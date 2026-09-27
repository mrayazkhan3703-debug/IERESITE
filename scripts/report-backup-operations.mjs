// Offline metadata only. Never loads application env, keys, archives or an SDK.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_RUNS = 4096, METADATA_LIMIT = 32768;
const ID = /^[a-f0-9]{32}$/, HASH = /^[a-f0-9]{64}$/;
const FILES = ["database.dump.age", "object-storage.tar.gz.age", "manifest.json.age"];
const REASONS = new Set([
  "FULL_READBACK_AND_RECEIPT_VERIFIED", "PREFLIGHT_FAILED", "CAPTURE_FAILED", "UPLOAD_FAILED",
  "RECEIPT_REPORT_FAILED", "RESULT_LOG_WRITE_FAILED", "MISSING_VERIFIED_RECEIPT", "RECEIPT_HASH_MISMATCH",
  "INVALID_PATH", "UNSAFE_ROOT_PATH", "OUTPUT_INSIDE_REPOSITORY", "LINKED_PATH", "MISSING_FILE",
  "INVALID_RUNNER_CONFIG", "INVALID_PUBLIC_RECIPIENT",
]);
const fail = (code) => { throw new Error(code); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function utc(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) fail("INVALID_TIMESTAMP");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) fail("INVALID_TIMESTAMP");
  return time;
}

async function safePath(path, kind) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) === parse(resolve(path)).root) fail("UNSAFE_STATE_PATH");
  const full = resolve(path);
  for (let cursor = full; ; cursor = dirname(cursor)) {
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) fail("LINKED_STATE_PATH");
    if (cursor === full && !(kind === "directory" ? info.isDirectory() : info.isFile())) fail("INVALID_METADATA_PATH");
    if (dirname(cursor) === cursor) break;
  }
  return full;
}

async function metadata(path) {
  await safePath(path, "file");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > METADATA_LIMIT) fail("METADATA_BOUND_EXCEEDED");
    // Bounded even when a concurrent writer grows the file after stat.
    const buffer = Buffer.alloc(METADATA_LIMIT + 1);
    let size = 0;
    while (size < buffer.length) {
      const chunk = await handle.read(buffer, size, buffer.length - size, null);
      if (!chunk.bytesRead) break;
      size += chunk.bytesRead;
    }
    if (size !== info.size || size > METADATA_LIMIT) fail("METADATA_CHANGED_OR_OVERSIZED");
    const bytes = buffer.subarray(0, size);
    return { value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")), sha256: sha(bytes) };
  } finally { await handle.close(); }
}

function policyValues(policy, targets) {
  if (policy?.format !== 1 || policy.status !== "OWNER_APPROVED_OPERATIONS_ONLY" ||
      policy.intervalMinutes !== 30 || policy.retentionDays !== 30 ||
      policy.automaticDeletion !== "DISABLED_UNTIL_VERIFIED_PROTECTED_COPY" || policy.achievement !== "NOT_VERIFIED" ||
      targets?.format !== 1 || targets.status !== "OWNER_APPROVED_TARGETS_ONLY" ||
      targets.rpoSeconds !== 3600 || targets.rtoSeconds !== 7200) fail("INVALID_APPROVED_POLICY");
  return { intervalSeconds: policy.intervalMinutes * 60, retentionSeconds: policy.retentionDays * 86400,
    rpoSeconds: targets.rpoSeconds, rtoSeconds: targets.rtoSeconds };
}

function validateResult(result, runId, now) {
  if (result?.format !== 1 || result.runId !== runId || !["Manual", "Scheduled"].includes(result.mode) ||
      !["VERIFIED_CIPHERTEXT_RUN", "FAILED"].includes(result.status) || !REASONS.has(result.reason) ||
      ["backupStarted", "transferStarted", "deletionStarted", "scheduledTaskEnabled"].some((key) => typeof result[key] !== "boolean") ||
      result.deletionStarted || result.scheduledTaskEnabled || result.achievedRpo !== "NOT_VERIFIED" ||
      result.achievedRto !== "NOT_VERIFIED" || utc(result.checkedAtUtc) > now) fail("INVALID_ATTEMPT_METADATA");
  if (result.status === "VERIFIED_CIPHERTEXT_RUN" && (result.reason !== "FULL_READBACK_AND_RECEIPT_VERIFIED" ||
      !result.backupStarted || !result.transferStarted || !HASH.test(result.recipientFingerprint ?? ""))) fail("INVALID_SUCCESS_METADATA");
}

