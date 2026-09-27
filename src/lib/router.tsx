"use client";

/** Compatibility API backed by native Next navigation, not a view router. */
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { routeHref, routeLocation, type QueryValue, type RouteLocation } from "./route-location";
export type { QueryValue, RouteLocation } from "./route-location";

type Navigator = Pick<ReturnType<typeof useRouter>, "push" | "replace">;
let activeNavigator: Navigator | null = null;
const initialLocation = routeLocation("/");
const ServerSnapshotContext = createContext<RouteLocation>(initialLocation);

function NavigationBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const committedPath = useRef(pathname);
  useLayoutEffect(() => { committedPath.current = pathname; }, [pathname]);
  useLayoutEffect(() => {
    activeNavigator = router;
    return () => { if (activeNavigator === router) activeNavigator = null; };
  }, [router]);
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const restoreDestination = () => {
      if (window.location.pathname === committedPath.current) return;
      committedPath.current = window.location.pathname;
      clearTimeout(refreshTimer);
      // The pinned 16.1.3 history cache can retain the outgoing page for nested
      // dynamic routes. After Next restores its tree, refresh that destination
      // using the public API. Query-only traversal keeps calculator/map state.
      refreshTimer = setTimeout(() => router.refresh(), 0);
    };
    window.addEventListener("popstate", restoreDestination);
    // Legacy bookmarks must request a real route, not only mutate the address.
    if (window.location.hash.startsWith("#/")) {
      const legacy = window.location.hash.slice(1);
      try { router.replace(routeHref(legacy)); }
      catch { /* A malformed bookmark must neither leave this origin nor crash the shell. */ }
    }
    return () => { clearTimeout(refreshTimer); window.removeEventListener("popstate", restoreDestination); };
  }, [router]);
  return null;
}

export function RouterServerSnapshotProvider({ location, children }: { location: RouteLocation; children: React.ReactNode }) {
  return <ServerSnapshotContext.Provider value={location}><NavigationBridge />{children}</ServerSnapshotContext.Provider>;
}

/** Locale/query state updates with native navigation and browser back/forward. */
export function useRoute(): RouteLocation {
  const fallback = useContext(ServerSnapshotContext);
  const pathname = usePathname();
  const search = useSearchParams();
  return useMemo(() => pathname ? routeLocation(pathname, search?.toString()) : fallback, [pathname, search, fallback]);
}

export function getLocale() {
  return typeof window === "undefined" ? "en" : routeLocation(window.location.pathname).locale;
}

export function href(path: string, query?: Record<string, QueryValue>) {
  return routeHref(path, query, getLocale());
}

function go(target: string, replace = false) {
  if (typeof window === "undefined") return;
  const url = new URL(target, window.location.origin);
  if (target === window.location.pathname + window.location.search + window.location.hash) return;
  if (url.pathname === window.location.pathname && !url.hash) {
    // Next's patched History API updates useSearchParams without remounting a
    // calculator/search scene or requesting RSC for each slider/filter edit.
    if (replace) window.history.replaceState(null, "", target);
    else window.history.pushState(null, "", target);
  } else if (activeNavigator) {
    if (replace) activeNavigator.replace(target);
    else activeNavigator.push(target);
  } else {
    // Safe pre-registration fallback: still visit the server-owned route.
    if (replace) window.location.replace(target);
    else window.location.assign(target);
  }
}

export function navigate(path: string, query?: Record<string, QueryValue>, opts?: { replace?: boolean }) {
  go(href(path, query), opts?.replace);
}

export function back() { window.history.back(); }

export function setLocale(next: string) {
  if (typeof window === "undefined") return;
  const location = routeLocation(window.location.pathname, window.location.search);
  go(routeHref(location.path, location.query, next), true);
}

export interface MatchResult { pattern: string | null; params: Record<string, string> }
export function matchPath(pathname: string, patterns: string[]): MatchResult {
  const segments = pathname.split("/").filter(Boolean);
  for (const pattern of patterns) {
    const pieces = pattern.split("/").filter(Boolean);
    if (pieces.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < pieces.length; index++) {
      if (pieces[index].startsWith(":")) params[pieces[index].slice(1)] = decodeURIComponent(segments[index]);
      else if (pieces[index] !== segments[index]) { matches = false; break; }
    }
    if (matches) return { pattern, params };
  }
  return { pattern: null, params: {} };
}

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  query?: Record<string, QueryValue>;
  children: React.ReactNode;
}

export function Link({ to, query, children, ...rest }: LinkProps) {
  const location = useRoute();
  const external = /^(https?:|mailto:|tel:)/.test(to);
  if (external) return <a href={to} {...rest}>{children}</a>;
  // Disable speculative prefetch: respect candidate payload/provider boundaries.
  return <NextLink href={routeHref(to, query, location.locale)} prefetch={false} {...rest}>{children}</NextLink>;
}

export function useRouteChange(handler: (loc: RouteLocation) => void) {
  const loc = useRoute();
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) window.scrollTo({ top: 0, behavior: "auto" });
    first.current = false;
    handler(loc);
    // Callers retain the existing route-triggered callback contract.
  }, [loc.rawPath, loc.locale, JSON.stringify(loc.query)]);
}
