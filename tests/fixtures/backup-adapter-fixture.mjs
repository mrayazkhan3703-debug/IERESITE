import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { S3Client, CreateBucketCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { hashFile, uploadExistingBackup, restoreToNewDirectory, loadConfig } from "../../scripts/backup-adapter.mjs";

const task = process.argv[2];
let stage = task;
function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Synthetic fixture subprocess failed; output redacted");
  return result.stdout.trim();
}
function config() {
  return { format: 1, endpoint: "http://backup-fixture-store:8333", region: "local", bucket: "backup-fixture",
    prefix: "synthetic/iere", forcePathStyle: true, recipientFile: "/public/recipients.txt", credentialFile: "/credentials/credentials.json" };
}
async function seed() {
  for (const directory of ["/input", "/public", "/credentials", "/identities", "/payload"]) await mkdir(directory, { recursive: true });
  run("age-keygen", ["-o", "/identities/recovery.agekey"]);
  run("age-keygen", ["-o", "/identities/wrong.agekey"]);
  await writeFile("/public/recipients.txt", run("age-keygen", ["-y", "/identities/recovery.agekey"]) + "\n");
  await writeFile("/credentials/credentials.json", JSON.stringify({ accessKeyId: "backup_fixture", secretAccessKey: "synthetic_fixture_only" }));
  await writeFile("/public/config.json", JSON.stringify(config()));
  run("psql", ["-h", "backup-fixture-db", "-U", "backup_fixture", "-d", "backup_fixture", "-v", "ON_ERROR_STOP=1", "-c",
    "CREATE TABLE synthetic_checkpoint (id integer PRIMARY KEY, label text); INSERT INTO synthetic_checkpoint VALUES (1, 'SYNTHETIC ONLY');"]);
  run("pg_dump", ["-h", "backup-fixture-db", "-U", "backup_fixture", "-d", "backup_fixture", "--format=custom", "--file=/input/database.dump"]);
  await writeFile("/payload/large-synthetic.bin", randomBytes(17 * 1024 ** 2));
  await writeFile("/payload/private-synthetic.txt", "SYNTHETIC ONLY: no property/customer/provider data");
  run("tar", ["-czf", "/input/object-storage.tar.gz", "-C", "/payload", "."]);
  const now = new Date().toISOString();
  await writeFile("/input/manifest.json", JSON.stringify({ format: 1, source: "local-docker-compose", syntheticFixture: true,
    createdAtUtc: now, completedAtUtc: now, database: { file: "database.dump", ...(await hashFile("/input/database.dump")) },
    objectStorage: { file: "object-storage.tar.gz", ...(await hashFile("/input/object-storage.tar.gz")) } }));
  console.log(JSON.stringify({ status: "SYNTHETIC_SEED_ONLY", archiveBytes: (await stat("/input/object-storage.tar.gz")).size }));
}
async function operate() {
  const cfg = await loadConfig("/public/config.json", true);
  const store = new S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true,
    credentials: JSON.parse(await readFile(cfg.credentialFile, "utf8")), requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  try {
    if (task === "upload") {
      // Recovery identities must not even be mounted into the uploader.
      try { await stat("/identities/recovery.agekey"); throw new Error("Uploader has recovery identity"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await store.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
      const receipt = await uploadExistingBackup({ config: cfg, directory: "/input", outputDirectory: "/output/upload", fixture: true, store });
      const inventory = await store.send(new ListObjectsV2Command({ Bucket: cfg.bucket }));
      if (inventory.Contents?.length !== 4 || inventory.Contents.some((item) => !item.Key.endsWith(".age") && !item.Key.endsWith("/receipt.json"))) throw new Error("Plaintext/object inventory failure");
      console.log(JSON.stringify({ status: receipt.status, encryptedObjects: 3, inventoryObjects: 4, uploaderIdentityAbsent: true,
        multipartArchive: receipt.objects[1].bytes > 16 * 1024 ** 2 }));
    } else {
      const receipt = JSON.parse(await readFile("/encrypted/upload/receipt.json", "utf8"));
      if (task === "restore") {
        stage = "restore-archives";
        const result = await restoreToNewDirectory({ config: cfg, receipt, outputDirectory: "/output/restored", identityFile: "/identities/recovery.agekey", fixture: true, store });
        const manifest = JSON.parse(await readFile("/output/restored/manifest.json", "utf8"));
        const restoredDb = await hashFile("/output/restored/database.dump");
        const restoredObjects = await hashFile("/output/restored/object-storage.tar.gz");
        if (restoredDb.sha256 !== manifest.database.sha256 || restoredObjects.sha256 !== manifest.objectStorage.sha256) throw new Error("Byte equality failure");
        stage = "extract-synthetic-objects";
        await mkdir("/payload/recovered", { mode: 0o700 });
        run("tar", ["-xzf", "/output/restored/object-storage.tar.gz", "-C", "/payload/recovered"]);
        if ((await readFile("/payload/recovered/private-synthetic.txt", "utf8")) !== "SYNTHETIC ONLY: no property/customer/provider data") throw new Error("Synthetic object bytes differ");
        console.log(JSON.stringify({ ...result, originalHashEquality: true, syntheticObjectRead: true }));
      } else if (task === "wrong-key") {
        let rejected = false;
        try { await restoreToNewDirectory({ config: cfg, receipt, outputDirectory: "/output/wrong-key", identityFile: "/identities/wrong.agekey", fixture: true, store }); }
        catch { rejected = true; }
        if (!rejected) throw new Error("Wrong identity accepted");
        await stat("/output/wrong-key/INCOMPLETE.txt");
        console.log(JSON.stringify({ status: "PASS_LOCAL_SYNTHETIC", wrongKeyRejected: true, incompleteMarker: true }));
      } else if (task === "corrupt") {
        const item = receipt.objects[0];
        const original = await store.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: item.key }));
        const corrupted = await original.Body.transformToByteArray(); corrupted[corrupted.length - 1] ^= 1;
        await store.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: item.key, Body: corrupted }));
        let rejected = false;
        try { await restoreToNewDirectory({ config: cfg, receipt, outputDirectory: "/output/corrupt", identityFile: "/identities/recovery.agekey", fixture: true, store }); }
        catch { rejected = true; }
        if (!rejected) throw new Error("Corruption accepted");
        await stat("/output/corrupt/INCOMPLETE.txt");
        console.log(JSON.stringify({ status: "PASS_LOCAL_SYNTHETIC", corruptionRejected: true, incompleteMarker: true }));
      } else throw new Error("Unknown fixture task");
    }
  } finally { store.destroy(); }
}
try { if (task === "seed") await seed(); else await operate(); }
catch (error) {
  const allowed = ["INVALID_CONFIG", "INVALID_RECEIPT", "TOOL_FAILED", "REMOTE_HASH_MISMATCH", "INVALID_FILE", "INCOMPLETE_BACKUP", "ARCHIVE_HASH_MISMATCH", "LINKED_PARENT_DIRECTORY", "RECEIPT_SCOPE_MISMATCH"];
  console.error(JSON.stringify({ status: "FAIL_LOCAL_SYNTHETIC", stage, reason: allowed.includes(error.message) ? error.message : "REDACTED" }));
  process.exitCode = 1;
}
