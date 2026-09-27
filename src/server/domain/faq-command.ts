import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";

export type FaqGroup = "GENERAL" | "BUYING" | "SELLING" | "OFF_PLAN" | "INVESTMENT" | "INTERNATIONAL" | "AI_ADVISOR" | "PRIVACY";
export interface FaqInput {
  groupKey: FaqGroup;
  locale: "en" | "ar";
  question: string;
  answer: string;
  sortOrder: number;
  isActive: boolean;
}
export interface FaqUpdateInput extends FaqInput {
  faqId: string;
  expectedUpdatedAt: string;
}

function validateFaq(input: FaqInput) {
  const question = input.question.trim();
  const answer = input.answer.trim();
  if (!question || question.length > 500 || !answer || answer.length > 5_000) {
    throw new HttpError(422, "A question and answer within the allowed limits are required.", "FAQ_VALIDATION");
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 10_000) {
    throw new HttpError(422, "FAQ sort order must be an integer from 0 to 10000.", "FAQ_VALIDATION");
  }
  return {
    groupKey: input.groupKey,
    locale: input.locale,
    question,
    answer,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  };
}

async function ensureUniqueQuestion(tx: Prisma.TransactionClient, input: FaqInput, excludeId?: string) {
  const duplicate = await tx.faq.findFirst({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      groupKey: input.groupKey,
      locale: input.locale,
      question: { equals: input.question.trim(), mode: "insensitive" },
    },
    select: { id: true },
  });
  if (duplicate) throw new HttpError(409, "A question with this locale and group already exists.", "FAQ_DUPLICATE");
}

export async function createFaqCommand(actor: SessionUser, input: FaqInput, ip: string | null) {
  const values = validateFaq(input);
  return db.$transaction(async (tx) => {
    await ensureUniqueQuestion(tx, values);
    const faq = await tx.faq.create({ data: values });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "faq.create", resourceType: "faq", resourceId: faq.id, before: null, after: values, ip }, tx);
    return { id: faq.id, updatedAt: faq.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new HttpError(409, "FAQ content changed during save. Refresh and retry.", "VERSION_CONFLICT");
    throw error;
  });
}

export async function updateFaqCommand(actor: SessionUser, input: FaqUpdateInput, ip: string | null) {
  const values = validateFaq(input);
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid FAQ version.", "INVALID_VERSION");
  return db.$transaction(async (tx) => {
    const faq = await tx.faq.findUnique({ where: { id: input.faqId } });
    if (!faq) throw new HttpError(404, "FAQ entry not found.", "NOT_FOUND");
    if (faq.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This FAQ changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");
    await ensureUniqueQuestion(tx, values, faq.id);
    const changed = await tx.faq.updateMany({ where: { id: faq.id, updatedAt: expectedUpdatedAt }, data: { ...values, updatedAt: new Date() } });
    if (changed.count !== 1) throw new HttpError(409, "This FAQ changed during save. Refresh and retry.", "VERSION_CONFLICT");
    await audit({
      actorId: actor.id, organizationId: actor.organizationId, action: "faq.update", resourceType: "faq", resourceId: faq.id,
      before: { groupKey: faq.groupKey, locale: faq.locale, question: faq.question, answer: faq.answer, sortOrder: faq.sortOrder, isActive: faq.isActive },
      after: values, ip,
    }, tx);
    const updated = await tx.faq.findUniqueOrThrow({ where: { id: faq.id }, select: { updatedAt: true } });
    return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new HttpError(409, "This FAQ changed during save. Refresh and retry.", "VERSION_CONFLICT");
    throw error;
  });
}
