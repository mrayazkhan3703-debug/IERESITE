// Explicit operator-invoked synthetic transport verification, never scheduled.
import { S3Client, HeadBucketCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, readFile, writeFile, open } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadConfig, hashFile, parts, uploadMultipart, PART_BYTES } from "./backup-adapter.mjs";

export const SYNTHETIC_BYTES = 17 * 1024 ** 2;
const CIPHER_BOUND = SYNTHETIC_BYTES + 1024 ** 2;
const fail = (code) => { throw new Error(code); };
const digest = (value) => createHash("sha256").update(value).digest("hex");
const stages = ["seed", "read-access", "upload", "recover"];
const safeReasons = ["INVALID_SYNTHETIC_INPUT", "INVALID_CREDENTIAL_FILE", "TOOL_FAILED", "OBJECT_CONFLICT",
  "REMOTE_HASH_MISMATCH", "REMOTE_TOO_LARGE", "CONDITIONAL_COMPLETION_NOT_ENFORCED", "CONDITIONAL_PUT_NOT_ENFORCED",
  "UPLOADER_IDENTITY_PRESENT", "INVALID_RECEIPT", "PLAINTEXT_OBJECT", "InvalidAccessKeyId", "SignatureDoesNotMatch",
  "AccessDenied", "NoSuchBucket", "TimeoutError", "NetworkingError", "NotImplemented", "InvalidRequest"];
