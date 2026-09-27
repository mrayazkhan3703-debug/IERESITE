/**
 * RAG pipeline (Q24): approved-source ingestion, chunking, deterministic local
 * embeddings (stable local term vectors — ADR-002), hybrid retrieval (keyword BM25-lite +
 * vector cosine + rerank by trust/freshness), citations with source metadata.
 * Production path: swap embed() to provider embeddings + pgvector.
 */
import { db, parseJson } from "@/lib/db";
import { tokenize } from "@/server/search/local-provider";
import { isRagSourceRetrievable, normalizeRagLocale } from "./policy";
import { hashRagContent } from "./provenance";

/* Embedding: deterministic TF-IDF over a shared vocabulary --------------------- */

export const LOCAL_EMBEDDING_VERSION = "local-tf-cosine-v1";

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

export interface LocalEmbedding {
  vector: Record<string, number>; // sparse {term: weight}
  norm: number;
}

export function embed(text: string): LocalEmbedding {
  const tokens = tokenize(text);
  const tf = termFreq(tokens);
  const vector: Record<string, number> = {};
  let norm = 0;
  for (const [term, count] of tf) {
    // Corpus-independent weights keep stored vectors comparable after unrelated
    // documents are added, edited, retired, or reindexed.
    const weight = 1 + Math.log(count);
    vector[term] = weight;
    norm += weight * weight;
  }
  return { vector, norm: Math.sqrt(norm) || 1 };
}

export function cosine(a: LocalEmbedding, b: LocalEmbedding): number {
  let dot = 0;
  const [small, large] = Object.keys(a.vector).length < Object.keys(b.vector).length ? [a, b] : [b, a];
  for (const [term, w] of Object.entries(small.vector)) {
    const other = large.vector[term];
    if (other) dot += w * other;
  }
  return dot / (small.norm * large.norm);
}

/* Chunking ----------------------------------------------------------------------- */

export function chunkText(text: string, targetTokens = 180, maxTokens = 260): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  const countTokens = (s: string) => Math.ceil(s.length / 4);

  const splitAtMax = (value: string): string[] => {
    const parts: string[] = [];
    let remainder = value.trim();
    const maxChars = maxTokens * 4;
    while (countTokens(remainder) > maxTokens) {
      let splitAt = remainder.lastIndexOf(" ", maxChars);
      if (splitAt < maxChars * 0.6) {
        const codePoints = Array.from(remainder);
        let units = 0;
        let pointCount = 0;
        while (pointCount < codePoints.length && units + (codePoints[pointCount]?.length ?? 0) <= maxChars) {
          units += codePoints[pointCount]?.length ?? 0;
          pointCount += 1;
        }
        splitAt = pointCount || 1;
        parts.push(codePoints.slice(0, splitAt).join("").trim());
        remainder = codePoints.slice(splitAt).join("").trim();
      } else {
        parts.push(remainder.slice(0, splitAt).trim());
        remainder = remainder.slice(splitAt).trim();
      }
    }
    if (remainder) parts.push(remainder);
    return parts;
  };

  const flush = () => {
    if (current.length) chunks.push(current.join("\n\n"));
    current = [];
    currentTokens = 0;
  };

  for (const para of paragraphs) {
    const sentences = para.split(/(?<=[.!?؟۔])\s+/).filter(Boolean);
    for (const sentence of sentences) {
      for (const segment of splitAtMax(sentence)) {
        const tokens = countTokens(segment);
        if (currentTokens + tokens > targetTokens && current.length) flush();
        current.push(segment);
        currentTokens += tokens;
      }
    }
  }
  flush();
  return chunks.filter((chunk) => chunk.length > 40);
}

/* Document ingestion pipeline ------------------------------------------------------- */

