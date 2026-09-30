/** Browser request IDs also work on a disposable HTTP host, where randomUUID is unavailable. */
export function clientRequestId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
