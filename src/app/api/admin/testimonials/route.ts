import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { createTestimonial, updateTestimonial } from "@/server/domain/testimonial-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  await requirePermission("content:read");
  const query = new URL(req.url).searchParams.get("q")?.trim();
  const status = new URL(req.url).searchParams.get("status");
  const testimonials = await db.testimonial.findMany({
    where: {
      ...(status && ["DRAFT", "PUBLISHED", "RETIRED"].includes(status) ? { status } : {}),
      ...(query ? { OR: [{ clientName: { contains: query, mode: "insensitive" as const } }, { quote: { contains: query, mode: "insensitive" as const } }] } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { _count: { select: { revisions: true } } },
  });
  return NextResponse.json({ testimonials: testimonials.map(({ _count, verificationEvidenceRef, consentEvidenceRef, ...testimonial }) => ({
    ...testimonial,
    verifiedAt: testimonial.verifiedAt?.toISOString() ?? null,
    consentCapturedAt: testimonial.consentCapturedAt?.toISOString() ?? null,
    createdAt: testimonial.createdAt.toISOString(),
    updatedAt: testimonial.updatedAt.toISOString(),
    hasVerificationEvidence: Boolean(verificationEvidenceRef),
    hasConsentEvidence: Boolean(consentEvidenceRef),
    revisionCount: _count.revisions,
  })) });
});

const contentSchema = z.object({
  clientName: z.string().trim().min(1).max(160),
  clientRole: z.string().max(160).nullable().optional(),
  quote: z.string().trim().min(1).max(5000),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  propertyContextId: z.string().max(180).nullable().optional(),
});

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = contentSchema.strict().parse(await jsonBody<z.infer<typeof contentSchema>>(req));
  return NextResponse.json(await createTestimonial(actor, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const schema = contentSchema.extend({ testimonialId: z.string().min(1), expectedUpdatedAt: z.string().datetime() }).strict();
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await updateTestimonial(actor, input, clientIp(req)));
});
