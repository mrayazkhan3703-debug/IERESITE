"use client";
import { MediaGalleryManager } from "./media-field";
import { Input } from "@/components/ui/input";
import type { EntityMediaInput, MediaAttachment } from "@/lib/media-contract";

type Floor = NonNullable<EntityMediaInput["floorPlans"]>[number] & MediaAttachment;
type Document = NonNullable<EntityMediaInput["documents"]>[number] & MediaAttachment;
export interface EntityMediaDraft { gallery: MediaAttachment[]; progressGallery: MediaAttachment[]; floorPlans: Floor[]; documents: Document[] }
export const emptyMediaDraft = (): EntityMediaDraft => ({ gallery: [], progressGallery: [], floorPlans: [], documents: [] });
export function readMediaDraft(entity: Record<string, unknown>): EntityMediaDraft {
  return {
    gallery: Array.isArray(entity.gallery) ? entity.gallery as MediaAttachment[] : [],
    progressGallery: Array.isArray(entity.progressGallery) ? entity.progressGallery as MediaAttachment[] : [],
    floorPlans: Array.isArray(entity.floorPlans) ? (entity.floorPlans as (Floor & { priceMinor?: string })[]).map((row) => ({ ...row, priceAed: row.priceMinor == null ? null : Number(row.priceMinor) / 100 })) : [],
    documents: Array.isArray(entity.documents) ? entity.documents as Document[] : [],
  };
}
export function mediaDraftPayload(draft: EntityMediaDraft, project = false): EntityMediaInput {
  const gallery = (rows: MediaAttachment[]) => rows.map(({ mediaId, isCover, altText, caption }) => ({ mediaId, isCover, altText, caption }));
  return {
    gallery: gallery(draft.gallery),
    ...(project ? { progressGallery: gallery(draft.progressGallery) } : { floorPlans: draft.floorPlans.map(({ mediaId, label, bedrooms, areaSqft, priceAed }) => ({ mediaId, label, bedrooms, areaSqft, priceAed })) }),
    documents: draft.documents.map(({ mediaId, label, docType, gated }) => ({ mediaId, label, docType: docType ?? "BROCHURE", gated: gated ?? false })),
  };
}
export function EntityMediaEditor({ value, onChange, project = false, onBusyChange }: {
  value: EntityMediaDraft; onChange: (value: EntityMediaDraft) => void; project?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  return <div className="space-y-4">
    <MediaGalleryManager label="Gallery" value={value.gallery} onChange={(gallery) => onChange({ ...value, gallery })} onBusyChange={onBusyChange} />
    {project && <MediaGalleryManager label="Construction progress media" value={value.progressGallery} primary={false} onChange={(progressGallery) => onChange({ ...value, progressGallery })} onBusyChange={onBusyChange} />}
    {!project && <>
      <MediaGalleryManager label="Floor plans" mode="floor-plan" kind="FLOOR_PLAN" primary={false} value={value.floorPlans} onChange={(rows) => onChange({ ...value, floorPlans: rows.map((row) => ({ ...value.floorPlans.find((previous) => previous.mediaId === row.mediaId), ...row })) })} onBusyChange={onBusyChange} />
      {value.floorPlans.map((row, index) => <fieldset key={row.mediaId} className="grid gap-2 rounded border p-3 sm:grid-cols-2"><legend>Floor plan {index + 1} details</legend>
        <Input aria-label={"Floor plan " + (index + 1) + " label"} placeholder="Label" value={row.label ?? ""} onChange={(event) => onChange({ ...value, floorPlans: value.floorPlans.map((item, at) => at === index ? { ...item, label: event.target.value } : item) })} />
        {(["bedrooms", "areaSqft", "priceAed"] as const).map((field) => <Input key={field} type="number" min={0} step="any" aria-label={"Floor plan " + (index + 1) + " " + field} placeholder={field} value={row[field] ?? ""} onChange={(event) => onChange({ ...value, floorPlans: value.floorPlans.map((item, at) => at === index ? { ...item, [field]: event.target.value === "" ? null : Number(event.target.value) } : item) })} />)}
      </fieldset>)}
    </>}
    <MediaGalleryManager label="Brochures / documents" mode="document" primary={false} value={value.documents} onChange={(rows) => onChange({ ...value, documents: rows.map((row) => ({ docType: "BROCHURE" as const, gated: false, ...value.documents.find((previous) => previous.mediaId === row.mediaId), ...row })) })} onBusyChange={onBusyChange} />
    {value.documents.map((row, index) => <fieldset key={row.mediaId} className="space-y-2 rounded border p-3"><legend>Document {index + 1} details</legend>
      <Input aria-label={"Document " + (index + 1) + " label"} value={row.label ?? ""} placeholder="Document label" onChange={(event) => onChange({ ...value, documents: value.documents.map((item, at) => at === index ? { ...item, label: event.target.value } : item) })} />
      <label className="block text-sm">Document type<select className="ml-2 rounded border p-2" value={row.docType} onChange={(event) => onChange({ ...value, documents: value.documents.map((item, at) => at === index ? { ...item, docType: event.target.value as Document["docType"] } : item) })}>{["BROCHURE", "FLOOR_PLAN_PACK", "TITLE_DEED", "ESCALATION", "OTHER"].map((type) => <option key={type}>{type}</option>)}</select></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={row.gated} onChange={(event) => onChange({ ...value, documents: value.documents.map((item, at) => at === index ? { ...item, gated: event.target.checked } : item) })} />Protected delivery</label>
    </fieldset>)}
  </div>;
}
