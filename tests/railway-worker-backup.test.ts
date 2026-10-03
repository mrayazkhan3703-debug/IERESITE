import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { access, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { workerBackupConfiguration, startBackupLoop, safeBackupResult, safeBackupFailure } from "../scripts/railway-worker-supervisor.mjs";

const env = () => ({ RAILWAY_BACKUP_MODE: "capture", PATH: "/usr/local/bin:/usr/bin:/bin",
  BACKUP_SOURCE_ID: "railway-main", BACKUP_DATABASE_URL: "postgresql://fixture:fixture@postgres.railway.internal:5432/iere_test",
  BACKUP_DATABASE_TRANSPORT: "railway-private", BACKUP_MEDIA_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  BACKUP_MEDIA_BUCKET: "fixture-media", BACKUP_MEDIA_KEY_PREFIX: "railway-main", BACKUP_MEDIA_ACCESS_KEY_ID: "fixture", BACKUP_MEDIA_SECRET_ACCESS_KEY: "fixture-only",
  BACKUP_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, BACKUP_BUCKET: "fixture-backups", BACKUP_ACCESS_KEY_ID: "fixture", BACKUP_SECRET_ACCESS_KEY: "fixture-only",
  BACKUP_AGE_RECIPIENT: "age1" + "a".repeat(58), BACKUP_MAX_STORED_BYTES: "1073741824" });
const recovery = () => ({ BACKUP_OWNER_KEY_COPY_CONFIRMED: "true", BACKUP_RECOVERY_EVIDENCE: JSON.stringify({ status: "PASS", source: "hosted-postgres-r2", sourceId: "railway-main", syntheticFixture: false,
  cleanup: "PASS", network: "INTERNAL_NO_PUBLISHED_PORTS", outboundJobs: "DISABLED", restoreCompletedAtUtc: new Date().toISOString(),
  databaseChecks: { status: "PASS_DATABASE" }, objectChecks: { status: "PASS_OBJECTS" }, deliveryChecks: { status: "PASS_DELIVERY" } }) });
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
const until = async (check: () => boolean) => { for (let i = 0; i < 100; i++) { if (check()) return; await wait(5); } throw new Error("Fixture did not settle"); };

test("backup stays disabled by default; only explicit validated backup variables reach its child", () => {
  expect(workerBackupConfiguration({}).mode).toBe("off");
  const config = workerBackupConfiguration({ ...env(), INCEPTION_API_KEY: "fixture-provider-secret", AUTH_SECRET: "fixture-session-secret", BACKUP_PRIVATE_AGE_IDENTITY: "fixture-private-identity" });
  const serialized = JSON.stringify(config.childEnv);
  expect(serialized).not.toContain("fixture-provider-secret"); expect(serialized).not.toContain("fixture-session-secret"); expect(serialized).not.toContain("fixture-private-identity");
  expect(config.childEnv?.LD_LIBRARY_PATH).toBe("/opt/iere-postgres/lib");
  expect(() => workerBackupConfiguration({ ...env(), RAILWAY_BACKUP_MODE: "unexpected" })).toThrow("INVALID_BACKUP_MODE");
});

test("scheduled mode retains same-source actual recovery and owner-key gates", () => {
  expect(() => workerBackupConfiguration({ ...env(), RAILWAY_BACKUP_MODE: "scheduled" })).toThrow("RECOVERY_GATE_REQUIRED");
  expect(workerBackupConfiguration({ ...env(), ...recovery(), RAILWAY_BACKUP_MODE: "scheduled" }).mode).toBe("scheduled");
  const bad = { ...recovery(), BACKUP_RECOVERY_EVIDENCE: recovery().BACKUP_RECOVERY_EVIDENCE.replace('"railway-main"', '"supabase-old"') };
  expect(() => workerBackupConfiguration({ ...env(), ...bad, RAILWAY_BACKUP_MODE: "scheduled" })).toThrow();
});

test("blocked backup configuration logs a safe status and never starts a capture", async () => {
  const logs: unknown[] = []; let started = false;
  const loop = startBackupLoop({ env: { ...env(), BACKUP_AGE_RECIPIENT: "private-invalid-fixture" }, spawnChild: () => { started = true; throw new Error(); }, log: (v: unknown) => logs.push(v) });
  expect(loop.status()).toBe("BLOCKED"); expect(started).toBe(false); expect(JSON.stringify(logs)).not.toContain("private-invalid-fixture"); await loop.stop();
});

test("capture runs once, cleans its private temp directory and never passes secrets as arguments", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 123, stdout: new EventEmitter() }); let root = "", calls = 0; const logs: unknown[] = [];
  const loop = startBackupLoop({ env: env(), spawnChild: (_exe: string, args: string[], options: { env: Record<string, string> }) => {
    calls++; expect(args).toEqual(["--no-env-file", "scripts/backup-railway.mjs", "capture"]); root = options.env.TMPDIR;
    void writeFile(join(root, "partial-private-fixture"), "fixture-only").then(() => {
      child.stdout.emit("data", Buffer.from(JSON.stringify({ status: "VERIFIED_CIPHERTEXT_ONLY", runId: "b".repeat(32), sourceId: "railway-main", objectCount: 3,
        backupCreatedAtUtc: new Date().toISOString(), verifiedAtUtc: new Date().toISOString(), staleBeforeCapture: true, previousCaptureAgeSeconds: null, secret: "fixture-only" })));
      child.emit("close", 0, null);
    }); return child;
  }, terminate: () => {}, log: (v: unknown) => logs.push(v), intervalMs: 5 });
  await until(() => loop.status() === "CAPTURE_FINISHED"); expect(calls).toBe(1); await expect(access(root)).rejects.toThrow();
  expect(JSON.stringify(logs)).toContain("VERIFIED_CIPHERTEXT_ONLY"); expect(JSON.stringify(logs)).not.toContain("fixture-only"); await loop.stop();
});

