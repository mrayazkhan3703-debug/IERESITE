import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { cli, reportBackupOperations } from "../scripts/report-backup-operations.mjs";

const policy = { format: 1, status: "OWNER_APPROVED_OPERATIONS_ONLY", intervalMinutes: 30, retentionDays: 30,
  automaticDeletion: "DISABLED_UNTIL_VERIFIED_PROTECTED_COPY", achievement: "NOT_VERIFIED" };
const targets = { format: 1, status: "OWNER_APPROVED_TARGETS_ONLY", rpoSeconds: 3600, rtoSeconds: 7200 };
const now = Date.parse("2026-09-27T10:00:00Z");
const hostId = (index: number) => index.toString(16).padStart(32, "0");
const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const result = (id: string, timestamp = "2026-09-27T09:39:00Z", success = true) => ({
  format: 1, runId: id, status: success ? "VERIFIED_CIPHERTEXT_RUN" : "FAILED", mode: "Manual",
  reason: success ? "FULL_READBACK_AND_RECEIPT_VERIFIED" : "UPLOAD_FAILED", checkedAtUtc: timestamp,
  backupStarted: true, transferStarted: true, deletionStarted: false, scheduledTaskEnabled: false,
  achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED", recipientFingerprint: "a".repeat(64),
});
const receipt = (remoteId: string, captured = "2026-09-27T09:40:00Z", verified = "2026-09-27T09:41:00Z") => ({
  format: 1, runId: remoteId, status: "VERIFIED_CIPHERTEXT_ONLY", recipientFingerprint: "a".repeat(64),
  createdAtUtc: captured, verifiedAtUtc: verified, offHost: "NOT_VERIFIED", achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED",
  objects: ["database.dump.age", "object-storage.tar.gz.age", "manifest.json.age"].map((file) => ({
    file, key: `private/iere/${remoteId}/${file}`, bytes: 1024, sha256: "b".repeat(64),
  })),
});
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "iere-operations-report-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function success(root: string, index = 1, captured?: string, verified?: string, started?: string) {
  const id = hostId(index), directory = join(root, `run-${id}`, "encrypted");
  await mkdir(directory, { recursive: true });
  const receiptFile = join(directory, "receipt.json"), raw = JSON.stringify(receipt(hostId(index + 100), captured, verified));
  await writeFile(receiptFile, raw);
  await writeFile(join(root, `run-${id}`, "result.json"), JSON.stringify(result(id, started)));
  await writeFile(join(root, "last-success.json"), JSON.stringify({ format: 1, runId: id, receiptFile,
    receiptSha256: sha(raw), verifiedAtUtc: verified ?? "2026-09-27T09:41:00Z" }));
  return receiptFile;
}
const report = (stateDirectory: string, options = {}) => reportBackupOperations({ stateDirectory, policy, targets, now, ...options });

test("empty state is actionable, never silently healthy or protected", () => fixture(async (root) => {
  const value = await report(root);
  expect(value.status).toBe("ATTENTION_REQUIRED");
  expect(value.alerts).toEqual(["NO_VERIFIED_RECEIPT"]);
  expect(value.cadence.status).toBe("INSUFFICIENT_SAMPLES");
  expect(value.schedulerStatus).toBe("NOT_INSPECTED");
  expect(value.achievedRpo).toBe("NOT_VERIFIED");
  expect(value.achievedRto).toBe("NOT_VERIFIED");
  expect(value.networkCalls).toBe(0);
  expect(value.stateMutated).toBe(false);
  expect(value.deletionAuthorized).toBe(false);
}));

test("fresh receipt matches its pointer; read-only report leaves exact bytes unchanged", () => fixture(async (root) => {
  const file = await success(root);
  const original = await readFile(file), pointer = await readFile(join(root, "last-success.json"));
  const value = await report(root);
  expect(value.status).toBe("PASS_SCOPED_METADATA");
  expect(value.pointerStatus).toBe("MATCHES_LATEST_RECORDED_RECEIPT");
  expect(value.latestCaptureWindowAgeSeconds).toBe(1200);
  expect(value.cadence.status).toBe("INSUFFICIENT_SAMPLES");
  expect(value.retention.enforcedRetention).toBe("NOT_VERIFIED");
  expect(await readFile(file)).toEqual(original);
  expect(await readFile(join(root, "last-success.json"))).toEqual(pointer);
}));

