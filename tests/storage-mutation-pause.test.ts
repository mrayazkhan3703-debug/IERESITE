import { expect, test } from "bun:test";
import { parseConfig } from "@/lib/config";
import { requireStorageWrites, storageWriteDeferral } from "@/server/storage/mutation-policy";
import { HttpError } from "@/server/auth";

test("storage cutover pause defaults off and can be explicitly disabled", () => {
  const base = { DATABASE_URL: "postgresql://fixture:fixture@localhost:5432/iere_test" };
  expect(parseConfig(base).STORAGE_MUTATIONS_PAUSED).toBe(false);
  expect(parseConfig({ ...base, STORAGE_MUTATIONS_PAUSED: "true" }).STORAGE_MUTATIONS_PAUSED).toBe(true);
  expect(parseConfig({ ...base, STORAGE_MUTATIONS_PAUSED: "false" }).STORAGE_MUTATIONS_PAUSED).toBe(false);
  expect(() => requireStorageWrites(false)).not.toThrow();
});

test("paused writes return a specific retryable error", () => {
  try { requireStorageWrites(true); throw new Error("Pause was bypassed"); }
  catch (error) {
    expect(error).toMatchObject({ status: 503, code: "STORAGE_MUTATIONS_PAUSED" });
    expect((error as Error).message).toContain("Keep this form open");
  }
});

test("only an actual storage maintenance error defers durable work", () => {
  expect(storageWriteDeferral(new HttpError(503, "Maintenance", "STORAGE_MUTATIONS_PAUSED")))
    .toMatchObject({ code: "STORAGE_MUTATIONS_PAUSED", retryAfterMs: 30000 });
  for (const error of [new HttpError(503, "Upstream", "UPSTREAM_FAILED"),
    new HttpError(403, "Denied", "STORAGE_MUTATIONS_PAUSED"), new Error("STORAGE_MUTATIONS_PAUSED"),
    { status: 503, code: "STORAGE_MUTATIONS_PAUSED" }, null]) expect(storageWriteDeferral(error)).toBeNull();
});

test("every upload, processing and deletion entry refuses before database or storage access", () => {
  const script = `
    import { storeUpload, processMediaJob } from "@/server/media/pipeline";
    import { deleteUnusedMedia } from "@/server/domain/media-command";
    import { putPrivateObject, putPublicObject, deletePrivateObject, deletePublicObject, getPublicObject, getPrivateObjectStream, signedPrivateObjectUrl } from "@/server/storage/object-store";
    const operations = [
      () => storeUpload(new File([], "empty.jpg")),
      () => processMediaJob("nonexistent"),
      () => deleteUnusedMedia({}, "nonexistent", null),
      () => putPrivateObject({key:"private/file",body:Buffer.alloc(1),contentType:"application/pdf"}),
      () => putPublicObject({key:"public/file",body:Buffer.alloc(1),contentType:"image/jpeg"}),
      () => deletePrivateObject("private/file"), () => deletePublicObject("public/file")
    ];
    for (const operation of operations) {
      try { await operation(); process.exit(2); }
      catch (error) { if(error.code!=="STORAGE_MUTATIONS_PAUSED" || error.status!==503) process.exit(3); }
    }
    for (const read of [() => getPublicObject("public/file"), async () => {for await (const ignored of getPrivateObjectStream("private/file")) {}}, () => signedPrivateObjectUrl("private/file")]) {
      try { await read(); process.exit(4); }
      catch(error) { if(error.code==="STORAGE_MUTATIONS_PAUSED") process.exit(5); }
    }
    console.log("PASS_PAUSED_WRITES_READS_UNCHANGED");
  `;
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], {
    env: { ...process.env, APP_ENV: "development", DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/iere_test", STORAGE_PROVIDER: "local", STORAGE_MUTATIONS_PAUSED: "true", S3_ENDPOINT: "" },
    stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("PASS_PAUSED_WRITES_READS_UNCHANGED");
});
