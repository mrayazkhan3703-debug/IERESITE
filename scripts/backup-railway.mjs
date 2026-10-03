// Dedicated short-lived backup service. No application env loading, private age keys, or deletion of remote backups.
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { captureHosted } from "./backup-hosted.mjs";
import { uploadExistingBackup, validateConfig, validateReceipt, assessReceipt } from "./backup-adapter.mjs";
import { validateHostedSource } from "./backup-hosted.mjs";

const fail = code => { throw new Error(code); };
export function railwayBackupConfiguration(env) {
  const source = validateHostedSource({ format: 1, sourceId: env.BACKUP_SOURCE_ID,
    databaseUrl: env.BACKUP_DATABASE_URL, databaseTransport: env.BACKUP_DATABASE_TRANSPORT,
    caCertificate: env.BACKUP_DATABASE_CA, endpoint: env.BACKUP_MEDIA_ENDPOINT,
    bucket: env.BACKUP_MEDIA_BUCKET, keyPrefix: env.BACKUP_MEDIA_KEY_PREFIX ?? "",
    accessKeyId: env.BACKUP_MEDIA_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_MEDIA_SECRET_ACCESS_KEY });
  const recipient = env.BACKUP_AGE_RECIPIENT;
  if (!/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient ?? "")) fail("PUBLIC_RECIPIENT_REQUIRED");
  const maxStoredBytes = Number(env.BACKUP_MAX_STORED_BYTES);
  if (!Number.isSafeInteger(maxStoredBytes) || maxStoredBytes < 1024 ** 2) fail("STORAGE_CAP_REQUIRED");
  if (![env.BACKUP_ACCESS_KEY_ID, env.BACKUP_SECRET_ACCESS_KEY].every(value => typeof value === "string" && value.length > 0 && value.length < 4096)) fail("BACKUP_CREDENTIALS_REQUIRED");
  const destination = validateConfig({ format: 1, provider: "cloudflare-r2", endpoint: env.BACKUP_ENDPOINT,
    region: "auto", forcePathStyle: true, bucket: env.BACKUP_BUCKET, prefix: `live-backups/${source.sourceId}`,
    maxStoredBytes, recipientFile: resolve(tmpdir(), "public-recipient"), credentialFile: resolve(tmpdir(), "backup-credentials") });
  if (source.bucket === destination.bucket) fail("SEPARATE_BACKUP_BUCKET_REQUIRED");
  return { source, recipient, destination, credentials: { accessKeyId: env.BACKUP_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_SECRET_ACCESS_KEY } };
}

export function requireRailwayRecovery(env, sourceId, now = Date.now()) {
  let evidence;
  try { evidence = JSON.parse(env.BACKUP_RECOVERY_EVIDENCE ?? ""); } catch { fail("RECOVERY_GATE_REQUIRED"); }
  const completed = Date.parse(evidence.restoreCompletedAtUtc);
  if (env.BACKUP_OWNER_KEY_COPY_CONFIRMED !== "true" || evidence.status !== "PASS" || evidence.sourceId !== sourceId ||
      evidence.source !== "hosted-postgres-r2" || evidence.syntheticFixture !== false || evidence.cleanup !== "PASS" ||
      evidence.network !== "INTERNAL_NO_PUBLISHED_PORTS" || evidence.outboundJobs !== "DISABLED" ||
      evidence.databaseChecks?.status !== "PASS_DATABASE" || evidence.objectChecks?.status !== "PASS_OBJECTS" ||
      evidence.deliveryChecks?.status !== "PASS_DELIVERY" || !Number.isFinite(completed) || completed > now) fail("RECOVERY_GATE_REQUIRED");
}

export async function latestRailwayReceipt(store, config) {
  try {
    const response = await store.send(new GetObjectCommand({ Bucket: config.bucket, Key: `${config.prefix}/latest.json` }));
    if (!response.Body || response.ContentLength > 32768) fail("INVALID_BACKUP_RECEIPT");
    let bytes = 0; const chunks = [];
    for await (const chunk of response.Body) { bytes += chunk.length; if (bytes > 32768) fail("INVALID_BACKUP_RECEIPT"); chunks.push(chunk); }
    if (!response.ETag) fail("INVALID_BACKUP_RECEIPT");
    const receipt = validateReceipt(JSON.parse(Buffer.concat(chunks).toString("utf8")), config);
    if (receipt.status !== "VERIFIED_CIPHERTEXT_ONLY") fail("INVALID_BACKUP_RECEIPT");
    return { receipt, etag: response.ETag };
  } catch (error) { if (error.$metadata?.httpStatusCode === 404) return null; throw error; }
}

export async function publishLatestRailwayReceipt(store, destination, receipt) {
  validateReceipt(receipt, destination);
  if (receipt.status !== "VERIFIED_CIPHERTEXT_ONLY") fail("INVALID_BACKUP_RECEIPT");
  const current = await latestRailwayReceipt(store, destination);
  if (current && Date.parse(current.receipt.createdAtUtc) > Date.parse(receipt.createdAtUtc)) return { published: false, newerCapturePreserved: true };
  const body = Buffer.from(JSON.stringify(receipt)), key = `${destination.prefix}/latest.json`;
  await store.send(new PutObjectCommand({ Bucket: destination.bucket, Key: key, Body: body, ContentType: "application/json",
    ...(current ? { IfMatch: current.etag } : { IfNoneMatch: "*" }) }));
  const saved = await latestRailwayReceipt(store, destination);
  if (!saved || createHash("sha256").update(JSON.stringify(saved.receipt)).digest("hex") !== createHash("sha256").update(body).digest("hex")) fail("LATEST_RECEIPT_MISMATCH");
  return { published: true, newerCapturePreserved: false };
}