test("scheduled captures never overlap; shutdown bounds children and cleans interrupted plaintext", async () => {
  let calls = 0; const signals: string[] = [], logs: unknown[] = [];
  const child = Object.assign(new EventEmitter(), { pid: 123 });
  const loop = startBackupLoop({ env: { ...env(), ...recovery(), RAILWAY_BACKUP_MODE: "scheduled" }, intervalMs: 10, killGraceMs: 5,
    spawnChild: () => { calls++; return child; }, terminate: (_child: unknown, signal = "SIGTERM") => { signals.push(signal); if (signal === "SIGKILL") child.emit("close", null, "SIGKILL"); }, log: (v: unknown) => logs.push(v) });
  await until(() => calls === 1); await wait(35); expect(calls).toBe(1); expect(JSON.stringify(logs)).toContain("PREVIOUS_CAPTURE_RUNNING");
  await loop.stop(); expect(signals).toContain("SIGTERM"); expect(signals).toContain("SIGKILL"); expect(loop.status()).toBe("STOPPED");
  expect(JSON.stringify(logs)).not.toContain('"event":"backup.completed"'); expect(JSON.stringify(logs)).toContain('"cleanup":"PASS"');
  // stop is idempotent, and never restarts a scheduled child.
  await loop.stop(); await wait(20); expect(calls).toBe(1);
});

test("deadline and spawn failures remain visible without leaking raw child output", async () => {
  const logs: unknown[] = [], child = Object.assign(new EventEmitter(), { pid: 123 });
  const loop = startBackupLoop({ env: env(), deadlineMs: 15, killGraceMs: 5, spawnChild: () => child,
    terminate: (_c: unknown, signal = "SIGTERM") => { if (signal === "SIGKILL") child.emit("close", null, "SIGKILL"); }, log: (v: unknown) => logs.push(v) });
  await until(() => loop.status() === "CAPTURE_FINISHED"); expect(JSON.stringify(logs)).toContain("DEADLINE_EXCEEDED"); await loop.stop();
  const failed = startBackupLoop({ env: env(), spawnChild: () => { throw new Error("fixture-credential-in-raw-error"); }, log: (v: unknown) => logs.push(v) });
  await until(() => failed.status() === "CAPTURE_FINISHED"); expect(JSON.stringify(logs)).toContain("SPAWN_OR_TEMP_FAILED"); expect(JSON.stringify(logs)).not.toContain("fixture-credential-in-raw-error"); await failed.stop();
});

test("backup summaries reject incomplete output and never echo unapproved child fields", () => {
  expect(safeBackupResult("fixture-raw-secret")).toBeNull();
  expect(safeBackupResult(JSON.stringify({ status: "VERIFIED_CIPHERTEXT_ONLY", runId: "fixture-secret" }))).toBeNull();
  expect(safeBackupResult("x".repeat(8193))).toBeNull();
  expect(safeBackupFailure(JSON.stringify({ status: "BACKUP_FAILED", code: "HOSTED_TOOL_FAILED", secret: "fixture-private-key" }))).toBe("HOSTED_TOOL_FAILED");
  expect(safeBackupFailure(JSON.stringify({ status: "BACKUP_FAILED", code: "fixture-private-key" }))).toBe("REDACTED_FAILURE");
});

test.skipIf(process.platform === "win32")("shutdown kills an owned real process group including descendants and removes its temp files", async () => {
  let root = "", descendant = 0;
  const childScript = "import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'}); writeFileSync(process.env.TMPDIR+'/descendant',String(child.pid)); process.on('SIGTERM',()=>{});setInterval(()=>{},1000);";
  const loop = startBackupLoop({ env: env(), killGraceMs: 25, spawnChild: (_exe, _args, options) => { root = options.env.TMPDIR; return spawn(process.execPath, ["--no-env-file", "-e", childScript], { ...options, env: { ...options.env, NODE_ENV: "test" } }); }, log: () => {} });
  try {
    await until(() => Boolean(root));
    for (let i = 0; i < 100; i++) { try { descendant = Number(await readFile(join(root, "descendant"), "utf8")); break; } catch { await wait(5); } }
    expect(descendant).toBeGreaterThan(0);
    await loop.stop(); await expect(access(root)).rejects.toThrow();
    // A killed descendant may briefly remain as a zombie until container PID 1 reaps it;
    // neither a missing process nor a zombie can continue work or write plaintext.
    let running = true;
    try { running = !(await readFile(`/proc/${descendant}/stat`, "utf8")).split(") ")[1].startsWith("Z"); } catch { running = false; }
    expect(running).toBe(false);
  } finally { await loop.stop(); }
});
