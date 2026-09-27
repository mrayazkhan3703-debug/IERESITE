import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Creates only synthetic objects in owned resources. Never pauses or reads working storage.
const root = fileURLToPath(new URL("../", import.meta.url));
const token = randomUUID().replaceAll("-", "");
const prefix = `iere-object-seed-${token}`;
const directory = resolve(root, "test-results/object-restore-fixture", token);
mkdirSync(directory, { recursive: true });
const owned = [];
const docker = (args) => {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Synthetic object fixture Docker command failed; no contents or credentials logged");
  return result.stdout.trim();
};
const own = (kind, args) => {
  const id = docker(args);
  if (kind !== "volume" && !/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid owned resource ID");
  if (kind === "volume" && id !== `${prefix}-volume`) throw new Error("Invalid owned volume");
  owned.push({ kind, id }); return id;
};
let manifest;
const cleanupFailures = [];
try {
  const image = docker(["image", "inspect", "-f", "{{.Id}}", "iere-local-monitor-test"]);
  const storageImage = docker(["image", "inspect", "-f", "{{.Id}}", "chrislusf/seaweedfs:4.47@sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882"]);
  const network = own("network", ["network", "create", "--internal", "--label", `iere.fixture=${token}`, prefix]);
  if (docker(["network", "inspect", "-f", "{{.Internal}}", network]) !== "true") throw new Error("Fixture network not internal");
  const volume = own("volume", ["volume", "create", "--label", `iere.fixture=${token}`, `${prefix}-volume`]);
  const storage = own("container", ["create", "--label", `iere.fixture=${token}`, "--network", network, "--network-alias", "restored-objects",
    "--mount", `type=volume,source=${volume},target=/data`, "-e", "AWS_ACCESS_KEY_ID=restore_fixture", "-e", "AWS_SECRET_ACCESS_KEY=restore_fixture_only",
    storageImage, "mini", "-dir=/data"]);
  docker(["start", storage]);
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try { docker(["exec", storage, "curl", "-fsS", "http://127.0.0.1:8333/healthz"]); ready = true; break; } catch { /* startup only */ }
    await new Promise((done) => setTimeout(done, 200));
  }
  if (!ready) throw new Error("Synthetic storage readiness failed");
  const seed = own("container", ["create", "--label", `iere.fixture=${token}`, "--network", network,
    "--mount", `type=bind,source=${resolve(root, "tests/fixtures/restored-object-seed.ts")},target=/app/restored-object-seed.ts,readonly`,
    image, "bun", "--no-env-file", "restored-object-seed.ts"]);
  const expected = JSON.parse(docker(["start", "-a", seed]));
  if (docker(["inspect", "-f", "{{.State.ExitCode}}", seed]) !== "0") throw new Error("Synthetic seed failed");
  docker(["stop", "--time", "10", storage]);
  if (docker(["inspect", "-f", "{{.State.ExitCode}}", storage]) !== "0") throw new Error("Synthetic storage did not stop cleanly");
  const archive = own("container", ["create", "--label", `iere.fixture=${token}`, "--network", "none", "--user", "root",
    "--mount", `type=volume,source=${volume},target=/source,readonly`, "--mount", `type=bind,source=${directory},target=/output`,
    image, "tar", "-czf", "/output/object-storage.tar.gz", "-C", "/source", "."]);
  docker(["start", "-a", archive]);
  if (docker(["inspect", "-f", "{{.State.ExitCode}}", archive]) !== "0") throw new Error("Synthetic archive failed");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(resolve(directory, "object-storage.tar.gz"))) hash.update(bytes);
  manifest = { format: 1, source: "local-docker-compose", syntheticFixture: true,
    createdAtUtc: new Date().toISOString(), images: { seaweedImageId: storageImage },
    objectStorage: { file: "object-storage.tar.gz", sha256: hash.digest("hex") }, expectedObjects: expected };
} finally {
  for (const resource of [...owned].reverse()) {
    try {
      const label = docker([resource.kind === "container" ? "inspect" : resource.kind, ...(resource.kind === "container" ? [] : ["inspect"]),
        "-f", resource.kind === "container" ? '{{index .Config.Labels "iere.fixture"}}' : '{{index .Labels "iere.fixture"}}', resource.id]);
      if (label !== token) throw new Error("Ownership mismatch");
      docker(resource.kind === "container" ? ["rm", "-f", resource.id] : [resource.kind, "rm", resource.id]);
    } catch { cleanupFailures.push(resource.kind); }
  }
}
if (cleanupFailures.length) throw new Error("Owned synthetic fixture cleanup failed");
writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
if (process.argv.includes("--verify")) {
  const result = spawnSync(process.execPath, [resolve(root, "scripts/verify-restored-objects.mjs"), "--backup-directory", directory],
    { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Synthetic restored-object verification failed");
  console.log(result.stdout.trim());
} else console.log(JSON.stringify({ status: "CREATED_SYNTHETIC_ONLY", backupDirectory: directory, cleanup: "PASS" }));
