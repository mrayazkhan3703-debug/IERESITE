import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { db } from "@/lib/db";
import { processMediaJob, storeUpload, type StoredMedia } from "@/server/media/pipeline";
import { deletePrivateObject, deletePublicObject, putPrivateObject } from "@/server/storage/object-store";
import { GET as getMediaContent } from "@/app/api/media/[id]/content/route";
import { openVerifiedCsvSnapshot, persistCsvSnapshot, SnapshotIntegrityError } from "@/server/ingestion/snapshot";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const uploaded: StoredMedia[] = [];
const privateKeys: string[] = [];
const snapshotKeys: string[] = [];

async function uploadFixture(isPrivate = false): Promise<StoredMedia> {
  const bytes = await sharp({ create: { width: 48, height: 32, channels: 3, background: { r: 80, g: 120, b: 160 } } })
    .png()
    .toBuffer();
  const file = new File([new Uint8Array(bytes)], "synthetic-test-image.png", { type: "image/png" });
  const stored = await storeUpload(file, { altText: "Synthetic integration fixture", private: isPrivate });
  uploaded.push(stored);
  if (isPrivate) privateKeys.push(stored.storageKey);
  return stored;
}

async function requestContent(id: string, variant?: string): Promise<Response> {
  const url = new URL(`/api/media/${id}/content`, "http://localhost");
  if (variant) url.searchParams.set("variant", variant);
  return getMediaContent(new Request(url), { params: Promise.resolve({ id }) });
}

