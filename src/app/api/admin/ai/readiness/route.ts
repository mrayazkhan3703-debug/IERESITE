import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, HttpError, requirePermission } from "@/server/auth";
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
  z.object({ action: z.literal("VERIFY_PROVIDER") }).strict().parse(await jsonBody(req));
  const started = Date.now(); let succeeded = false, reason: string | null = null;
  try {
    const result = await getChatProvider().chat({ messages: [{ role: "system", content: "This is a service verification. Reply exactly READY. Do not call tools, create leads, or provide property advice." }, { role: "user", content: "Service verification" }], temperature: 0, meta: { kind: "RAG" } });
    succeeded = result.model !== "local-mock" && result.content.trim() === "READY";
    if (!succeeded) reason = result.model === "local-mock" ? "LOCAL_ONLY" : "PROVIDER_RESPONSE_INVALID";
  } catch (error) { reason = error instanceof AiProviderBlockedError ? error.code : safeProviderFailureCode(error); }
  const latencyMs = Date.now() - started;
  await audit({ actorId: actor.id, action: "ai.provider.verify", resourceType: "AI_PROVIDER", resourceId: "selected", after: { succeeded, reason, latencyMs }, ip: clientIp(req) });
  return NextResponse.json({ succeeded, reason, latencyMs, readiness: await aiReadiness() }, { headers: { "Cache-Control": "private, no-store" } });
}, { rateLimit: { key: "ai-provider-verify", limit: 3, windowMs: 3600000 } });
