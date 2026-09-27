import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requireUser } from "@/server/auth";
import { db } from "@/lib/db";
import { search } from "@/server/search/service";
import { queryToSearchState } from "@/server/search/types";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().max(120).optional(),
  searchState: z.record(z.string(), z.unknown()),
  alertConsent: z.boolean().default(false),
  alertFrequency: z.enum(["INSTANT", "DAILY", "WEEKLY", "MONTHLY"]).default("WEEKLY"),
});

export const GET = apiHandler(async () => {
  const user = await requireUser();
  const searches = await db.savedSearch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    savedSearches: searches.map((s) => ({
      id: s.id,
      name: s.name,
      searchState: JSON.parse(s.searchStateJson),
      alertConsent: s.alertConsent,
      alertFrequency: s.alertFrequency,
      lastMatchCount: s.lastMatchCount,
      lastMatchedAt: s.lastMatchedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

export const POST = apiHandler(async (req) => {
  const user = await requireUser();
  const body = await jsonBody<z.infer<typeof schema>>(req);
  const input = schema.parse(body);

  // validate the search state actually resolves
  const state = queryToSearchState(input.searchState as Record<string, string>);
  const result = await search({ ...state, page: 1, pageSize: 1 });

  const saved = await db.savedSearch.create({
    data: {
      userId: user.id,
      name: input.name ?? `Search · ${new Date().toLocaleDateString()}`,
      searchStateJson: JSON.stringify(input.searchState),
      alertConsent: input.alertConsent,
      alertFrequency: input.alertFrequency,
      lastMatchCount: result.total,
      lastMatchedAt: new Date(),
    },
  });
  return NextResponse.json({ id: saved.id, currentMatches: result.total }, { status: 201 });
});

export const DELETE = apiHandler(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await db.savedSearch.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.savedSearch.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
