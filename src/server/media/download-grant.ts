import crypto from "node:crypto";
import { db } from "@/lib/db";
import { publicMarketReportWhere } from "@/server/domain/visibility";

export async function issueReportDownloadGrant(mediaId: string | null, reportId: string): Promise<string | null> {
  if (!mediaId) return null;
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaId, isPrivate: false, mimeType: "application/pdf" }, select: { id: true } });
  if (!asset) return null;
  const token = crypto.randomBytes(32).toString("hex");
  await db.mediaDownloadGrant.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.mediaDownloadGrant.create({ data: {
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"), mediaId,
    sourceType: "MARKET_REPORT", sourceId: reportId, expiresAt: new Date(Date.now() + 600000),
  } });
  return `/api/media/${encodeURIComponent(mediaId)}/content?grant=${token}`;
}

export async function validReportDownloadGrant(token: string | null, mediaId: string): Promise<boolean> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const grant = await db.mediaDownloadGrant.findUnique({ where: { tokenHash: crypto.createHash("sha256").update(token).digest("hex") } });
  if (!grant || grant.mediaId !== mediaId || grant.expiresAt <= new Date() || grant.sourceType !== "MARKET_REPORT") return false;
  return Boolean(await db.marketReport.findFirst({ where: { id: grant.sourceId, fileMediaId: mediaId, ...publicMarketReportWhere() }, select: { id: true } }));
}
