import type { MetadataRoute } from "next";
import { robotsTxt } from "@/server/seo/sitemap";

export function robotsForEnvironment(appEnv: string | undefined, baseUrl: string): MetadataRoute.Robots {
  if (appEnv === "staging") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/", "/account/", "/admin/", "/compare",
        "/ar/account/", "/ar/admin/", "/ar/compare",
      ],
    },
    sitemap: new URL("/sitemap.xml", baseUrl).toString(),
  };
}

export function robotsTextForEnvironment(appEnv: string | undefined, baseUrl: string): string {
  return appEnv === "staging" ? "User-agent: *\nDisallow: /\n" : robotsTxt(baseUrl);
}
