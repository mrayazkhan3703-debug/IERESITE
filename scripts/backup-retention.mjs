import { createHash, randomUUID } from "node:crypto";
import { ListObjectsV2Command, GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, ListMultipartUploadsCommand } from "@aws-sdk/client-s3";
import { validateReceipt } from "./backup-adapter.mjs";

export const BACKUP_RETENTION_NAMESPACES = Object.freeze({
  "live-backups/railway-main": "a43857db13d74050936bc7f4a9f90e61",
  "private/iere-live": "e8c17022e7e14416b4c68b9d8a4854f1",
});
const FILES = new Set(["database.dump.age", "object-storage.tar.gz.age", "manifest.json.age", "receipt.json"]);
const sha = value => createHash("sha256").update(value).digest("hex");
const fail = () => { throw new Error("RETENTION_VALIDATION_FAILED"); };
const isMissing = error => error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey";
function unchangedHead(head, item) {
  return head.ETag === item.ETag && head.ContentLength === item.Size &&
    Number.isFinite(head.LastModified?.getTime()) &&
    Math.floor(head.LastModified.getTime() / 1000) === Math.floor(item.LastModified.getTime() / 1000);
}
async function send(store, command) { return store.send(command, { abortSignal: AbortSignal.timeout(120000) }); }
async function list(store, bucket, prefix) {
  const rows = []; let token;
  for (let page = 0; page < 100; page++) {
    const result = await send(store, new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix + "/", ContinuationToken: token }));
    rows.push(...result.Contents ?? []);
    if (!result.IsTruncated) return rows;
    if (!result.NextContinuationToken || rows.length > 100000) fail();
    token = result.NextContinuationToken;
  }
  fail();
}
async function read(store, bucket, key, limit) {
  const result = await send(store, new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body || result.ContentLength > limit) fail();
  const hash = createHash("sha256"), chunks = []; let bytes = 0;
  try {
    for await (const chunk of result.Body) {
      bytes += chunk.length; if (bytes > limit) fail(); hash.update(chunk);
      if (limit <= 32768) chunks.push(chunk);
    }
  } finally { result.Body.destroy?.(); }
  return { bytes, sha256: hash.digest("hex"), text: limit <= 32768 ? Buffer.concat(chunks).toString("utf8") : null };
}
async function pointer(store, bucket, prefix) {
  try { return JSON.parse((await read(store, bucket, prefix + "/latest.json", 32768)).text); }
  catch (error) { if (isMissing(error)) return null; throw error; }
}

/** Union of rolling points, seven UTC daily points, recovery baseline and latest pointer. */
export function retainedBackupIds(captures, pin, latestId, now = Date.now()) {
  const sorted = [...captures].sort((a, b) => Date.parse(b.receipt.createdAtUtc) - Date.parse(a.receipt.createdAtUtc) || b.runId.localeCompare(a.runId));
  const keep = new Map([[pin, ["PROVEN_RESTORATION"]]]);
  const add = (id, reason) => keep.set(id, [...keep.get(id) ?? [], reason]);
  sorted.slice(0, 4).forEach(item => add(item.runId, "RECENT_FOUR"));
  const cutoff = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - 6 * 86400000;
  const days = new Set();
  for (const item of sorted) {
    const time = Date.parse(item.receipt.createdAtUtc), day = new Date(time).toISOString().slice(0, 10);
    if (time >= cutoff && time <= now && !days.has(day)) { days.add(day); add(item.runId, "DAILY_SEVEN"); }
  }
  if (latestId) add(latestId, "LATEST_POINTER");
  return keep;
}