export function redactR2Failure(error, stage) {
  return { status: "FAIL_SCOPED_R2_SYNTHETIC", stage: stages.includes(stage) ? stage : "unknown",
    reason: safeReasons.includes(error?.message) ? error.message : safeReasons.includes(error?.name) ? error.name : "REDACTED",
    httpStatus: Number.isInteger(error?.$metadata?.httpStatusCode) ? error.$metadata.httpStatusCode : null,
    operationalBackup: "NOT_VERIFIED" };
}
async function json(path, maximum = 4096) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) fail("INVALID_SYNTHETIC_INPUT");
  return JSON.parse(await readFile(path, "utf8"));
}
function tool(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 4096 });
  if (result.error || result.status !== 0) fail("TOOL_FAILED");
  return result.stdout;
}
async function client(config) {
  const credentials = await json(config.credentialFile);
  if (!/^[a-fA-F0-9]{32}$/.test(credentials.accessKeyId ?? "") || !/^[a-fA-F0-9]{64}$/.test(credentials.secretAccessKey ?? "")) fail("INVALID_CREDENTIAL_FILE");
  return new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
    credentials, maxAttempts: 1, requestHandler: { connectionTimeout: 5000, requestTimeout: 30000, socketTimeout: 15000 },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    logger: { trace() {}, debug() {}, info() {}, warn() {}, error() {} } });
}
export function verificationKeys(config, runId) {
  if (config.provider !== "cloudflare-r2" || !/^[a-f0-9]{32}$/.test(runId ?? "")) fail("INVALID_SYNTHETIC_INPUT");
  const prefix = `${config.prefix}/verification/${runId}`;
  return { payload: `${prefix}/synthetic-payload.bin.age`, receipt: `${prefix}/synthetic-receipt.json` };
}
async function seed() {
  const identityPath = "/recovery/test-only.agekey";
  tool("age-keygen", ["-o", identityPath]);
  const recipient = tool("age-keygen", ["-y", identityPath]).trim();
  await writeFile("/public/recipients.txt", `${recipient}\n`, { flag: "wx", mode: 0o600 });
  // Bounded generation; no application files/volumes/records are mounted.
  const output = await open("/payload/payload.bin", "wx", 0o600);
  try { for (let i = 0; i < 17; i++) await output.writeFile(randomBytes(1024 ** 2)); }
  finally { await output.close(); }
  const original = await hashFile("/payload/payload.bin", SYNTHETIC_BYTES);
  await writeFile("/payload/seed.json", JSON.stringify({ format: 1, scope: "SYNTHETIC_R2_TRANSPORT",
    runId: randomUUID().replaceAll("-", ""), ...original, recipientFingerprint: digest(recipient) }), { flag: "wx", mode: 0o600 });
  return { status: "PASS_SYNTHETIC_SEED", bytes: original.bytes, realRecoveryKeyCustody: "NOT_CONFIGURED" };
}
export async function verifyConditionalCompletion(store, bucket, key, path) {
  // Probe only the existing owned synthetic object, with identical ciphertext.
  const { UploadId } = await store.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }));
  if (!UploadId) fail("INVALID_SYNTHETIC_INPUT");
  let rejected = false;
  try {
    const completed = [];
    for await (const Body of parts(path)) {
      const PartNumber = completed.length + 1;
      const { ETag } = await store.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId, PartNumber, Body }));
      if (!ETag) fail("INVALID_SYNTHETIC_INPUT");
      completed.push({ PartNumber, ETag });
    }
    try { await store.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId, IfNoneMatch: "*", MultipartUpload: { Parts: completed } })); }
    catch (error) { if (error.$metadata?.httpStatusCode !== 412) throw error; rejected = true; }
    if (!rejected) fail("CONDITIONAL_COMPLETION_NOT_ENFORCED");
  } finally {
    // Successful completion consumes the upload; failed precondition leaves it to abort.
    if (rejected) await store.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId }));
    else {
      try { await store.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId })); }
      catch (error) { if (error.name !== "NoSuchUpload") throw error; }
    }
  }
  return true;
}
export async function verifyConditionalPut(store, bucket, key, encryptedBody) {
  try { await store.send(new PutObjectCommand({ Bucket: bucket, Key: key, IfNoneMatch: "*", Body: encryptedBody })); }
  catch (error) { if (error.$metadata?.httpStatusCode === 412) return true; throw error; }
  fail("CONDITIONAL_PUT_NOT_ENFORCED");
}
export async function cipherReadback(store, bucket, key, destination) {
  const response = await store.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) fail("REMOTE_HASH_MISMATCH");
  let bytes = 0; let header = Buffer.alloc(0);
  const hash = createHash("sha256");
  const counter = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    if (bytes > CIPHER_BOUND) return done(new Error("REMOTE_TOO_LARGE"));
    if (header.length < 22) header = Buffer.concat([header, chunk.subarray(0, 22 - header.length)]);
    hash.update(chunk); done(null, chunk);
  } });
  await pipeline(response.Body, counter, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  if (!header.toString("utf8").startsWith("age-encryption.org/v1\n")) fail("PLAINTEXT_OBJECT");
  return { bytes, sha256: hash.digest("hex") };
}
export async function boundedRemoteBody(body, limit = 4096) {
  if (!body) fail("INVALID_RECEIPT");
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of body) {
      bytes += chunk.length;
      if (bytes > limit) fail("INVALID_RECEIPT");
      chunks.push(Buffer.from(chunk));
    }
  } finally { body.destroy?.(); }
  return Buffer.concat(chunks);
}
async function upload(config, store) {
  try { await lstat("/recovery/test-only.agekey"); fail("UPLOADER_IDENTITY_PRESENT"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const original = await json("/payload/seed.json");
  const current = await hashFile("/payload/payload.bin", SYNTHETIC_BYTES);
  if (original.scope !== "SYNTHETIC_R2_TRANSPORT" || current.bytes !== SYNTHETIC_BYTES || current.sha256 !== original.sha256) fail("INVALID_SYNTHETIC_INPUT");
  const keys = verificationKeys(config, original.runId);
  const recipient = (await readFile("/public/recipients.txt", "utf8")).trim();
  if (digest(recipient) !== original.recipientFingerprint) fail("INVALID_SYNTHETIC_INPUT");
  tool("age", ["-R", "/public/recipients.txt", "-o", "/output/synthetic-payload.bin.age", "/payload/payload.bin"]);
  const local = await hashFile("/output/synthetic-payload.bin.age", CIPHER_BOUND);
  await uploadMultipart(store, config.bucket, keys.payload, "/output/synthetic-payload.bin.age");
  const remote = await cipherReadback(store, config.bucket, keys.payload, "/output/readback.age");
  if (local.bytes !== remote.bytes || local.sha256 !== remote.sha256) fail("REMOTE_HASH_MISMATCH");
  await verifyConditionalCompletion(store, config.bucket, keys.payload, "/output/synthetic-payload.bin.age");
  const handle = await open("/output/synthetic-payload.bin.age", "r");
  const encrypted = Buffer.alloc(4096);
  try { await handle.read(encrypted, 0, encrypted.length, 0); } finally { await handle.close(); }
  await verifyConditionalPut(store, config.bucket, keys.payload, encrypted);
  const receipt = { format: 1, scope: original.scope, status: "SYNTHETIC_CIPHERTEXT_ONLY", runId: original.runId,
    verifiedAtUtc: new Date().toISOString(), bucket: config.bucket, keys, ciphertext: local,
    recipientFingerprint: original.recipientFingerprint, multipartPartBound: PART_BYTES,
    conditionalCompletionRejected: true, conditionalPutRejected: true, operationalBackup: "NOT_VERIFIED" };
  const Body = Buffer.from(JSON.stringify(receipt));
  await store.send(new PutObjectCommand({ Bucket: config.bucket, Key: keys.receipt, Body, ContentType: "application/json", IfNoneMatch: "*" }));
  const response = await store.send(new GetObjectCommand({ Bucket: config.bucket, Key: keys.receipt }));
  const verified = await boundedRemoteBody(response.Body);
  if (verified.length !== Body.length || digest(verified) !== digest(Body)) fail("INVALID_RECEIPT");
  await writeFile("/output/receipt.json", Body, { flag: "wx", mode: 0o600 });
  return { ...receipt, uploaderRecoveryIdentityAbsent: true, remoteObjectsRetained: 2, plaintextBackupUploads: 0 };
}
async function recover(config, store) {
  const receipt = await json("/evidence/receipt.json");
  const original = await json("/payload/seed.json");
  const keys = verificationKeys(config, original.runId);
  if (receipt.scope !== original.scope || receipt.status !== "SYNTHETIC_CIPHERTEXT_ONLY" || receipt.keys?.payload !== keys.payload ||
      receipt.keys?.receipt !== keys.receipt || !/^[a-f0-9]{64}$/.test(receipt.ciphertext?.sha256 ?? "")) fail("INVALID_RECEIPT");
  const remote = await cipherReadback(store, config.bucket, keys.payload, "/output/independent-download.age");
  if (remote.bytes !== receipt.ciphertext.bytes || remote.sha256 !== receipt.ciphertext.sha256) fail("REMOTE_HASH_MISMATCH");
  tool("age", ["-d", "-i", "/recovery/test-only.agekey", "-o", "/output/recovered.bin", "/output/independent-download.age"]);
  const recovered = await hashFile("/output/recovered.bin", SYNTHETIC_BYTES);
  if (recovered.bytes !== original.bytes || recovered.sha256 !== original.sha256) fail("REMOTE_HASH_MISMATCH");
  return { status: "PASS_SCOPED_R2_SYNTHETIC_RECOVERY", runId: original.runId, independentProcessDownload: true,
    ciphertextHashEqual: true, plaintextByteHashEqual: true, bytes: recovered.bytes,
    scope: "Synthetic random bytes only; same-host recovery, not operational/independent-site recovery",
    achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED", realRecoveryKeyCustody: "NOT_CONFIGURED" };
}
async function cli(stage) {
  if (!stages.includes(stage)) fail("INVALID_SYNTHETIC_INPUT");
  if (stage === "seed") return seed();
  const config = await loadConfig("/config/backup.json");
  if (config.provider !== "cloudflare-r2") fail("INVALID_SYNTHETIC_INPUT");
  const store = await client(config);
  try {
    if (stage === "read-access") {
      await store.send(new HeadBucketCommand({ Bucket: config.bucket }));
      await store.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: `${config.prefix}/verification/${randomUUID()}/`, MaxKeys: 1 }));
      return { status: "PASS_SCOPED_R2_READ_ACCESS", bucket: config.bucket, remoteWrites: 0, privacy: "NOT_INDEPENDENTLY_VERIFIED" };
    }
    return stage === "upload" ? await upload(config, store) : await recover(config, store);
  } finally { store.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const stage = process.argv[2];
  cli(stage).then((result) => console.log(JSON.stringify({ ...result, capturedAtUtc: new Date().toISOString() })))
    .catch((error) => { console.log(JSON.stringify({ ...redactR2Failure(error, stage), capturedAtUtc: new Date().toISOString() })); process.exitCode = 1; });
}
