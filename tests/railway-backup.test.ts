import { expect, test } from "bun:test";
import { railwayBackupConfiguration, requireRailwayRecovery, runRailwayBackup, latestRailwayReceipt, publishLatestRailwayReceipt } from "../scripts/backup-railway.mjs";
import { Readable } from "node:stream";
import { assessReceipt } from "../scripts/backup-adapter.mjs";

const env = () => ({ BACKUP_SOURCE_ID: "railway-main", BACKUP_DATABASE_URL: "postgresql://fixture:fixture@postgres.railway.internal:5432/iere_test",
  BACKUP_DATABASE_TRANSPORT: "railway-private", BACKUP_MEDIA_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  BACKUP_MEDIA_BUCKET: "fixture-media", BACKUP_MEDIA_KEY_PREFIX: "railway-main", BACKUP_MEDIA_ACCESS_KEY_ID: "fixture", BACKUP_MEDIA_SECRET_ACCESS_KEY: "fixture-only",
  BACKUP_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, BACKUP_BUCKET: "fixture-backups", BACKUP_ACCESS_KEY_ID: "fixture", BACKUP_SECRET_ACCESS_KEY: "fixture-only",
  BACKUP_AGE_RECIPIENT: "age1" + "a".repeat(58), BACKUP_MAX_STORED_BYTES: "1073741824" });
const evidence = (now = Date.now()) => ({ status: "PASS", source: "hosted-postgres-r2", sourceId: "railway-main", syntheticFixture: false,
  cleanup: "PASS", network: "INTERNAL_NO_PUBLISHED_PORTS", outboundJobs: "DISABLED", restoreCompletedAtUtc: new Date(now).toISOString(),
  databaseChecks: { status: "PASS_DATABASE" }, objectChecks: { status: "PASS_OBJECTS" }, deliveryChecks: { status: "PASS_DELIVERY" } });

test("hosted backup plan uses only a public encryption recipient and performs no network calls", async () => {
  const result = await runRailwayBackup("plan", env());
  if (!("networkCalls" in result) || !("scheduleEnabled" in result)) throw new Error("Plan result required");
  expect(result.status).toBe("PLAN_ONLY"); expect(result.networkCalls).toBe(0); expect(result.scheduleEnabled).toBe(false);
  expect(JSON.stringify(result)).not.toContain("fixture-only");
  expect(railwayBackupConfiguration(env()).destination.prefix).toBe("live-backups/railway-main");
});

test("private identity, missing credentials, unsafe database and shared media/backup bucket are rejected", () => {
  for (const patch of [{ BACKUP_AGE_RECIPIENT: "AGE-SECRET-KEY-fixture" }, { BACKUP_MAX_STORED_BYTES: "" }, { BACKUP_SECRET_ACCESS_KEY: "" },
    { BACKUP_DATABASE_URL: "postgresql://fixture:fixture@public.example.invalid:5432/iere_test" }, { BACKUP_BUCKET: "fixture-media" }]) {
    expect(() => railwayBackupConfiguration({ ...env(), ...patch })).toThrow();
  }
});

test("scheduled backups require actual recovery of this source and the owner key copy", () => {
  const now = Date.now(), pass = evidence(now);
  const approved = { BACKUP_OWNER_KEY_COPY_CONFIRMED: "true", BACKUP_RECOVERY_EVIDENCE: JSON.stringify(pass) };
  expect(() => requireRailwayRecovery(approved, "railway-main", now)).not.toThrow();
  for (const patch of [{ status: "FAILED" }, { sourceId: "supabase-old" }, { syntheticFixture: true }, { outboundJobs: "ENABLED" },
    { databaseChecks: { status: "FAILED" } }, { restoreCompletedAtUtc: new Date(now + 86400000).toISOString() }]) {
    expect(() => requireRailwayRecovery({ ...approved, BACKUP_RECOVERY_EVIDENCE: JSON.stringify({ ...pass, ...patch }) }, "railway-main", now)).toThrow();
  }
  expect(() => requireRailwayRecovery({ ...approved, BACKUP_OWNER_KEY_COPY_CONFIRMED: "false" }, "railway-main", now)).toThrow();
  expect(() => requireRailwayRecovery({ ...approved, BACKUP_RECOVERY_EVIDENCE: JSON.stringify(evidence(now - 30 * 86400000)) }, "railway-main", now)).not.toThrow(); // A completed drill must not expire and silently stop ongoing backups.
});

