// Explicit source file only; never loads application env or an implicit SDK credential chain.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { hashFile, ARCHIVE_LIMIT } from "./backup-adapter.mjs";
import { databaseTransport, objectNamespace, staticMediaKey } from "./backup-source-policy.mjs";

const fail = code => { throw new Error(code); };
export function validateHostedSource(value, fixture = false) {
  if (value?.format !== 1 || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(value.sourceId ?? "") ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket ?? "") ||
      ![value.accessKeyId, value.secretAccessKey].every(x => typeof x === "string" && x.length > 0 && x.length < 4096)) fail("INVALID_HOSTED_SOURCE");
  databaseTransport(value, fixture);
  objectNamespace(value.keyPrefix, "public/media/validation");
  let storage;
  try { storage = new URL(value.endpoint); } catch { fail("INVALID_HOSTED_SOURCE"); }
  const profile = value.mediaProfile ?? "cloudflare-r2";
  const acceptedHost = profile === "cloudflare-r2"
    ? /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(storage.hostname)
    : profile === "railway-temporary-seaweed" && value.databaseTransport === "railway-private" &&
      storage.hostname === "media-production-51c3.up.railway.app" && value.bucket === "iere-railway-test" && !value.keyPrefix;
  if (storage.username || storage.password || storage.search || storage.hash || storage.pathname !== "/" ||
      (!fixture && (storage.protocol !== "https:" || storage.port || !acceptedHost))) fail("INVALID_HOSTED_SOURCE");
  return value;
}
export function mediaObjectReferences(assets) {
  if (!Array.isArray(assets) || assets.length > 20_000) fail("MEDIA_BOUND_EXCEEDED");
  const references = [];
  for (const asset of assets) {
    if (typeof asset.id !== "string" || (!/^(public\/media|private\/portfolio)\/[A-Za-z0-9._/-]+$/.test(asset.storageKey ?? "") && !staticMediaKey(asset.storageKey)) ||
        asset.storageKey.split("/").some(x => !x || x === "." || x === "..")) fail("UNSUPPORTED_MEDIA_KEY");
    if (staticMediaKey(asset.storageKey) && (asset.isPrivate || !asset.mimeType?.startsWith("image/"))) fail("UNSUPPORTED_STATIC_MEDIA");
    const original = { assetId: asset.id, key: asset.storageKey, kind: asset.kind, mimeType: asset.mimeType, private: asset.isPrivate, variant: null };
    if (!staticMediaKey(asset.storageKey)) {
      if (Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0) original.expectedBytes = asset.sizeBytes;
      if (/^[a-f0-9]{64}$/.test(asset.storageChecksum ?? "")) original.expectedSha256 = asset.storageChecksum;
      else if (!asset.mimeType?.startsWith("image/") && /^[a-f0-9]{64}$/.test(asset.checksum ?? "")) original.expectedSha256 = asset.checksum;
    }
    references.push(original);
    const variants = asset.variantsJson ? JSON.parse(asset.variantsJson) : {};
    if (!variants || typeof variants !== "object" || Array.isArray(variants)) fail("INVALID_VARIANTS");
    for (const name of Object.keys(variants)) {
      if (!["thumb", "card", "hero"].includes(name) || asset.isPrivate || !asset.storageKey.startsWith("public/media/")) fail("UNSUPPORTED_VARIANT");
      references.push({ assetId: asset.id, key: `${asset.storageKey}.${name}.webp`, kind: "IMAGE", mimeType: "image/webp", private: false, variant: name });
    }
  }
  return references;
}
export function importObjectReferences(rows) {
  if (!Array.isArray(rows) || rows.length > 10000) fail("IMPORT_BOUND_EXCEEDED");
  return rows.map(row => {
    if (!/^private\/imports\/[a-f0-9]{24}\/[a-f0-9]{64}\.(csv|json)$/.test(row.snapshotRef ?? "")) fail("UNSUPPORTED_IMPORT_KEY");
    return { assetId: null, key: row.snapshotRef, kind: "DOCUMENT", mimeType: row.snapshotRef.endsWith(".csv") ? "text/csv" : "application/json", private: true, variant: "import-snapshot" };
  });
}
/** @param {any} store @param {string} bucket @param {any[]} references @param {string} directory @param {{keyPrefix?: string, staticRoot?: string}} options */
export async function captureReferencedObjects(store, bucket, references, directory, { keyPrefix = "", staticRoot } = {}) {
  await mkdir(resolve(directory, "objects"), { mode: 0o700 });
  const index = []; let totalBytes = 0;
  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    let response;
    if (staticMediaKey(ref.key)) {
      if (!staticRoot || !isAbsolute(staticRoot)) fail("STATIC_BUNDLE_REQUIRED");
      const root = await realpath(staticRoot), candidate = resolve(root, ref.key.slice("static/".length));
      const info = await lstat(candidate);
      const actual = await realpath(candidate), distance = relative(root, actual);
      if (!info.isFile() || info.isSymbolicLink() || distance.startsWith("..") || isAbsolute(distance)) fail("UNSAFE_STATIC_MEDIA");
      response = { Body: createReadStream(actual), ContentLength: info.size };
    } else response = await store.send(new GetObjectCommand({ Bucket: bucket, Key: objectNamespace(keyPrefix, ref.key) }));
    if (!response.Body) fail("REFERENCED_OBJECT_MISSING");
    const pending = resolve(directory, "objects", `pending-${i}`);
    const hash = createHash("sha256"); let bytes = 0;
    async function* bounded() {
      for await (const chunk of response.Body) {
        bytes += chunk.length; totalBytes += chunk.length;
        if (bytes > (ref.variant === "import-snapshot" ? 50 : 25) * 1024 ** 2 || totalBytes > ARCHIVE_LIMIT) fail("MEDIA_BOUND_EXCEEDED");
        hash.update(chunk); yield chunk;
      }
    }
    try { await pipeline(bounded(), createWriteStream(pending, { flags: "wx", mode: 0o600 })); }
    finally { response.Body.destroy?.(); }
    if (!bytes || (response.ContentLength !== undefined && bytes !== response.ContentLength)) fail("OBJECT_CAPTURE_INCOMPLETE");
    const sha256 = hash.digest("hex"), file = `objects/${sha256}`;
    if (ref.expectedBytes && bytes !== ref.expectedBytes) fail("STORED_MEDIA_SIZE_MISMATCH");
    if (ref.expectedSha256 && sha256 !== ref.expectedSha256) fail("STORED_MEDIA_CHECKSUM_MISMATCH");
    const target = resolve(directory, file);
    try { await lstat(target); await unlink(pending); } catch (error) { if (error.code !== "ENOENT") throw error; await rename(pending, target); }
    index.push({ ...ref, file, bytes, sha256 });
  }
  return { objects: index, totalBytes };
}
export async function hostedTool(program, args, env = {}) {
  return new Promise((done, reject) => {
    const proc = spawn(program, args, { shell: false, stdio: ["ignore", "ignore", "ignore"], env: { PATH: process.env.PATH, LANG: "C.UTF-8", ...env } });
    const timer = setTimeout(() => proc.kill("SIGKILL"), 15 * 60_000);
    proc.once("error", () => { clearTimeout(timer); reject(new Error("HOSTED_TOOL_FAILED")); });
    proc.once("close", code => { clearTimeout(timer); if (code === 0) done(); else reject(new Error("HOSTED_TOOL_FAILED")); });
  });
}
/** @param {{source: any, directory: string, staticRoot?: string, fixture?: boolean, postgres?: any, store?: any, runTool?: typeof hostedTool}} options */
export async function captureHosted({ source, directory, staticRoot, fixture = false, postgres, store, runTool = hostedTool }) {
  source = validateHostedSource(source, fixture);
  if (runTool !== hostedTool && !fixture) fail("FIXTURE_TOOL_ONLY");
  if (!isAbsolute(directory)) fail("ABSOLUTE_OUTPUT_REQUIRED");
  await mkdir(directory, { mode: 0o700 }); // Refuse reuse of any existing capture directory.
  const marker = resolve(directory, "INCOMPLETE.txt");
  await writeFile(marker, "Hosted capture has not completed and must not be restored.", { flag: "wx", mode: 0o600 });
  const started = new Date().toISOString();
  const { SQL } = await import("bun");
  const transport = databaseTransport(source, fixture);
  const sql = postgres ?? new SQL(source.databaseUrl, { max: 1, connectionTimeout: 15, idleTimeout: 0, maxLifetime: 0,
    tls: transport.tls });
  const remote = store ?? new S3Client({ endpoint: source.endpoint, region: source.mediaProfile === "railway-temporary-seaweed" ? "us-east-1" : "auto", forcePathStyle: true,
    credentials: { accessKeyId: source.accessKeyId, secretAccessKey: source.secretAccessKey }, maxAttempts: 3,
    requestHandler: { connectionTimeout: 5000, socketTimeout: 30000 }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  let reserved;
  const caPath = resolve(directory, "source-ca.crt");
  try {
    reserved = await sql.reserve();
    if (transport.sslmode === "verify-full") await writeFile(caPath, source.caCertificate, { flag: "wx", mode: 0o600 });
    await reserved.unsafe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await reserved.unsafe("SET LOCAL statement_timeout = '120s'");
    const [snapshot] = await reserved.unsafe("SELECT pg_export_snapshot() AS snapshot, current_setting('server_version_num') AS version");
    // JSON extraction remains compatible with hosted schemas before the additive stored-hash migration.
    const assets = await reserved.unsafe('SELECT id, "storageKey", kind, "mimeType", "isPrivate", "variantsJson", "sizeBytes", checksum, to_jsonb(m)->>\'storageChecksum\' AS "storageChecksum" FROM public."MediaAsset" m ORDER BY id LIMIT 20001');
    const imports = await reserved.unsafe('SELECT DISTINCT "snapshotRef" FROM public."ImportRun" WHERE "snapshotRef" IS NOT NULL ORDER BY "snapshotRef" LIMIT 10001');
    const tables = await reserved.unsafe("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    if (tables.length > 500) fail("DATABASE_BOUND_EXCEEDED");
    const counts = {};
    if (tables.some(({ tablename }) => !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(tablename))) fail("UNSUPPORTED_TABLE");
    if (tables.length) {
      const rows = await reserved.unsafe(tables.map(({ tablename }) => `SELECT '${tablename}' AS name, count(*)::text AS count FROM public."${tablename}"`).join(" UNION ALL "));
      for (const row of rows) counts[row.name] = row.count;
    }
    const migrations = await reserved.unsafe('SELECT migration_name, checksum FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name');
    const extensions = await reserved.unsafe("SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis','pg_trgm','vector') ORDER BY extname");
    if (extensions.length !== 3) fail("SOURCE_EXTENSIONS_MISSING");
    const dbUrl = new URL(source.databaseUrl);
    await runTool("pg_dump", ["--format=custom", "--schema=public", "--no-owner", "--no-privileges", `--snapshot=${snapshot.snapshot}`, "--file", resolve(directory, "database.dump")], {
      PGHOST: dbUrl.hostname, PGPORT: dbUrl.port || "5432", PGUSER: decodeURIComponent(dbUrl.username), PGPASSWORD: decodeURIComponent(dbUrl.password),
      PGDATABASE: decodeURIComponent(dbUrl.pathname.slice(1)), PGSSLMODE: transport.sslmode, PGCONNECT_TIMEOUT: "15",
      ...(transport.sslmode === "verify-full" ? { PGSSLROOTCERT: caPath } : {}),
    });
    // Immutable media keys from the same DB snapshot include library assets, posters, private documents and retained references.
    const captured = await captureReferencedObjects(remote, source.bucket, [...mediaObjectReferences(assets), ...importObjectReferences(imports)], directory, { keyPrefix: source.keyPrefix, staticRoot });
    const inventory = { format: 1, sourceId: source.sourceId, snapshot: snapshot.snapshot, sourceKeyPrefix: source.keyPrefix ?? "", databaseTransport: source.databaseTransport ?? "verified-tls", counts, migrations, extensions, ...captured };
    await writeFile(resolve(directory, "inventory.json"), JSON.stringify(inventory), { flag: "wx", mode: 0o600 });
    await runTool("tar", ["-czf", resolve(directory, "object-storage.tar.gz"), "-C", directory, "inventory.json", "objects"]);
    await runTool("pg_restore", ["--list", resolve(directory, "database.dump")]);
    await runTool("tar", ["-tzf", resolve(directory, "object-storage.tar.gz")]);
    const manifest = { format: 2, source: source.mediaProfile === "railway-temporary-seaweed" ? "hosted-postgres-s3" : "hosted-postgres-r2",
      mediaProfile: source.mediaProfile ?? "cloudflare-r2", sourceId: source.sourceId, syntheticFixture: fixture,
      createdAtUtc: started, completedAtUtc: new Date().toISOString(),
      database: { file: "database.dump", sha256: (await hashFile(resolve(directory, "database.dump"))).sha256, serverVersionNum: snapshot.version, schema: "public" },
      objectStorage: { file: "object-storage.tar.gz", sha256: (await hashFile(resolve(directory, "object-storage.tar.gz"))).sha256, format: "content-addressed-r2", objectCount: captured.objects.length, totalBytes: captured.totalBytes, inventorySha256: (await hashFile(resolve(directory, "inventory.json"))).sha256 },
      consistency: "Exported repeatable-read PostgreSQL snapshot shared by pg_dump and object reference inventory. Object keys must be immutable; missing objects invalidate capture. Managed platform schemas and provider account configuration are outside application recovery scope.",
      restoreDrill: "NOT_VERIFIED" };
    await writeFile(resolve(directory, "manifest.json"), JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    await reserved.unsafe("ROLLBACK");
    await unlink(marker);
    return manifest;
  } finally {
    if (reserved) { await reserved.unsafe("ROLLBACK").catch(() => {}); reserved.release(); }
    if (!fixture) await unlink(caPath).catch(() => {});
    if (!postgres) await sql.close({ timeout: 5 }); if (!store) remote.destroy();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [config, directory] = process.argv.slice(2);
  (async () => {
    const info = await lstat(config);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) fail("INVALID_SOURCE_FILE");
    const source = JSON.parse((await readFile(config, "utf8")).replace(/^\uFEFF/, ""));
    const manifest = await captureHosted({ source, directory, staticRoot: resolve(import.meta.dirname, "../public") });
    console.log(JSON.stringify({ status: "PASS_HOSTED_CAPTURE", sourceId: manifest.sourceId, objectCount: manifest.objectStorage.objectCount }));
  })().catch(() => { console.error('{"status":"FAILED_HOSTED_CAPTURE","details":"redacted"}'); process.exitCode = 1; });
}
