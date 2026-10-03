// Optional encrypted capture alongside the existing worker. Never replaces its
// scheduler, exposes a database port, or loads an age identity. Disabled by default.
import { spawn } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { railwayBackupConfiguration, requireRailwayRecovery, SAFE_BACKUP_ERROR_CODES } from "./backup-railway.mjs";

const BACKUP_VARIABLES = ["BACKUP_SOURCE_ID", "BACKUP_DATABASE_URL", "BACKUP_DATABASE_TRANSPORT", "BACKUP_DATABASE_CA",
  "BACKUP_MEDIA_ENDPOINT", "BACKUP_MEDIA_BUCKET", "BACKUP_MEDIA_KEY_PREFIX", "BACKUP_MEDIA_ACCESS_KEY_ID", "BACKUP_MEDIA_SECRET_ACCESS_KEY",
  "BACKUP_ENDPOINT", "BACKUP_BUCKET", "BACKUP_ACCESS_KEY_ID", "BACKUP_SECRET_ACCESS_KEY", "BACKUP_AGE_RECIPIENT", "BACKUP_MAX_STORED_BYTES",
  "BACKUP_OWNER_KEY_COPY_CONFIRMED", "BACKUP_RECOVERY_EVIDENCE"];
export const BACKUP_INTERVAL_MS = 30 * 60000;
export const BACKUP_DEADLINE_MS = 25 * 60000;

export function safeBackupResult(output) {
  try {
    if (output.length > 8192) return null;
    const value = JSON.parse(output);
    if (value.status !== "VERIFIED_CIPHERTEXT_ONLY" || !/^[a-f0-9]{32}$/.test(value.runId ?? "") ||
      !/^[a-z0-9][a-z0-9-]{2,80}$/.test(value.sourceId ?? "") || !Number.isSafeInteger(value.objectCount) || value.objectCount < 0 ||
      !Number.isFinite(Date.parse(value.backupCreatedAtUtc)) || !Number.isFinite(Date.parse(value.verifiedAtUtc)) ||
      typeof value.staleBeforeCapture !== "boolean" || !(value.previousCaptureAgeSeconds === null || Number.isFinite(value.previousCaptureAgeSeconds))) return null;
    return { runId: value.runId, sourceId: value.sourceId, objectCount: value.objectCount, backupCreatedAtUtc: value.backupCreatedAtUtc,
      verifiedAtUtc: value.verifiedAtUtc, staleBeforeCapture: value.staleBeforeCapture, previousCaptureAgeSeconds: value.previousCaptureAgeSeconds };
  } catch { return null; }
}

export function safeBackupFailure(output) {
  try { if (output.length > 8192) return "REDACTED_FAILURE"; const value = JSON.parse(output); return value.status === "BACKUP_FAILED" && SAFE_BACKUP_ERROR_CODES.has(value.code) ? value.code : "REDACTED_FAILURE"; }
  catch { return "REDACTED_FAILURE"; }
}

export function workerBackupConfiguration(env) {
  const mode = env.RAILWAY_BACKUP_MODE ?? "off";
  if (!["off", "capture", "scheduled"].includes(mode)) throw new Error("INVALID_BACKUP_MODE");
  if (mode === "off") return { mode, childEnv: null };
  // A strict allowlist keeps application/provider/session keys out of backup children.
  const childEnv = Object.fromEntries(BACKUP_VARIABLES.filter(key => typeof env[key] === "string").map(key => [key, env[key]]));
  const config = railwayBackupConfiguration(childEnv);
  if (mode === "scheduled") requireRailwayRecovery(childEnv, config.source.sourceId);
  return { mode, childEnv: { ...childEnv, PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LD_LIBRARY_PATH: "/opt/iere-postgres/lib" } };
}

