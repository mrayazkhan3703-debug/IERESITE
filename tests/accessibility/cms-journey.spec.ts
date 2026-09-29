import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";

const db = new PrismaClient();
const runId = `${Date.now()}-${randomBytes(6).toString("hex")}`;
const slugPrefix = `iere-cms-e2e-${runId}`;
const userId = `iere-cms-e2e-user-${runId}`;
const email = `iere-cms-e2e-${runId}@example.invalid`;
const sessionToken = randomBytes(32).toString("hex");

async function cleanup() {
  const entries = await db.contentEntry.findMany({
    where: { slug: { startsWith: slugPrefix } },
    select: { id: true },
  });
  const entryIds = entries.map(({ id }) => id);

  await db.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: userId },
        ...(entryIds.length ? [{ resourceId: { in: entryIds } }] : []),
      ],
    },
  });
  if (entryIds.length) {
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: entryIds } } });
    await db.contentEntry.deleteMany({ where: { id: { in: entryIds } } });
  }
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });

  const remainingEntries = await db.contentEntry.count({ where: { slug: { startsWith: slugPrefix } } });
  const remainingSessions = await db.session.count({ where: { userId } });
  if (remainingEntries !== 0 || remainingSessions !== 0) {
    throw new Error("Synthetic CMS browser fixtures were not fully cleaned up.");
  }
}

test.beforeAll(async () => {
  await cleanup();
  const contentEditor = await db.role.findUniqueOrThrow({ where: { key: "CONTENT_EDITOR" } });
  await db.user.create({
    data: {
      id: userId,
      email,
      emailVerified: new Date(),
      name: "Synthetic CMS Browser Test",
      roles: { create: { roleId: contentEditor.id } },
    },
  });
  await db.session.create({
    data: {
      userId,
      tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      mfaVerifiedAt: new Date(),
    },
  });
});

test.afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

test("CONTENT_EDITOR creates a revisioned draft in the visual CMS without publishing it", async ({ page }) => {
  test.setTimeout(90_000);
  const baseURL = process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3000";
  await page.context().addCookies([{
    name: process.env.AUTH_COOKIE_NAME ?? "ie_session",
    value: sessionToken,
    url: baseURL,
    httpOnly: true,
    sameSite: "Lax",
  }]);

  await page.goto("/admin/content");
  const authResponse = await page.request.get("/api/auth/me");
  expect(authResponse.status()).toBe(200);
  expect(await authResponse.json()).toMatchObject({ user: { id: userId, roles: ["CONTENT_EDITOR"] } });
  await expect(page.getByRole("heading", { name: "Editorial content" })).toBeVisible();

  await page.getByRole("button", { name: "Create draft", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Create content draft" })).toBeVisible();

  const title = `Synthetic CMS browser draft ${runId}`;
  const body = `Synthetic-only browser verification for ${runId}. No property, market, legal, or provider data.`;
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Slug", { exact: true }).fill(slugPrefix);
  await dialog.getByLabel("Excerpt", { exact: true }).fill("Synthetic local CMS verification only.");
  await dialog.getByLabel("Body (safe Markdown)", { exact: true }).fill(body);

  const saveResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/content" && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create draft", exact: true }).last().click();
  const response = await saveResponse;
  expect(response.status(), await response.text()).toBe(201);

  const draftRow = page.getByRole("row").filter({ hasText: title });
  await expect(draftRow).toBeVisible();
  await expect(draftRow).toContainText("DRAFT");
  await expect(draftRow).toContainText("1");
  await expect(draftRow.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
  await expect(draftRow.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);

  const entry = await db.contentEntry.findUniqueOrThrow({ where: { slug: slugPrefix } });
  expect(entry).toMatchObject({
    contentType: "GUIDE",
    locale: "en",
    title,
    body,
    status: "DRAFT",
    reviewWorkflowState: "NONE",
    authorId: userId,
    publishedAt: null,
  });
  const revision = await db.contentRevision.findUniqueOrThrow({
    where: { contentEntryId_version: { contentEntryId: entry.id, version: 1 } },
  });
  expect(revision.editedBy).toBe(userId);
  expect(JSON.parse(revision.snapshotJson)).toMatchObject({ title, body, status: "DRAFT" });
  expect(await db.auditLog.count({ where: { actorId: userId, action: "content.create_draft", resourceId: entry.id } })).toBe(1);
  expect(await db.outboxEvent.count({ where: { aggregateType: "content", aggregateId: entry.id, eventType: "content.updated" } })).toBe(1);
});
