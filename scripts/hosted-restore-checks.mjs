import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, lstat, realpath, copyFile } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { hashFile, inspectBackup } from "./backup-adapter.mjs";
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { staticMediaKey } from "./backup-source-policy.mjs";

const fail = code => { throw new Error(code); };
export function validateHostedInventory(value) {
  if (value?.format !== 1 || !value.counts || typeof value.counts !== "object" || Array.isArray(value.counts) ||
      Object.keys(value.counts).length > 500 || Object.entries(value.counts).some(([key, count]) =>
        !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(key) || !/^\d{1,15}$/.test(count)) ||
      !Array.isArray(value.objects) || value.objects.length > 80000 || !Array.isArray(value.migrations) || value.migrations.length > 1000 ||
      value.migrations.some(row => !/^[A-Za-z0-9_-]{1,180}$/.test(row.migration_name) || !/^[a-f0-9]{64}$/.test(row.checksum)) ||
      !Array.isArray(value.extensions) || value.extensions.length !== 3 ||
      [...value.extensions.map(row => row.extname)].sort().join(",") !== "pg_trgm,postgis,vector") fail("INVALID_INVENTORY");
  for (const row of value.objects) {
    if (!/^[a-f0-9]{64}$/.test(row.sha256) || row.file !== `objects/${row.sha256}` ||
        !Number.isInteger(row.bytes) || row.bytes < 1 || row.bytes > (row.variant === "import-snapshot" ? 50 : 25) * 1024 ** 2 ||
        !(row.variant === "import-snapshot" ? /^private\/imports\/[a-f0-9]{24}\/[a-f0-9]{64}\.(csv|json)$/.test(row.key) && row.private === true : /^(public\/media|private\/portfolio)\/[A-Za-z0-9._/-]+$/.test(row.key) || (staticMediaKey(row.key) && row.private === false && !row.variant && row.mimeType?.startsWith("image/"))) ||
        row.key.split("/").some(x => !x || x === "." || x === "..")) fail("INVALID_INVENTORY");
  }
  return value;
}
export function validateHostedArchive(names, verbose) {
  const entries = names.trim().split("\n"), types = verbose.trim().split("\n");
  if (entries.length > 80002 || entries.length !== types.length || entries.some((name, i) =>
      !/^(inventory\.json|objects\/?|objects\/[a-f0-9]{64})$/.test(name) ||
      (name.replace(/\/$/, "") === "objects" ? types[i][0] !== "d" : types[i][0] !== "-")) ||
      new Set(entries).size !== entries.length || !entries.includes("inventory.json")) fail("UNSAFE_OBJECT_ARCHIVE");
}
function tar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 ** 2 });
  if (result.status !== 0 || result.error) fail("OBJECT_ARCHIVE_FAILED"); return result.stdout;
}
async function inventory(directory, manifest) {
  if ((await hashFile(resolve(directory, "inventory.json"))).sha256 !== manifest.objectStorage.inventorySha256) fail("INVENTORY_HASH_MISMATCH");
  const value = validateHostedInventory(JSON.parse(await readFile(resolve(directory, "inventory.json"), "utf8")));
  if (value.sourceId !== manifest.sourceId || value.objects.length !== manifest.objectStorage.objectCount ||
      value.objects.reduce((sum, row) => sum + row.bytes, 0) !== manifest.objectStorage.totalBytes) fail("INVENTORY_SCOPE_MISMATCH");
  return value;
}
export async function verifyHostedObjects(value, directory, store, bucket) {
  validateHostedInventory(value);
  await store.send(new CreateBucketCommand({ Bucket: bucket }));
  let bytes = 0, objectCount = 0;
  for (const row of value.objects) {
    if (staticMediaKey(row.key)) continue; // Restored separately into the isolated application bundle.
    const file = resolve(directory, row.file), checked = await hashFile(file, (row.variant === "import-snapshot" ? 50 : 25) * 1024 ** 2);
    if (checked.sha256 !== row.sha256 || checked.bytes !== row.bytes) fail("OBJECT_HASH_MISMATCH");
    const body = await readFile(file);
    await store.send(new PutObjectCommand({ Bucket: bucket, Key: row.key, Body: body, ContentType: row.mimeType }));
    const response = await store.send(new GetObjectCommand({ Bucket: bucket, Key: row.key }));
    if (!response.Body) fail("RESTORED_OBJECT_MISSING");
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of response.Body) { size += chunk.length; if (size > row.bytes) fail("OBJECT_HASH_MISMATCH"); hash.update(chunk); }
    if (size !== row.bytes || hash.digest("hex") !== row.sha256) fail("OBJECT_HASH_MISMATCH");
    bytes += size;
    objectCount++;
  }
  return { objectCount, totalBytes: bytes, staticFilesRestoredSeparately: value.objects.length - objectCount };
}

