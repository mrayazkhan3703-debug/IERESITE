import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assessBackupMetadata, checkBackupDirectory } from "../scripts/check-backup-evidence.mjs";

const now = Date.parse("2026-09-27T10:00:00Z");
const policy = { format: 1, status: "OWNER_APPROVED_TARGETS_ONLY", approvedOn: "2026-09-26", rpoSeconds: 3600, rtoSeconds: 7200 };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const database = "SYNTHETIC archive bytes; not a PostgreSQL archive";
const objects = "SYNTHETIC archive bytes; not a SeaweedFS archive";
const manifest = () => ({
  format: 1, source: "local-docker-compose", createdAtUtc: "2026-09-27T09:30:00.0000000Z", completedAtUtc: "2026-09-27T09:31:00Z",
  images: { postgresImageId: `sha256:${"a".repeat(64)}`, seaweedImageId: `sha256:${"b".repeat(64)}` },
  database: { file: "database.dump", serverVersionNum: "160010", sha256: digest(database) },
  objectStorage: { file: "object-storage.tar.gz", sha256: digest(objects) },
  approvedRecoveryTargets: { ...policy, achievement: "NOT_VERIFIED_BY_LOCAL_DRILL" },
});

test("age result preserves official targets and never certifies achieved recovery", () => {
  const result = assessBackupMetadata(manifest(), policy, now);
  expect(result.status).toBe("PASS_SCOPED");
  expect(result.captureWindowAgeSeconds).toBe(1800);
  expect(result.completionAgeSeconds).toBe(1740);
  expect(result.targets).toEqual({ rpoSeconds: 3600, rtoSeconds: 7200, approvedOn: "2026-09-26" });
  expect(result.achievedRpo).toBe("NOT_VERIFIED");
  expect(result.achievedRto).toBe("NOT_VERIFIED");
  expect(result.remainingEvidence).toHaveLength(4);
});

test("old capture is stale even if completion is recent; exact boundary is inclusive", () => {
  expect(assessBackupMetadata({ ...manifest(), createdAtUtc: "2026-09-27T08:00:00Z", completedAtUtc: "2026-09-27T09:59:00Z" }, policy, now).status).toBe("FAIL_BACKUP_AGE");
  expect(assessBackupMetadata({ ...manifest(), createdAtUtc: "2026-09-27T09:00:00Z" }, policy, now).withinTargetAge).toBe(true);
  expect(assessBackupMetadata({ ...manifest(), createdAtUtc: "2026-09-27T08:59:59.999Z" }, policy, now).withinTargetAge).toBe(false);
});

test("missing legacy target metadata is explicit; conflicting or achievement claims refused", () => {
  expect(assessBackupMetadata({ ...manifest(), approvedRecoveryTargets: undefined }, policy, now).targetMetadata).toBe("LEGACY_MISSING_TARGET_METADATA");
  for (const change of [{ rpoSeconds: 7200 }, { rtoSeconds: 3600 }, { approvedOn: "2026-09-25" }, { achievement: "VERIFIED" }, { status: "VERIFIED" }]) {
    expect(() => assessBackupMetadata({ ...manifest(), approvedRecoveryTargets: { ...manifest().approvedRecoveryTargets, ...change } }, policy, now)).toThrow();
  }
});

test("invalid targets, dates, clocks and temporal order fail closed", () => {
  for (const change of [{ rpoSeconds: 0 }, { rtoSeconds: 0.5 }, { rpoSeconds: "3600" }, { approvedOn: "2026-02-30" }, { status: "VERIFIED" }]) {
    expect(() => assessBackupMetadata(manifest(), { ...policy, ...change }, now)).toThrow();
  }
  for (const change of [{ completedAtUtc: "2026-09-27T10:01:00Z" }, { createdAtUtc: "2026-09-27T09:32:00Z" },
    { createdAtUtc: "2026-02-30T09:30:00Z" }, { createdAtUtc: "2026-09-27T09:30:00+00:00" }, { createdAtUtc: "yesterday" }]) {
    expect(() => assessBackupMetadata({ ...manifest(), ...change }, policy, now)).toThrow();
  }
  expect(() => assessBackupMetadata(manifest(), policy, NaN)).toThrow();
});

