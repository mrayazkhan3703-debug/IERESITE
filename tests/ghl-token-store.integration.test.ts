import { expect, it } from "bun:test";
import { db } from "@/lib/db";
import { PrismaGhlTokenStore } from "@/server/crm/ghl-token-store";
import type { GhlStoredTokens } from "@/server/crm/ghl-client";

it("persists only encrypted GHL tokens and serializes refreshes across transactions", async () => {
  const locationId = `test-location-${crypto.randomUUID()}`;
  const store = new PrismaGhlTokenStore(locationId, "c3".repeat(32), db);
  const initial: GhlStoredTokens = {
    accessToken: "synthetic-access-secret",
    refreshToken: "synthetic-refresh-secret",
    expiresAt: Date.now() + 60_000,
    scope: "contacts.readonly",
    locationId,
  };

  try {
    await store.install(initial);
    const row = await db.ghlOAuthCredential.findUnique({ where: { locationId } });
    expect(row).not.toBeNull();
    expect(row?.encryptedTokens).not.toContain(initial.accessToken);
    expect(row?.encryptedTokens).not.toContain(initial.refreshToken);
    expect(await store.read()).toEqual(initial);

    let activeRefreshes = 0;
    let maxConcurrentRefreshes = 0;
    let secondObservedAccessToken = "";
    let markFirstLocked!: () => void;
    let releaseFirst!: () => void;
    const firstLocked = new Promise<void>((resolve) => { markFirstLocked = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = store.withRefreshLock(async (current, save) => {
      expect(current?.accessToken).toBe(initial.accessToken);
      activeRefreshes += 1;
      maxConcurrentRefreshes = Math.max(maxConcurrentRefreshes, activeRefreshes);
      markFirstLocked();
      await firstGate;
      await save({ ...initial, accessToken: "rotated-access", refreshToken: "rotated-refresh" });
      activeRefreshes -= 1;
    });
    await firstLocked;
    const second = store.withRefreshLock(async (current) => {
      activeRefreshes += 1;
      maxConcurrentRefreshes = Math.max(maxConcurrentRefreshes, activeRefreshes);
      secondObservedAccessToken = current?.accessToken ?? "";
      activeRefreshes -= 1;
    });
    releaseFirst();

    await Promise.all([first, second]);
    expect(maxConcurrentRefreshes).toBe(1);
    expect(secondObservedAccessToken).toBe("rotated-access");
    expect((await store.read())?.refreshToken).toBe("rotated-refresh");
  } finally {
    await db.ghlOAuthCredential.deleteMany({ where: { locationId } });
    await db.$disconnect();
  }
});
