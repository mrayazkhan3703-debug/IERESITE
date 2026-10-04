/**
 * AI gateway (ADR-004): server-side provider registry; credentials never reach clients.
 * Provider failures are surfaced; there is no implicit cross-provider fallback.
 * Backend only — never imported client-side.
 */
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { logEvent } from "@/server/rate-limit";
import { Prisma } from "@prisma/client";
import { aiUsageQuotaDecision, aiProviderGateCode, AiProviderBlockedError, estimateAiPromptCharacters, estimateAiReservationTokens } from "./controls";
import { aiDailyUsageTotals } from "./usage-totals";
import { generateWithInception, inceptionConfigCode } from "./inception-provider";
import { AiProviderError } from "./provider-error";
import { aiRetryDelay } from "./retry-policy";
import { requireTurnBudget } from "./turn-budget";
import { aiReservationFailureCode, aiReservationTransactionOptions } from "./reservation-budget";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Internal shared processing deadline; never accepted from a public request. */
  deadlineAt?: number;
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

async function reserveLiveAiUsage(provider: string, model: string, req: ChatRequest, deadlineAt: number) {
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
      const usage = config.AI_USAGE_LIMIT_MODE === "unlimited" ? { requestsToday: 0, reservedTokensToday: 0 }
        : await aiDailyUsageTotals(tx, utcDayStart(now), config.AI_MAX_OUTPUT_TOKENS);
      const budgetCode = aiUsageQuotaDecision(usage, reservationTokens, config.AI_DAILY_REQUEST_LIMIT,
        config.AI_DAILY_TOKEN_LIMIT, config.AI_USAGE_LIMIT_MODE);
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...aiReservationTransactionOptions(deadlineAt) });
  } catch (error) {
    if (error instanceof AiProviderBlockedError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const code = aiReservationFailureCode(error.code);
      if (code) {
        logEvent("ai.request_blocked", { provider, code });
        throw new AiProviderBlockedError(code);
      }
    }
    throw error;
  }
}

export function safeProviderFailureCode(error: unknown): string {
  if (error instanceof AiProviderError) return error.code;
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

class InceptionChatProvider implements ChatProvider {
  readonly name = "inception";

  async chat(req: ChatRequest): Promise<ChatResponse> {
    return this.attempt(req, Math.min(req.deadlineAt ?? Infinity, Date.now() + getConfig().AI_REQUEST_TIMEOUT_MS), false);
  }

  private async attempt(req: ChatRequest, deadline: number, alreadyRetried: boolean): Promise<ChatResponse> {
    requireTurnBudget(deadline);
    const config = getConfig();
    await assertAiFeatureAvailable(this.name);
    const apiKey = config.INCEPTION_API_KEY?.trim();
    if (inceptionConfigCode(apiKey, config.INCEPTION_MODEL, config.INCEPTION_BASE_URL)) throw new AiProviderError("PROVIDER_CONFIG_MISSING", "Inception server configuration is incomplete or invalid.");

    const started = Date.now();
    const reservation = await reserveLiveAiUsage(this.name, config.INCEPTION_MODEL, req, deadline);
    try {
      requireTurnBudget(deadline);
      const result = await generateWithInception({ ...req, maxTokens: Math.min(req.maxTokens ?? config.AI_MAX_OUTPUT_TOKENS, config.AI_MAX_OUTPUT_TOKENS) }, {
        apiKey: apiKey!,
        model: config.INCEPTION_MODEL,
        baseUrl: config.INCEPTION_BASE_URL,
        timeoutMs: Math.max(1, deadline - Date.now()),
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
      await finishAiUsage(reservation, error instanceof AiProviderError ? error.usage : null, errorCode).catch(() => {});
      logEvent("ai.chat_failed", { provider: this.name, kind: req.meta?.kind, latencyMs: Date.now() - started, errorCode, ...(error instanceof AiProviderError ? error.diagnostics ?? {} : {}) });
      const delay = aiRetryDelay(errorCode, alreadyRetried, deadline - Date.now());
      if (delay !== null) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        // A fresh attempt repeats the feature/budget checks and retains a
        // separate reservation for the failed call. No hidden free retry.
        return this.attempt(req, deadline, true);
      }
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
      content: "Local AI mock is enabled. No external model was called; this is not investment advice.",
      promptTokens: null,
      completionTokens: null,
      costMicros: null,
      model: "local-mock",
    };
  }
}

let provider: ChatProvider | null = null;
export function createChatProvider(selected: string): ChatProvider {
  switch (selected) {
    case "mock": return new MockChatProvider();
    case "inception": return new InceptionChatProvider();
    default: throw new AiProviderBlockedError("AI_PROVIDER_NOT_APPROVED");
  }
}
export function getChatProvider(): ChatProvider {
  const selected = getConfig().AI_PROVIDER;
  if (!provider || provider.name !== selected) provider = createChatProvider(selected);
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
