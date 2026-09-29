import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { canCreateCatalogResource, canManageCatalogResource } from "@/server/domain/resource-policy";
import { requirePublicMedia } from "@/server/domain/media-policy";

export type PaymentInstallmentInput = {
  label: string;
  percent: number;
  dueOffsetMonths?: number | null;
  amountMinor?: string | null;
};

export type PaymentPlanValues = {
  name: string;
  currency: string;
  postHandover: boolean;
  sourceDocumentId?: string | null;
  verificationStatus: "UNVERIFIED" | "PUBLISHED" | "VERIFIED";
  validFrom?: string | null;
  validTo?: string | null;
  notes?: string | null;
  isDefault: boolean;
  installments: PaymentInstallmentInput[];
};

function requireVerificationAuthority(actor: SessionUser, status: PaymentPlanValues["verificationStatus"]) {
  if (status === "VERIFIED" && !actor.roles.some((role) => role === "OWNER" || role === "ADMIN")) {
    throw new HttpError(403, "Only an owner or administrator can mark a payment plan verified.", "PAYMENT_PLAN_VERIFICATION_FORBIDDEN");
  }
}

function validate(input: PaymentPlanValues) {
  const sum = input.installments.reduce((total, item) => total + item.percent, 0);
  if (!input.name.trim() || input.installments.length < 1 || input.installments.length > 24) {
    throw new HttpError(422, "Enter a plan name and between 1 and 24 installments.", "PAYMENT_PLAN_INVALID");
  }
  if (input.installments.some((item) => !item.label.trim() || !Number.isFinite(item.percent) || item.percent <= 0 || item.percent > 100)) {
    throw new HttpError(422, "Every installment needs a label and a percentage greater than 0 and no more than 100.", "PAYMENT_INSTALLMENT_INVALID");
  }
  if (Math.abs(sum - 100) > 0.01) {
    throw new HttpError(422, `Installment percentages must total 100% (currently ${sum.toFixed(2)}%).`, "PAYMENT_PLAN_TOTAL_INVALID");
  }
  if (input.installments.some((item) => item.dueOffsetMonths != null && (!Number.isInteger(item.dueOffsetMonths) || Math.abs(item.dueOffsetMonths) > 240))) {
    throw new HttpError(422, "Installment timing must be within 240 months of its reference date.", "PAYMENT_INSTALLMENT_TIMING_INVALID");
  }
  if (input.installments.some((item) => item.amountMinor != null && (!/^\d+$/.test(item.amountMinor) || BigInt(item.amountMinor) > 9_223_372_036_854_775_807n))) {
    throw new HttpError(422, "Installment amounts must fit in a PostgreSQL minor-unit amount.", "PAYMENT_INSTALLMENT_AMOUNT_INVALID");
  }
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) {
    throw new HttpError(422, "The payment plan end date must be on or after its start date.", "PAYMENT_PLAN_DATE_RANGE");
  }
  for (const date of [input.validFrom, input.validTo]) if (date) {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new HttpError(422, "Payment plan dates must be valid calendar dates.", "PAYMENT_PLAN_DATE_INVALID");
  }
  if (input.verificationStatus === "VERIFIED" && !input.sourceDocumentId) {
    throw new HttpError(422, "Attach a source document before marking a payment plan verified.", "PAYMENT_PLAN_SOURCE_REQUIRED");
  }
}

function serialize(plan: {
  id: string; projectId: string; name: string; currency: string; totalPercent: number; postHandover: boolean;
  sourceDocumentId: string | null; verificationStatus: string; validFrom: Date | null; validTo: Date | null;
  notes: string | null; isDefault: boolean; updatedAt: Date;
  installments: { id: string; sequence: number; label: string; percent: number; dueOffsetMonths: number | null; amountMinor: bigint | null }[];
}) {
  return { ...plan, validFrom: plan.validFrom?.toISOString().slice(0, 10) ?? null, validTo: plan.validTo?.toISOString().slice(0, 10) ?? null,
    updatedAt: plan.updatedAt.toISOString(), installments: plan.installments.map((item) => ({ ...item, amountMinor: item.amountMinor?.toString() ?? null })) };
}

async function assertProjectAccess(actor: SessionUser, projectId: string, write = false) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, ownerOrganizationId: true, deletedAt: true } });
  if (!project || project.deletedAt) throw new HttpError(404, "Project not found.", "NOT_FOUND");
  if (write ? !canManageCatalogResource(actor, project.ownerOrganizationId) : (!canManageCatalogResource(actor, project.ownerOrganizationId) && project.ownerOrganizationId !== null)) {
    throw new HttpError(403, "You cannot manage this project record.", "RESOURCE_FORBIDDEN");
  }
  if (write && !canCreateCatalogResource(actor)) throw new HttpError(403, "Project updates require an organization-scoped staff role.", "RESOURCE_FORBIDDEN");
  return project;
}

