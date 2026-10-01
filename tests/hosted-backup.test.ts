import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateHostedSource, mediaObjectReferences, importObjectReferences, captureReferencedObjects, captureHosted } from "../scripts/backup-hosted.mjs";
import { validateHostedInventory, validateHostedArchive, verifyHostedObjects } from "../scripts/hosted-restore-checks.mjs";
import { validateBackupScope } from "../scripts/backup-adapter.mjs";
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const source = () => ({ format: 1, sourceId: "supabase-fixture", databaseUrl: "postgresql://fixture:fixture@db.example.invalid:5432/postgres?sslmode=verify-full",
  endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, bucket: "fixture-media", accessKeyId: "fixture", secretAccessKey: "fixture-only",
  caCertificate: "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n" });
const asset = () => ({ id: "fixture", storageKey: "public/media/fixture.png", kind: "IMAGE", mimeType: "image/png", isPrivate: false, variantsJson: null });
const inventory = () => ({ format: 1, sourceId: "supabase-fixture", counts: { Property: "1" }, migrations: [{ migration_name: "20261001_fixture", checksum: "a".repeat(64) }],
  extensions: ["pg_trgm", "postgis", "vector"].map(extname => ({ extname, extversion: "1" })), objects: [{ assetId: "fixture", key: "public/media/fixture.png",
    file: "objects/" + hash("fixture"), bytes: 7, sha256: hash("fixture"), mimeType: "image/png", private: false, variant: null }] });
