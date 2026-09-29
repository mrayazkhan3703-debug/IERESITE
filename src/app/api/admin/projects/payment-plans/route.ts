import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { createProjectPaymentPlan, listProjectPaymentPlans, updateProjectPaymentPlan } from "@/server/domain/payment-plan-command";

export const dynamic = "force-dynamic";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const amountMinor = z.string().regex(/^\d+$/).max(19).nullable().optional();
const planSchema = z.object({
  projectId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  postHandover: z.boolean(),
  sourceDocumentId: z.string().min(1).nullable().optional(),
  verificationStatus: z.enum(["UNVERIFIED", "PUBLISHED", "VERIFIED"]),
  validFrom: dateOnly,
  validTo: dateOnly,
  notes: z.string().max(2000).nullable().optional(),
  isDefault: z.boolean(),
  installments: z.array(z.object({
    label: z.string().trim().min(1).max(160),
    percent: z.number().finite().positive().max(100),
    dueOffsetMonths: z.number().int().min(-240).max(240).nullable().optional(),
    amountMinor,
  }).strict()).min(1).max(24),
}).strict();

export const GET = apiHandler(async (req) => {
  const actor = await requirePermission("project:read");
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  return NextResponse.json({ paymentPlans: await listProjectPaymentPlans(actor, projectId) });
});

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("project:update");
  const input = planSchema.parse(await jsonBody<z.infer<typeof planSchema>>(req));
  const { projectId, ...plan } = input;
  return NextResponse.json(await createProjectPaymentPlan(actor, projectId, plan, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("project:update");
  const input = planSchema.omit({ projectId: true }).extend({
    planId: z.string().min(1).max(100),
    expectedUpdatedAt: z.string().datetime(),
  }).strict().parse(await jsonBody<z.infer<typeof planSchema> & { planId: string; expectedUpdatedAt: string }>(req));
  const { planId, expectedUpdatedAt, ...plan } = input;
  return NextResponse.json(await updateProjectPaymentPlan(actor, planId, expectedUpdatedAt, plan, clientIp(req)));
});
