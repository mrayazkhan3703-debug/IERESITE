import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { db } from "@/lib/db";
import { createCareerOpening, updateCareerOpening } from "@/server/domain/career-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requirePermission("content:read");
  const openings = await db.careerOpening.findMany({ orderBy: [{ updatedAt: "desc" }], take: 100, include: { _count: { select: { revisions: true } }, revisions: { orderBy: { version: "desc" }, take: 1, select: { editedBy: true } } } });
  return NextResponse.json({ openings: openings.map((opening) => ({ ...opening, closesAt: opening.closesAt?.toISOString() ?? null, publishedAt: opening.publishedAt?.toISOString() ?? null, createdAt: opening.createdAt.toISOString(), updatedAt: opening.updatedAt.toISOString(), revisionCount: opening._count.revisions, latestEditorId: opening.revisions[0]?.editedBy ?? null, revisions: undefined, _count: undefined })) });
});

const draft = z.object({
  locale: z.enum(["en", "ar"]), slug: z.string().trim().min(1).max(180), title: z.string().trim().min(1).max(180),
  department: z.string().trim().min(1).max(100), location: z.string().trim().min(1).max(120),
  employmentType: z.string().trim().min(1).max(80), workplaceType: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(1000), description: z.string().trim().min(1).max(12000), closesAt: z.string().datetime().nullable().optional(),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = draft.parse(await jsonBody<z.infer<typeof draft>>(req));
  return NextResponse.json(await createCareerOpening(actor, input, clientIp(req)), { status: 201 });
});

const update = draft.extend({ careerOpeningId: z.string().min(1), expectedUpdatedAt: z.string().datetime(), submitForReview: z.boolean().optional() }).strict();
export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = update.parse(await jsonBody<z.infer<typeof update>>(req));
  return NextResponse.json(await updateCareerOpening(actor, input, clientIp(req)));
});
