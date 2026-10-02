export type AiProviderGateCode = "AI_KILL_SWITCH" | "AI_LIVE_DISABLED" | "AI_PROVIDER_NOT_APPROVED";

export class AiProviderBlockedError extends Error {
  constructor(readonly code: AiProviderGateCode | "AI_DAILY_REQUEST_LIMIT" | "AI_DAILY_TOKEN_LIMIT" | "AI_BUDGET_BUSY" | "AI_PROMPT_TOO_LARGE") {
    super(code);
    this.name = "AiProviderBlockedError";
  }
}

export function aiProviderGateCode(
  provider: string,
  liveEnabled: boolean,
  advisorFlag: { isEnabled: boolean; rolloutPercent: number } | null,
): AiProviderGateCode | null {
  if (!advisorFlag?.isEnabled || advisorFlag.rolloutPercent < 100) return "AI_KILL_SWITCH";
  if (provider === "mock") return null;
  if (!liveEnabled) return "AI_LIVE_DISABLED";
  if (provider !== "inception") return "AI_PROVIDER_NOT_APPROVED";
  return null;
}

export function estimateAiPromptCharacters(messages: { content: string }[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

/** Conservative token estimate; exact provider tokenization and billed cost may be unknown. */
export function estimateAiReservationTokens(promptCharacters: number, maxOutputTokens: number): number {
  return Math.ceil(promptCharacters / 3) + maxOutputTokens;
}

export type AiBudgetUsage = {
  reservedTokens: number;
  promptTokens: number | null;
  completionTokens: number | null;
};

export function aiBudgetDecision(
  rows: AiBudgetUsage[],
  requestedTokens: number,
  dailyRequestLimit: number,
  dailyTokenLimit: number,
  unknownUsageReserveTokens: number,
): "AI_DAILY_REQUEST_LIMIT" | "AI_DAILY_TOKEN_LIMIT" | null {
  if (rows.length >= dailyRequestLimit) return "AI_DAILY_REQUEST_LIMIT";
  const consumed = rows.reduce((sum, row) => {
    if (row.reservedTokens > 0) return sum + row.reservedTokens;
    if (row.promptTokens === null || row.completionTokens === null) return sum + unknownUsageReserveTokens;
    return sum + row.promptTokens + row.completionTokens;
  }, 0);
  return consumed + requestedTokens > dailyTokenLimit ? "AI_DAILY_TOKEN_LIMIT" : null;
}
