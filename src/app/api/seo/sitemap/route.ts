import { NextResponse } from "next/server";
import { sitemapXml } from "@/server/seo/sitemap";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const baseUrl = process.env.APP_URL ?? url.origin;
  const xml = await sitemapXml(baseUrl);
  return new NextResponse(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});
