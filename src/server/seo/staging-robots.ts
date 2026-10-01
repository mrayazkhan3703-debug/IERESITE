import type { MetadataRoute } from "next";
import { PRIVATE_CRAWLER_PATHS, robotsTxt } from "@/server/seo/sitemap";

export function robotsForEnvironment(appEnv: string | undefined, baseUrl: string): MetadataRoute.Robots {
  if (appEnv === "staging") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: PRIVATE_CRAWLER_PATHS,
    },
    sitemap: new URL("/sitemap.xml", baseUrl).toString(),
  };
}

export function robotsTextForEnvironment(appEnv: string | undefined, baseUrl: string): string {
  return appEnv === "staging" ? "User-agent: *\nDisallow: /\n" : robotsTxt(baseUrl);
}