export async function ingestDocument(opts: {
  sourceId: string;
  title: string;
  slug: string;
  content: string;
  locale?: string;
}): Promise<{ documentId: string; chunks: number }> {
  const contentHash = hashRagContent(opts.content);
  const locale = normalizeRagLocale(opts.locale);
  const existing = await db.ragDocument.findUnique({ where: { slug: opts.slug } });
  let doc: NonNullable<typeof existing>;
  if (existing && existing.contentHash === contentHash && existing.locale === locale && existing.sourceId === opts.sourceId && existing.title === opts.title) {
    const existingChunks = await db.ragChunk.count({ where: { documentId: existing.id } });
    if (existingChunks > 0) return { documentId: existing.id, chunks: existingChunks };
    doc = existing;
  } else {
    doc = await db.ragDocument.upsert({
      where: { slug: opts.slug },
      create: { sourceId: opts.sourceId, title: opts.title, slug: opts.slug, content: opts.content, contentHash, locale, status: "DRAFT" },
      update: {
        sourceId: opts.sourceId, title: opts.title, content: opts.content, contentHash, locale,
        status: "DRAFT", approvedById: null, approvedAt: null, version: { increment: 1 },
      },
    });
  }

  const chunks = chunkText(opts.content);
  await db.ragChunk.deleteMany({ where: { documentId: doc.id } });
  if (chunks.length) {
    await db.ragChunk.createMany({
      data: chunks.map((content, sequence) => ({
        documentId: doc.id,
        documentVersion: doc.version,
        sequence,
        content,
        tokenCount: Math.ceil(content.length / 4),
        keywordsJson: JSON.stringify([...termFreq(tokenize(content)).keys()].slice(0, 30)),
      })),
    });
  }
  return { documentId: doc.id, chunks: chunks.length };
}

/** Rebuild only the exact reviewed revision named by the event. */
export async function rebuildDocumentIndex(documentId: string, expectedVersion?: number, signal?: AbortSignal): Promise<boolean> {
  if (!documentId) throw new Error("documentId required");
  return db.$transaction(async (tx) => {
    signal?.throwIfAborted();
    const doc = await tx.ragDocument.findUnique({ where: { id: documentId }, include: { source: true } });
    signal?.throwIfAborted();
    if (!doc || (expectedVersion !== undefined && doc.version !== expectedVersion)) return false;
    if (doc.status !== "ACTIVE" || !doc.approvedById || !isRagSourceRetrievable(doc.source)) {
      await tx.ragChunk.deleteMany({ where: { documentId } });
      return false;
    }
    const chunks = chunkText(doc.content);
    if (!chunks.length) throw new Error("Approved RAG document produced no searchable chunks");
    await tx.ragChunk.deleteMany({ where: { documentId } });
    await tx.ragChunk.createMany({
      data: chunks.map((content, sequence) => {
        const vector = embed(`${doc.title}\n${content}`);
        return {
          documentId,
          documentVersion: doc.version,
          sequence,
          content,
          tokenCount: Math.ceil(content.length / 4),
          embeddingJson: JSON.stringify(vector.vector),
          embeddingVersion: LOCAL_EMBEDDING_VERSION,
          keywordsJson: JSON.stringify([...termFreq(tokenize(content)).keys()].slice(0, 30)),
        };
      }),
    });
    return true;
  }, { isolationLevel: "Serializable" });
}

/** Reconcile every active document after its source is approved or revoked. */
export async function reconcileRagSourceIndex(sourceId: string, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  const source = await db.ragSource.findUnique({ where: { id: sourceId }, include: { documents: { select: { id: true, version: true, status: true } } } });
  if (!source) return 0;
  const activeDocuments = source.documents.filter((document) => document.status === "ACTIVE");
  if (!isRagSourceRetrievable(source)) {
    signal?.throwIfAborted();
    const result = await db.ragChunk.deleteMany({ where: { documentId: { in: source.documents.map((document) => document.id) } } });
    return result.count;
  }
  let indexed = 0;
  for (const document of activeDocuments) {
    signal?.throwIfAborted();
    if (await rebuildDocumentIndex(document.id, document.version, signal)) indexed += 1;
  }
  return indexed;
}

/* Hybrid retrieval --------------------------------------------------------------------- */

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceId: string;
  sourceTitle: string;
  trustTier: string;
  publishedAt: string | null;
  verifiedAt: string;
  canonicalUrl: string | null;
  content: string;
  score: number;
}

