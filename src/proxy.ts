import { type NextRequest, NextResponse } from "next/server";
import { lookupRedirect } from "@/server/seo/sitemap";
import { isSafeInternalRedirectPath } from "@/server/seo/redirect-path";
import { buildContentSecurityPolicy, createCspNonce } from "@/server/security/content-security-policy";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function proxy(request: NextRequest) {
  const redirect = await lookupRedirect(request.nextUrl.pathname);
  if (redirect && isSafeInternalRedirectPath(redirect.to)) {
    const destination = request.nextUrl.clone();
    destination.pathname = redirect.to;
    destination.search = request.nextUrl.search;
    const status = REDIRECT_STATUSES.has(redirect.statusCode) ? redirect.statusCode : 308;
    const response = NextResponse.redirect(destination, status);
    if (process.env.APP_ENV === "staging") response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  const locale = request.nextUrl.pathname === "/ar" || request.nextUrl.pathname.startsWith("/ar/") ? "ar" : "en";
  const nonce = createCspNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  requestHeaders.set("x-iere-locale", locale);
  requestHeaders.set("x-iere-path", request.nextUrl.pathname);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the request CSP while rendering so it can nonce framework and
  // inline bootstrap scripts; return the same policy to the browser.
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  if (process.env.APP_ENV === "staging") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon.ico|robots.txt|sitemap.xml|images/|brand/).*)"],
};
