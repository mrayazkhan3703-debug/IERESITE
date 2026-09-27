import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolveSpaRoutePage, spaRouteMetadata } from "./route-contract";

/** Metadata for concrete critical routes; keep the catch-all SEO contract. */
export async function criticalPageMetadata(path: string): Promise<Metadata> {
  const locale = (await headers()).get("x-iere-locale") === "ar" ? "ar" : "en";
  return spaRouteMetadata(path, locale, await resolveSpaRoutePage(path));
}
