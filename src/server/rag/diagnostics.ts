import { db } from "@/lib/db";
import { isRagSourceRetrievable } from "./policy";
import { LOCAL_EMBEDDING_VERSION } from "./pipeline";
export async function ragDiagnostics(cursor?: string) {
  const now = new Date();
  const rows = await db.ragDocument.findMany({
    where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" }, take: 26,
    select: { id: true, title: true, locale: true, status: true, version: true, approvedById: true, approvedAt: true,
      source: { select: { isActive: true, isApproved: true, trustTier: true, verifiedAt: true, freshnessReviewDueAt: true } },
      chunks: { where: { isActive: true, embeddingVersion: LOCAL_EMBEDDING_VERSION }, select: { documentVersion: true }, take: 501 } },
  });
  return { checkedAt: now.toISOString(), embedding: LOCAL_EMBEDDING_VERSION, limit: 25, nextCursor: rows.length > 25 ? rows[24].id : null,
    documents: rows.slice(0, 25).map((doc) => {
      const currentChunks = doc.chunks.filter((chunk) => chunk.documentVersion === doc.version).length;
      const reason = doc.status !== "ACTIVE" ? "DOCUMENT_NOT_ACTIVE" : !doc.approvedById || !doc.approvedAt ? "DOCUMENT_NOT_APPROVED"
        : !isRagSourceRetrievable(doc.source, now) ? "SOURCE_NOT_APPROVED_OR_CURRENT" : !currentChunks ? "CURRENT_REVISION_NOT_INDEXED" : null;
      return { id: doc.id, title: doc.title, locale: doc.locale, version: doc.version, currentChunks, truncated: doc.chunks.length > 500, status: reason ? "EXCLUDED" : "READY", reason, canIndex: doc.status === "ACTIVE" && Boolean(doc.approvedById && doc.approvedAt) && isRagSourceRetrievable(doc.source, now) };
    }), note: "Local lexical vectors only. READY means the approved current revision has searchable chunks; it does not verify external facts or guarantee an answer." };
}
