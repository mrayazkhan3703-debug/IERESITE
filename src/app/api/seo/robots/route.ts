import { NextResponse } from "next/server";
import { robotsTextForEnvironment } from "@/server/seo/staging-robots";

export const GET = () => {
  const body = robotsTextForEnvironment(process.env.APP_ENV, process.env.APP_URL ?? "http://localhost:3000");
  return new NextResponse(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
};