async function scratch(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "iere-hosted-fixture-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test("hosted capture requires verified TLS, a CA, session port and explicit R2 credentials", () => {
  expect(validateHostedSource(source()).sourceId).toBe("supabase-fixture");
  for (const patch of [{ caCertificate: "" }, { databaseUrl: source().databaseUrl.replace("verify-full", "require") },
    { databaseUrl: source().databaseUrl.replace("5432", "6543") }, { endpoint: "http://example.invalid" }, { secretAccessKey: "" }, { sourceId: "../escape" }]) {
    expect(() => validateHostedSource({ ...source(), ...patch })).toThrow();
  }
});
test("reference inventory covers originals, videos, private documents and every supported derivative", () => {
  const rows = mediaObjectReferences([{ ...asset(), variantsJson: JSON.stringify({ thumb: {}, card: {}, hero: {} }) },
    { ...asset(), id: "video", storageKey: "public/media/video.mp4", kind: "VIDEO", mimeType: "video/mp4" },
    { ...asset(), id: "private", storageKey: "private/portfolio/document.pdf", isPrivate: true, mimeType: "application/pdf" }]);
  expect(rows).toHaveLength(6); expect(rows[5].private).toBe(true); expect(rows[1].key).toBe("public/media/fixture.png.thumb.webp");
});
test("unknown/local/traversal keys and private derivatives fail closed", () => {
  for (const patch of [{ storageKey: "local/media/file.png" }, { storageKey: "public/media/../file.png" },
    { variantsJson: '{"untracked":{}}' }, { isPrivate: true, variantsJson: '{"thumb":{}}' }, { variantsJson: "not-json" }]) {
    expect(() => mediaObjectReferences([{ ...asset(), ...patch }])).toThrow();
  }
});
test("retained private import snapshots are captured with strict keys", () => {
  const snapshotRef = `private/imports/${"a".repeat(24)}/${"b".repeat(64)}.csv`;
  expect(importObjectReferences([{ snapshotRef }])[0].private).toBe(true);
  expect(() => importObjectReferences([{ snapshotRef: "https://example.invalid/secret" }])).toThrow();
});
test("database counts, migrations and pg_dump share the exported repeatable-read snapshot", async () => {
  await scratch(async root => {
    const statements: string[] = [], tools: { name: string; args: string[] }[] = [];
    const reserved = { release() {}, unsafe: async (text: string) => {
      statements.push(text);
      if (text.includes("pg_export_snapshot")) return [{ snapshot: "fixture-snapshot", version: "170006" }];
      if (text.includes('FROM public."MediaAsset"')) return [asset()];
      if (text.includes('FROM public."ImportRun"')) return [];
      if (text.includes("FROM pg_tables")) return [{ tablename: "MediaAsset" }];
      if (text.includes("count(*)")) return [{ name: "MediaAsset", count: "1" }];
      if (text.includes('FROM public."_prisma_migrations"')) return inventory().migrations;
      if (text.includes("FROM pg_extension")) return inventory().extensions;
      return [];
    } };
    const runTool = async (name: string, args: string[]) => {
      tools.push({ name, args });
      if (name === "pg_dump") await writeFile(args[args.indexOf("--file") + 1], "FIXTURE_ONLY_NOT_REAL_DUMP");
      if (name === "tar" && args[0] === "-czf") await writeFile(args[1], "FIXTURE_ONLY_NOT_REAL_ARCHIVE");
    };
    const manifest = await captureHosted({ source: source(), fixture: true, directory: join(root, "capture"), postgres: { reserve: async () => reserved },
      store: { send: async () => ({ Body: Readable.from([Buffer.from("fixture")]), ContentLength: 7 }) }, runTool });
    expect(statements[0]).toContain("REPEATABLE READ READ ONLY"); expect(tools[0].args).toContain("--snapshot=fixture-snapshot");
    expect(tools[0].args.join(" ")).not.toContain("postgresql://"); expect(manifest.syntheticFixture).toBe(true);
    expect(manifest.objectStorage.objectCount).toBe(1);
    await expect(readFile(join(root, "capture", "INCOMPLETE.txt"))).rejects.toThrow();
    await expect(captureHosted({ source: source(), directory: join(root, "unsafe"), runTool })).rejects.toThrow("FIXTURE_TOOL_ONLY");
  });
});
test("capture hashes actual stored bytes, deduplicates content and retains each source key", async () => {
  await scratch(async dir => {
    const references = mediaObjectReferences([asset(), { ...asset(), id: "second", storageKey: "public/media/second.png" }]);
    const store = { send: async () => ({ Body: Readable.from([Buffer.from("fixture")]), ContentLength: 7 }) };
    const result = await captureReferencedObjects(store, "fixture", references, dir);
    expect(result.objects.map((row: { sha256: string }) => row.sha256)).toEqual([hash("fixture"), hash("fixture")]);
    expect(result.totalBytes).toBe(14); expect(await readFile(join(dir, result.objects[0].file), "utf8")).toBe("fixture");
  });
});
test("missing, interrupted and truncated objects prevent a successful capture", async () => {
  for (const send of [async () => { throw new Error("NoSuchKey"); }, async () => ({ Body: null }),
    async () => ({ Body: Readable.from([Buffer.from("partial")]), ContentLength: 99 }),
    async () => ({ Body: Readable.from((async function* () { yield Buffer.from("partial"); throw new Error("interrupted"); })()) })]) {
    await scratch(async dir => { await expect(captureReferencedObjects({ send }, "fixture", mediaObjectReferences([asset()]), dir)).rejects.toThrow(); });
  }
});
test("hosted format is additive and incomplete scope cannot enter the existing encrypted adapter", () => {
  expect(() => validateBackupScope({ format: 1, source: "local-docker-compose" })).not.toThrow();
  const manifest = { format: 2, source: "hosted-postgres-r2", sourceId: "supabase-fixture", database: { schema: "public" },
    objectStorage: { format: "content-addressed-r2", objectCount: 1, inventorySha256: "a".repeat(64) } };
  expect(() => validateBackupScope(manifest)).not.toThrow();
  expect(() => validateBackupScope({ ...manifest, sourceId: "" })).toThrow();
  expect(() => validateBackupScope({ ...manifest, syntheticFixture: true })).toThrow();
});
test("restoration rejects archive traversal, links, duplicate entries and unrecognized members", () => {
  expect(() => validateHostedArchive("inventory.json\nobjects/\nobjects/" + "a".repeat(64), "- fixture\nd fixture\n- fixture")).not.toThrow();
  for (const [names, types] of [["../outside", "- fixture"], ["inventory.json\nobjects/" + "a".repeat(64), "- fixture\nl fixture"],
    ["inventory.json\ninventory.json", "- fixture\n- fixture"], ["inventory.json\nprivate.txt", "- fixture\n- fixture"]]) {
    expect(() => validateHostedArchive(names, types)).toThrow();
  }
});
test("inventory bounds and object filenames are independently validated after extraction", () => {
  expect(validateHostedInventory(inventory()).objects).toHaveLength(1);
  for (const patch of [{ counts: { 'unsafe"': "1" } }, { counts: { Property: "NaN" } }, { extensions: [] },
    { objects: [{ ...inventory().objects[0], file: "../outside" }] }, { objects: [{ ...inventory().objects[0], bytes: 30 * 1024 ** 2 }] }]) {
    expect(() => validateHostedInventory({ ...inventory(), ...patch })).toThrow();
  }
});
test("restore uploads each captured object and verifies full readback bytes", async () => {
  await scratch(async dir => {
    await mkdir(join(dir, "objects")); await writeFile(join(dir, inventory().objects[0].file), "fixture");
    const uploaded: Buffer[] = [];
    const store = { send: async (command: { constructor: { name: string }; input: { Body: Uint8Array } }) => {
      if (command.constructor.name === "PutObjectCommand") uploaded.push(Buffer.from(command.input.Body));
      return { Body: Readable.from([Buffer.from("fixture")]) };
    } };
    expect((await verifyHostedObjects(inventory(), dir, store, "fixture")).objectCount).toBe(1); expect(uploaded).toHaveLength(1);
    await expect(verifyHostedObjects(inventory(), dir, { send: async () => ({ Body: Readable.from([Buffer.from("tampered")]) }) }, "fixture")).rejects.toThrow();
    await writeFile(join(dir, inventory().objects[0].file), "tampered");
    await expect(verifyHostedObjects(inventory(), dir, store, "fixture")).rejects.toThrow("OBJECT_HASH_MISMATCH");
  });
});
