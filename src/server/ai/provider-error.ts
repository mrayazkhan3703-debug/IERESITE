import type { SafeAiErrorCode } from "@/lib/operational-codes";

/** Sanitized categories only; raw provider messages never cross this boundary. */
export class AiProviderError extends Error {
  constructor(readonly code: SafeAiErrorCode, message: string,
    readonly usage: { promptTokens: number | null; completionTokens: number | null } | null = null,
    readonly diagnostics: { httpStatus: number; providerCode: string | null; requestId: string | null } | null = null) {
    super(message); this.name = "AiProviderError";
  }
}
