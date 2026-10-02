import { AiProviderError } from "./provider-error";

export const ADVISOR_PROCESSING_MS = 60_000;
export function requireTurnBudget(deadlineAt: number) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new AiProviderError("PROVIDER_TIMEOUT", "Advisor processing budget expired");
  return remaining;
}

/** Tools are read-only. A timed-out operation may finish reading, but its result is never persisted or used. */
export async function withinTurnBudget<T>(operation: () => Promise<T>, deadlineAt: number): Promise<T> {
  const remaining = requireTurnBudget(deadlineAt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AiProviderError("PROVIDER_TIMEOUT", "Advisor processing budget expired")), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
