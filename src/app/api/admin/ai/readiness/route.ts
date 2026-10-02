import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, HttpError, requirePermission } from "@/server/auth";
import { advisorSystemPrompt } from "@/server/ai/advisor";
import { AiProviderError } from "@/server/ai/provider-error";
import { type ChatMessage } from "@/server/ai/gateway";
import { aiReadiness } from "@/server/ai/readiness";
import { getChatProvider, safeProviderFailureCode } from "@/server/ai/gateway";
import { AiProviderBlockedError } from "@/server/ai/controls";
import { clientIp } from "@/server/rate-limit";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async () => {
  await requirePermission("content:read");
  return NextResponse.json(await aiReadiness(), { headers: { "Cache-Control": "private, no-store" } });
});
export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  if (!actor.roles.some((role) => ["OWNER", "ADMIN"].includes(role))) throw new HttpError(403, "Only owners or admins can run a provider check.", "FORBIDDEN");
  const { scenario } = z.object({ action: z.literal("VERIFY_PROVIDER"), scenario: z.enum(["MINIMAL", "ADVISOR", "TOOL_FOLLOWUP"]).default("MINIMAL") }).strict().parse(await jsonBody(req));
  const started = Date.now(); let succeeded = false, reason: string | null = null;
  let diagnostics: { httpStatus: number; providerCode: string | null; requestId: string | null } | null = null;
  const messages: ChatMessage[] = scenario === "MINIMAL"
    ? [{ role: "system", content: "This is a service verification. Reply exactly READY. Do not call tools, create leads, or provide property advice." }, { role: "user", content: "Service verification" }]
    : [{ role: "system", content: await advisorSystemPrompt("en") }, { role: "user", content: scenario === "ADVISOR" ? "Hello. Explain how you help without asserting any property facts." : "Find a property matching my criteria." }];
  if (scenario === "TOOL_FOLLOWUP") messages.push({ role: "assistant", content: '{"tool":"search_properties","args":{}}' }, { role: "tool", content: '{"items":[],"total":0,"verification":"request-shape diagnostic only"}' }, { role: "user", content: "Explain that there are no results. Do not invent inventory." });
  try {
    const result = await getChatProvider().chat({ messages, deadlineAt: started + 60_000, temperature: 0, meta: { kind: "RAG" } });
    diagnostics = { httpStatus: 200, providerCode: null, requestId: null };
    succeeded = result.model !== "local-mock" && (scenario !== "MINIMAL" ? Boolean(result.content.trim()) : result.content.trim() === "READY");
    if (!succeeded) reason = result.model === "local-mock" ? "LOCAL_ONLY" : "PROVIDER_RESPONSE_INVALID";
  } catch (error) { diagnostics = error instanceof AiProviderError ? error.diagnostics : null; reason = error instanceof AiProviderBlockedError ? error.code : safeProviderFailureCode(error); }
  const latencyMs = Date.now() - started;
  await audit({ actorId: actor.id, action: "ai.provider.verify", resourceType: "AI_PROVIDER", resourceId: "selected", after: { scenario, succeeded, reason, latencyMs, diagnostics }, ip: clientIp(req) });
  return NextResponse.json({ scenario, succeeded, reason, latencyMs, diagnostics, readiness: await aiReadiness() }, { headers: { "Cache-Control": "private, no-store" } });
}, { rateLimit: { key: "ai-provider-verify", limit: 3, windowMs: 3600000 } });
