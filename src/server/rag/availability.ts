import { db } from "@/lib/db";
import { LOCAL_EMBEDDING_VERSION } from "./pipeline";
import { normalizeRagLocale } from "./policy";

/** Exact existence check; stale document revisions and expired approvals do not count. */
export async function hasApprovedKnowledge(locale: string, now = new Date()) {
  const [row] = await db.$queryRaw<{ available: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM "RagChunk" c JOIN "RagDocument" d ON d.id = c."documentId"
      JOIN "RagSource" s ON s.id = d."sourceId"
      WHERE c."isActive" AND c."embeddingVersion" = ${LOCAL_EMBEDDING_VERSION} AND c."documentVersion" = d.version
        AND d.status = 'ACTIVE' AND d.locale = ${normalizeRagLocale(locale)}
        AND NULLIF(TRIM(d."approvedById"), '') IS NOT NULL AND d."approvedAt" <= ${now}
        AND s."isActive" AND s."isApproved" AND NULLIF(TRIM(s."approvedById"), '') IS NOT NULL
        AND s."approvedAt" <= ${now} AND s."trustTier" <> 'UNVERIFIED'
        AND s."verifiedAt" <= ${now} AND s."freshnessReviewDueAt" > ${now}) AS available
  `;
  return row?.available === true;
}