async function inspectNamespace(store, config, prefix, pin, now) {
  const rows = await list(store, config.bucket, prefix), groups = new Map();
  for (const item of rows) {
    const suffix = item.Key?.slice(prefix.length + 1), match = /^([a-f0-9]{32})\/(.+)$/.exec(suffix ?? "");
    if (!match) continue;
    const group = groups.get(match[1]) ?? { runId: match[1], members: [], unknown: false };
    if (!FILES.has(match[2]) || !Number.isSafeInteger(item.Size) || item.Size < 0 || !item.ETag || !Number.isFinite(item.LastModified?.getTime())) group.unknown = true;
    group.members.push(item); groups.set(group.runId, group);
  }
  const complete = [], partial = [], incomplete = [], skipped = [];
  for (const group of groups.values()) {
    if (group.unknown) { skipped.push(group.runId); continue; }
    const receiptObject = group.members.find(item => item.Key.endsWith("/receipt.json"));
    if (!receiptObject) { incomplete.push(group); continue; }
    try {
      const body = await read(store, config.bucket, receiptObject.Key, 32768);
      group.receipt = validateReceipt(JSON.parse(body.text), { ...config, prefix }); group.receiptHash = body.sha256;
      if (group.receipt.status !== "VERIFIED_CIPHERTEXT_ONLY" || group.receipt.runId !== group.runId || Date.parse(group.receipt.verifiedAtUtc) > now) fail();
      const valid = group.receipt.objects.every(object => group.members.some(item => item.Key === object.key && item.Size === object.bytes));
      if (valid && group.members.length === 4) complete.push(group);
      else if (group.members.every(item => item.Key === receiptObject.Key || group.receipt.objects.some(object => object.key === item.Key && object.bytes === item.Size))) partial.push(group);
      else skipped.push(group.runId);
    } catch { skipped.push(group.runId); }
  }
  const latest = await pointer(store, config.bucket, prefix);
  if (latest) {
    validateReceipt(latest, { ...config, prefix });
    const saved = complete.find(item => item.runId === latest.runId)?.receipt;
    if (latest.status !== "VERIFIED_CIPHERTEXT_ONLY" || !saved || latest.verifiedAtUtc !== saved.verifiedAtUtc ||
        latest.recipientFingerprint !== saved.recipientFingerprint || JSON.stringify(latest.objects) !== JSON.stringify(saved.objects)) fail();
  }
  const keep = retainedBackupIds(complete, pin, latest?.runId, now);
  // A missing/tampered baseline or pointer blocks the namespace, never weakens retention.
  if (![...keep.keys()].every(id => complete.some(item => item.runId === id))) fail();
  const retained = complete.filter(item => keep.has(item.runId));
  for (const group of retained) for (const object of group.receipt.objects) {
    const checked = await read(store, config.bucket, object.key, object.bytes);
    if (checked.bytes !== object.bytes || checked.sha256 !== object.sha256) fail();
  }
  const active = new Set(); let keyMarker, uploadMarker;
  for (let page = 0; page < 100; page++) {
    const uploads = await send(store, new ListMultipartUploadsCommand({ Bucket: config.bucket, Prefix: prefix + "/", KeyMarker: keyMarker, UploadIdMarker: uploadMarker }));
    for (const upload of uploads.Uploads ?? []) { const match = /^([a-f0-9]{32})\//.exec(upload.Key?.slice(prefix.length + 1) ?? ""); if (match) active.add(match[1]); }
    if (!uploads.IsTruncated) break;
    if (page === 99 || !uploads.NextKeyMarker) fail();
    keyMarker = uploads.NextKeyMarker; uploadMarker = uploads.NextUploadIdMarker;
  }
  const newestFour = [...complete].sort((a,b) => Date.parse(b.receipt.createdAtUtc)-Date.parse(a.receipt.createdAtUtc)).slice(0,4);
  const oldestRecent = newestFour.length === 4 ? Date.parse(newestFour[3].receipt.createdAtUtc) : -Infinity;
  // Receipt-backed partial deletion may resume only behind four intact newer recoveries.
  const resumable = partial.filter(item => !keep.has(item.runId) && Date.parse(item.receipt.createdAtUtc) < oldestRecent);
  const staleIncomplete = incomplete.filter(group => group.members.length && group.members.every(item => now - item.LastModified.getTime() >= 86400000));
  const candidates = [...complete.filter(item => !keep.has(item.runId)), ...resumable, ...staleIncomplete]
    .filter(item => !keep.has(item.runId) && !active.has(item.runId));
  return { prefix, retained: retained.map(item => ({ runId: item.runId, createdAtUtc: item.receipt.createdAtUtc,
    bytes: item.members.reduce((sum, member) => sum + member.Size, 0), reasons: keep.get(item.runId) })), candidates, skipped, latestId: latest?.runId ?? null };
}

/** Caller holds a database advisory lock for the full inspection/application window. */
export async function runBackupRetention({ store, config, apply = false, now = Date.now(), lockHeld = false }) {
  if (apply && !lockHeld) throw new Error("RETENTION_LOCK_REQUIRED");
  const namespaces = [];
  for (const [prefix, pin] of Object.entries(BACKUP_RETENTION_NAMESPACES)) namespaces.push(await inspectNamespace(store, config, prefix, pin, now));
  const manifest = { format: 1, policy: "FOUR_RECENT_SEVEN_DAILY_PINNED_V1", id: randomUUID(), atUtc: new Date(now).toISOString(),
    bucket: config.bucket, capBytes: config.maxStoredBytes, apply,
    namespaces: namespaces.map(ns => ({ prefix: ns.prefix, retained: ns.retained, skipped: ns.skipped,
      remove: ns.candidates.map(group => ({ runId: group.runId, createdAtUtc: group.receipt?.createdAtUtc ?? null,
        reason: group.receipt ? "OLDER_VERIFIED_OR_INTERRUPTED_DELETION" : "INACTIVE_INCOMPLETE_OVER_24H",
        bytes: group.members.reduce((sum,item) => sum + item.Size,0) })) })) };
  if (!apply) return { manifest, removedRuns: 0, removedBytes: 0 };
  const auditKey = `live-backups/railway-main/retention/${manifest.id}.json`;
  await send(store, new PutObjectCommand({ Bucket: config.bucket, Key: auditKey, Body: Buffer.from(JSON.stringify(manifest)), ContentType: "application/json", IfNoneMatch: "*" }));
  let removedRuns = 0, removedBytes = 0;
  for (const ns of namespaces) for (const group of ns.candidates) {
    const current = await pointer(store, config.bucket, ns.prefix);
    if (current) validateReceipt(current, { ...config, prefix: ns.prefix });
    if (current?.runId === group.runId || group.runId === BACKUP_RETENTION_NAMESPACES[ns.prefix]) fail();
    const uploads = await send(store, new ListMultipartUploadsCommand({ Bucket: config.bucket, Prefix: `${ns.prefix}/${group.runId}/` }));
    if (uploads.IsTruncated || uploads.Uploads?.length) fail();
    // Verify all remaining bytes before the first removal; interrupted cleanup is resumable.
    if (group.receipt) for (const object of group.receipt.objects) {
      if (!group.members.some(item => item.Key === object.key)) continue;
      const checked = await read(store, config.bucket, object.key, object.bytes);
      if (checked.bytes !== object.bytes || checked.sha256 !== object.sha256) fail();
    }
    for (const item of group.members) {
      const currentHead = await send(store, new HeadObjectCommand({ Bucket: config.bucket, Key: item.Key }));
      // S3 HTTP Last-Modified has second precision; R2 listings retain milliseconds.
      // ETag/length plus verified content hashes still guard the immutable archive.
      if (!unchangedHead(currentHead, item)) fail();
    }
    // Archives are immutable UUID keys. A changed receipt or member blocks cleanup.
    for (const item of [...group.members].sort((a,b) => Number(a.Key.endsWith("/receipt.json"))-Number(b.Key.endsWith("/receipt.json")))) {
      // R2 may ignore DeleteObject IfMatch. Recheck immediately under the writer lock;
      // UUID archives must remain immutable for cooperating capture/cleanup writers.
      if (!unchangedHead(await send(store, new HeadObjectCommand({ Bucket: config.bucket, Key: item.Key })), item)) fail();
      await send(store, new DeleteObjectCommand({ Bucket: config.bucket, Key: item.Key, IfMatch: item.ETag }));
      try { await send(store, new HeadObjectCommand({ Bucket: config.bucket, Key: item.Key })); fail(); }
      catch (error) { if (!isMissing(error)) throw error; }
      removedBytes += item.Size;
    }
    removedRuns++;
  }
  await send(store, new PutObjectCommand({ Bucket: config.bucket, Key: auditKey, Body: Buffer.from(JSON.stringify({ ...manifest, completedAtUtc: new Date().toISOString(), removedRuns, removedBytes })), ContentType: "application/json" }));
  return { manifest, removedRuns, removedBytes };
}
