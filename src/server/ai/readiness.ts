import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { aiProviderGateCode, aiBudgetDecision } from "./controls";
import { isSafeAiErrorCode } from "@/lib/operational-codes";

export async function aiReadiness() {
  const config = getConfig(), now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [flag, today, recent] = await Promise.all([
    db.featureFlag.findUnique({ where: { key: "ai_advisor" }, select: { isEnabled: true, rolloutPercent: true } }),
    db.aiUsage.findMany({ where: { createdAt: { gte: dayStart } }, select: { reservedTokens: true, promptTokens: true, completionTokens: true }, take: 10001 }),
    db.aiUsage.findMany({ where: { provider: config.AI_PROVIDER, model: config.GEMINI_MODEL }, orderBy: { createdAt: "desc" }, take: 20, select: { kind: true, status: true, errorCode: true, createdAt: true } }),
  ]);
  const gate = aiProviderGateCode(config.AI_PROVIDER, config.AI_LIVE_ENABLED, flag);
  const configCode = config.AI_PROVIDER === "gemini" && !config.GEMINI_API_KEY?.trim() ? "PROVIDER_CONFIG_MISSING" : null;
  const budgetCode = aiBudgetDecision(today, config.AI_MAX_OUTPUT_TOKENS, config.AI_DAILY_REQUEST_LIMIT, config.AI_DAILY_TOKEN_LIMIT, config.AI_MAX_OUTPUT_TOKENS);
  const latest = recent[0];
  const fresh = latest && now.getTime() - latest.createdAt.getTime() < 3600000;
  const measured = fresh && latest.status === "SUCCEEDED";
  return {
    checkedAt: now.toISOString(), provider: config.AI_PROVIDER, model: config.AI_PROVIDER === "gemini" ? config.GEMINI_MODEL : "local-mock",
    status: gate || configCode || budgetCode ? "BLOCKED" : config.AI_PROVIDER === "mock" ? "LOCAL_ONLY" : measured ? "RECENT_SUCCESS" : fresh && latest.status === "FAILED" ? "DEGRADED" : "UNVERIFIED",
    reason: gate || configCode || budgetCode || (fresh && latest?.status === "FAILED" ? isSafeAiErrorCode(latest.errorCode) ? latest.errorCode : "PROVIDER_FAILED" : null),
    limits: { requestsToday: today.length, dailyRequests: config.AI_DAILY_REQUEST_LIMIT, dailyTokens: config.AI_DAILY_TOKEN_LIMIT, reservedTokensToday: today.reduce((sum, row) => sum + row.reservedTokens, 0), maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS, timeoutMs: config.AI_REQUEST_TIMEOUT_MS },
    recent: recent.map((row) => ({ ...row, errorCode: row.errorCode === null ? null : isSafeAiErrorCode(row.errorCode) ? row.errorCode : "PROVIDER_FAILED", createdAt: row.createdAt.toISOString() })),
    note: "Configuration is not generation evidence. Recent success is a measured request within one hour; it does not guarantee the next request or verify property facts. Token reservations are budget units, not billed cost.",
  };
}
