import { HttpError, type SessionUser } from "@/server/auth";
import { db } from "@/lib/db";

export function requireStorageInventoryOwner(actor: SessionUser) {
  if (!actor.roles.includes("OWNER")) throw new HttpError(403, "Storage reconciliation requires the website owner.", "FORBIDDEN");
}

/** Logical keys only: no credentials, signed URLs, private content or customer details. */
export async function storageReferenceInventory(actor: SessionUser) {
  requireStorageInventoryOwner(actor);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const media = await tx.mediaAsset.findMany({ orderBy: { id: "asc" }, take: 20001,
      select: { id: true, storageKey: true, kind: true, mimeType: true, sizeBytes: true, checksum: true, isPrivate: true, variantsJson: true } });
    const imports = await tx.importRun.findMany({ where: { snapshotRef: { not: null } }, distinct: ["snapshotRef"],
      orderBy: { snapshotRef: "asc" }, take: 10001, select: { snapshotRef: true } });
    if (media.length > 20000 || imports.length > 10000) throw new HttpError(409, "Use the hosted snapshot for this larger inventory.", "STORAGE_INVENTORY_BOUND");
    return { capturedAtUtc: new Date().toISOString(), consistency: "Read-only repeatable-read reference inventory; not a database backup.",
      media, imports, backupAcceptance: "NOT_VERIFIED" };
  }, { isolationLevel: "RepeatableRead", timeout: 15000 });
}
