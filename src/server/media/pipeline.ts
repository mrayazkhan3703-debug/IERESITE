/**
 * Media pipeline (Q06): upload validation (MIME sniffing, size caps, extension
 * allowlist, filename sanitization), sharp derivative generation (EXIF stripped),
 * galleries/documents wiring. Local development can use public/uploads; Docker uses
 * the S3-compatible object store with same-origin, privacy-checked delivery.
 */
import { db } from "@/lib/db";
import { logEvent } from "@/server/rate-limit";
import { emitEvent } from "@/server/jobs/outbox";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { deletePrivateObject, deletePublicObject, getPublicObject, putPrivateObject, putPublicObject } from "@/server/storage/object-store";
import { HttpError } from "@/server/auth";
import { validateVideo } from "./video-validation";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

const ALLOWED = new Map<string, { ext: string; kind: string }>([
  ["image/jpeg", { ext: "jpg", kind: "IMAGE" }],
  ["image/png", { ext: "png", kind: "IMAGE" }],
  ["image/webp", { ext: "webp", kind: "IMAGE" }],
  ["image/avif", { ext: "avif", kind: "IMAGE" }],
  ["application/pdf", { ext: "pdf", kind: "DOCUMENT" }],
  ["video/mp4", { ext: "mp4", kind: "VIDEO" }],
  ["video/webm", { ext: "webm", kind: "VIDEO" }],
]);

/** Magic-byte sniffing — never trust the client MIME */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(4, 8).toString() === "ftyp") {
    const brand = buf.subarray(8, 12).toString();
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
    if (["isom", "iso2", "avc1", "mp41", "mp42", "M4V "].includes(brand)) return "video/mp4";
  }
  if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

