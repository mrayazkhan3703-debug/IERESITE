import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function validateRestoreManifest(manifest) {
  if (manifest.format !== 1 || manifest.source !== "local-docker-compose" ||
      !/^sha256:[a-f0-9]{64}$/.test(manifest.images?.seaweedImageId ?? "") ||
      !/^[a-f0-9]{64}$/i.test(manifest.objectStorage?.sha256 ?? "") ||
      manifest.objectStorage.file !== "object-storage.tar.gz") throw new Error("Unsupported object restore manifest");
}

export function validateObjectEvidence(value) {
  if (!Number.isInteger(value.objectCount) || value.objectCount < 1 || value.objectCount > 200 ||
      !Number.isInteger(value.totalBytes) || value.totalBytes < 0 || value.totalBytes > 256 * 1024 * 1024 ||
      !Number.isInteger(value.etagVerified) || value.etagVerified < 0 || value.etagVerified > value.objectCount ||
      !/^[a-f0-9]{64}$/.test(value.inventorySha256 ?? "")) throw new Error("Invalid restored object evidence");
}

async function verify(directory) {
  if (!directory) throw new Error("Pass --backup-directory with an existing completed backup path");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const backup = resolve(directory);
  if (existsSync(resolve(backup, "INCOMPLETE.txt"))) throw new Error("Incomplete backup refused");
  const manifest = JSON.parse(readFileSync(resolve(backup, "manifest.json"), "utf8").replace(/^\uFEFF/, ""));
  validateRestoreManifest(manifest);
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(resolve(backup, "object-storage.tar.gz"))) hash.update(bytes);
  if (hash.digest("hex") !== manifest.objectStorage.sha256.toLowerCase()) throw new Error("Object archive hash mismatch");
  const token = randomUUID().replaceAll("-", "");
  const prefix = `iere-object-read-${token}`;
  const owned = [];
  let stage = "image preflight";
  const docker = (args, allowNonzero = false) => {
    const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    if (result.error || (result.status !== 0 && !allowNonzero)) throw new Error(`Docker failure during ${stage}; no contents or credentials logged`);
    return result.stdout.trim();
  };
  const appImage = docker(["image", "inspect", "-f", "{{.Id}}", "iere-local-monitor-test"]);
  docker(["image", "inspect", "-f", "{{.Id}}", manifest.images.seaweedImageId]);
  const create = (kind, args) => {
    const id = docker(args);
    if (kind !== "volume" && !/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid owned resource ID");
    if (kind === "volume" && id !== `${prefix}-volume`) throw new Error("Invalid owned volume name");
    owned.push({ kind, id }); return id;
  };
  let evidence;
  const cleanupFailures = [];
  try {
    stage = "isolated restore setup";
    const network = create("network", ["network", "create", "--internal", "--label", `iere.fixture=${token}`, prefix]);
    if (docker(["network", "inspect", "-f", "{{.Internal}}", network]) !== "true") throw new Error("Fixture network not internal");
    const volume = create("volume", ["volume", "create", "--label", `iere.fixture=${token}`, `${prefix}-volume`]);
    // Helper has no network route; archive mounted read-only, only disposable volume writable.
    const extract = create("container", ["create", "--label", `iere.fixture=${token}`, "--network", "none", "--user", "root",
      "--mount", `type=bind,source=${backup},target=/backup,readonly`, "--mount", `type=volume,source=${volume},target=/restore`,
      appImage, "tar", "-xzf", "/backup/object-storage.tar.gz", "-C", "/restore"]);
    docker(["start", "-a", extract]);
    if (docker(["inspect", "-f", "{{.State.ExitCode}}", extract]) !== "0") throw new Error("Object archive extraction failed");
    const storage = create("container", ["create", "--label", `iere.fixture=${token}`, "--network", network, "--network-alias", "restored-objects",
      "--mount", `type=volume,source=${volume},target=/data`, "-e", "AWS_ACCESS_KEY_ID=restore_fixture", "-e", "AWS_SECRET_ACCESS_KEY=restore_fixture_only",
      "-e", "S3_BUCKET=iere-local", manifest.images.seaweedImageId, "mini", "-dir=/data"]);
    docker(["start", storage]);
    stage = "restored object server readiness";
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { docker(["exec", storage, "curl", "-fsS", "http://127.0.0.1:8333/healthz"]); ready = true; break; } catch { /* startup only */ }
      await new Promise((done) => setTimeout(done, 200));
    }
    if (!ready) throw new Error("Restored object server readiness failed");
    stage = "bounded S3 object reads";
    const reader = create("container", ["create", "--label", `iere.fixture=${token}`, "--network", network,
      "--mount", `type=bind,source=${resolve(root, "tests/fixtures/restored-object-reads.ts")},target=/app/restored-object-reads.ts,readonly`,
      appImage, "bun", "--no-env-file", "restored-object-reads.ts"]);
    const output = docker(["start", "-a", reader], true);
    if (docker(["inspect", "-f", "{{.State.ExitCode}}", reader]) !== "0") {
      const failure = JSON.parse(output);
      const name = /^[a-z0-9]+$/i.test(failure.errorClass ?? "") ? failure.errorClass : "UnknownFailure";
      throw new Error(`Restored object reads failed (${name}, emptyArchive=${failure.emptyArchive === true}); no keys/contents logged`);
    }
    evidence = JSON.parse(output);
    validateObjectEvidence(evidence);
    if (manifest.syntheticFixture === true && (evidence.objectCount !== manifest.expectedObjects?.objectCount ||
        evidence.totalBytes !== manifest.expectedObjects?.totalBytes || evidence.inventorySha256 !== manifest.expectedObjects?.inventorySha256)) {
      throw new Error("Synthetic restored objects do not match pre-archive source bytes");
    }
  } finally {
    stage = "owned resource cleanup";
    for (const resource of [...owned].reverse()) {
      try {
        const label = docker([resource.kind === "container" ? "inspect" : resource.kind, ...(resource.kind === "container" ? [] : ["inspect"]),
          "-f", resource.kind === "container" ? '{{index .Config.Labels "iere.fixture"}}' : '{{index .Labels "iere.fixture"}}', resource.id]);
        if (label !== token) throw new Error("Ownership mismatch; cleanup refused");
        docker(resource.kind === "container" ? ["rm", "-f", resource.id] : [resource.kind, "rm", resource.id]);
      } catch { cleanupFailures.push(resource.kind); }
    }
  }
  if (cleanupFailures.length) throw new Error("Owned fixture cleanup failed; no working resources removed");
  const report = { status: "PASS", verifiedAt: new Date().toISOString(), archiveSha256: manifest.objectStorage.sha256,
    ...evidence, isolated: true, cleanup: "PASS", syntheticFixture: manifest.syntheticFixture === true,
    scope: "Archive S3 reads; not off-host recovery or approved RPO/RTO" };
  const outputDirectory = resolve(root, "test-results/restored-objects", token);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf("--backup-directory");
  verify(index >= 0 ? process.argv[index + 1] : undefined).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