test("scheduled mode fails before network access when recovery evidence is absent", async () => {
  await expect(runRailwayBackup("scheduled", env())).rejects.toThrow("RECOVERY_GATE_REQUIRED");
});

const receipt = (now = Date.now()) => ({ format: 1, runId: "b".repeat(32), status: "VERIFIED_CIPHERTEXT_ONLY", recipientFingerprint: "a".repeat(64),
  createdAtUtc: new Date(now).toISOString(), verifiedAtUtc: new Date(now).toISOString(), objects: ["database.dump", "object-storage.tar.gz", "manifest.json"].map(file => ({
    file: `${file}.age`, key: `live-backups/railway-main/${"b".repeat(32)}/${file}.age`, bytes: 100, sha256: "a".repeat(64) })) });

test("latest pointer handles missing and stale captures, rejects synthetic or oversized receipts", async () => {
  const config = railwayBackupConfiguration(env()).destination, now = Date.now();
  const store = (value: unknown) => ({ send: async () => ({ Body: Readable.from([Buffer.from(JSON.stringify(value))]), ETag: "fixture-etag" }) });
  const missing = { send: async () => { throw { $metadata: { httpStatusCode: 404 } }; } };
  expect(await latestRailwayReceipt(missing, config)).toBeNull();
  const stale = await latestRailwayReceipt(store(receipt(now - 3600001)), config);
  expect(assessReceipt(stale!.receipt, config, now).status).toBe("STALE_RECEIPT");
  await expect(latestRailwayReceipt(store({ ...receipt(), status: "PASS_LOCAL_SYNTHETIC" }), config)).rejects.toThrow("INVALID_BACKUP_RECEIPT");
  await expect(latestRailwayReceipt(store("x".repeat(33000)), config)).rejects.toThrow();
});

test("latest pointer uses conditional writes, verifies readback, and preserves a newer capture", async () => {
  const config = railwayBackupConfiguration(env()).destination, now = Date.now(), next = receipt(now);
  let stored = receipt(now - 1000), writes = 0;
  const store = { send: async (command: { constructor: { name: string }; input: { Body?: Uint8Array; IfMatch?: string } }) => {
    if (command.constructor.name === "PutObjectCommand") {
      expect(command.input.IfMatch).toBe("fixture-etag"); stored = JSON.parse(Buffer.from(command.input.Body!).toString("utf8")); writes++;
      return {};
    }
    return { Body: Readable.from([Buffer.from(JSON.stringify(stored))]), ETag: "fixture-etag" };
  } };
  expect((await publishLatestRailwayReceipt(store, config, next)).published).toBe(true);
  expect(writes).toBe(1);
  expect((await publishLatestRailwayReceipt(store, config, receipt(now - 2000))).newerCapturePreserved).toBe(true);
  expect(writes).toBe(1);
});

test("a rejected concurrent pointer write fails without replacing the previous receipt", async () => {
  const config = railwayBackupConfiguration(env()).destination;
  const old = receipt(Date.now() - 1000);
  const store = { send: async (command: { constructor: { name: string } }) => {
    if (command.constructor.name === "PutObjectCommand") throw new Error("Conditional write rejected");
    return { Body: Readable.from([Buffer.from(JSON.stringify(old))]), ETag: "fixture-etag" };
  } };
  await expect(publishLatestRailwayReceipt(store, config, receipt())).rejects.toThrow("Conditional write rejected");
  expect((await latestRailwayReceipt(store, config))!.receipt.createdAtUtc).toBe(old.createdAtUtc);
});
