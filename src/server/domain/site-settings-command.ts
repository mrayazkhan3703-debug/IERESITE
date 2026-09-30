import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_SITE_SETTINGS, parseSiteSettings, type SiteSettings } from "@/lib/site-settings";
import type { SessionUser } from "@/server/auth";
import { audit, HttpError } from "@/server/auth";

const SETTINGS_ID = "public";

export async function readSiteSettings() {
  const row = await db.siteSetting.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) return { settings: DEFAULT_SITE_SETTINGS, version: 0, updatedAt: null };
  let parsed: unknown;
  try { parsed = JSON.parse(row.settingsJson); } catch { parsed = null; }
  const settings = parseSiteSettings(parsed);
  return settings
    ? { settings, version: row.version, updatedAt: row.updatedAt.toISOString() }
    : { settings: DEFAULT_SITE_SETTINGS, version: row.version, updatedAt: row.updatedAt.toISOString() };
}

export async function saveSiteSettings(
  actor: SessionUser,
  input: { expectedVersion: number; settings: SiteSettings; changeNote?: string },
  ip: string | null,
) {
  const settings = parseSiteSettings(input.settings);
  if (!settings) throw new HttpError(422, "Site settings contain an invalid route, label, module or asset reference.", "SITE_SETTINGS_INVALID");
  const assetIds = [...new Set([settings.defaultOgMediaId, settings.fallbackImageMediaId].filter((id): id is string => Boolean(id)))];
  return db.$transaction(async (tx) => {
    if (assetIds.length) {
      const assets = await tx.mediaAsset.findMany({
        where: { id: { in: assetIds }, kind: "IMAGE", isPrivate: false },
        select: { id: true },
      });
      if (assets.length !== assetIds.length) throw new HttpError(422, "Brand images must come from the public Media Library.", "SITE_SETTINGS_MEDIA_INVALID");
    }
    const current = await tx.siteSetting.findUnique({ where: { id: SETTINGS_ID } });
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== input.expectedVersion) throw new HttpError(409, "Site settings changed in another session. Refresh before saving.", "VERSION_CONFLICT");
    const nextVersion = currentVersion + 1;
    const snapshotJson = JSON.stringify(settings);
    const now = new Date();
    if (current) {
      const changed = await tx.siteSetting.updateMany({
        where: { id: SETTINGS_ID, version: currentVersion },
        data: { settingsJson: snapshotJson, version: nextVersion, updatedAt: now },
      });
      if (changed.count !== 1) throw new HttpError(409, "Site settings changed in another session. Refresh before saving.", "VERSION_CONFLICT");
    } else {
      await tx.siteSetting.create({ data: { id: SETTINGS_ID, version: nextVersion, settingsJson: snapshotJson } });
    }
    await tx.siteSettingRevision.create({
      data: {
        siteSettingId: SETTINGS_ID,
        version: nextVersion,
        snapshotJson,
        editedBy: actor.id,
        changeNote: input.changeNote?.trim().slice(0, 300) || "Updated public site settings",
      },
    });
    await audit({
      actorId: actor.id,
      organizationId: actor.organizationId,
      action: "site_settings.update",
      resourceType: "site_settings",
      resourceId: SETTINGS_ID,
      before: current ? { version: current.version, settingsJson: current.settingsJson } : null,
      after: { version: nextVersion, settings },
      ip,
    }, tx);
    return { ok: true as const, version: nextVersion, updatedAt: now.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      throw new HttpError(409, "Site settings changed in another session. Refresh before saving.", "VERSION_CONFLICT");
    }
    throw error;
  });
}

export async function listSiteSettingRevisions() {
  return db.siteSettingRevision.findMany({
    where: { siteSettingId: SETTINGS_ID },
    orderBy: { version: "desc" },
    take: 30,
    select: { id: true, version: true, editedBy: true, changeNote: true, createdAt: true },
  });
}
