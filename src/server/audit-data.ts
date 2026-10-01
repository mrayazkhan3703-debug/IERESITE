/** Audit snapshots must be valid JSON and must never retain credentials. */
const sensitiveKey = /password|secret|token|authorization|cookie|credential|api.?key|private.?key|connection.?string|database.?url/i;
const safeUsageKey = /^(promptTokens|completionTokens|totalTokens|tokenCount|reservedTokens|dailyTokenLimit)$/i;

export function redactAuditData(value: unknown): unknown {
  const seen = new WeakSet<object>();
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => {
    if (sensitiveKey.test(key) && !safeUsageKey.test(key)) return "[REDACTED]";
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "object" && item !== null) {
      if (seen.has(item)) return "[CIRCULAR]";
      seen.add(item);
    }
    return item;
  }) ?? "null");
}

export function serializeAuditData(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const encoded = JSON.stringify(redactAuditData(value));
  // Cutting JSON text mid-string made legacy snapshots unreadable. Keep a valid
  // marker instead; do not expose partial text that could contain credentials.
  return encoded.length <= 4000 ? encoded : JSON.stringify({ truncated: true, note: "Snapshot exceeds the audit size limit." });
}

export function readAuditData(encoded: string | null): unknown {
  if (!encoded) return null;
  try { return redactAuditData(JSON.parse(encoded)); }
  catch { return { unavailable: true, note: "Legacy snapshot is not valid JSON." }; }
}