export async function restoreStaticMedia(value, directory, publicRoot) {
  validateHostedInventory(value);
  const root = await realpath(publicRoot);
  let count = 0, bytes = 0;
  for (const row of value.objects.filter(row => staticMediaKey(row.key))) {
    const file = resolve(directory, row.file), digest = await hashFile(file, 25 * 1024 ** 2);
    if (digest.sha256 !== row.sha256 || digest.bytes !== row.bytes) fail("OBJECT_HASH_MISMATCH");
    const target = resolve(root, row.key.slice("static/".length)), parent = dirname(target);
    // Check every ancestor before creating directories; refuse links in the pinned bundle.
    let current = root;
    for (const segment of relative(root, parent).split(/[\\/]/)) {
      current = resolve(current, segment);
      try { const info = await lstat(current); if (info.isSymbolicLink() || !info.isDirectory()) fail("UNSAFE_STATIC_MEDIA"); }
      catch (error) { if (error.code !== "ENOENT") throw error; await mkdir(current); }
    }
    const distance = relative(root, await realpath(parent));
    if (distance.startsWith("..") || isAbsolute(distance)) fail("UNSAFE_STATIC_MEDIA");
    try { const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile()) fail("UNSAFE_STATIC_MEDIA"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await copyFile(file, target);
    if ((await hashFile(target)).sha256 !== row.sha256) fail("OBJECT_HASH_MISMATCH");
    count++; bytes += row.bytes;
  }
  return { staticFiles: count, totalBytes: bytes };
}
async function checks(mode, backup, extracted) {
  const manifest = JSON.parse(await readFile(resolve(backup, "manifest.json"), "utf8"));
  if (manifest.format !== 2 || !["hosted-postgres-r2", "hosted-postgres-s3"].includes(manifest.source)) fail("HOSTED_SCOPE_REQUIRED");
  if (mode === "prepare") {
    await inspectBackup(backup, manifest.syntheticFixture === true);
    const archive = resolve(backup, "object-storage.tar.gz");
    validateHostedArchive(tar(["-tzf", archive]), tar(["-tvzf", archive]));
    await mkdir(resolve(extracted, "data"));
    tar(["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", resolve(extracted, "data")]);
    const value = await inventory(resolve(extracted, "data"), manifest);
    return { status: "PASS_PREPARED", objects: value.objects.length };
  }
  const directory = resolve(extracted, "data"), value = await inventory(directory, manifest);
  if (mode === "static") return { status: "PASS_STATIC_MEDIA", ...await restoreStaticMedia(value, directory, resolve(extracted, "public")) };
  const { SQL } = await import("bun");
  const sql = new SQL("postgresql://iere_restore@restored-db:5432/iere_restore", { max: 1, connectionTimeout: 10 });
  try {
    if (mode === "database") {
      for (const [table, count] of Object.entries(value.counts)) {
        const [row] = await sql.unsafe(`SELECT count(*)::text AS count FROM public."${table}"`);
        if (row.count !== count) fail("RECORD_COUNT_MISMATCH");
      }
      const migrations = await sql.unsafe('SELECT migration_name,checksum FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name');
      if (JSON.stringify(migrations) !== JSON.stringify(value.migrations)) fail("MIGRATION_MISMATCH");
      const extensions = await sql.unsafe("SELECT extname,extversion FROM pg_extension WHERE extname IN ('postgis','pg_trgm','vector') ORDER BY extname");
      if (extensions.length !== 3) fail("EXTENSION_MISSING");
      await sql.unsafe("SELECT ST_AsText(ST_SetSRID(ST_MakePoint(55,25),4326)), similarity('restore','restore'), '[1,2,3]'::vector <-> '[1,2,3]'::vector");
      const [role] = await sql.unsafe("SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname='iere_app'");
      if (!role || role.rolsuper || role.rolcreaterole || role.rolcreatedb || !role.rolbypassrls) fail("APPLICATION_ROLE_PRIVILEGED");
      return { status: "PASS_DATABASE", tables: Object.keys(value.counts).length, migrations: migrations.length, extensions,
        sourceExtensions: value.extensions, permissions: "NON_SUPERUSER_APPLICATION_ROLE_SOURCE_COMPATIBLE_RLS_BYPASS",
        permissionScope: "Supabase application tables rely on server RBAC through the hosted postgres connection. The isolated application role retains row access without superuser, database or role creation." };
    }
    if (mode === "objects") {
      const store = new S3Client({ endpoint: "http://restored-objects:8333", region: "us-east-1", forcePathStyle: true,
        credentials: { accessKeyId: "restore_fixture", secretAccessKey: "restore_fixture_only" }, maxAttempts: 1 });
      try { return { status: "PASS_OBJECTS", ...await verifyHostedObjects(value, directory, store, "iere-restored") }; } finally { store.destroy(); }
    }
    if (mode !== "delivery") fail("UNKNOWN_RESTORE_CHECK");
    const base = "http://restored-web:3000";
    const publicImage = value.objects.find(row => !row.private && !row.variant && row.mimeType.startsWith("image/"));
    const publicVideo = value.objects.find(row => !row.private && !row.variant && row.mimeType.startsWith("video/"));
    const [protectedDoc] = await sql.unsafe('SELECT d."mediaId" FROM public."PropertyDocument" d JOIN public."MediaAsset" m ON m.id=d."mediaId" WHERE NOT m."isPrivate" AND (d.gated OR d."docType" IN (\'TITLE_DEED\',\'ESCALATION\')) LIMIT 1');
    if (!publicImage || !publicVideo || !protectedDoc) fail("DELIVERY_FIXTURES_MISSING");
    for (const row of [publicImage, publicVideo]) {
      const response = await fetch(staticMediaKey(row.key) ? `${base}/${row.key.slice("static/".length)}` : `${base}/api/media/${encodeURIComponent(row.assetId)}/content`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (response.status !== 200) {
        const text = new TextDecoder().decode(bytes);
        if (text.includes('"Media object not found"')) fail("PUBLIC_OBJECT_DELIVERY_NOT_FOUND");
        if (text.includes('"Media not found"')) fail("PUBLIC_ASSET_DELIVERY_NOT_FOUND");
        fail(`PUBLIC_DELIVERY_HTTP_${response.status}`);
      }
      if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) fail("PUBLIC_DELIVERY_HASH_MISMATCH");
    }
    const range = await fetch(`${base}/api/media/${encodeURIComponent(publicVideo.assetId)}/content`, { headers: { Range: "bytes=0-31" } });
    if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 32) fail("VIDEO_RANGE_FAILED");
    const denied = await fetch(`${base}/api/media/${encodeURIComponent(protectedDoc.mediaId)}/content`);
    if (![401,403].includes(denied.status)) fail("PROTECTED_DOCUMENT_EXPOSED");
    const [owner] = await sql.unsafe('SELECT u.id FROM public."User" u JOIN public."UserRole" ur ON ur."userId"=u.id JOIN public."Role" r ON r.id=ur."roleId" WHERE r.key=\'OWNER\' AND u."isActive" LIMIT 1');
    if (!owner) fail("RESTORE_OWNER_MISSING");
    const token = randomUUID() + randomUUID(), sessionId = randomUUID();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    // Isolated restore only: disposable session never sent to the hosted application.
    await sql`INSERT INTO public."Session"(id,"userId","tokenHash","expiresAt","mfaVerifiedAt","createdAt") VALUES(${sessionId},${owner.id},${tokenHash},now()+interval '10 minutes',now(),now())`;
    try {
      const allowed = await fetch(`${base}/api/media/${encodeURIComponent(protectedDoc.mediaId)}/content`, { headers: { Cookie: `ie_session=${token}` } });
      const row = value.objects.find(object => object.assetId === protectedDoc.mediaId && !object.variant);
      if (!row || allowed.status !== 200 || createHash("sha256").update(new Uint8Array(await allowed.arrayBuffer())).digest("hex") !== row.sha256 ||
          allowed.headers.get("cache-control") !== "private, no-store") fail("AUTHORIZED_DOCUMENT_MISMATCH");
    } finally { await sql`DELETE FROM public."Session" WHERE id=${sessionId}`; }
    return { status: "PASS_DELIVERY", publicImages: 1, publicVideos: 1, videoRanges: 1, protectedDocuments: 1, anonymousDocumentDenied: true };
  } finally { await sql.close({ timeout: 5 }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checks(...process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = /^[A-Z0-9_]{3,60}$/.test(error.message ?? "") ? error.message : /^[A-Z0-9_]{3,60}$/.test(error.code ?? "") ? error.code : "RESTORE_CHECK_FAILED";
    console.error(JSON.stringify({ status: "FAILED", code })); process.exitCode = 1;
  });
}