test("bounded metadata reader accepts Windows UTF8 BOM without rewriting", () => fixture(async (root) => {
  await success(root);
  const file = join(root, `run-${hostId(1)}`, "result.json");
  await writeFile(file, `\uFEFF${JSON.stringify(result(hostId(1)))}`);
  expect((await report(root)).status).toBe("PASS_SCOPED_METADATA");
  expect((await readFile(file, "utf8")).startsWith("\uFEFF")).toBe(true);
}));

test("capture age, not recent verification, drives exact RPO boundary and cadence alerts", () => fixture(async (root) => {
  await success(root, 1, "2026-09-27T09:00:00Z", "2026-09-27T09:59:00Z", "2026-09-27T08:59:00Z");
  const boundary = await report(root);
  expect(boundary.alerts).toEqual(["RECEIPT_CADENCE_OVERDUE"]);
  expect((await report(root, { now: now + 1 })).alerts).toContain("STALE_CAPTURE_WINDOW");
  expect(boundary.achievedRpo).toBe("NOT_VERIFIED");
}));

test("recorded gaps and 30-day eligibility never authorize deletion", () => fixture(async (root) => {
  await success(root, 1, "2026-08-28T10:00:00Z", "2026-08-28T10:01:00Z", "2026-08-28T09:59:00Z");
  await success(root, 2);
  const value = await report(root);
  expect(value.cadence.status).toBe("RECORDED_GAPS");
  expect(value.cadence.gaps).toHaveLength(1);
  expect(value.alerts).toContain("RECORDED_CADENCE_GAPS");
  expect(value.retention.dueCount).toBe(1);
  expect(value.runs[0].retentionAction).toBe("REVIEW_ONLY_NO_DELETION");
  expect(value.retention.deletionAuthorized).toBe(false);
}));

test("exact 30-minute intervals are scoped samples, not continuous protection", () => fixture(async (root) => {
  await success(root, 1, "2026-09-27T09:10:00Z", "2026-09-27T09:11:00Z", "2026-09-27T09:09:00Z");
  await success(root, 2);
  const value = await report(root);
  expect(value.status).toBe("PASS_SCOPED_METADATA");
  expect(value.cadence.status).toBe("PASS_SCOPED_RECORDED_INTERVALS");
  expect(value.cadence.continuousProtection).toBe("NOT_VERIFIED");
}));

test("historical failures remain visible, newer failures alert without moving success pointer", () => fixture(async (root) => {
  await success(root);
  for (const [index, timestamp] of [[2, "2026-09-27T09:00:00Z"], [3, "2026-09-27T09:50:00Z"]] as const) {
    const directory = join(root, `run-${hostId(index)}`);
    await mkdir(directory);
    await writeFile(join(directory, "result.json"), JSON.stringify(result(hostId(index), timestamp, false)));
  }
  const value = await report(root);
  expect(value.counts.failedAttempts).toBe(2);
  expect(value.counts.unresolvedFailures).toBe(1);
  expect(value.alerts).toContain("UNRESOLVED_FAILED_ATTEMPTS");
  expect(value.pointerStatus).toBe("MATCHES_LATEST_RECORDED_RECEIPT");
}));

test("missing result is explicitly incomplete OR active, never fabricated failure", () => fixture(async (root) => {
  await success(root);
  await mkdir(join(root, `run-${hostId(2)}`));
  const value = await report(root);
  expect(value.counts.failedAttempts).toBe(0);
  expect(value.anomalies).toEqual([{ runId: hostId(2), code: "INCOMPLETE_OR_ACTIVE_ATTEMPT" }]);
}));

