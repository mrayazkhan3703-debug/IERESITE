import type { Prisma } from "@prisma/client";
import { HttpError } from "@/server/auth";
import { documentAttachmentSchema, floorPlanAttachmentSchema, galleryAttachmentSchema, type EntityMediaInput } from "@/lib/media-contract";

/** Called only inside the authorized entity command's version-checked transaction. */
export async function saveEntityMedia(tx: Prisma.TransactionClient, type: "PROPERTY" | "PROJECT", id: string, input: EntityMediaInput) {
  async function validate(ids: string[], category: "gallery" | "floor" | "document") {
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "Attach each asset only once per collection.", "DUPLICATE_ATTACHMENT");
    if (!ids.length) return [];
    const assets = await tx.mediaAsset.findMany({ where: { id: { in: ids }, isPrivate: false }, select: { id: true, mimeType: true } });
    if (assets.length !== ids.length || assets.some((asset) => category === "gallery"
      ? !asset.mimeType.startsWith("image/") && !asset.mimeType.startsWith("video/")
      : category === "floor" ? !asset.mimeType.startsWith("image/") && asset.mimeType !== "application/pdf" : asset.mimeType !== "application/pdf")) {
      throw new HttpError(422, "Choose public media of the correct type for this attachment.", "INVALID_ATTACHMENT");
    }
    return assets;
  }
  async function gallery(section: "GALLERY" | "PROGRESS", supplied: EntityMediaInput["gallery"]) {
    if (supplied === undefined) return;
    if (supplied.length > 60) throw new HttpError(422, "A gallery supports up to 60 assets.", "INVALID_ATTACHMENT");
    const rows = supplied.map((row) => galleryAttachmentSchema.parse(row));
    const assets = await validate(rows.map((row) => row.mediaId), "gallery");
    const covers = rows.filter((row) => row.isCover);
    if (covers.length > 1 || covers.some((row) => !assets.find((asset) => asset.id === row.mediaId)?.mimeType.startsWith("image/"))) {
      throw new HttpError(422, "Choose one image as the cover.", "INVALID_COVER");
    }
    const cover = section === "GALLERY" ? covers[0]?.mediaId ?? assets.find((asset) => asset.mimeType.startsWith("image/"))?.id : undefined;
    if (type === "PROPERTY") {
      const existing = await tx.propertyMedia.findMany({ where: { propertyId: id } });
      await tx.propertyMedia.deleteMany({ where: { propertyId: id, mediaId: { notIn: rows.map((row) => row.mediaId) } } });
      const created: Prisma.PropertyMediaCreateManyInput[] = [];
      for (const [sortOrder, row] of rows.entries()) {
        const data = { sortOrder, isCover: row.mediaId === cover, altText: row.altText ?? null, caption: row.caption ?? null };
        const previous = existing.find((item) => item.mediaId === row.mediaId);
        if (previous) {
          if (previous.sortOrder !== data.sortOrder || previous.isCover !== data.isCover || previous.altText !== data.altText || previous.caption !== data.caption) await tx.propertyMedia.update({ where: { id: previous.id }, data });
        } else created.push({ propertyId: id, mediaId: row.mediaId, ...data });
      }
      if (created.length) await tx.propertyMedia.createMany({ data: created });
    } else {
      const existing = await tx.projectMedia.findMany({ where: { projectId: id, section } });
      await tx.projectMedia.deleteMany({ where: { projectId: id, section, mediaId: { notIn: rows.map((row) => row.mediaId) } } });
      const created: Prisma.ProjectMediaCreateManyInput[] = [];
      for (const [sortOrder, row] of rows.entries()) {
        const data = { sortOrder, isCover: row.mediaId === cover, altText: row.altText ?? null, caption: row.caption ?? null };
        const previous = existing.find((item) => item.mediaId === row.mediaId);
        if (previous) {
          if (previous.sortOrder !== data.sortOrder || previous.isCover !== data.isCover || previous.altText !== data.altText || previous.caption !== data.caption) await tx.projectMedia.update({ where: { id: previous.id }, data });
        } else created.push({ projectId: id, section, mediaId: row.mediaId, ...data });
      }
      if (created.length) await tx.projectMedia.createMany({ data: created });
    }
  }
  await gallery("GALLERY", input.gallery);
  if (type === "PROJECT") await gallery("PROGRESS", input.progressGallery);
  if (type === "PROPERTY" && input.floorPlans !== undefined) {
    if (input.floorPlans.length > 30) throw new HttpError(422, "Use up to 30 floor plans.", "INVALID_ATTACHMENT");
    const rows = input.floorPlans.map((row) => floorPlanAttachmentSchema.parse(row));
    await validate(rows.map((row) => row.mediaId), "floor");
    const existing = await tx.propertyFloorPlan.findMany({ where: { propertyId: id } });
    await tx.propertyFloorPlan.deleteMany({ where: { propertyId: id, mediaId: { notIn: rows.map((row) => row.mediaId) } } });
    const created: Prisma.PropertyFloorPlanCreateManyInput[] = [];
    for (const row of rows) {
      const data = { label: row.label ?? null, bedrooms: row.bedrooms ?? null, areaSqft: row.areaSqft ?? null, priceMinor: row.priceAed == null ? null : BigInt(Math.round(row.priceAed * 100)) };
      const previous = existing.find((item) => item.mediaId === row.mediaId);
      if (previous) await tx.propertyFloorPlan.update({ where: { id: previous.id }, data });
      else created.push({ propertyId: id, mediaId: row.mediaId, ...data });
    }
    if (created.length) await tx.propertyFloorPlan.createMany({ data: created });
  }
  if (input.documents !== undefined) {
    if (input.documents.length > 30) throw new HttpError(422, "Use up to 30 documents.", "INVALID_ATTACHMENT");
    const rows = input.documents.map((row) => documentAttachmentSchema.parse(row));
    await validate(rows.map((row) => row.mediaId), "document");
    const scope = type === "PROPERTY" ? { propertyId: id } : { projectId: id };
    const existing = await tx.propertyDocument.findMany({ where: scope });
    await tx.propertyDocument.deleteMany({ where: { ...scope, mediaId: { notIn: rows.map((row) => row.mediaId) } } });
    const created: Prisma.PropertyDocumentCreateManyInput[] = [];
    for (const row of rows) {
      if (["TITLE_DEED", "ESCALATION"].includes(row.docType) && !row.gated) throw new HttpError(422, "Sensitive documents must have protected delivery.", "PRIVATE_DOCUMENT_REQUIRED");
      const data = { label: row.label ?? null, docType: row.docType, gated: row.gated };
      const previous = existing.find((item) => item.mediaId === row.mediaId);
      if (previous) await tx.propertyDocument.update({ where: { id: previous.id }, data });
      else created.push({ ...scope, mediaId: row.mediaId, ...data });
    }
    if (created.length) await tx.propertyDocument.createMany({ data: created });
  }
}
