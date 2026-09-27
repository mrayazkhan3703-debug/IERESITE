/** Generate a per-response nonce using Web Crypto, available in Next Proxy. */
export function createCspNonce(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Production-like policy for the app shell. Script execution requires a fresh
 * nonce; inline style attributes remain allowed because the UI uses React
 * style props for charts, maps and responsive measurements.
 */
export function buildContentSecurityPolicy(nonce: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(nonce)) throw new Error("Invalid CSP nonce.");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}
