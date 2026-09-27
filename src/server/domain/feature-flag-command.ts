import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";

export interface FeatureFlagUpdateInput {
  key: string;
  expectedUpdatedAt: string;
  isEnabled?: boolean;
  rolloutPercent?: number;
}

export async function updateFeatureFlagCommand(actor: SessionUser, input: FeatureFlagUpdateInput, ip: string | null) {
  if (!actor.roles.some((role) => role === "OWNER" || role === "ADMIN")) {
    throw new HttpError(403, "Only an owner or admin can change feature flags.", "FEATURE_FLAG_FORBIDDEN");
  }
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid feature flag version.", "INVALID_VERSION");
  if (input.isEnabled === undefined && input.rolloutPercent === undefined) throw new HttpError(422, "At least one feature flag value must change.", "FEATURE_FLAG_UPDATE_EMPTY");

  try {
    return await db.$transaction(async (tx) => {
      const flag = await tx.featureFlag.findUnique({ where: { key: input.key } });
      if (!flag) throw new HttpError(404, "Feature flag not found.", "NOT_FOUND");
      if (flag.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This feature flag changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");
      const after = {
        isEnabled: input.isEnabled ?? flag.isEnabled,
        rolloutPercent: input.rolloutPercent ?? flag.rolloutPercent,
      };
      const changed = await tx.featureFlag.updateMany({
        where: { id: flag.id, updatedAt: expectedUpdatedAt },
        data: { ...after, updatedBy: actor.email, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new HttpError(409, "This feature flag changed during save. Refresh and retry.", "VERSION_CONFLICT");
      await audit({
        actorType: "USER", actorId: actor.id, action: "flag.update", resourceType: "feature_flag", resourceId: flag.id,
        before: { isEnabled: flag.isEnabled, rolloutPercent: flag.rolloutPercent }, after, ip,
      }, tx);
      return { ok: true as const, key: flag.key, ...after };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "This feature flag changed during save. Refresh and retry.", "VERSION_CONFLICT");
    }
    throw error;
  }
}
