/** Pure URL compatibility helpers; view selection belongs to the App Router. */
export type QueryValue = string | number | boolean | undefined | null;
export interface RouteLocation {
  rawPath: string;
  path: string;
  query: Record<string, string>;
  locale: string;
}

export function routeLocation(pathname: string, search = ""): RouteLocation {
  const rawPath = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const localized = /^\/(ar|en)(?:\/|$)/.exec(rawPath);
  const path = localized ? rawPath.slice(localized[0].length - (localized[0].endsWith("/") ? 1 : 0)) || "/" : rawPath;
  // URLSearchParams handles '+' correctly and never mutates Object.prototype.
  const query = Object.fromEntries(new URLSearchParams(search));
  return { rawPath, path, query, locale: localized?.[1] ?? "en" };
}

export function routeHref(path: string, query?: Record<string, QueryValue>, locale = "en"): string {
  if (locale !== "en" && locale !== "ar") throw new Error("Unsupported route locale");
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path)) {
    throw new Error("Navigation requires an absolute internal path");
  }
  const target = new URL(path, "http://route.invalid");
  // Already-prefixed routes remain explicit; never create /ar/ar/... .
  if (locale === "ar" && !/^\/(ar|en)(?:\/|$)/.test(target.pathname)) {
    target.pathname = `/ar${target.pathname === "/" ? "" : target.pathname}`;
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") target.searchParams.delete(key);
      else target.searchParams.set(key, String(value));
    }
  }
  return `${target.pathname}${target.search}${target.hash}`;
}
