import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ownerId = `private-doc-owner-${suffix}`;
const otherId = `private-doc-other-${suffix}`;

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await db.$disconnect();
});

describe("private portfolio documents", () => {
  test("stores in the private object store and exposes only ownership-checked expiring URLs", async () => {
    const customer = await db.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
    await db.user.createMany({
      data: [
        { id: ownerId, email: `private-owner-${suffix}@example.invalid`, emailVerified: new Date() },
        { id: otherId, email: `private-other-${suffix}@example.invalid`, emailVerified: new Date() },
      ],
    });
    await db.userRole.createMany({ data: [{ userId: ownerId, roleId: customer.id }, { userId: otherId, roleId: customer.id }] });
    const ownerToken = await createSession(ownerId);
    const otherToken = await createSession(otherId);

    const form = new FormData();
    form.set("category", "TITLE_DEED");
    form.set("label", "Integration document");
    form.set("file", new File([Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")], "title-deed.pdf", { type: "application/pdf" }));
    const csrfRejected = await fetch(`${baseUrl}/api/account/portfolio/documents`, {
      method: "POST",
      headers: { cookie: `ie_session=${ownerToken}` },
      body: form,
    });
    expect(csrfRejected.status).toBe(403);
    expect((await csrfRejected.json() as { code: string }).code).toBe("CSRF");

    const upload = await fetch(`${baseUrl}/api/account/portfolio/documents`, {
      method: "POST",
      headers: { cookie: `ie_session=${ownerToken}`, "x-requested-with": "fetch" },
      body: form,
    });
    expect(upload.status).toBe(201);
    const uploaded = await upload.json() as { id: string; media: { id: string; url: string; expiresInSeconds: number } };
    expect(uploaded.media.expiresInSeconds).toBe(300);
    expect(uploaded.media.url).toContain("X-Amz-Signature=");

    const publicLookup = await fetch(`${baseUrl}/api/media/${uploaded.media.id}`);
    expect(publicLookup.status).toBe(404);

    const ownerList = await fetch(`${baseUrl}/api/account/portfolio/documents`, { headers: { cookie: `ie_session=${ownerToken}` } });
    const ownerBody = await ownerList.json() as { documents: Array<{ id: string; media: { url: string } }> };
    expect(ownerBody.documents.map((document) => document.id)).toContain(uploaded.id);
    expect(ownerBody.documents[0].media.url).toContain("X-Amz-Expires=300");

    const otherList = await fetch(`${baseUrl}/api/account/portfolio/documents`, { headers: { cookie: `ie_session=${otherToken}` } });
    expect((await otherList.json() as { documents: unknown[] }).documents).toHaveLength(0);

    const signed = new URL(uploaded.media.url);
    const internalUrl = new URL(signed.toString());
    internalUrl.hostname = "object-storage";
    const object = await fetch(internalUrl, { headers: { host: signed.host } });
    expect(object.status).toBe(200);
    expect(await object.text()).toStartWith("%PDF-1.4");

    const remove = await fetch(`${baseUrl}/api/account/portfolio/documents/${uploaded.id}`, {
      method: "DELETE",
      headers: { cookie: `ie_session=${ownerToken}`, "x-requested-with": "fetch" },
    });
    expect(remove.status).toBe(200);
    expect(await db.mediaAsset.findUnique({ where: { id: uploaded.media.id } })).toBeNull();
  });
});