test("scope, image and archive metadata are fixed, not caller-selected paths", () => {
  for (const change of [{ format: 2 }, { source: "production" }, { syntheticFixture: true }, { images: {} },
    { database: { ...manifest().database, file: "../../.env" } }, { objectStorage: { ...manifest().objectStorage, sha256: "invalid" } }]) {
    expect(() => assessBackupMetadata({ ...manifest(), ...change }, policy, now)).toThrow();
  }
});

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "iere-backup-evidence-"));
  try {
    await writeFile(join(directory, "manifest.json"), `\uFEFF${JSON.stringify(manifest())}`);
    await writeFile(join(directory, "database.dump"), database);
    await writeFile(join(directory, "object-storage.tar.gz"), objects);
    await run(directory);
  } finally {
    // Exact directory created by this fixture, never a working backup/volume.
    if (!directory.startsWith(join(tmpdir(), "iere-backup-evidence-"))) throw new Error("Unexpected fixture cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
}

test("read-only integrity check hashes both files without claiming archive format or restore", async () => {
  await fixture(async (directory) => {
    const before = await readFile(join(directory, "manifest.json"), "utf8");
    const result = await checkBackupDirectory(directory, policy, now);
    expect(result.archives.integrity).toBe("SHA256_MATCH");
    expect(result.archives.databaseBytes).toBe(Buffer.byteLength(database));
    expect(result.archiveFormats).toBe("NOT_REVALIDATED");
    expect(result.releaseGate).toBe("OPEN");
    expect(await readFile(join(directory, "manifest.json"), "utf8")).toBe(before);
  });
});

test("corrupt or absent archives fail rather than reporting success", async () => {
  await fixture(async (directory) => {
    await writeFile(join(directory, "database.dump"), "corrupt");
    await expect(checkBackupDirectory(directory, policy, now)).rejects.toThrow("ARCHIVE_HASH_MISMATCH");
    await rm(join(directory, "object-storage.tar.gz"));
    await expect(checkBackupDirectory(directory, policy, now)).rejects.toThrow();
  });
});

test("incomplete marker and oversized/invalid manifest refuse archive verification", async () => {
  await fixture(async (directory) => {
    await writeFile(join(directory, "INCOMPLETE.txt"), "SYNTHETIC failure");
    await expect(checkBackupDirectory(directory, policy, now)).rejects.toThrow("INCOMPLETE_BACKUP");
    await rm(join(directory, "INCOMPLETE.txt"));
    await writeFile(join(directory, "manifest.json"), "x".repeat(32_769));
    await expect(checkBackupDirectory(directory, policy, now)).rejects.toThrow("INVALID_EVIDENCE_FILE");
    await writeFile(join(directory, "manifest.json"), "{invalid");
    await expect(checkBackupDirectory(directory, policy, now)).rejects.toThrow();
  });
});

test("linked archive is refused rather than reading a different target", async () => {
  await fixture(async (directory) => {
    await rm(join(directory, "database.dump"));
    await symlink(join(directory, "object-storage.tar.gz"), join(directory, "database.dump"));
    await expect(checkBackupDirectory(directory, policy, now)).rejects.toThrow("INVALID_EVIDENCE_FILE");
  });
});

test("CLI errors redact exception/manifest contents and stale evidence exits nonzero", async () => {
  await fixture(async (directory) => {
    const script = resolve("scripts/check-backup-evidence.mjs");
    const current = manifest();
    current.createdAtUtc = "2020-01-01T00:00:00Z";
    current.completedAtUtc = "2020-01-01T00:01:00Z";
    await writeFile(join(directory, "manifest.json"), JSON.stringify(current));
    const stale = spawnSync(process.execPath, ["--no-env-file", script, "--backup-directory", directory], { encoding: "utf8" });
    expect(stale.status).toBe(1);
    expect(JSON.parse(stale.stdout).status).toBe("FAIL_BACKUP_AGE");
    expect(stale.stdout).not.toContain(directory);
    await writeFile(join(directory, "manifest.json"), "SYNTHETIC_PRIVATE_MANIFEST_CANARY");
    const invalid = spawnSync(process.execPath, ["--no-env-file", script, "--backup-directory", directory], { encoding: "utf8" });
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).not.toContain("SYNTHETIC_PRIVATE_MANIFEST_CANARY");
    expect(invalid.stderr).not.toContain(directory);
  });
});
