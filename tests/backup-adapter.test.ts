import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, symlink, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessReceipt, validateConfig, validateReceipt, plan, parts, PART_BYTES, assertAbsent, uploadMultipart, inspectBackup, cli, newDirectory, loadConfig } from "../scripts/backup-adapter.mjs";

const config = () => ({ format: 1, endpoint: "https://backups.example.invalid", region: "local", bucket: "iere-backups",
  prefix: "private/iere", forcePathStyle: true, recipientFile: "/secrets/recipients.txt", credentialFile: "/secrets/credentials.json" });
const receipt = () => ({ format: 1, runId: "a".repeat(32), status: "VERIFIED_CIPHERTEXT_ONLY", recipientFingerprint: "b".repeat(64),
  createdAtUtc: "2026-09-27T00:00:00Z", verifiedAtUtc: "2026-09-27T00:01:00Z",
  objects: ["database.dump", "object-storage.tar.gz", "manifest.json"].map((file) => ({ file: `${file}.age`,
    key: `private/iere/${"a".repeat(32)}/${file}.age`, bytes: 123, sha256: "c".repeat(64) })) });
async function scratch(task: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "iere-backup-unit-"));
  try { await task(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
test("plan does not read credentials, make network calls, enable tasks or authorize deletion", () => {
  const result = plan(config());
  expect(result.networkCalls).toBe(0); expect(result.scheduledTaskEnabled).toBe(false);
  expect(result.deletionAuthorized).toBe(false); expect(result.destination).toBe("BLOCKED_EXTERNAL");
  expect(result.achievedRpo).toBe("NOT_VERIFIED"); expect(result.achievedRto).toBe("NOT_VERIFIED");
});
test("Windows UTF8-BOM JSON configuration is accepted without changing original bytes", async () => {
  await scratch(async (directory) => {
    const path = join(directory, "windows.json");
    const original = `\uFEFF${JSON.stringify(config())}`;
    await writeFile(path, original);
    expect((await loadConfig(path)).bucket).toBe("iere-backups");
    expect(await readFile(path, "utf8")).toBe(original);
  });
});
test("preflight fails closed without a public recipient and does not generate a key", async () => {
  await scratch(async (directory) => {
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify({ ...config(), recipientFile: join(directory, "missing.txt") }));
    await expect(cli(["preflight", "--config", path])).rejects.toThrow();
  });
});
test("adapter thresholds stay bound to the recorded owner-approved policies", async () => {
  const operations = JSON.parse(await readFile("docs/agent/BACKUP_OPERATIONS_POLICY.json", "utf8"));
  const recovery = JSON.parse(await readFile("docs/agent/RECOVERY_TARGETS.json", "utf8"));
  expect(operations.intervalMinutes).toBe(plan(config()).intervalMinutes);
  expect(operations.retentionDays).toBe(plan(config()).retentionDays);
  expect(recovery.rpoSeconds).toBe(3600); expect(recovery.rtoSeconds).toBe(7200);
});
test("configuration rejects missing values, credential endpoints, insecure live transport and unsafe prefixes", () => {
  for (const patch of [{ bucket: "" }, { prefix: "../escape" }, { endpoint: "https://user:secret@example.invalid" },
    { endpoint: "http://example.invalid" }, { endpoint: "https://example.invalid/?secret=value" }, { recipientFile: "relative" },
    { credentialFile: "relative" }, { forcePathStyle: "true" }, { region: "" }, { format: 2 }]) {
    expect(() => validateConfig({ ...config(), ...patch })).toThrow();
  }
  expect(() => validateConfig(null)).toThrow();
  expect(validateConfig(config()).endpoint).toBe("https://backups.example.invalid/");
});
test("HTTP fixture exception permits only the fixed disposable hostname", () => {
  expect(validateConfig({ ...config(), endpoint: "http://backup-fixture-store:8333" }, true).endpoint).toBe("http://backup-fixture-store:8333/");
  for (const endpoint of ["http://object-storage:8333", "http://127.0.0.1:8333", "https://example.invalid"]) {
    expect(() => validateConfig({ ...config(), endpoint }, true)).toThrow();
  }
});
test("explicit R2 profile accepts the account and documented jurisdiction endpoints with auto region", () => {
  for (const jurisdiction of ["", ".eu", ".fedramp", ".us"]) {
    const selected = validateConfig({ ...config(), provider: "cloudflare-r2", region: "auto",
      endpoint: `https://${"a".repeat(32)}${jurisdiction}.r2.cloudflarestorage.com` });
    expect(selected.provider).toBe("cloudflare-r2"); expect(selected.region).toBe("auto");
  }
});
test("R2 profile rejects aliases, lookalike endpoints, wrong region, port and unsupported provider", () => {
  const selected = { ...config(), provider: "cloudflare-r2", region: "auto", endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com` };
  for (const patch of [{ region: "us-east-1" }, { forcePathStyle: false }, { endpoint: "https://example.invalid" },
    { endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com.example.invalid` },
    { endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com:444` }, { provider: "unknown" }]) {
    expect(() => validateConfig({ ...selected, ...patch })).toThrow();
  }
  expect(() => validateConfig({ ...selected, endpoint: "http://backup-fixture-store:8333" }, true)).toThrow();
});
test("R2 planning records only configuration, not privacy, access, recovery or live success", () => {
  const selected = { ...config(), provider: "cloudflare-r2", region: "auto", endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com` };
  const result = plan(selected);
  expect(result.provider).toBe("cloudflare-r2"); expect(result.networkCalls).toBe(0);
  expect(result.destinationConfiguration).toBe("RECORDED_NOT_LIVE_VERIFIED"); expect(result.destination).toBe("BLOCKED_EXTERNAL");
  expect(result.bucketPrivacy).toBe("NOT_VERIFIED"); expect(result.keyRecovery).toBe("NOT_VERIFIED");
  expect(result.scheduledTaskEnabled).toBe(false); expect(result.deletionAuthorized).toBe(false);
});
test("receipts constrain every object to the run prefix and fixed encrypted filenames", () => {
  expect(validateReceipt(receipt(), config()).objects.length).toBe(3);
  for (const patch of [{ runId: "../other" }, { status: "PRODUCTION_READY" }, { recipientFingerprint: "bad" },
    { objects: [] }, { verifiedAtUtc: "bad" }]) expect(() => validateReceipt({ ...receipt(), ...patch }, config())).toThrow();
  for (const patch of [{ key: "elsewhere/object" }, { file: "database.dump" }, { bytes: -1 }, { sha256: "bad" }]) {
    const altered = receipt(); Object.assign(altered.objects[0], patch);
    expect(() => validateReceipt(altered, config())).toThrow();
  }
});
test("retention and stale reports never authorize deletion or claim achieved recovery", () => {
  const result = assessReceipt(receipt(), config(), Date.parse("2026-10-28T00:00:00Z"));
  expect(result.status).toBe("STALE_RECEIPT"); expect(result.retentionDue).toBe(true);
  expect(result.deletionAuthorized).toBe(false); expect(result.achievedRpo).toBe("NOT_VERIFIED");
  expect(() => assessReceipt(receipt(), config(), 0)).toThrow();
  expect(assessReceipt(receipt(), config(), Date.parse("2026-09-27T00:10:00Z")).status).toBe("PASS_SCOPED_RECEIPT_AGE");
});
test("receipts require real UTC timestamps and bound the small encrypted manifest", () => {
  for (const value of ["2026", "2026-02-30T00:00:00Z", "2026-09-27T00:00:00+01:00", "not-a-date"]) {
    expect(() => validateReceipt({ ...receipt(), createdAtUtc: value }, config())).toThrow();
  }
  const oversized = receipt(); oversized.objects[2].bytes = 65537;
  expect(() => validateReceipt(oversized, config())).toThrow();
});
test("multipart reader bounds each chunk and preserves bytes across the boundary", async () => {
  await scratch(async (directory) => {
    const data = Buffer.alloc(PART_BYTES + 193, 37); const path = join(directory, "fixture"); await writeFile(path, data);
    const chunks = []; for await (const part of parts(path)) chunks.push(part);
    expect(chunks.map((part) => part.length)).toEqual([PART_BYTES, 193]); expect(Buffer.concat(chunks)).toEqual(data);
  });
});
test("existing remote objects fail closed, while only a real missing key is absent", async () => {
  await expect(assertAbsent({ send: async () => ({ Body: (async function* () { yield Buffer.from("existing"); })() }) }, "bucket", "key")).rejects.toThrow("OBJECT_CONFLICT");
  await expect(assertAbsent({ send: async () => { throw Object.assign(new Error(), { name: "NoSuchKey" }); } }, "bucket", "key")).resolves.toBeUndefined();
  await expect(assertAbsent({ send: async () => { throw Object.assign(new Error(), { $metadata: { httpStatusCode: 403 } }); } }, "bucket", "key")).rejects.toThrow();
});
test("failed multipart upload is aborted without publishing a completion", async () => {
  await scratch(async (directory) => {
    const path = join(directory, "fixture"); await writeFile(path, "synthetic encrypted bytes"); const calls: string[] = [];
    const store = { send: async (command: any) => {
      const name = command.constructor.name; calls.push(name);
      if (name === "GetObjectCommand") throw Object.assign(new Error(), { name: "NoSuchKey" });
      if (name === "CreateMultipartUploadCommand") return { UploadId: "fixture-only" };
      if (name === "UploadPartCommand") throw new Error("injected upload failure");
      return {};
    } };
    await expect(uploadMultipart(store, "bucket", "key", path)).rejects.toThrow();
    expect(calls).toEqual(["GetObjectCommand", "CreateMultipartUploadCommand", "UploadPartCommand", "AbortMultipartUploadCommand"]);
  });
});
test("incomplete backup is rejected before tools or storage access", async () => {
  await scratch(async (directory) => {
    await writeFile(join(directory, "INCOMPLETE.txt"), "synthetic incomplete capture");
    await expect(inspectBackup(directory)).rejects.toThrow("INCOMPLETE_BACKUP");
  });
});
test("backup hash mismatch and synthetic/live scope mismatch fail before archive tooling", async () => {
  await scratch(async (directory) => {
    await writeFile(join(directory, "database.dump"), "synthetic");
    const manifest = { format: 1, source: "local-docker-compose", syntheticFixture: true,
      database: { file: "database.dump", sha256: "0".repeat(64) } };
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    await expect(inspectBackup(directory)).rejects.toThrow("INVALID_BACKUP_SCOPE");
    await expect(inspectBackup(directory, true)).rejects.toThrow("ARCHIVE_HASH_MISMATCH");
  });
});
test("CLI requires explicit configuration and rejects duplicate/unknown flags", async () => {
  await expect(cli(["plan"])).rejects.toThrow("CONFIG_REQUIRED");
  await expect(cli(["plan", "--config", "a", "--config", "b"])).rejects.toThrow("INVALID_ARGUMENTS");
  await expect(cli(["plan", "--env", "credentials"])).rejects.toThrow("INVALID_ARGUMENTS");
  await expect(cli(["plan", "--config"])).rejects.toThrow("INVALID_ARGUMENTS");
});
test("offline CLI plan succeeds without credential or recipient files", async () => {
  await scratch(async (directory) => {
    const path = join(directory, "config.json"); await writeFile(path, JSON.stringify(config()));
    const result = await cli(["plan", "--config", path]);
    if (!result || !("networkCalls" in result)) throw new Error("Offline plan returned an unexpected shape");
    expect(result.status).toBe("PLAN_ONLY"); expect(result.networkCalls).toBe(0);
  });
});
test("new output directory rejects relative, existing and linked parents without changing existing files", async () => {
  await scratch(async (directory) => {
    await writeFile(join(directory, "preserved"), "unchanged");
    await expect(newDirectory("relative")).rejects.toThrow("ABSOLUTE_DIRECTORY_REQUIRED");
    await expect(newDirectory(join(process.cwd(), "private-backup"))).rejects.toThrow("OUTPUT_INSIDE_REPOSITORY");
    await expect(newDirectory(directory)).rejects.toThrow();
    await mkdir(join(directory, "parent")); await symlink(join(directory, "parent"), join(directory, "link"));
    await expect(newDirectory(join(directory, "link", "child"))).rejects.toThrow("LINKED_PARENT_DIRECTORY");
    expect(await readFile(join(directory, "preserved"), "utf8")).toBe("unchanged");
  });
});
test("CLI failures are machine readable and redact secret-like arguments and paths", () => {
  const result = spawnSync(process.execPath, ["--no-env-file", "scripts/backup-adapter.mjs", "plan", "--config", "/synthetic-PRIVATE-marker/config.json"], { encoding: "utf8" });
  expect(result.status).toBe(1); expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("PRIVATE-marker"); expect(result.stderr).not.toContain("ENOENT");
  const report = JSON.parse(result.stderr.trim()); expect(report.status).toBe("FAILED");
  expect(report.scheduledTaskEnabled).toBe(false); expect(report.deletionAuthorized).toBe(false);
});
