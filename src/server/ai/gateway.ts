/**
 * AI gateway (ADR-004): server-side provider registry; credentials never reach clients.
 * Provider failures are surfaced; there is no implicit cross-provider fallback.
 * Backend only — never imported client-side.
 */
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { logEvent } from "@/server/rate-limit";
import { Prisma } from "@prisma/client";
import { aiBudgetDecision, aiProviderGateCode, AiProviderBlockedError, estimateAiPromptCharacters, estimateAiReservationTokens } from "./controls";
import { generateWithGemini, GeminiProviderError } from "./gemini-provider";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** correlation for usage tracking */
  meta?: { kind: "CHAT" | "NL_SEARCH" | "RAG"; conversationId?: string };
}

export interface ChatResponse {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costMicros: number | null;
  model: string;
}

export interface ChatProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function assertAiFeatureAvailable(provider: string) {
  const config = getConfig();
  const flag = await db.featureFlag.findUnique({ where: { key: "ai_advisor" }, select: { isEnabled: true, rolloutPercent: true } });
  const blockedCode = aiProviderGateCode(provider, config.AI_LIVE_ENABLED, flag);
  if (blockedCode) {
    logEvent("ai.request_blocked", { provider, code: blockedCode });
    throw new AiProviderBlockedError(blockedCode);
  }
}

async function reserveLiveAiUsage(provider: string, model: string, req: ChatRequest) {
  const config = getConfig();
  const promptCharacters = estimateAiPromptCharacters(req.messages);
  if (promptCharacters > config.AI_MAX_PROMPT_CHARS) {
    logEvent("ai.request_blocked", { provider, code: "AI_PROMPT_TOO_LARGE" });
    throw new AiProviderBlockedError("AI_PROMPT_TOO_LARGE");
  }
  const reservationTokens = estimateAiReservationTokens(promptCharacters, config.AI_MAX_OUTPUT_TOKENS);
  const now = new Date();

  try {
    return await db.$transaction(async (tx) => {
      const flag = await tx.featureFlag.findUnique({ where: { key: "ai_advisor" }, select: { isEnabled: true, rolloutPercent: true } });
      const blockedCode = aiProviderGateCode(provider, config.AI_LIVE_ENABLED, flag);
      if (blockedCode) {
        logEvent("ai.request_blocked", { provider, code: blockedCode });
        throw new AiProviderBlockedError(blockedCode);
      }
      const usage = await tx.aiUsage.findMany({
        where: { createdAt: { gte: utcDayStart(now) } },
        select: { reservedTokens: true, promptTokens: true, completionTokens: true },
        take: config.AI_DAILY_REQUEST_LIMIT + 1,
      });
      const budgetCode = aiBudgetDecision(
        usage,
        reservationTokens,
        config.AI_DAILY_REQUEST_LIMIT,
        config.AI_DAILY_TOKEN_LIMIT,
        config.AI_MAX_OUTPUT_TOKENS,
      );
      if (budgetCode) {
        logEvent("ai.request_blocked", { provider, code: budgetCode });
        throw new AiProviderBlockedError(budgetCode);
      }
      return tx.aiUsage.create({
        data: {
          provider,
          model,
          kind: req.meta?.kind ?? "CHAT",
          status: "RESERVED",
          reservedTokens: reservationTokens,
          promptTokens: null,
          conversationId: req.meta?.conversationId,
        },
        select: { id: true, reservedTokens: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof AiProviderBlockedError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      logEvent("ai.request_blocked", { provider, code: "AI_BUDGET_BUSY" });
      throw new AiProviderBlockedError("AI_BUDGET_BUSY");
    }
    throw error;
  }
}

export function safeProviderFailureCode(error: unknown): string {
  if (error instanceof GeminiProviderError) return error.code;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out")) return "PROVIDER_TIMEOUT";
  const status = message.match(/HTTP (\d{3})/)?.[1];
  if (status === "401" || status === "403") return "PROVIDER_AUTH_FAILED";
  if (status === "429") return "PROVIDER_RATE_LIMITED";
  return "PROVIDER_FAILED";
}

async function finishAiUsage(
  reservation: { id: string; reservedTokens: number },
  result: Pick<ChatResponse, "promptTokens" | "completionTokens"> | null,
  errorCode: string | null,
) {
  const knownUsage = result?.promptTokens !== null && result?.promptTokens !== undefined
    && result.completionTokens !== null && result.completionTokens !== undefined;
  await db.aiUsage.updateMany({
    where: { id: reservation.id, status: "RESERVED" },
    data: {
      status: errorCode ? "FAILED" : "SUCCEEDED",
      ...(result ? { promptTokens: result.promptTokens, completionTokens: result.completionTokens } : {}),
      ...(knownUsage && result ? { reservedTokens: result.promptTokens! + result.completionTokens! } : {}),
      errorCode,
    },
  });
}

class GeminiChatProvider implements ChatProvider {
  readonly name = "gemini";

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const config = getConfig();
    await assertAiFeatureAvailable(this.name);
    const apiKey = config.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new GeminiProviderError("PROVIDER_CONFIG_MISSING", "GEMINI_API_KEY is required when AI_PROVIDER=gemini");

    const started = Date.now();
    const reservation = await reserveLiveAiUsage(this.name, config.GEMINI_MODEL, req);
    try {
      const result = await generateWithGemini({ ...req, maxTokens: config.AI_MAX_OUTPUT_TOKENS }, {
        apiKey,
        model: config.GEMINI_MODEL,
        timeoutMs: config.AI_REQUEST_TIMEOUT_MS,
      });
      await finishAiUsage(reservation, result, null);
      logEvent("ai.chat", {
        provider: this.name,
        kind: req.meta?.kind,
        latencyMs: Date.now() - started,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });
      return { ...result, costMicros: null };
    } catch (error) {
      const errorCode = safeProviderFailureCode(error);
      await finishAiUsage(reservation, error instanceof GeminiProviderError ? error.usage : null, errorCode).catch(() => {});
      logEvent("ai.chat_failed", { provider: this.name, kind: req.meta?.kind, latencyMs: Date.now() - started, errorCode });
      throw error;
    }
  }
}

/** Explicit local-only response; it never claims to be generated advice. */
class MockChatProvider implements ChatProvider {
  readonly name = "mock";

  async chat(): Promise<ChatResponse> {
    await assertAiFeatureAvailable(this.name);
    return {
      content: "Local AI mock is enabled. No Gemini or OpenAI model was called; this is not investment advice.",
      promptTokens: null,
      completionTokens: null,
      costMicros: null,
      model: "local-mock",
    };
  }
}

let provider: ChatProvider | null = null;

export function getChatProvider(): ChatProvider {
  if (!provider) {
    const selected = getConfig().AI_PROVIDER;
    switch (selected) {
      case "mock":
        provider = new MockChatProvider();
        break;
      case "zai":
        throw new AiProviderBlockedError("AI_PROVIDER_NOT_APPROVED");
      case "gemini":
        provider = new GeminiChatProvider();
        break;
      case "openai":
        throw new Error("AI_PROVIDER=openai is not implemented yet; configure it only after the OpenAI adapter is added");
    }
  }
  return provider;
}

/** One-shot helper for deterministic-ish tasks (NL parsing etc.) */
export async function complete(
  system: string,
  user: string,
  opts?: { kind?: "CHAT" | "NL_SEARCH" | "RAG"; conversationId?: string; temperature?: number }
): Promise<string> {
  const res = await getChatProvider().chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: opts?.temperature ?? 0.2,
    meta: { kind: opts?.kind ?? "CHAT", conversationId: opts?.conversationId },
  });
  return res.content;
}