async function installmentRows(tx: Prisma.TransactionClient, paymentPlanId: string, currency: string, rows: PaymentInstallmentInput[]) {
  await tx.paymentPlanInstallment.deleteMany({ where: { paymentPlanId } });
  await tx.paymentPlanInstallment.createMany({ data: rows.map((item, index) => ({
    paymentPlanId, sequence: index + 1, label: item.label.trim(), percent: item.percent,
    dueOffsetMonths: item.dueOffsetMonths ?? null,
    amountMinor: item.amountMinor ? BigInt(item.amountMinor) : null,
    currency,
  })) });
}

export async function listProjectPaymentPlans(actor: SessionUser, projectId: string) {
  await assertProjectAccess(actor, projectId);
  const plans = await db.paymentPlan.findMany({ where: { projectId }, include: { installments: { orderBy: { sequence: "asc" } } }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
  return plans.map(serialize);
}

export async function createProjectPaymentPlan(actor: SessionUser, projectId: string, input: PaymentPlanValues, ip: string | null) {
  validate(input);
  requireVerificationAuthority(actor, input.verificationStatus);
  await assertProjectAccess(actor, projectId, true);
  return db.$transaction(async (tx) => {
    const sourceDocumentId = input.sourceDocumentId
      ? await requirePublicMedia(tx, input.sourceDocumentId, ["DOCUMENT", "BROCHURE"])
      : null;
    if (input.isDefault) await tx.paymentPlan.updateMany({ where: { projectId }, data: { isDefault: false } });
    const plan = await tx.paymentPlan.create({ data: {
      projectId, name: input.name.trim(), currency: input.currency.toUpperCase(), totalPercent: 100,
      postHandover: input.postHandover, sourceDocumentId, verificationStatus: input.verificationStatus,
      validFrom: input.validFrom ? new Date(`${input.validFrom}T00:00:00.000Z`) : null,
      validTo: input.validTo ? new Date(`${input.validTo}T00:00:00.000Z`) : null,
      notes: input.notes?.trim() || null, isDefault: input.isDefault,
      installments: { create: input.installments.map((item, index) => ({ sequence: index + 1, label: item.label.trim(), percent: item.percent, dueOffsetMonths: item.dueOffsetMonths ?? null, amountMinor: item.amountMinor ? BigInt(item.amountMinor) : null, currency: input.currency.toUpperCase() })) },
    }, include: { installments: { orderBy: { sequence: "asc" } } } });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "payment_plan.create", resourceType: "payment_plan", resourceId: plan.id, before: null, after: serialize(plan), ip }, tx);
    await emitEvent("project", projectId, "project.updated", { projectId, paymentPlanId: plan.id }, tx);
    return serialize(plan);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateProjectPaymentPlan(actor: SessionUser, planId: string, expectedUpdatedAt: string, input: PaymentPlanValues, ip: string | null) {
  validate(input);
  requireVerificationAuthority(actor, input.verificationStatus);
  const expected = new Date(expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new HttpError(400, "Invalid payment plan version.", "INVALID_VERSION");
  const found = await db.paymentPlan.findUnique({ where: { id: planId }, select: { projectId: true } });
  if (!found) throw new HttpError(404, "Payment plan not found.", "NOT_FOUND");
  await assertProjectAccess(actor, found.projectId, true);
  return db.$transaction(async (tx) => {
    const plan = await tx.paymentPlan.findUnique({ where: { id: planId }, include: { installments: { orderBy: { sequence: "asc" } } } });
    if (!plan) throw new HttpError(404, "Payment plan not found.", "NOT_FOUND");
    if (plan.updatedAt.getTime() !== expected.getTime()) throw new HttpError(409, "This payment plan changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
    const before = serialize(plan);
    const sourceDocumentId = input.sourceDocumentId
      ? await requirePublicMedia(tx, input.sourceDocumentId, ["DOCUMENT", "BROCHURE"])
      : null;
    if (input.isDefault) await tx.paymentPlan.updateMany({ where: { projectId: plan.projectId, id: { not: plan.id } }, data: { isDefault: false } });
    const changed = await tx.paymentPlan.updateMany({ where: { id: plan.id, updatedAt: expected }, data: {
      name: input.name.trim(), currency: input.currency.toUpperCase(), totalPercent: 100, postHandover: input.postHandover,
      sourceDocumentId, verificationStatus: input.verificationStatus,
      validFrom: input.validFrom ? new Date(`${input.validFrom}T00:00:00.000Z`) : null,
      validTo: input.validTo ? new Date(`${input.validTo}T00:00:00.000Z`) : null,
      notes: input.notes?.trim() || null, isDefault: input.isDefault, updatedAt: new Date(),
    } });
    if (changed.count !== 1) throw new HttpError(409, "This payment plan changed during the save. Refresh and retry.", "VERSION_CONFLICT");
    await installmentRows(tx, plan.id, input.currency.toUpperCase(), input.installments);
    const updated = await tx.paymentPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { installments: { orderBy: { sequence: "asc" } } } });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "payment_plan.update", resourceType: "payment_plan", resourceId: plan.id, before, after: serialize(updated), ip }, tx);
    await emitEvent("project", plan.projectId, "project.updated", { projectId: plan.projectId, paymentPlanId: plan.id }, tx);
    return serialize(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
