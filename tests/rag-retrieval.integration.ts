import { afterAll, describe, expect, it } from "bun:test";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { embed, LOCAL_EMBEDDING_VERSION, retrieve } from "@/server/rag/pipeline";
import { hashRagContent } from "@/server/rag/provenance";

const prefix = `test-rag-policy-${randomUUID()}`;
const createdDocumentSlugs: string[] = [];
const createdSourceIds: string[] = [];

async function addDocument(opts: {
  key: string;
  locale: "en" | "ar";
  isApproved: boolean;
  freshnessReviewDueAt: Date;
  status?: string;
}) {
  const sourceId = `${prefix}-${opts.key}`;
  const slug = `${prefix}-${opts.key}`;
  const content = opts.locale === "ar"
    ? "نص اصطناعي للاختبار عن سياسات العقارات والتحقق من المصادر؛ ليس معلومة سوقية."
    : "Citrine lantern policy retrieval fixture; this is synthetic test text only.";
  createdSourceIds.push(sourceId);
  createdDocumentSlugs.push(slug);
  const source = await db.ragSource.create({
    data: {
      id: sourceId,
      title: `Synthetic test source ${opts.key}`,
      trustTier: "OFFICIAL",
      isActive: true,
      isApproved: opts.isApproved,
      approvedById: opts.isApproved ? "synthetic-rag-reviewer" : null,
      approvedAt: opts.isApproved ? new Date(Date.now() - 60_000) : null,
      verifiedAt: new Date(Date.now() - 86_400_000),
      freshnessReviewDueAt: opts.freshnessReviewDueAt,
    },
  });
  const document = await db.ragDocument.create({
    data: {
      sourceId: source.id,
      title: `Synthetic test document ${opts.key}`,
      slug,
      content,
      locale: opts.locale,
      status: opts.status ?? "ACTIVE",
      contentHash: hashRagContent(content),
      approvedById: (opts.status ?? "ACTIVE") === "ACTIVE" ? "synthetic-rag-reviewer" : null,
      approvedAt: (opts.status ?? "ACTIVE") === "ACTIVE" ? new Date(Date.now() - 60_000) : null,
    },
  });
  await db.ragChunk.create({
    data: {
      documentId: document.id,
      documentVersion: document.version,
      sequence: 0,
      content,
      tokenCount: Math.ceil(content.length / 4),
      embeddingJson: JSON.stringify(embed(`${document.title}\n${content}`).vector),
      embeddingVersion: LOCAL_EMBEDDING_VERSION,
      isActive: true,
    },
  });
}

afterAll(async () => {
  await db.ragDocument.deleteMany({ where: { slug: { in: createdDocumentSlugs } } });
  await db.ragSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await db.$disconnect();
});

describe("RAG retrieval source gates", () => {
  it("filters unapproved, stale, retired, and cross-locale chunks", async () => {
    const now = Date.now();
    await addDocument({ key: "approved-en", locale: "en", isApproved: true, freshnessReviewDueAt: new Date(now + 30 * 86_400_000) });
    await addDocument({ key: "approved-ar", locale: "ar", isApproved: true, freshnessReviewDueAt: new Date(now + 30 * 86_400_000) });
    await addDocument({ key: "unapproved", locale: "en", isApproved: false, freshnessReviewDueAt: new Date(now + 30 * 86_400_000) });
    await addDocument({ key: "stale", locale: "en", isApproved: true, freshnessReviewDueAt: new Date(now - 1_000) });
    await addDocument({ key: "retired", locale: "en", isApproved: true, freshnessReviewDueAt: new Date(now + 30 * 86_400_000), status: "RETIRED" });

    const english = await retrieve("citrine lantern policy", 10, "en");
    const arabic = await retrieve("سياسات العقارات والتحقق من المصادر", 10, "ar");
    const englishSlugs = english.map((item) => item.documentId);
    const arabicSlugs = arabic.map((item) => item.documentId);

    expect(english).toHaveLength(1);
    expect(arabic).toHaveLength(1);
    expect(english[0]?.documentTitle).toBe("Synthetic test document approved-en");
    expect(arabic[0]?.documentTitle).toBe("Synthetic test document approved-ar");
    expect(englishSlugs).not.toEqual(arabicSlugs);
    expect(arabic[0]?.sourceTitle).toBe("Synthetic test source approved-ar");
    expect(arabic[0]?.content).toContain("نص اصطناعي للاختبار");
    expect(arabic[0]?.verifiedAt).toBeTruthy();
    expect(await retrieve("zqxjv qwvplm", 10, "ar")).toEqual([]);
    // A shared word in an unrelated test-source title is not enough to ground a multiword answer.
    expect(await retrieve("approved unrelated mortgage regulation requirements", 10, "ar")).toEqual([]);
    expect(await retrieve("approved legislation regulations mortgage policy for investors", 10, "ar")).toEqual([]);
  });
});