export async function retrieve(query: string, k = 4, localeInput = "en"): Promise<RetrievedChunk[]> {
  const locale = normalizeRagLocale(localeInput);
  const now = new Date();
  const chunks = await db.ragChunk.findMany({
    where: {
      isActive: true,
      embeddingVersion: LOCAL_EMBEDDING_VERSION,
      document: {
        status: "ACTIVE",
        locale,
        source: {
          isActive: true,
          isApproved: true,
          trustTier: { not: "UNVERIFIED" },
          verifiedAt: { not: null },
          freshnessReviewDueAt: { gt: now },
        },
      },
    },
    include: { document: { include: { source: true } } },
    take: 2_000,
  });
  const currentChunks = chunks.filter((chunk) => chunk.documentVersion === chunk.document.version);
  if (!currentChunks.length) return [];

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const queryEmb = embed(query);
  const results: RetrievedChunk[] = [];

  for (const chunk of currentChunks) {
    const sourceVerifiedAt = chunk.document.source.verifiedAt;
    if (!isRagSourceRetrievable(chunk.document.source, now) || !sourceVerifiedAt) continue;
    // keyword score: fraction of query tokens present (BM25-lite)
    const chunkTokens = new Set(tokenize(chunk.content + " " + chunk.document.title));
    let keywordScore = 0;
    let matchedTokenCount = 0;
    for (const qt of queryTokens) {
      if (chunkTokens.has(qt)) {
        keywordScore += 1;
        matchedTokenCount += 1;
      }
      else {
        // partial/fuzzy match for typo tolerance
        for (const ct of chunkTokens) {
          if (Math.abs(ct.length - qt.length) <= 1 && ct[0] === qt[0] && levenshteinClose(ct, qt)) {
            keywordScore += 0.6;
            matchedTokenCount += 1;
            break;
          }
        }
      }
    }
    keywordScore /= queryTokens.length;
    // Local vectors are exact sparse term vectors, not semantic embeddings.
    // Require at least two matching terms for multiword questions so one shared
    // generic word/title token cannot surface an unrelated source as evidence.
    if (matchedTokenCount < Math.min(2, queryTokens.length)) continue;

    // vector score
    let vectorScore = 0;
    if (chunk.embeddingJson) {
      const vec = parseJson<Record<string, number>>(chunk.embeddingJson, {});
      const norm = Math.sqrt(Object.values(vec).reduce((s, w) => s + w * w, 0)) || 1;
      const qNorm = queryEmb.norm;
      let dot = 0;
      for (const [term, w] of Object.entries(queryEmb.vector)) {
        const other = vec[term];
        if (other) dot += w * other;
      }
      vectorScore = dot / (qNorm * norm);
    }

    const trustBoost = TRUST_WEIGHT[chunk.document.source.trustTier] ?? 0;
    const freshDays = (now.getTime() - sourceVerifiedAt.getTime()) / 86400_000;
    const freshnessBoost = Math.max(0, 0.05 - freshDays / 8000); // newer = tiny boost

    const score = 0.55 * keywordScore + 0.45 * vectorScore + trustBoost + freshnessBoost;
    if (score < 0.15) continue;

    results.push({
      chunkId: chunk.id,
      documentId: chunk.document.id,
      documentTitle: chunk.document.title,
      sourceId: chunk.document.source.id,
      sourceTitle: chunk.document.source.title,
      trustTier: chunk.document.source.trustTier,
      publishedAt: chunk.document.source.publishedAt?.toISOString() ?? null,
      verifiedAt: sourceVerifiedAt.toISOString(),
      canonicalUrl: chunk.document.source.canonicalUrl,
      content: chunk.content,
      score,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, k);
}

const TRUST_WEIGHT: Record<string, number> = { OFFICIAL: 0.08, INTERNAL: 0.06, SECONDARY: 0.02, UNVERIFIED: 0 };

function levenshteinClose(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) diff++;
  diff += Math.abs(a.length - b.length);
  return diff <= 1 && len >= 4;
}