function safeOriginalFilename(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? "";
  const safe = base.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[<>:"|?*]/g, "_").trim();
  return (safe || "upload").slice(0, 255);
}

export interface StoredMedia {
  id: string;
  url: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  storageKey: string;
  originalFilename?: string | null;
  altText?: string | null;
  caption?: string | null;
  updatedAt?: string;
}

export class DuplicateMediaError extends HttpError {
  constructor(public readonly existingAsset: { id: string; url: string; kind: string; mimeType: string; altText: string | null; caption: string | null; originalFilename: string | null }) {
    super(409, "This file already exists in Media Library. Choose Use existing asset to attach it.", "DUPLICATE_MEDIA");
  }
}

export async function storeUpload(file: File, opts?: { altText?: string; uploadedBy?: string; private?: boolean; kind?: "IMAGE" | "LOGO" | "FLOOR_PLAN" | "DOCUMENT" | "BROCHURE" | "VIDEO" }): Promise<StoredMedia> {
  const config = (await import("@/lib/config")).getConfig();
  const maxBytes = config.MEDIA_MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size === 0 || file.size > maxBytes) {
    throw new HttpError(400, `Choose a nonempty file up to ${config.MEDIA_MAX_UPLOAD_MB}MB.`, "INVALID_FILE_SIZE");
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length !== file.size || buf.length > maxBytes) throw new HttpError(400, "Invalid file size.", "INVALID_FILE_SIZE");
  const sniffed = sniffMime(buf);
  const mime = sniffed ?? file.type;
  const allowed = ALLOWED.get(mime);
  if (!sniffed || !allowed) {
    throw new HttpError(400, "Unsupported file type (allowed: JPEG, PNG, WebP, AVIF, PDF, MP4, WebM).", "INVALID_FILE_TYPE");
  }
  const checksum = crypto.createHash("sha256").update(buf).digest("hex");
  // Public and private assets have separate visibility and lifecycle rules.
  // A private portfolio document/image must not be blocked just because the
  // same bytes already exist in the public library (or disclose that asset).
  if (!opts?.private) {
    const duplicate = await db.mediaAsset.findFirst({ where: { checksum, isPrivate: false }, select: { id: true, url: true, kind: true, mimeType: true, altText: true, caption: true, originalFilename: true } });
    if (duplicate) throw new DuplicateMediaError(duplicate);
  }
  const kind = opts?.kind ?? allowed.kind as "IMAGE" | "DOCUMENT";
  const imageKind = ["IMAGE", "LOGO", "FLOOR_PLAN"].includes(kind);
  if ((mime.startsWith("image/") && !imageKind) || (mime === "application/pdf" && !["DOCUMENT", "BROCHURE", "FLOOR_PLAN"].includes(kind)) || (mime.startsWith("video/") && kind !== "VIDEO")) {
    throw new HttpError(400, "Choose an asset kind compatible with the uploaded file.", "INVALID_MEDIA_KIND");
  }
  const videoDimensions = mime.startsWith("video/") ? await validateVideo(buf, mime) : null;
  const validatedImage = mime.startsWith("image/") ? await imageDimensions(buf) : null;
  if (mime.startsWith("image/") && !validatedImage) throw new HttpError(400, "This image is malformed or could not be decoded.", "INVALID_IMAGE");

  const id = crypto.randomUUID();
  const objectStorage = config.STORAGE_PROVIDER === "s3";
  if (objectStorage && !config.S3_ENDPOINT) throw new Error("Public media requires configured S3-compatible object storage");
  const key = opts?.private
    ? `private/portfolio/${opts.uploadedBy ?? "unowned"}/${id}.${allowed.ext}`
    : objectStorage ? `public/media/${id}.${allowed.ext}` : `${id}.${allowed.ext}`;
  if (opts?.private) {
    await putPrivateObject({ key, body: buf, contentType: mime });
  } else if (objectStorage) {
    await putPublicObject({ key, body: buf, contentType: mime });
  } else {
    await fs.mkdir(UPLOAD_ROOT, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_ROOT, key), buf);
  }

  let width: number | null = videoDimensions?.width ?? null;
  let height: number | null = videoDimensions?.height ?? null;
  let variants: Record<string, string> | null = null;

  if (mime.startsWith("image/") && !opts?.private) {
    const dims = validatedImage;
    width = dims?.width ?? null;
    height = dims?.height ?? null;
    try {
      variants = await generateVariants(id, key, buf, objectStorage);
    } catch (err) {
      await cleanupVariantMedia(id, key, objectStorage);
      logEvent("media.variants_failed", { id, error: String(err) });
    }
  }

  let media;
  try {
    media = await db.mediaAsset.create({
      data: {
        id,
        kind,
        originalFilename: safeOriginalFilename(file.name),
        storageKey: key,
        url: opts?.private ? `private-object://${key}` : objectStorage ? publicMediaUrl(id) : `/uploads/${key}`,
        mimeType: mime,
        sizeBytes: buf.length,
        width,
        height,
        altText: opts?.altText ?? null,
        checksum,
        exifStripped: mime.startsWith("image/"),
        isPrivate: opts?.private ?? false,
        uploadedBy: opts?.uploadedBy ?? null,
        variantsJson: variants ? JSON.stringify(variants) : null,
      },
    });
  } catch (error) {
    if (opts?.private) await deletePrivateObject(key).catch(() => {});
    else if (objectStorage) await cleanupObjectMedia(key);
    else await cleanupLocalMedia(id, key);
    throw error;
  }

  await emitEvent("media", media.id, "media.uploaded", { mediaId: media.id });
  return {
    id: media.id,
    url: media.url,
    kind: media.kind,
    mimeType: mime,
    sizeBytes: buf.length,
    width,
    height,
    storageKey: key,
    originalFilename: media.originalFilename,
    altText: media.altText,
    caption: media.caption,
    updatedAt: media.updatedAt.toISOString(),
  };
}

async function imageDimensions(buf: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
  } catch {
    return null;
  }
}

