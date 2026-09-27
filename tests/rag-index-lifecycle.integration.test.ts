import { afterAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { mapOutboxEventToJob } from "@/server/jobs/outbox";
import { chunkText, embed, LOCAL_EMBEDDING_VERSION, rebuildDocumentIndex, reconcileRagSourceIndex, retrieve } from "@/server/rag/pipeline";
import { hashRagContent } from "@/server/rag/provenance";

const prefix = `test-rag-index-${randomUUID()}`;
const sourceId = `${prefix}-source`;
const slug = `${prefix}-document`;
const needle = randomUUID().replace(/[0-9-]/g, "");
const initialContent = `${needle} juniper lantern. This synthetic retrieval fixture tests document-versioned indexing and source reconciliation.`;

async function cleanup() {
  const document = await db.ragDocument.findUnique({ where: { slug }, select: { id: true } });
  if (document) await db.ragDocument.delete({ where: { id: document.id } });
  await db.ragSource.deleteMany({ where: { id: sourceId } });
}

afterAll(async () => { await cleanup(); await db.$disconnect(); });

describe("versioned local RAG index lifecycle", () => {
  it("bounds long paragraph chunks and uses corpus-independent local vectors", () => {
    const text = "juniper ".repeat(2_000).trim();
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Math.ceil(chunk.length / 4) <= 260)).toBe(true);
    expect(chunks.join(" ").split(/\s+/)).toHaveLength(2_000);
    const unbrokenChunks = chunkText("x".repeat(2_000));
    expect(unbrokenChunks.every((chunk) => Math.ceil(chunk.length / 4) <= 260)).toBe(true);
    expect(unbrokenChunks.join("")).toBe("x".repeat(2_000));
    expect(embed("juniper lantern")).toEqual(embed("juniper lantern"));
    expect(LOCAL_EMBEDDING_VERSION).toBe("local-tf-cosine-v1");
  });

  it("ignores stale revision jobs and withdraws/rebuilds chunks on source changes", async () => {
    await cleanup();
    const now = new Date();
    await db.ragSource.create({ data: {
      id: sourceId,
      title: `${prefix} synthetic source`,
      sourceType: "INTERNAL_DOC",
      trustTier: "INTERNAL",
      isActive: true,
      isApproved: true,
      approvedById: "synthetic-reviewer",
      approvedAt: new Date(now.getTime() - 60_000),
      verifiedAt: new Date(now.getTime() - 86_400_000),
      freshnessReviewDueAt: new Date(now.getTime() + 30 * 86_400_000),
    } });
    const document = await db.ragDocument.create({ data: {
      sourceId,
      title: `${prefix} synthetic document`,
      slug,
      content: initialContent,
      contentHash: hashRagContent(initialContent),
      locale: "en",
      status: "ACTIVE",
      version: 1,
      approvedById: "synthetic-reviewer",
      approvedAt: new Date(now.getTime() - 30_000),
    } });

    const publishedJob = mapOutboxEventToJob("test-event", "rag.document.published", "rag_document", document.id, { documentVersion: 1 });
    const sourceJob = mapOutboxEventToJob("test-source-event", "rag.source.updated", "rag_source", sourceId, {});
    expect(publishedJob).toMatchObject({ key: "rag.embed.document", payload: { documentId: document.id, documentVersion: 1 } });
    expect(sourceJob).toMatchObject({ key: "rag.reconcile.source", payload: { sourceId } });

    await db.ragChunk.create({ data: {
      documentId: document.id,
      documentVersion: 0,
      sequence: 0,
      content: "stale synthetic chunk should never be retrieved",
      tokenCount: 10,
      embeddingJson: JSON.stringify(embed("stale synthetic chunk").vector),
      embeddingVersion: LOCAL_EMBEDDING_VERSION,
    } });
    expect(await retrieve(needle, 10, "en")).toHaveLength(0);
    expect(await rebuildDocumentIndex(document.id, 1)).toBe(true);
    expect(await retrieve(needle, 10, "en")).toHaveLength(1);

    const nextContent = `${initialContent} ${needle} revised lantern method with a second fully synthetic sentence.`;
    await db.ragDocument.update({ where: { id: document.id }, data: {
      content: nextContent,
      contentHash: hashRagContent(nextContent),
      version: 2,
    } });
    expect(await rebuildDocumentIndex(document.id, 1)).toBe(false);
    expect(await retrieve(needle, 10, "en")).toHaveLength(0);
    expect(await rebuildDocumentIndex(document.id, 2)).toBe(true);
    expect(await db.ragChunk.count({ where: { documentId: document.id, documentVersion: 2, embeddingVersion: LOCAL_EMBEDDING_VERSION } })).toBeGreaterThan(0);

    await db.ragSource.update({ where: { id: sourceId }, data: { isApproved: false, approvedById: null, approvedAt: null } });
    expect(await reconcileRagSourceIndex(sourceId)).toBeGreaterThan(0);
    expect(await db.ragChunk.count({ where: { documentId: document.id } })).toBe(0);
    expect(await retrieve(needle, 10, "en")).toHaveLength(0);

    await db.ragSource.update({ where: { id: sourceId }, data: {
      isApproved: true,
      approvedById: "synthetic-second-reviewer",
      approvedAt: new Date(),
    } });
    expect(await reconcileRagSourceIndex(sourceId)).toBe(1);
    expect(await retrieve(needle, 10, "en")).toHaveLength(1);
  });
});
