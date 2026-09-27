const RESERVED_PUBLIC_PATHS = new Set(["api", "_next", "admin", "account"]);

/** Defense in depth for stored redirects, including legacy/corrupt DB rows. */
export function isSafeInternalRedirectPath(value: string): boolean {
  if (
    value.length > 500 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    !/^\/[A-Za-z0-9._~/-]*$/.test(value) ||
    value.includes("//") ||
    (value.endsWith("/") && value !== "/")
  ) {
    return false;
  }

  const segments = value.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  return !segments[0] || !RESERVED_PUBLIC_PATHS.has(segments[0].toLowerCase());
}
