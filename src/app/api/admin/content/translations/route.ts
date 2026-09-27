import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { pairContentTranslations, unlinkContentTranslation } from "@/server/domain/content-command";
import { clientIp } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  await requirePermission("content:read");
  const contentEntryId = new URL(req.url).searchParams.get("contentEntryId");
  if (!contentEntryId) return NextResponse.json({ candidates: [] });
  const entry = await db.contentEntry.findUnique({
    where: { id: contentEntryId },
    select: { id: true, locale: true, contentType: true, translationGroupId: true },
  });
  if (!entry) return NextResponse.json({ candidates: [] });
  const oppositeLocale = entry.locale === "en" ? "ar" : "en";
  const candidates = entry.translationGroupId ? [] : await db.contentEntry.findMany({
    where: {
      id: { not: entry.id }, contentType: entry.contentType, locale: oppositeLocale,
      translationGroupId: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, locale: true, slug: true, title: true, status: true, updatedAt: true },
  });
  return NextResponse.json({ candidates: candidates.map((candidate) => ({ ...candidate, updatedAt: candidate.updatedAt.toISOString() })) });
});

const pairSchema = z.object({
  englishContentEntryId: z.string().min(1),
  englishExpectedUpdatedAt: z.string().datetime(),
  arabicContentEntryId: z.string().min(1),
  arabicExpectedUpdatedAt: z.string().datetime(),
}).strict();

const unlinkSchema = z.object({
  contentEntryId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  peerExpectedUpdatedAt: z.string().datetime(),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = pairSchema.parse(await jsonBody<z.infer<typeof pairSchema>>(req));
  return NextResponse.json(await pairContentTranslations(
    actor, input.englishContentEntryId, input.englishExpectedUpdatedAt,
    input.arabicContentEntryId, input.arabicExpectedUpdatedAt, clientIp(req),
  ), { status: 201 });
});

export const DELETE = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = unlinkSchema.parse(await jsonBody<z.infer<typeof unlinkSchema>>(req));
  return NextResponse.json(await unlinkContentTranslation(
    actor, input.contentEntryId, input.expectedUpdatedAt, input.peerExpectedUpdatedAt, clientIp(req),
  ));
});