export async function runRailwayBackup(action, env) {
  if (!["plan", "capture", "scheduled", "report"].includes(action)) fail("INVALID_BACKUP_ACTION");
  const config = railwayBackupConfiguration(env);
  if (action === "scheduled") requireRailwayRecovery(env, config.source.sourceId);
  if (action === "plan") return { status: "PLAN_ONLY", sourceId: config.source.sourceId, databaseTransport: config.source.databaseTransport ?? "verified-tls",
    mediaNamespace: config.source.keyPrefix, intervalMinutes: 30, privateIdentityRequired: false, scheduleEnabled: false, deletionEnabled: false, networkCalls: 0 };
  const store = new S3Client({ endpoint: config.destination.endpoint, region: "auto", forcePathStyle: true,
    credentials: config.credentials, maxAttempts: 3, requestHandler: { connectionTimeout: 5000, socketTimeout: 30000 },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  let root;
  try {
    const previous = await latestRailwayReceipt(store, config.destination);
    if (action === "report") return previous ? assessReceipt(previous.receipt, config.destination) : { status: "BACKUP_MISSING", achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED" };
    root = await mkdtemp(resolve(tmpdir(), "iere-railway-backup-"));
    const recipientFile = resolve(root, "recipients.txt"), credentialFile = resolve(root, "credentials.json");
    await writeFile(recipientFile, `${config.recipient}\n`, { mode: 0o600, flag: "wx" });
    await writeFile(credentialFile, JSON.stringify(config.credentials), { mode: 0o600, flag: "wx" });
    const destination = { ...config.destination, recipientFile, credentialFile };
    const directory = resolve(root, "capture");
    const manifest = await captureHosted({ source: config.source, directory, staticRoot: resolve(import.meta.dirname, "../public") });
    const receipt = await uploadExistingBackup({ config: destination, directory, outputDirectory: resolve(root, "encrypted"), store });
    // A compare-and-set pointer avoids an older concurrent run replacing the latest recovery point.
    await publishLatestRailwayReceipt(store, destination, receipt);
    return { status: "VERIFIED_CIPHERTEXT_ONLY", sourceId: manifest.sourceId, runId: receipt.runId, objectCount: manifest.objectStorage.objectCount,
      backupCreatedAtUtc: manifest.createdAtUtc, verifiedAtUtc: receipt.verifiedAtUtc, previousCaptureAgeSeconds: previous ? (Date.now() - Date.parse(previous.receipt.createdAtUtc)) / 1000 : null,
      staleBeforeCapture: previous ? Date.now() - Date.parse(previous.receipt.createdAtUtc) > 3600000 : true,
      privateIdentityRequired: false, deletionEnabled: false, achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED" };
  } finally {
    store.destroy();
    if (root) {
      const parent = await realpath(tmpdir()), actual = await realpath(root), distance = relative(parent, actual);
      if (distance.startsWith("..") || isAbsolute(distance) || !/^iere-railway-backup-[^/\\]+$/.test(distance)) fail("UNSAFE_TEMP_CLEANUP");
      await rm(actual, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // The whole container exits after 25 minutes; cron runs cannot hang across the next interval.
  const deadline = setTimeout(() => { console.error('{"status":"BACKUP_DEADLINE_EXCEEDED"}'); process.exit(124); }, 25 * 60000);
  runRailwayBackup(process.argv[2] ?? "plan", process.env).then(result => {
    console.log(JSON.stringify(result));
    if (["STALE_RECEIPT", "BACKUP_MISSING"].includes(result.status)) process.exitCode = 1;
  }).catch(error => {
    const allowed = new Set(["RECOVERY_GATE_REQUIRED", "STORAGE_CAP_REACHED", "REFERENCED_OBJECT_MISSING", "OBJECT_CAPTURE_INCOMPLETE", "LATEST_RECEIPT_MISMATCH", "SOURCE_EXTENSIONS_MISSING", "UNSUPPORTED_MEDIA_KEY", "SOURCE_CA_REQUIRED", "INVALID_HOSTED_SOURCE", "PUBLIC_RECIPIENT_REQUIRED", "STORAGE_CAP_REQUIRED", "BACKUP_CREDENTIALS_REQUIRED", "SEPARATE_BACKUP_BUCKET_REQUIRED", "HOSTED_TOOL_FAILED", "MEDIA_BOUND_EXCEEDED", "INVALID_BACKUP_RECEIPT"]);
    console.error(JSON.stringify({ status: "BACKUP_FAILED", code: allowed.has(error.message) ? error.message : "REDACTED_FAILURE" })); process.exitCode = 1;
  })
    .finally(() => clearTimeout(deadline));
}
