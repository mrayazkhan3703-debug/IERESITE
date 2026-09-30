import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import type { SessionUser } from "@/server/auth";
import { DEFAULT_SITE_SETTINGS } from "@/lib/site-settings";
import { readSiteSettings, saveSiteSettings } from "@/server/domain/site-settings-command";

const prefix = `site-settings-${Date.now()}`;
const actor: SessionUser = { sessionId: `${prefix}-session`, id: `${prefix}-owner`, email: `${prefix}@example.invalid`, name: "Settings fixture", organizationId: null, roles: ["OWNER"], permissions: ["*"], mfaVerified: true };
let ownsFixture = false;
beforeAll(async () => {
  if (getConfig().APP_ENV !== "development" || !["postgres", "db", "localhost", "127.0.0.1"].includes(new URL(getConfig().DATABASE_URL!).hostname) || await db.siteSetting.count()) throw new Error("Site settings integration requires an empty disposable local database.");
  await db.user.create({ data: { id: actor.id, email: actor.email } });
  ownsFixture = true;
});
afterAll(async () => {
  if (ownsFixture) {
    await db.siteSetting.deleteMany({ where: { id: "public" } });
    await db.auditLog.deleteMany({ where: { actorId: actor.id } });
    await db.mediaAsset.deleteMany({ where: { storageKey: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { id: actor.id } });
  }
  await db.$disconnect();
});

describe("versioned site settings", () => {
  test("saves audited snapshots and rejects stale updates", async () => {
    const initial = await readSiteSettings();
    expect(initial.version).toBe(0);
    const settings = structuredClone(DEFAULT_SITE_SETTINGS);
    settings.pageCopy.careersTitle = { en: "Work with our team", ar: "انضم إلى فريقنا" };
    const saved = await saveSiteSettings(actor, { expectedVersion: 0, settings, changeNote: "Synthetic CI override" }, null);
    expect(saved.version).toBe(1);
    await expect(saveSiteSettings(actor, { expectedVersion: 0, settings }, null)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const current = await readSiteSettings();
    expect(current.settings.pageCopy.careersTitle?.ar).toBe("انضم إلى فريقنا");
    expect(await db.siteSettingRevision.count({ where: { siteSettingId: "public" } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorId: actor.id, action: "site_settings.update" } })).toBe(1);
  });
  test("cannot assign a private image as a public brand asset", async () => {
    const image = await db.mediaAsset.create({ data: { storageKey: `${prefix}/private.webp`, url: "private-object://fixture", mimeType: "image/webp", sizeBytes: 100, kind: "IMAGE", isPrivate: true } });
    const current = await readSiteSettings();
    await expect(saveSiteSettings(actor, { expectedVersion: current.version, settings: { ...current.settings, defaultOgMediaId: image.id } }, null)).rejects.toMatchObject({ code: "SITE_SETTINGS_MEDIA_INVALID" });
    expect((await readSiteSettings()).version).toBe(current.version);
  });
});
