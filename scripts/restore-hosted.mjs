// Explicit images and completed archive only. Never imports app env or hosted credentials.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBackupScope } from "./backup-adapter.mjs";

async function restore(directory, configFile) {
  if (!directory || !configFile || !isAbsolute(directory) || !isAbsolute(configFile)) throw new Error("ABSOLUTE_PATHS_REQUIRED");
  if (existsSync(resolve(directory, "INCOMPLETE.txt"))) throw new Error("INCOMPLETE_BACKUP");
  const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8").replace(/^\uFEFF/, ""));
  validateBackupScope(manifest, manifest.syntheticFixture === true);
  if (manifest.source !== "hosted-postgres-r2") throw new Error("HOSTED_SCOPE_REQUIRED");
  const config = JSON.parse(readFileSync(configFile, "utf8").replace(/^\uFEFF/, ""));
  for (const key of ["toolImage", "postgresImage", "storageImage", "appImage"]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(config[key] ?? "")) throw new Error("PINNED_RESTORE_IMAGES_REQUIRED");
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const token = randomUUID().replaceAll("-", ""), prefix = `iere-hosted-restore-${token}`;
  const owned = []; let stage = "PREFLIGHT", report;
  const started = Date.now();
  const docker = (args, timeout = 120000, allowFailure = false) => {
    const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 });
    if (result.error || (result.status !== 0 && !allowFailure)) throw new Error(`${stage}_FAILED`);
    return (result.stdout + (allowFailure ? result.stderr : "")).trim();
  };
  for (const key of ["toolImage", "postgresImage", "storageImage", "appImage"]) docker(["image", "inspect", config[key]]);
  const version = docker(["run", "--rm", "--network", "none", "--entrypoint", "postgres", config.postgresImage, "--version"]);
  const major = Math.floor(Number(manifest.database.serverVersionNum) / 10000);
  if (!Number.isInteger(major) || !new RegExp(`\\b${major}\\.`).test(version)) throw new Error("POSTGRES_MAJOR_MISMATCH");
  const create = (kind, args) => {
    const id = docker(args); owned.push({ kind, id }); return id;
  };
  let network, extractVolume;
  const check = (mode, networkId = "none") => {
    const id = create("container", ["create", "--label", `iere.restore=${token}`, "--network", networkId,
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "1000:1000",
      "--tmpfs", "/tmp:rw,nosuid,noexec,size=64m", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,noexec,size=1m",
      "--mount", `type=bind,source=${directory},target=/backup,readonly`,
      "--mount", `type=bind,source=${resolve(root, "scripts/hosted-restore-checks.mjs")},target=/app/scripts/hosted-restore-checks.mjs,readonly`,
      "--mount", `type=volume,source=${extractVolume},target=/extracted${mode === "prepare" ? "" : ",readonly"}`,
      "--entrypoint", "bun", config.toolImage, "--no-env-file", "scripts/hosted-restore-checks.mjs", mode, "/backup", "/extracted"]);
    const result = JSON.parse(docker(["start", "-a", id], 15 * 60000, true));
    if (docker(["inspect", "-f", "{{.State.ExitCode}}", id]) !== "0" || !result.status?.startsWith("PASS_")) {
      throw new Error(/^[A-Z0-9_]{3,60}$/.test(result.code ?? "") ? result.code : `${stage}_FAILED`);
    }
    return result;
  };
  const ready = async (container, args) => {
    const until = Date.now() + 120000;
    while (Date.now() < until) {
      try { docker(["exec", container, ...args], 5000); return; } catch { await new Promise(done => setTimeout(done, 500)); }
    }
    throw new Error(`${stage}_TIMEOUT`);
  };
  const cleanupFailures = [];
  try {
    stage = "ISOLATED_SETUP";
    network = create("network", ["network", "create", "--internal", "--label", `iere.restore=${token}`, prefix]);
    if (docker(["network", "inspect", "-f", "{{.Internal}}", network]) !== "true") throw new Error("NETWORK_NOT_ISOLATED");
    extractVolume = create("volume", ["volume", "create", "--label", `iere.restore=${token}`, `${prefix}-extract`]);
    const initialize = create("container", ["create", "--label", `iere.restore=${token}`, "--network", "none", "--user", "root",
      "--mount", `type=volume,source=${extractVolume},target=/extracted`, "--entrypoint", "chown", config.toolImage, "1000:1000", "/extracted"]);
    docker(["start", "-a", initialize]);
    stage = "ARCHIVE_VERIFICATION"; const prepared = check("prepare");
    stage = "DATABASE_RESTORE";
    const dbVolume = create("volume", ["volume", "create", "--label", `iere.restore=${token}`, `${prefix}-db`]);
    const database = create("container", ["create", "--label", `iere.restore=${token}`, "--network", network, "--network-alias", "restored-db",
      "--mount", `type=volume,source=${dbVolume},target=/var/lib/postgresql/data`, "--mount", `type=bind,source=${directory},target=/backup,readonly`,
      "-e", "POSTGRES_USER=iere_restore", "-e", "POSTGRES_DB=iere_restore", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", config.postgresImage]);
    docker(["start", database]); await ready(database, ["pg_isready", "-U", "iere_restore", "-d", "iere_restore"]);
    docker(["exec", database, "psql", "-v", "ON_ERROR_STOP=1", "-U", "iere_restore", "-d", "iere_restore", "-c",
      "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;"]);
    // Supabase's public schema is in the dump; extensions need that schema before restoring application tables.
    // Omit only its already-created schema entry. Every other entry must restore successfully.
    const toc = docker(["exec", database, "pg_restore", "--list", "/backup/database.dump"]);
    const schemaRows = toc.split("\n").filter(line => /^\d+; \d+ \d+ SCHEMA - public /.test(line));
    if (schemaRows.length !== 1) throw new Error("PUBLIC_SCHEMA_ENTRY_REQUIRED");
    writeFileSync(resolve(directory, "restore-list.txt"), toc.split("\n").filter(line => !schemaRows.includes(line)).join("\n"), { mode: 0o600 });
    docker(["exec", database, "pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", "--use-list", "/backup/restore-list.txt", "-U", "iere_restore", "-d", "iere_restore", "/backup/database.dump"], 15 * 60000);
    docker(["exec", database, "psql", "-v", "ON_ERROR_STOP=1", "-U", "iere_restore", "-d", "iere_restore", "-c",
      "CREATE ROLE iere_app LOGIN PASSWORD 'restore_fixture_only' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS; GRANT USAGE ON SCHEMA public TO iere_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO iere_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO iere_app;"]);
    const databaseChecks = check("database", network);
    stage = "OBJECT_RESTORE";
    const objectVolume = create("volume", ["volume", "create", "--label", `iere.restore=${token}`, `${prefix}-objects`]);
    const storage = create("container", ["create", "--label", `iere.restore=${token}`, "--network", network, "--network-alias", "restored-objects",
      "--mount", `type=volume,source=${objectVolume},target=/data`, "-e", "AWS_ACCESS_KEY_ID=restore_fixture", "-e", "AWS_SECRET_ACCESS_KEY=restore_fixture_only",
      config.storageImage, "mini", "-dir=/data"]);
    docker(["start", storage]); await ready(storage, ["curl", "-fsS", "http://127.0.0.1:8333/healthz"]);
    const objectChecks = check("objects", network);
    stage = "APPLICATION_DELIVERY";
    const env = { APP_ENV: "development", APP_URL: "http://restored-web:3000", PORT: "3000", HOSTNAME: "0.0.0.0",
      DATABASE_URL: "postgresql://iere_app:restore_fixture_only@restored-db:5432/iere_restore", AI_PROVIDER: "mock", AI_LIVE_ENABLED: "false",
      CRM_PROVIDER: "localdev", CRM_LIVE_ENABLED: "false", CRM_SYNC_DEFERRED: "true", JOB_SCHEDULER_ENABLED: "false", EMAIL_PROVIDER: "localdev",
      STORAGE_PROVIDER: "s3", S3_ENDPOINT: "http://restored-objects:8333", S3_REGION: "us-east-1", S3_BUCKET: "iere-restored",
      S3_ACCESS_KEY_ID: "restore_fixture", S3_SECRET_ACCESS_KEY: "restore_fixture_only", S3_FORCE_PATH_STYLE: "true", AUTH_MFA_REQUIRED: "true" };
    const app = create("container", ["create", "--label", `iere.restore=${token}`, "--network", network, "--network-alias", "restored-web",
      ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]), config.appImage, "bun", ".next/standalone/server.js"]);
    docker(["start", app]); await ready(app, ["bun", "--no-env-file", "-e", "const r=await fetch('http://localhost:3000/api/health');if(!r.ok)process.exit(1)"]);
    const appDatabase = JSON.parse(docker(["exec", app, "bun", "--no-env-file", "-e",
      "const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();try{console.log(JSON.stringify({publicImages:await db.mediaAsset.count({where:{isPrivate:false,mimeType:{startsWith:'image/'}}})}));}finally{await db.$disconnect();}"]));
    if (appDatabase.publicImages < 1) throw new Error("APPLICATION_DATABASE_MEDIA_MISSING");
    const deliveryChecks = check("delivery", network);
    report = { status: "PASS", source: manifest.source, sourceId: manifest.sourceId, syntheticFixture: manifest.syntheticFixture === true,
      backupCreatedAtUtc: manifest.createdAtUtc, restoreStartedAtUtc: new Date(started).toISOString(), restoreCompletedAtUtc: new Date().toISOString(),
      elapsedSeconds: (Date.now() - started) / 1000, durationScope: "Isolated scripted recovery, not incident-to-service RTO",
      achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED", network: "INTERNAL_NO_PUBLISHED_PORTS", outboundJobs: "DISABLED",
      images: config, prepared, databaseChecks, objectChecks, deliveryChecks };
  } finally {
    stage = "OWNED_CLEANUP";
    for (const resource of [...owned].reverse()) {
      try {
        const label = docker([resource.kind === "container" ? "inspect" : resource.kind, ...(resource.kind === "container" ? [] : ["inspect"]), "-f",
          resource.kind === "container" ? '{{index .Config.Labels "iere.restore"}}' : '{{index .Labels "iere.restore"}}', resource.id]);
        if (label !== token) throw new Error("OWNERSHIP_MISMATCH");
        docker(resource.kind === "container" ? ["rm", "-f", resource.id] : [resource.kind, "rm", resource.id]);
      } catch { cleanupFailures.push(resource.kind); }
    }
  }
  if (cleanupFailures.length) throw new Error("OWNED_CLEANUP_FAILED");
  if (!report) throw new Error("RESTORE_NOT_VERIFIED");
  report.cleanup = "PASS";
  writeFileSync(resolve(directory, "restore-drill-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
restore(...process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify({ status: "FAILED", code: /^[A-Z0-9_]{3,60}$/.test(error.message ?? "") ? error.message : "RESTORE_FAILED" })); process.exitCode = 1;
});
