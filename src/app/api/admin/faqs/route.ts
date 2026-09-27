import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { db } from "@/lib/db";
import { createFaqCommand, updateFaqCommand } from "@/server/domain/faq-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requirePermission("content:read");
  const entries = await db.faq.findMany({ orderBy: [{ locale: "asc" }, { groupKey: "asc" }, { sortOrder: "asc" }, { question: "asc" }] });
  return NextResponse.json({ entries: entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString() })) });
});

const baseSchema = z.object({
  groupKey: z.enum(["GENERAL", "BUYING", "SELLING", "OFF_PLAN", "INVESTMENT", "INTERNATIONAL", "AI_ADVISOR", "PRIVACY"]),
  locale: z.enum(["en", "ar"]),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(5000),
  sortOrder: z.number().int().min(0).max(10000),
  isActive: z.boolean(),
});

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = baseSchema.strict().parse(await jsonBody<z.infer<typeof baseSchema>>(req));
  return NextResponse.json(await createFaqCommand(actor, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const schema = baseSchema.extend({ faqId: z.string().min(1), expectedUpdatedAt: z.string().datetime() }).strict();
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await updateFaqCommand(actor, input, clientIp(req)));
});