/** Owned detached group includes pg_dump, age and tar descendants on Linux. */
export function terminateOwnedChild(child, signal = "SIGTERM", platform = process.platform) {
  if (!child.pid) return;
  try { if (platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

/**
 * @typedef {{pid?: number, stdout?: import('node:events').EventEmitter | null, stderr?: import('node:events').EventEmitter | null, once: import('node:events').EventEmitter['once']}} BackupChild
 * @param {{env: Record<string, string | undefined>, spawnChild?: (exe: string, args: string[], options: {cwd: string, env: Record<string, string>, stdio: ['ignore', 'pipe', 'pipe'], detached: boolean}) => BackupChild,
 * terminate?: (child: BackupChild, signal?: string) => void, log?: (value: unknown) => void, intervalMs?: number, deadlineMs?: number, killGraceMs?: number}} options
 */
export function startBackupLoop({ env, spawnChild = spawn, terminate = terminateOwnedChild, log = value => console.log(JSON.stringify(value)),
  intervalMs = BACKUP_INTERVAL_MS, deadlineMs = BACKUP_DEADLINE_MS, killGraceMs = 2000 }) {
  let config;
  try { config = workerBackupConfiguration(env); }
  catch { log({ event: "backup.blocked", status: "CONFIGURATION_OR_RECOVERY_GATE_REQUIRED" }); return { stop: async () => {}, status: () => "BLOCKED" }; }
  if (config.mode === "off") return { stop: async () => {}, status: () => "DISABLED" };
  let active = null, timer = null, stopped = false;
  const run = async () => {
    if (stopped) return;
    if (active) { log({ event: "backup.skipped", status: "PREVIOUS_CAPTURE_RUNNING" }); return; }
    let finish;
    const completed = new Promise(done => { finish = done; });
    const state = { child: null, completed, cancelled: false }; active = state;
    let forceTimer, deadline, root, exitCode = null, exitSignal = null, output = "", errorOutput = "";
    const stopChild = () => {
      state.cancelled = true;
      if (!state.child) return;
      try { terminate(state.child, "SIGTERM"); } catch { /* safe summary only */ }
      forceTimer ??= setTimeout(() => { try { terminate(state.child, "SIGKILL"); } catch { /* safe summary only */ } }, killGraceMs);
    };
    state.stop = stopChild;
    try {
      root = await mkdtemp(resolve(tmpdir(), "iere-worker-backup-"));
      if (!stopped && !state.cancelled) {
        const child = spawnChild(process.execPath, ["--no-env-file", "scripts/backup-railway.mjs", config.mode], {
          cwd: resolve(import.meta.dirname, ".."), env: { ...config.childEnv, TMPDIR: root, TMP: root, TEMP: root },
          stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
        });
        state.child = child;
        child.stdout?.on("data", chunk => { if (output.length <= 8192) output += chunk.toString(); });
        child.stderr?.on("data", chunk => { if (errorOutput.length <= 8192) errorOutput += chunk.toString(); });
        log({ event: "backup.started", mode: config.mode, atUtc: new Date().toISOString() });
        deadline = setTimeout(() => { log({ event: "backup.failed", status: "DEADLINE_EXCEEDED" }); stopChild(); }, deadlineMs);
        await new Promise(done => {
          child.once("error", () => done());
          child.once("close", (code, signal) => { exitCode = code; exitSignal = signal; done(); });
        });
      }
    } catch { log({ event: "backup.failed", status: "SPAWN_OR_TEMP_FAILED" }); }
    finally {
      clearTimeout(deadline); clearTimeout(forceTimer);
      // Also terminate descendants left by an unsuccessful pg_dump/age process.
      if (state.child) { try { terminate(state.child, "SIGKILL"); } catch { /* safe summary only */ } }
      let cleanup = "PASS";
      if (root) {
        try {
          const parent = await realpath(tmpdir()), actual = await realpath(root), distance = relative(parent, actual);
          if (distance.startsWith("..") || isAbsolute(distance) || !/^iere-worker-backup-[^/\\]+$/.test(distance)) throw new Error("UNSAFE_TEMP");
          await rm(actual, { recursive: true, force: true });
        } catch { cleanup = "FAILED"; }
      }
      if (active === state) active = null;
      const result = safeBackupResult(output.trim());
      const passed = exitCode === 0 && cleanup === "PASS" && !state.cancelled && result;
      log({ event: passed ? "backup.completed" : "backup.failed", status: passed ? "VERIFIED_CIPHERTEXT_ONLY" : "CHILD_EXIT_RESULT_OR_CLEANUP_FAILED", exitCode, signal: exitSignal, cleanup, ...(passed ? result : { code: safeBackupFailure(errorOutput.trim()) }) });
      finish();
    }
  };
  void run();
  if (config.mode === "scheduled") timer = setInterval(() => { void run(); }, intervalMs);
  return {
    status: () => stopped ? "STOPPED" : active ? "RUNNING" : config.mode === "scheduled" ? "SCHEDULED" : "CAPTURE_FINISHED",
    stop: async () => {
      stopped = true; clearInterval(timer);
      const pending = active;
      if (pending) { pending.stop(); await pending.completed; }
    },
  };
}

export function startRailwayWorker(env = process.env) {
  const workerEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("BACKUP_") && key !== "RAILWAY_BACKUP_MODE"));
  const worker = spawn(process.execPath, ["src/worker.ts"], { cwd: resolve(import.meta.dirname, ".."), env: workerEnv, stdio: "inherit" });
  const backup = startBackupLoop({ env });
  let shuttingDown = false, shutdownTimer;
  const shutdown = () => {
    if (shuttingDown) return; shuttingDown = true;
    void backup.stop(); worker.kill("SIGTERM");
    shutdownTimer = setTimeout(() => { worker.kill("SIGKILL"); }, 60000);
  };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  worker.once("error", () => { console.error('{"event":"worker.failed","status":"SPAWN_FAILED"}'); shutdown(); process.exitCode = 1; });
  worker.once("exit", async (code) => {
    clearTimeout(shutdownTimer); await backup.stop();
    process.off("SIGTERM", shutdown); process.off("SIGINT", shutdown);
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) startRailwayWorker();
