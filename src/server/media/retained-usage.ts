import type { Prisma } from "@prisma/client";
export interface RetainedMediaUsage { type: string; id: string; label: string; href: null }

/** Bounded library diagnostics; the deletion command performs authoritative full counts. */
export async function retainedMediaUsage(tx: Prisma.TransactionClient, ids: string[]) {
  const uses = new Map(ids.map((id) => [id, [] as RetainedMediaUsage[]]));
  if (!ids.length) return { uses, truncated: false };
  const limit = 2000;
  const contains = ids.map((id) => ({ contains: id }));
  const [posters, blocks, settings, contentRevisions, settingRevisions, reportRevisions, seoRevisions] = await Promise.all([
    tx.mediaAsset.findMany({ where: { posterMediaId: { in: ids } }, select: { id: true, posterMediaId: true }, take: limit }),
    tx.contentEntry.findMany({ where: { OR: contains.map((filter) => ({ bodyJson: filter })) }, select: { id: true, bodyJson: true }, take: limit }),
    tx.siteSetting.findMany({ where: { OR: contains.map((filter) => ({ settingsJson: filter })) }, select: { id: true, settingsJson: true }, take: limit }),
    tx.contentRevision.findMany({ where: { OR: contains.map((filter) => ({ snapshotJson: filter })) }, select: { id: true, snapshotJson: true }, take: limit }),
    tx.siteSettingRevision.findMany({ where: { OR: contains.map((filter) => ({ snapshotJson: filter })) }, select: { id: true, snapshotJson: true }, take: limit }),
    tx.marketReportRevision.findMany({ where: { OR: contains.map((filter) => ({ snapshotJson: filter })) }, select: { id: true, snapshotJson: true }, take: limit }),
    tx.seoMetadataRevision.findMany({ where: { OR: contains.map((filter) => ({ snapshotJson: filter })) }, select: { id: true, snapshotJson: true }, take: limit }),
  ]);
  posters.forEach((row) => uses.get(row.posterMediaId!)?.push({ type: "VIDEO_POSTER", id: row.id, label: "Video poster reference", href: null }));
  const sources = [
    { type: "CONTENT_IMAGE_BLOCK", rows: blocks.map((row) => ({ id: row.id, text: row.bodyJson })) },
    { type: "SITE_SETTINGS", rows: settings.map((row) => ({ id: row.id, text: row.settingsJson })) },
    { type: "CONTENT_REVISION", rows: contentRevisions.map((row) => ({ id: row.id, text: row.snapshotJson })) },
    { type: "SETTINGS_REVISION", rows: settingRevisions.map((row) => ({ id: row.id, text: row.snapshotJson })) },
    { type: "REPORT_REVISION", rows: reportRevisions.map((row) => ({ id: row.id, text: row.snapshotJson })) },
    { type: "SEO_REVISION", rows: seoRevisions.map((row) => ({ id: row.id, text: row.snapshotJson })) },
  ];
  for (const source of sources) for (const row of source.rows) for (const id of ids) {
    if (row.text?.includes(id)) uses.get(id)?.push({ type: source.type, id: row.id, label: source.type.includes("REVISION") ? "Retained revision" : source.type === "SITE_SETTINGS" ? "Site Settings" : "Content image block", href: null });
  }
  return { uses, truncated: posters.length === limit || sources.some((source) => source.rows.length === limit) };
}
