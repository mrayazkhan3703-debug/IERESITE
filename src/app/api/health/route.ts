import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { indexStatus } from "@/server/search/service";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getConfig();
  const webOnlyPreview = config.APP_ENV === "staging" && config.STAGING_WEB_ONLY;
  const started = Date.now();
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const index = await indexStatus().catch(() => ({ provider: "local", size: 0, built: false }));
  const degraded: string[] = [];
  if (!dbOk) degraded.push("database");
  if (!index.built) degraded.push("search-index-not-yet-built");
  if (webOnlyPreview) degraded.push("worker-disabled-web-only-preview");

  const body = {
    status: degraded.includes("database") || webOnlyPreview ? "degraded" : "ok",
    service: "investment-experts-web",
    env: process.env.APP_ENV ?? "development",
    checks: {
      database: { ok: dbOk, latencyMs: dbLatencyMs },
      searchIndex: { ok: index.built, ...index },
      jobRunner: { mode: webOnlyPreview ? "disabled-web-only-preview" : "dedicated-worker" },
    },
    degraded,
    uptimeSec: Math.round(process.uptime()),
    tookMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: dbOk ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
