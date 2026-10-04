import { inceptionConfigCode } from "./inception-provider";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { aiProviderGateCode, aiUsageQuotaDecision } from "./controls";
import { aiDailyUsageTotals } from "./usage-totals";
import { isSafeAiErrorCode } from "@/lib/operational-codes";

export async function aiReadiness() {
  const config = getConfig(), now = new Date();
  const model = config.AI_PROVIDER === "inception" ? config.INCEPTION_MODEL : config.AI_PROVIDER === "mock" ? "local-mock" : "unsupported-provider";
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [flag, today, recent] = await Promise.all([
    db.featureFlag.findUnique({ where: { key: "ai_advisor" }, select: { isEnabled: true, rolloutPercent: true } }),
    aiDailyUsageTotals(db, dayStart, config.AI_MAX_OUTPUT_TOKENS),
    db.aiUsage.findMany({ where: { provider: config.AI_PROVIDER, model }, orderBy: { createdAt: "desc" }, take: 20, select: { kind: true, status: true, errorCode: true, createdAt: true } }),
  ]);
  const gate = aiProviderGateCode(config.AI_PROVIDER, config.AI_LIVE_ENABLED, flag);
  const configCode = config.AI_PROVIDER === "inception" ? inceptionConfigCode(config.INCEPTION_API_KEY, config.INCEPTION_MODEL, config.INCEPTION_BASE_URL) : null;
  const budgetCode = aiUsageQuotaDecision(today, config.AI_MAX_OUTPUT_TOKENS, config.AI_DAILY_REQUEST_LIMIT, config.AI_DAILY_TOKEN_LIMIT, config.AI_USAGE_LIMIT_MODE);
  const latest = recent[0];
  const fresh = latest && now.getTime() - latest.createdAt.getTime() < 3600000;
  const measured = fresh && latest.status === "SUCCEEDED";
  return {
    checkedAt: now.toISOString(), provider: config.AI_PROVIDER, model, usageLimitMode: config.AI_USAGE_LIMIT_MODE,
    status: gate || configCode || budgetCode ? "BLOCKED" : config.AI_PROVIDER === "mock" ? "LOCAL_ONLY" : measured ? "RECENT_SUCCESS" : fresh && latest.status === "FAILED" ? "DEGRADED" : "UNVERIFIED",
    reason: gate || configCode || budgetCode || (fresh && latest?.status === "FAILED" ? isSafeAiErrorCode(latest.errorCode) ? latest.errorCode : "PROVIDER_FAILED" : null),
    limits: { ...today, dailyRequests: config.AI_USAGE_LIMIT_MODE === "unlimited" ? null : config.AI_DAILY_REQUEST_LIMIT,
      dailyTokens: config.AI_USAGE_LIMIT_MODE === "unlimited" ? null : config.AI_DAILY_TOKEN_LIMIT,
      hourlyRequests: config.AI_USAGE_LIMIT_MODE === "unlimited" ? null : config.AI_RATE_LIMIT_PER_HOUR,
      maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS, timeoutMs: config.AI_REQUEST_TIMEOUT_MS },
    recent: recent.map((row) => ({ ...row, errorCode: row.errorCode === null ? null : isSafeAiErrorCode(row.errorCode) ? row.errorCode : "PROVIDER_FAILED", createdAt: row.createdAt.toISOString() })),
    note: "Configuration is not generation evidence. Recent success is a measured request within one hour; it does not guarantee the next request or verify property facts. Token reservations are budget units, not billed cost.",
  };
}