function validateReceipt(receipt, result, now) {
  if (receipt?.format !== 1 || !ID.test(receipt.runId ?? "") || receipt.status !== "VERIFIED_CIPHERTEXT_ONLY" ||
      receipt.recipientFingerprint !== result.recipientFingerprint || !HASH.test(receipt.recipientFingerprint ?? "") ||
      receipt.offHost !== "NOT_VERIFIED" || receipt.achievedRpo !== "NOT_VERIFIED" || receipt.achievedRto !== "NOT_VERIFIED" ||
      !Array.isArray(receipt.objects) || receipt.objects.length !== 3) fail("INVALID_RECEIPT_METADATA");
  const captured = utc(receipt.createdAtUtc), verified = utc(receipt.verifiedAtUtc);
  if (captured > verified || verified > now || verified < utc(result.checkedAtUtc)) fail("INVALID_RECEIPT_TIME");
  let prefix;
  for (const [index, item] of receipt.objects.entries()) {
    if (!item || item.file !== FILES[index] || typeof item.key !== "string" || item.key.length > 1024 ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > (index === 2 ? 65536 : 64 * 1024 ** 3 + 16 * 1024 ** 2) ||
        !HASH.test(item.sha256 ?? "")) fail("INVALID_RECEIPT_OBJECT");
    const suffix = `/${receipt.runId}/${item.file}`;
    const candidate = item.key.endsWith(suffix) ? item.key.slice(0, -suffix.length) : "";
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(candidate) || (prefix && candidate !== prefix)) fail("INVALID_RECEIPT_OBJECT");
    prefix = candidate;
  }
  return { captured, verified };
}