/** Derivative generation: recompressed + EXIF stripped + bounded sizes (Q31 image budget) */
async function generateVariants(id: string, storageKey: string, buf: Buffer, objectStorage: boolean, signal?: AbortSignal): Promise<Record<string, string>> {
  const sharp = (await import("sharp")).default;
  const variants: Record<string, string> = {};
  const specs: { name: "thumb" | "card" | "hero"; width: number; format: "webp" | "jpeg" }[] = [
    { name: "thumb", width: 400, format: "webp" },
    { name: "card", width: 800, format: "webp" },
    { name: "hero", width: 1600, format: "webp" },
  ];
  for (const spec of specs) {
    signal?.throwIfAborted();
    const outKey = objectStorage ? `${storageKey}.${spec.name}.webp` : `${id}.${spec.name}.webp`;
    const output = await sharp(buf)
      .rotate() // respects EXIF orientation, then strips it
      .resize({ width: spec.width, withoutEnlargement: true })
      .webp({ quality: spec.name === "hero" ? 80 : 75 })
      .toBuffer();
    signal?.throwIfAborted();
    if (objectStorage) {
      await putPublicObject({ key: outKey, body: output, contentType: "image/webp" });
      variants[spec.name] = publicMediaUrl(id, spec.name);
    } else {
      await fs.mkdir(UPLOAD_ROOT, { recursive: true });
      await fs.writeFile(path.join(UPLOAD_ROOT, outKey), output);
      variants[spec.name] = `/uploads/${outKey}`;
    }
  }
  return variants;
}

/** Job handler: (re)process derivatives for a media asset */
export async function processMediaJob(mediaId: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const media = await db.mediaAsset.findUnique({ where: { id: mediaId } });
  // Deletion may win the race with outbox delivery; there is no derivative
  // work left for an asset that no longer exists. Private uploads also never
  // create public display variants.
  if (!media || media.isPrivate || !media.mimeType.startsWith("image/")) return;
  const objectStorage = media.storageKey.startsWith("public/media/");
  const buf = objectStorage
    ? await getPublicObject(media.storageKey)
    : await fs.readFile(path.join(UPLOAD_ROOT, media.storageKey));
  if (!buf) throw new Error(`Media object ${media.storageKey} not found`);
  signal?.throwIfAborted();
  const variants = await generateVariants(media.id, media.storageKey, buf, objectStorage, signal);
  signal?.throwIfAborted();
  await db.mediaAsset.update({
    where: { id: media.id },
    data: { variantsJson: JSON.stringify(variants), exifStripped: true },
  });
}

function publicMediaUrl(id: string, variant?: "thumb" | "card" | "hero"): string {
  const base = `/api/media/${encodeURIComponent(id)}/content`;
  return variant ? `${base}?variant=${variant}` : base;
}

async function cleanupObjectMedia(storageKey: string): Promise<void> {
  await Promise.all([storageKey, ...["thumb", "card", "hero"].map((name) => `${storageKey}.${name}.webp`)]
    .map((key) => deletePublicObject(key).catch(() => {})));
}

async function cleanupVariantMedia(id: string, storageKey: string, objectStorage: boolean): Promise<void> {
  if (objectStorage) {
    await Promise.all(["thumb", "card", "hero"].map((name) => deletePublicObject(`${storageKey}.${name}.webp`).catch(() => {})));
  } else {
    await Promise.all(["thumb", "card", "hero"].map((name) => fs.unlink(path.join(UPLOAD_ROOT, `${id}.${name}.webp`)).catch(() => {})));
  }
}

async function cleanupLocalMedia(id: string, storageKey: string): Promise<void> {
  await Promise.all([storageKey, ...["thumb", "card", "hero"].map((name) => `${id}.${name}.webp`)]
    .map((name) => fs.unlink(path.join(UPLOAD_ROOT, name)).catch(() => {})));
}

/** Best URL for a display context (variants when available) */
export function mediaUrl(media: { url: string; variantsJson: string | null }, variant: "thumb" | "card" | "hero"): string {
  if (media.variantsJson) {
    try {
      const v = JSON.parse(media.variantsJson) as Record<string, string>;
      if (v[variant]) return v[variant];
    } catch {}
  }
  return media.url;
}
