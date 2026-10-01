import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";
import { reconcileRagSourceIndex, rebuildDocumentIndex } from "@/server/rag/pipeline";
import { hashRagContent } from "@/server/rag/provenance";
import { JobDeferredError, releaseDeferredJob } from "@/server/jobs/deferred";
import { ragDiagnostics } from "@/server/rag/diagnostics";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const localHosts = ["localhost", "127.0.0.1", "web", "web-test", "postgres", "host.docker.internal"];
if (!localHosts.includes(new URL(baseUrl).hostname) || !localHosts.includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Advisor verification requires a disposable local database and app.");
const prefix = `advisor-operations-${randomUUID()}`, sourceId = prefix + "-source", ownerId = prefix + "-owner";
const docIds = Array.from({ length: 31 }, (_, n) => prefix + "-doc-" + String(n).padStart(2, "0"));
let cookie = "";
beforeAll(async () => {
  const role = await db.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  await db.user.create({ data: { id: ownerId, email: ownerId + "@example.invalid", emailVerified: new Date(), roles: { create: { roleId: role.id } } } });
  cookie = `ie_session=${await createSession(ownerId, { mfaVerified: true })}`;
  await db.ragSource.create({ data: { id: sourceId, title: "Synthetic local indexing verification", sourceType: "INTERNAL_DOC", trustTier: "INTERNAL", isActive: true, isApproved: true, approvedById: ownerId, approvedAt: new Date(), verifiedAt: new Date(Date.now() - 60000), freshnessReviewDueAt: new Date(Date.now() + 86400000) } });
  await db.ragDocument.createMany({ data: docIds.map((id) => {
    const content = "Synthetic verification of bounded indexing and approved knowledge revisions. This is a disposable local fixture, with no property facts.";
    return { id, sourceId, slug: id, title: id, content, contentHash: hashRagContent(content), status: "ACTIVE", approvedById: ownerId, approvedAt: new Date() };
  }) });
});
afterAll(async () => {
  await db.jobRun.deleteMany({ where: { OR: [{ idempotencyKey: { startsWith: `rag-source:${sourceId}:` } }, { idempotencyKey: prefix + "-deferred" }] } });
  await db.auditLog.deleteMany({ where: { actorId: ownerId } });
  await db.ragDocument.deleteMany({ where: { sourceId } });
  await db.ragSource.deleteMany({ where: { id: sourceId } });
  await db.user.deleteMany({ where: { id: ownerId } });
  await db.$disconnect();
});
describe("Advisor readiness and bounded approved-source indexing", () => {
  test("indexes at most 25 documents and preserves the next page as idempotent work", async () => {
    expect(await reconcileRagSourceIndex(sourceId)).toBe(25);
    const jobs = await db.jobRun.findMany({ where: { idempotencyKey: { startsWith: `rag-source:${sourceId}:` } } });
    expect(jobs).toHaveLength(1); expect(jobs[0].payloadJson).toEqual({ sourceId, afterId: docIds[24] });
    expect(await reconcileRagSourceIndex(sourceId)).toBe(25);
    expect(await db.jobRun.count({ where: { idempotencyKey: jobs[0].idempotencyKey } })).toBe(1);
    expect(await reconcileRagSourceIndex(sourceId, undefined, docIds[24])).toBe(6);
    expect(await db.ragChunk.count({ where: { documentId: { in: docIds } } })).toBe(31);
  });
  test("withdraws unapproved revisions and identifies exact exclusion reasons", async () => {
    await db.ragDocument.update({ where: { id: docIds[0] }, data: { status: "DRAFT", approvedById: null, approvedAt: null } });
    expect(await rebuildDocumentIndex(docIds[0], 1)).toBe(false);
    expect(await db.ragChunk.count({ where: { documentId: docIds[0] } })).toBe(0);
    const diagnostic = await ragDiagnostics(prefix);
    expect(diagnostic.documents.find((doc) => doc.id === docIds[0])).toMatchObject({ status: "EXCLUDED", reason: "DOCUMENT_NOT_ACTIVE", canIndex: false });
    expect(diagnostic.documents.length).toBeLessThanOrEqual(25); expect(diagnostic.nextCursor).toBeTruthy();
  });
  test("retains a deferred job without consuming retries or releasing another worker's lease", async () => {
    const now = new Date();
    const job = await db.jobRun.create({ data: { jobKey: "crm.lead.deliver", payloadJson: {}, idempotencyKey: prefix + "-deferred", status: "RUNNING", attempts: 1, lockedBy: prefix, leaseExpiresAt: new Date(now.getTime() + 120000) } });
    expect(await releaseDeferredJob(db, job.id, "other-worker", new JobDeferredError(), now)).toBe(0);
    expect(await releaseDeferredJob(db, job.id, prefix, new JobDeferredError(), now)).toBe(1);
    expect(await db.jobRun.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "RETRYING", attempts: 0, error: "CRM_SYNC_DEFERRED", lockedBy: null, scheduledAt: new Date(now.getTime() + 86400000) });
    expect(await releaseDeferredJob(db, job.id, prefix, new JobDeferredError(), now)).toBe(0);
    expect(await db.deadLetterEvent.count({ where: { sourceId: job.id } })).toBe(0);
  });
  test("protects operational endpoints and returns safe measured metadata", async () => {
    for (const route of ["/api/admin/ai/readiness", "/api/admin/rag/index"]) {
      expect((await fetch(baseUrl + route)).status).toBe(401);
      const response = await fetch(baseUrl + route, { headers: { cookie } });
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
      const text = await response.text(); expect(text).not.toContain("apiKey"); expect(text).not.toContain("contentHash");
    }
    const headers = { cookie, "content-type": "application/json", "x-requested-with": "fetch" };
    const withoutCsrf = await fetch(baseUrl + "/api/admin/ai/readiness", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "VERIFY_PROVIDER" }) });
    expect(withoutCsrf.status).toBe(403);
    const probe = await fetch(baseUrl + "/api/admin/ai/readiness", { method: "POST", headers, body: JSON.stringify({ action: "VERIFY_PROVIDER" }) });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toMatchObject({ succeeded: false, reason: "AI_KILL_SWITCH" });
    const tooMany = await fetch(baseUrl + "/api/admin/rag/index", { method: "POST", headers, body: JSON.stringify({ documents: docIds.slice(0, 11).map((id) => ({ id, version: 1 })) }) });
    expect(tooMany.status).toBe(400);
    const rebuild = await fetch(baseUrl + "/api/admin/rag/index", { method: "POST", headers, body: JSON.stringify({ documents: [{ id: docIds[0], version: 1 }, { id: docIds[1], version: 999 }] }) });
    expect(rebuild.status).toBe(200);
    expect((await rebuild.json() as { results: { indexed: boolean }[] }).results.every((result) => !result.indexed)).toBe(true);
    const list = await fetch(baseUrl + "/api/admin/rag", { headers: { cookie } });
    expect(list.status).toBe(200); expect(await list.text()).not.toContain("disposable local fixture");
    const detail = await fetch(baseUrl + "/api/admin/rag/documents/" + docIds[1], { headers: { cookie } });
    expect(detail.status).toBe(200); expect(await detail.text()).toContain("disposable local fixture");
  });
});