export async function reportBackupOperations({ stateDirectory, policy, targets, now = Date.now(), maxRuns = MAX_RUNS }) {
  const limits = policyValues(policy, targets);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(maxRuns) || maxRuns < 1 || maxRuns > MAX_RUNS) fail("INVALID_REPORT_OPTIONS");
  const root = await safePath(stateDirectory, "directory");
  const runs = [], anomalies = [], successes = [], remoteIds = new Set();
  const entries = await opendir(root);
  let count = 0;
  for await (const entry of entries) {
    if (!/^run-[a-f0-9]{32}$/.test(entry.name)) continue; // No recovery directories or archive/key paths read.
    if (++count > maxRuns) fail("INVENTORY_BOUND_EXCEEDED");
    const runId = entry.name.slice(4), directory = join(root, entry.name);
    try {
      await safePath(directory, "directory");
      let result;
      try { result = (await metadata(join(directory, "result.json"))).value; }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        anomalies.push({ runId, code: "INCOMPLETE_OR_ACTIVE_ATTEMPT" });
        continue;
      }
      validateResult(result, runId, now);
      /** @type {{ runId: string, status: string, reason: string, checkedAtUtc: string, remoteRunId?: string, captureWindowAgeSeconds?: number, verifiedAtUtc?: string, retentionDue?: boolean, retentionAction?: string }} */
      const row = { runId, status: result.status, reason: result.reason, checkedAtUtc: result.checkedAtUtc };
      if (result.status === "VERIFIED_CIPHERTEXT_RUN") {
        const receiptPath = join(directory, "encrypted", "receipt.json");
        const receipt = await metadata(receiptPath);
        const time = validateReceipt(receipt.value, result, now);
        if (remoteIds.has(receipt.value.runId)) fail("DUPLICATE_REMOTE_RUN");
        remoteIds.add(receipt.value.runId);
        const ageSeconds = (now - time.captured) / 1000;
        Object.assign(row, { remoteRunId: receipt.value.runId, captureWindowAgeSeconds: ageSeconds,
          verifiedAtUtc: receipt.value.verifiedAtUtc, retentionDue: ageSeconds >= limits.retentionSeconds,
          retentionAction: ageSeconds >= limits.retentionSeconds ? "REVIEW_ONLY_NO_DELETION" : "KEEP" });
        successes.push({ ...time, runId, remoteRunId: receipt.value.runId, receiptPath, receiptSha256: receipt.sha256 });
      }
      runs.push(row);
    } catch {
      anomalies.push({ runId, code: "INVALID_OR_UNREADABLE_ATTEMPT_EVIDENCE" }); // Never echo untrusted values/errors.
    }
  }
  runs.sort((a, b) => a.checkedAtUtc.localeCompare(b.checkedAtUtc) || a.runId.localeCompare(b.runId));
  successes.sort((a, b) => a.captured - b.captured || a.runId.localeCompare(b.runId));
  const latest = successes.at(-1);
  let pointerStatus = "NO_SUCCESS_POINTER";
  try {
    const pointer = (await metadata(join(root, "last-success.json"))).value;
    const matched = successes.find((item) => item.runId === pointer.runId);
    if (pointer.format !== 1 || !ID.test(pointer.runId ?? "") || !HASH.test(pointer.receiptSha256 ?? "") ||
        !matched || typeof pointer.receiptFile !== "string" || !isAbsolute(pointer.receiptFile) ||
        resolve(pointer.receiptFile) !== resolve(matched.receiptPath) || pointer.receiptSha256 !== matched.receiptSha256 ||
        utc(pointer.verifiedAtUtc) < matched.verified || utc(pointer.verifiedAtUtc) > now || matched !== latest) fail("INVALID_SUCCESS_POINTER");
    pointerStatus = "MATCHES_LATEST_RECORDED_RECEIPT";
  } catch (error) {
    if (error.code !== "ENOENT" || successes.length) anomalies.push({ code: "MISSING_OR_INVALID_SUCCESS_POINTER" });
  }
  const gaps = [];
  for (let index = 1; index < successes.length; index++) {
    const gapSeconds = (successes[index].captured - successes[index - 1].captured) / 1000;
    if (gapSeconds > limits.intervalSeconds) gaps.push({ before: successes[index - 1].runId, after: successes[index].runId, gapSeconds });
  }
  const latestAge = latest ? (now - latest.captured) / 1000 : null;
  const failures = runs.filter((item) => item.status === "FAILED");
  const unresolvedFailures = failures.filter((item) => !latest || utc(item.checkedAtUtc) >= latest.verified);
  const alerts = [];
  if (anomalies.length) alerts.push("EVIDENCE_INTEGRITY_OR_INCOMPLETE_ATTEMPT");
  if (!latest) alerts.push("NO_VERIFIED_RECEIPT");
  if (latestAge > limits.rpoSeconds) alerts.push("STALE_CAPTURE_WINDOW");
  if (latestAge > limits.intervalSeconds) alerts.push("RECEIPT_CADENCE_OVERDUE");
  if (gaps.length) alerts.push("RECORDED_CADENCE_GAPS");
  if (unresolvedFailures.length) alerts.push("UNRESOLVED_FAILED_ATTEMPTS");
  return { format: 1, status: alerts.length ? "ATTENTION_REQUIRED" : "PASS_SCOPED_METADATA", checkedAtUtc: new Date(now).toISOString(),
    scope: "LOCAL_RECORDED_METADATA_NOT_REMOTE_REVALIDATION", networkCalls: 0, stateMutated: false,
    deletionAuthorized: false, schedulerStatus: "NOT_INSPECTED", offHostAlerts: "NOT_CONFIGURED_BY_THIS_REPORT",
    achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED", targets: limits,
    latestCaptureWindowAgeSeconds: latestAge, pointerStatus, alerts,
    counts: { attempts: count, verifiedReceipts: successes.length, failedAttempts: failures.length, unresolvedFailures: unresolvedFailures.length, anomalies: anomalies.length },
    cadence: { status: successes.length < 2 ? "INSUFFICIENT_SAMPLES" : gaps.length ? "RECORDED_GAPS" : "PASS_SCOPED_RECORDED_INTERVALS",
      sampleCount: successes.length, gaps, continuousProtection: "NOT_VERIFIED" },
    retention: { mode: "READ_ONLY_30_DAY_ELIGIBILITY", dueCount: runs.filter((item) => item.retentionDue).length,
      enforcedRetention: "NOT_VERIFIED", deletionAuthorized: false }, runs, anomalies };
}

export async function cli(argv) {
  if (argv.length !== 2 || argv[0] !== "--state-directory" || !isAbsolute(argv[1])) fail("INVALID_ARGUMENTS");
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const policy = (await metadata(join(repository, "docs/agent/BACKUP_OPERATIONS_POLICY.json"))).value;
  const targets = (await metadata(join(repository, "docs/agent/RECOVERY_TARGETS.json"))).value;
  return reportBackupOperations({ stateDirectory: argv[1], policy, targets });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await cli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "PASS_SCOPED_METADATA" ? 0 : 2;
  } catch {
    process.stdout.write('{"status":"FAILED","reason":"INVALID_OR_UNREADABLE_REPORT_INPUT","networkCalls":0,"stateMutated":false,"deletionAuthorized":false}\n');
    process.exitCode = 1;
  }
}
