/** A malformed model tool request is protocol data, never a visitor-facing answer. */
export function containsAdvisorToolEnvelope(content: string): boolean {
  return /"tool"\s*:/.test(content) && /"args"\s*:/.test(content);
}
