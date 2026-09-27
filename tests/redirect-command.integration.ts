import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createRedirectCommand, setRedirectActiveCommand, updateRedirectCommand } from "@/server/domain/redirect-command";
import { lookupRedirect } from "@/server/seo/sitemap";

const prefix = `redirect-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${prefix}-user`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: userId, email: "redirect-editor@example.invalid", name: "Redirect editor",
  organizationId: null, roles: ["OWNER"], permissions: ["seo:update"], mfaVerified: true,
};

async function cleanup() {
  const redirects = await db.redirect.findMany({ where: { fromPath: { contains: prefix } }, select: { id: true } });
  const ids = redirects.map((item) => item.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
    await db.redirect.deleteMany({ where: { id: { in: ids } } });
  }
  await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: userId, email: actor.email } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional redirect manager commands", () => {
  test("creates disabled rules, prevents unsafe paths and redirect chains, and versions/audits state changes", async () => {
    const oldPath = `/${prefix}-old`;
    const newPath = `/${prefix}-new`;
    const created = await createRedirectCommand(actor, {
      fromPath: oldPath, toPath: newPath, statusCode: 301, note: "Integration fixture",
    }, "127.0.0.1");
    let redirect = await db.redirect.findUniqueOrThrow({ where: { id: created.id } });
    expect(redirect.isActive).toBe(false);
    expect(await db.auditLog.count({ where: { resourceId: redirect.id, action: "redirect.create_disabled" } })).toBe(1);

    await expect(createRedirectCommand(actor, { fromPath: "/old", toPath: "https://example.invalid", statusCode: 301 }, null))
      .rejects.toMatchObject({ status: 422, code: "REDIRECT_PATH_INVALID" });
    await expect(createRedirectCommand(actor, { fromPath: "/api/health", toPath: "/", statusCode: 301 }, null))
      .rejects.toMatchObject({ status: 422, code: "REDIRECT_PATH_INVALID" });
    await expect(updateRedirectCommand(actor, {
      redirectId: redirect.id, expectedUpdatedAt: redirect.updatedAt.toISOString(), fromPath: oldPath, toPath: oldPath,
      statusCode: 301, isActive: true,
    }, null)).rejects.toMatchObject({ status: 422, code: "REDIRECT_PATH_INVALID" });

    await setRedirectActiveCommand(actor, redirect.id, redirect.updatedAt.toISOString(), true, null);
    redirect = await db.redirect.findUniqueOrThrow({ where: { id: redirect.id } });
    expect(redirect.isActive).toBe(true);
    expect(await db.auditLog.count({ where: { resourceId: redirect.id, action: "redirect.activate" } })).toBe(1);
    expect(await lookupRedirect(oldPath)).toEqual({ to: newPath, statusCode: 301 });
    const afterHit = await db.redirect.findUniqueOrThrow({ where: { id: redirect.id } });
    expect(afterHit.hits).toBe(1);
    expect(afterHit.updatedAt.toISOString()).toBe(redirect.updatedAt.toISOString());
    redirect = afterHit;

    const chained = await createRedirectCommand(actor, {
      fromPath: `/${prefix}-middle`, toPath: oldPath, statusCode: 302,
    }, null);
    let chainedRedirect = await db.redirect.findUniqueOrThrow({ where: { id: chained.id } });
    await expect(setRedirectActiveCommand(actor, chainedRedirect.id, chainedRedirect.updatedAt.toISOString(), true, null))
      .rejects.toMatchObject({ status: 409, code: "REDIRECT_CHAIN_BLOCKED" });
    expect((await db.redirect.findUniqueOrThrow({ where: { id: chainedRedirect.id } })).isActive).toBe(false);

    await expect(updateRedirectCommand(actor, {
      redirectId: redirect.id, expectedUpdatedAt: new Date(redirect.updatedAt.getTime() - 1).toISOString(),
      fromPath: oldPath, toPath: newPath, statusCode: 301, isActive: true,
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    await setRedirectActiveCommand(actor, redirect.id, redirect.updatedAt.toISOString(), false, null);
    redirect = await db.redirect.findUniqueOrThrow({ where: { id: redirect.id } });
    expect(redirect.isActive).toBe(false);
    expect(await db.auditLog.count({ where: { resourceId: redirect.id } })).toBe(3);
  });
});
