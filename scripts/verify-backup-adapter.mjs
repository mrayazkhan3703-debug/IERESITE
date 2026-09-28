import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// Entirely disposable. No Compose/application environment, database or volumes.
const root = fileURLToPath(new URL("../", import.meta.url));
const token = randomUUID().replaceAll("-", "");
const label = `iere.fixture=${token}`;
const owned = [];
let directory;
const evidence = [];
let volumeBaseline;
function docker(args, input, timeoutMs = 60_000) {
  const result = spawnSync("docker", args, { cwd: root, input, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    let context = "";
    if (args[0] === "start" && args[1] === "-a") {
      try {
        const parsed = JSON.parse(result.stderr.trim().split(/\r?\n/).at(-1));
        if (["seed", "upload", "restore", "wrong-key", "corrupt", "restore-archives", "extract-synthetic-objects"].includes(parsed.stage) &&
            ["INVALID_CONFIG", "INVALID_RECEIPT", "TOOL_FAILED", "REMOTE_HASH_MISMATCH", "INVALID_FILE", "INCOMPLETE_BACKUP", "ARCHIVE_HASH_MISMATCH", "LINKED_PARENT_DIRECTORY", "RECEIPT_SCOPE_MISMATCH", "REDACTED"].includes(parsed.reason)) {
          context = ` (${parsed.stage}: ${parsed.reason})`;
        }
      } catch { /* Never print raw Docker/stderr details. */ }
    }
    throw new Error(`Disposable backup Docker command failed${context}; details redacted`);
  }
  return result.stdout.trim();
}
function own(kind, args) {
  const id = docker(args);
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid owned resource ID");
  owned.push({ kind, id });
  if (kind === "container") {
    const mounts = JSON.parse(docker(["inspect", "-f", "{{json .Mounts}}", id]));
    if (mounts.some((item) => item.Type === "volume")) throw new Error("Unexpected fixture volume allocation");
  }
  return id;
}
async function until(check, name) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { check(); return; } catch { /* owned services' readiness only */ }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Disposable ${name} service readiness failed`);
}
function mount(name, target, readonly = false) {
  const path = resolve(directory, name);
  if (path.includes(",")) throw new Error("Invalid fixture mount path");
  return ["--mount", `type=bind,source=${path},target=${target}${readonly ? ",readonly" : ""}`];
}
let failure;
try {
  volumeBaseline = new Set(docker(["volume", "ls", "--format", "{{.Name}}"]).split(/\r?\n/).filter(Boolean));
  directory = await mkdtemp(resolve(tmpdir(), `iere-backup-${token}-`));
  for (const name of ["input", "public", "credentials", "identities", "payload", "encrypted", "restored"]) {
    await mkdir(resolve(directory, name), { mode: 0o777 });
  }
  const image = docker(["image", "inspect", "-f", "{{.Id}}", "iere-local-backup-tools"]);
  const storageImage = docker(["image", "inspect", "-f", "{{.Id}}", "chrislusf/seaweedfs:4.47@sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882"]);
  const network = own("network", ["network", "create", "--internal", "--label", label, `iere-backup-${token}`]);
  if (docker(["network", "inspect", "-f", "{{.Internal}}", network]) !== "true") throw new Error("Fixture network is not internal");
  const database = own("container", ["create", "--label", label, "--network", network, "--network-alias", "backup-fixture-db",
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,noexec,size=64m", "-e", "POSTGRES_USER=backup_fixture", "-e", "POSTGRES_DB=backup_fixture",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "--user", "0:0", "--entrypoint", "docker-entrypoint.sh", image, "postgres"]);
  const storage = own("container", ["create", "--label", label, "--network", network, "--network-alias", "backup-fixture-store",
    "--tmpfs", "/data:rw,nosuid,noexec,size=256m", "-e", "AWS_ACCESS_KEY_ID=backup_fixture", "-e", "AWS_SECRET_ACCESS_KEY=synthetic_fixture_only",
    storageImage, "mini", "-dir=/data"]);
  docker(["start", database, storage]);
  await until(() => docker(["exec", database, "pg_isready", "-U", "backup_fixture", "-d", "backup_fixture"]), "database");
  await until(() => docker(["exec", storage, "curl", "-fsS", "http://127.0.0.1:8333/healthz"]), "object");
  function job(task) {
    const mounts = task === "seed" ? [
      ...mount("input", "/input"), ...mount("public", "/public"), ...mount("credentials", "/credentials"),
      ...mount("identities", "/identities"), ...mount("payload", "/payload"),
    ] : task === "upload" ? [
      ...mount("input", "/input", true), ...mount("public", "/public", true), ...mount("credentials", "/credentials", true),
      ...mount("encrypted", "/output"),
    ] : [
      ...mount("public", "/public", true), ...mount("credentials", "/credentials", true), ...mount("identities", "/identities", true),
      ...mount("encrypted", "/encrypted", true), ...mount("restored", "/output"), ...mount("payload", "/payload"),
    ];
    const container = own("container", ["create", "--label", label, "--network", network, "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, "--read-only", "--tmpfs", "/tmp:rw,nosuid,noexec,size=32m",
      "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,noexec,size=1m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", ...mounts,
      "--entrypoint", "bun", image, "--no-env-file", "tests/fixtures/backup-adapter-fixture.mjs", task]);
    const output = docker(["start", "-a", container]);
    if (docker(["inspect", "-f", "{{.State.ExitCode}}", container]) !== "0") throw new Error(`Synthetic ${task} failed`);
    const result = JSON.parse(output);
    evidence.push({ task, ...result });
    return result;
  }
  job("seed");
  const uploaded = job("upload");
  if (!uploaded.multipartArchive || !uploaded.uploaderIdentityAbsent) throw new Error("Multipart/identity separation not exercised");
  job("restore"); job("wrong-key"); job("corrupt");
  // Query the recovered archive in a clean synthetic database, not working PostgreSQL.
  const recovered = resolve(directory, "restored/restored/database.dump");
  const restoreContainer = own("container", ["create", "--label", label, "--network", network,
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,noexec,size=1m",
    "--mount", `type=bind,source=${recovered},target=/database.dump,readonly`,
    "--entrypoint", "pg_restore", image, "-h", "backup-fixture-db", "-U", "backup_fixture", "-d", "backup_fixture", "--clean", "--if-exists", "/database.dump"]);
  // pg_restore can exceed the normal one-minute command ceiling on a busy
  // hosted runner even though the disposable restore is still progressing.
  docker(["start", "-a", restoreContainer], undefined, 120_000);
  if (docker(["inspect", "-f", "{{.State.ExitCode}}", restoreContainer]) !== "0") throw new Error("Synthetic recovered database restore failed");
  const restoredRow = docker(["exec", database, "psql", "-U", "backup_fixture", "-d", "backup_fixture", "-Atc", "SELECT count(*) FROM synthetic_checkpoint WHERE id=1 AND label='SYNTHETIC ONLY'"]);
  if (restoredRow !== "1") throw new Error("Recovered synthetic database row missing");
  evidence.push({ task: "database-restore", syntheticRowRead: true });
} catch (error) { failure = error.message; }
finally {
  for (const resource of [...owned].reverse()) {
    try {
      const inspectArgs = resource.kind === "container" ? ["inspect", "-f", '{{index .Config.Labels "iere.fixture"}}', resource.id]
        : ["network", "inspect", "-f", '{{index .Labels "iere.fixture"}}', resource.id];
      if (docker(inspectArgs) !== token) throw new Error("Fixture ownership mismatch");
      docker(resource.kind === "container" ? ["rm", "-f", "-v", resource.id] : ["network", "rm", resource.id]);
    } catch { failure = "Owned fixture cleanup failed"; }
  }
  if (directory) {
    const parent = resolve(tmpdir());
    if (resolve(directory).startsWith(parent + (process.platform === "win32" ? "\\" : "/")) &&
        directory.split(/[\\/]/).at(-1).startsWith(`iere-backup-${token}-`)) {
      await rm(directory, { recursive: true, force: true });
    } else failure = "Fixture directory scope mismatch";
  }
  if (volumeBaseline) {
    const additionalVolumes = docker(["volume", "ls", "--format", "{{.Name}}"]).split(/\r?\n/).filter((name) => name && !volumeBaseline.has(name));
    if (additionalVolumes.length) failure = "New volume allocation requires ownership review; no broad deletion";
    evidence.push({ task: "volume-preservation", newVolumes: additionalVolumes.length, preexistingVolumesPreserved: true });
  }
}
const report = { status: failure ? "FAIL_LOCAL_SYNTHETIC" : "PASS_LOCAL_SYNTHETIC", capturedAtUtc: new Date().toISOString(),
  scope: "Disposable internal-network S3/public-key adapter only; no application data/credentials/off-host proof",
  evidence, cleanup: failure ? "REVIEW_REQUIRED" : "PASS", offHost: "NOT_VERIFIED", achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED" };
await mkdir(resolve(root, "test-results/backup-adapter"), { recursive: true });
await writeFile(resolve(root, "test-results/backup-adapter/integration.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (failure) { console.error(failure); process.exitCode = 1; }