test("receipt mutation, pointer traversal and stale pointers are not trusted", () => fixture(async (root) => {
  const file = await success(root);
  const raw = await readFile(file, "utf8");
  await writeFile(file, raw + " ");
  expect((await report(root)).anomalies).toContainEqual({ code: "MISSING_OR_INVALID_SUCCESS_POINTER" });
  await writeFile(join(root, "last-success.json"), JSON.stringify({ format: 1, runId: hostId(1),
    receiptFile: join(root, "..", "never-read-private-file"), receiptSha256: sha(raw + " "), verifiedAtUtc: "2026-09-27T09:41:00Z" }));
  expect((await report(root)).status).toBe("ATTENTION_REQUIRED");
}));

test("synthetic scope, malformed object paths, dates and success claims fail closed", () => fixture(async (root) => {
  const file = await success(root);
  for (const change of [{ status: "PASS_LOCAL_SYNTHETIC" }, { createdAtUtc: "2026-02-30T09:40:00Z" },
    { verifiedAtUtc: "2026-09-27T10:01:00Z" }, { recipientFingerprint: "c".repeat(64) }, { achievedRpo: "VERIFIED" },
    { objects: receipt(hostId(101)).objects.map((item) => ({ ...item, key: "../private" })) }]) {
    await writeFile(file, JSON.stringify({ ...receipt(hostId(101)), ...change }));
    expect((await report(root)).counts.verifiedReceipts).toBe(0);
  }
}));

test("duplicate remote runs cannot supply independent cadence samples", () => fixture(async (root) => {
  await success(root, 1);
  const second = await success(root, 2);
  await writeFile(second, JSON.stringify(receipt(hostId(101))));
  const value = await report(root);
  expect(value.counts.verifiedReceipts).toBe(1);
  expect(value.counts.anomalies).toBeGreaterThan(0);
}));

test("untrusted errors/metadata never echo secrets, endpoints or filesystem paths", () => fixture(async (root) => {
  await success(root);
  const file = join(root, `run-${hostId(1)}`, "result.json");
  await writeFile(file, JSON.stringify({ ...result(hostId(1)), reason: "SYNTHETIC-PRIVATE-ERROR", secret: "SYNTHETIC-PRIVATE-ERROR" }));
  const text = JSON.stringify(await report(root));
  expect(text).not.toContain("SYNTHETIC-PRIVATE-ERROR");
  expect(text).not.toContain(root);
  expect(text).not.toContain("private/iere");
}));

test("oversized logs and linked state/receipts are rejected; recovery files are ignored", () => fixture(async (root) => {
  const file = await success(root);
  await writeFile(join(root, `run-${hostId(1)}`, "result.json"), "x".repeat(32769));
  expect((await report(root)).counts.anomalies).toBeGreaterThan(0);
  await writeFile(join(root, `run-${hostId(1)}`, "result.json"), JSON.stringify(result(hostId(1))));
  const linked = join(root, "linked-state");
  await symlink(root, linked, "dir");
  await expect(report(linked)).rejects.toThrow();
  await rm(file);
  await symlink(join(root, "last-success.json"), file);
  expect((await report(root)).counts.verifiedReceipts).toBe(0);
  await writeFile(join(root, "recovery-private-key.txt"), "THIS MUST NEVER BE READ");
  expect(JSON.stringify(await report(root))).not.toContain("THIS MUST NEVER BE READ");
}));

test("inventory, policy and command arguments remain bounded and fail closed", () => fixture(async (root) => {
  await success(root, 1); await success(root, 2);
  await expect(report(root, { maxRuns: 1 })).rejects.toThrow("INVENTORY_BOUND_EXCEEDED");
  await expect(report(root, { policy: { ...policy, retentionDays: 1 } })).rejects.toThrow();
  await expect(report(root, { targets: { ...targets, rpoSeconds: 7200 } })).rejects.toThrow();
  await expect(report(root, { now: NaN })).rejects.toThrow();
  for (const args of [[], ["--state-directory", "relative"], ["--state-directory", root, "--delete"], ["--credentials", root]]) {
    await expect(cli(args)).rejects.toThrow();
  }
  const child = spawnSync(process.execPath, ["--no-env-file", resolve("scripts/report-backup-operations.mjs"), "--state-directory", join(root, "absent")], { encoding: "utf8" });
  expect(child.status).toBe(1);
  expect(child.stdout).not.toContain(root);
  expect(child.stderr).toBe("");
}));
