import { NextResponse } from "next/server";
import { search } from "@/server/search/service";
import { queryToSearchState } from "@/server/search/types";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { normalizeSearchText } from "@/server/search/normalize";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) query[k] = v;
  const state = queryToSearchState(query);

  const result = await search(state);

  // record search analytics (essential business telemetry, minimized)
  db.searchQuery
    .create({
      data: {
        queryText: state.q ?? "",
        normalizedText: normalizeSearchText(state.q ?? ""),
        resultCount: result.total,
      },
    })
    .catch(() => {});

  return NextResponse.json(result);
});
