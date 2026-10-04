import { NextResponse } from "next/server";
import { z } from "zod";
import { parseNlQuery } from "@/server/ai/advisor";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { clientIp, rateLimit, logEvent } from "@/server/rate-limit";
import { PUBLIC_COMMUNITY_WHERE } from "@/server/domain/visibility";

const schema = z.object({ query: z.string().min(3).max(400), locale: z.enum(["en", "ar"]).default("en") }).strict();

export const POST = apiHandler(
  async (req) => {
    const config = getConfig();
    const rl = config.AI_USAGE_LIMIT_MODE === "unlimited" ? { ok: true, retryAfterSec: 0 }
      : rateLimit(`nl:${clientIp(req)}`, config.AI_RATE_LIMIT_PER_HOUR, 3600_000);
    if (!rl.ok) {
      return NextResponse.json({ error: "Natural-language search limit reached. Use the filters or try later.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    }

    const body = await jsonBody<z.infer<typeof schema>>(req);
    const { query, locale } = schema.parse(body);

    const communities = await db.community.findMany({ where: PUBLIC_COMMUNITY_WHERE, select: { name: true } });
    const result = await parseNlQuery(query, communities.map((c) => c.name), locale);

    logEvent("nl_search.parsed", { queryLen: query.length, filters: Object.keys(result.filters ?? {}) });

    return NextResponse.json(result);
  },
  { rateLimit: { limit: 12, windowMs: 60_000, key: "nls" } }
);
