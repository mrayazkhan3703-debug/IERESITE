import { AiProviderError } from "./provider-error";

/** Remote database round trips can exceed Prisma's five-second default.
 * Keep the reservation atomic and bounded by the original processing deadline.
 */
export function aiReservationTransactionOptions(deadlineAt: number, now = Date.now()) {
  const remaining = Math.floor(deadlineAt - now);
  if (!Number.isFinite(remaining) || remaining < 1000) {
    throw new AiProviderError("PROVIDER_TIMEOUT", "Insufficient time to reserve AI usage");
  }
  const maxWait = Math.min(3000, Math.floor(remaining / 4));
  return { maxWait, timeout: Math.min(15000, remaining - maxWait) };
}

/** A failed atomic reservation never authorizes a provider request. */
export function aiReservationFailureCode(databaseCode: string) {
  return ["P2028", "P2034"].includes(databaseCode) ? "AI_BUDGET_BUSY" as const : null;
}