async function cleanupUploadedMediaJobs(ids: string[]) {
  if (!ids.length) return;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const jobs = await db.jobRun.findMany({
      where: {
        jobKey: "media.process",
        OR: ids.map((mediaId) => ({ payloadJson: { path: ["mediaId"], equals: mediaId } })),
      },
      select: { id: true, status: true },
    });
    if (!jobs.length) return;

    const deletableIds = jobs.filter((job) => job.status !== "RUNNING").map((job) => job.id);
    if (deletableIds.length) {
      await db.deadLetterEvent.deleteMany({ where: { sourceId: { in: deletableIds } } });
      await db.jobRun.deleteMany({ where: { id: { in: deletableIds }, status: { not: "RUNNING" } } });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for synthetic media jobs before fixture teardown.");
}

beforeAll(() => {
  if (process.env.STORAGE_PROVIDER !== "s3") {
    throw new Error("Media storage integration requires the Docker S3-compatible object store");
  }
});

afterAll(async () => {
  const ids = uploaded.map(({ id }) => id);
  if (ids.length) {
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await cleanupUploadedMediaJobs(ids);
    await db.mediaAsset.deleteMany({ where: { id: { in: ids } } });
  }
  await Promise.all(uploaded.filter((item) => !privateKeys.includes(item.storageKey)).flatMap((item) => [
    deletePublicObject(item.storageKey).catch(() => {}),
    ...["thumb", "card", "hero"].map((variant) => deletePublicObject(`${item.storageKey}.${variant}.webp`).catch(() => {})),
  ]));
  await Promise.all(privateKeys.map((key) => deletePrivateObject(key).catch(() => {})));
  await Promise.all(snapshotKeys.map((key) => deletePrivateObject(key).catch(() => {})));
  await db.$disconnect();
});

describe("S3-compatible public and private media delivery", () => {
  test("stores original and WebP derivatives and streams them through the public route", async () => {
    const stored = await uploadFixture();
    expect(stored.storageKey).toMatch(/^public\/media\//);
    expect(stored.url).toBe(`/api/media/${stored.id}/content`);

    const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: stored.id } });
    expect(asset.originalFilename).toBe("synthetic-test-image.png");
    const variants = JSON.parse(asset.variantsJson ?? "{}") as Record<string, string>;
    expect(variants.card).toBe(`/api/media/${stored.id}/content?variant=card`);

    const original = await requestContent(stored.id);
    expect(original.status).toBe(200);
    expect(original.headers.get("content-type")).toBe("image/png");
    expect((await original.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const derivative = await requestContent(stored.id, "card");
    expect(derivative.status).toBe(200);
    expect(derivative.headers.get("content-type")).toBe("image/webp");
    expect((await derivative.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await requestContent(stored.id, "unknown")).status).toBe(404);
  });

  test("does not expose private portfolio objects through the public media route", async () => {
    const stored = await uploadFixture(true);
    expect(stored.storageKey).toMatch(/^private\/portfolio\//);
    expect((await requestContent(stored.id)).status).toBe(404);
  });

  test("returns an existing public asset for checksum reuse", async () => {
    const bytes = await sharp({ create: { width: 13, height: 17, channels: 3, background: { r: 11, g: 12, b: 13 } } }).png().toBuffer();
    const file = new File([new Uint8Array(bytes)], "duplicate-reuse.png", { type: "image/png" });
    const stored = await storeUpload(file); uploaded.push(stored);
    await expect(storeUpload(file)).rejects.toMatchObject({ status: 409, code: "DUPLICATE_MEDIA", existingAsset: { id: stored.id, url: stored.url } });
  });

  test("validates MP4 and WebM streams and delivers byte ranges", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "iere-video-test-"));
    const execute = promisify(execFile);
    try {
      for (const [ext, codec, mime] of [["mp4", "libx264", "video/mp4"], ["webm", "libvpx-vp9", "video/webm"]] as const) {
        const filename = path.join(directory, "fixture." + ext);
        await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=64x48:d=1", "-c:v", codec, "-pix_fmt", "yuv420p", "-an", filename], { timeout: 15000, maxBuffer: 65536 });
        const bytes = await readFile(filename);
        const stored = await storeUpload(new File([new Uint8Array(bytes)], "synthetic-verification." + ext, { type: mime }));
        uploaded.push(stored);
        expect(stored.kind).toBe("VIDEO"); expect(stored.width).toBe(64); expect(stored.height).toBe(48);
        const response = await getMediaContent(new Request("http://localhost/api/media/" + stored.id + "/content", { headers: { range: "bytes=0-31" } }), { params: Promise.resolve({ id: stored.id }) });
        expect(response.status).toBe(206);
        expect(response.headers.get("content-range")).toBe("bytes 0-31/" + bytes.length);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(0, 32));
        const invalid = await getMediaContent(new Request("http://localhost/api/media/" + stored.id + "/content", { headers: { range: "bytes=" + bytes.length + "-" } }), { params: Promise.resolve({ id: stored.id }) });
        expect(invalid.status).toBe(416);
        await unlink(filename);
      }
    } finally { await rmdir(directory).catch(() => {}); }
  }, 45000);

  test("rejects malformed containers and empty or oversized uploads", async () => {
    await expect(storeUpload(new File([], "empty.jpg", { type: "image/jpeg" }))).rejects.toMatchObject({ code: "INVALID_FILE_SIZE" });
    await expect(storeUpload(new File([new Uint8Array(26 * 1024 * 1024)], "large.mp4", { type: "video/mp4" }))).rejects.toMatchObject({ code: "INVALID_FILE_SIZE" });
    await expect(storeUpload(new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])], "broken.webm", { type: "video/webm" }))).rejects.toMatchObject({ code: "INVALID_VIDEO" });
  });

  test("treats deleted and private media derivative work as a terminal no-op", async () => {
    const privateMedia = await uploadFixture(true);
    await expect(processMediaJob(privateMedia.id)).resolves.toBeUndefined();
    await expect(processMediaJob(`deleted-media-${crypto.randomUUID()}`)).resolves.toBeUndefined();
  });

  test("stores private content-addressed import snapshots and verifies persisted bytes before reading", async () => {
    const body = new TextEncoder().encode("field,value\nunit-fixture,synthetic\n");
    const snapshot = await persistCsvSnapshot({ sourceKey: "media-storage-test", bytes: body });
    snapshotKeys.push(snapshot.storageRef);
    expect(snapshot.storageRef).toMatch(/^private\/imports\/[a-f0-9]{24}\/[a-f0-9]{64}\.csv$/);

    const chunks = await openVerifiedCsvSnapshot(snapshot);
    const read: number[] = [];
    for await (const chunk of chunks) read.push(...chunk);
    expect(new TextDecoder().decode(new Uint8Array(read))).toBe(new TextDecoder().decode(body));

    await putPrivateObject({ key: snapshot.storageRef, body: Buffer.from("tampered"), contentType: "text/csv" });
    await expect(openVerifiedCsvSnapshot(snapshot)).rejects.toBeInstanceOf(SnapshotIntegrityError);
  });
});
