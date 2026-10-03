import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// Explicit credential files only. Never prints credential values or deletes source objects.
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
for (const name of ["--source", "--destination", "--prefix", "--receipt"]) if (!args.includes(name) || !option(name)) throw new Error(`Missing ${name}`);
const prefix = option("--prefix");
if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw new Error("Invalid namespace");
const source = JSON.parse(await readFile(option("--source"), "utf8"));
const destination = JSON.parse(await readFile(option("--destination"), "utf8"));
function store(config) {
  if (!config.endpoint?.startsWith("https://") || !config.bucket || !config.accessKeyId || !config.secretAccessKey) throw new Error("Invalid explicit storage configuration");
  return new S3Client({ endpoint: config.endpoint, region: config.region ?? "auto", forcePathStyle: true, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
}
const from = store(source), to = store(destination);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const receipt = { format: 1, startedAt: new Date().toISOString(), prefix, copied: args.includes("--copy"), complete: false, objects: [] };
let token, total = 0;
try {
  do {
    const page = await from.send(new ListObjectsV2Command({ Bucket: source.bucket, ContinuationToken: token, MaxKeys: 500 }));
    for (const object of page.Contents ?? []) {
      if (!object.Key || object.Key.startsWith("/") || object.Key.includes("\\") || object.Key.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Unsafe source object key");
      if (receipt.objects.length >= 20000 || (object.Size ?? 0) > 64 * 1024 * 1024 || total + (object.Size ?? 0) > 500 * 1024 * 1024) throw new Error("Migration size bound exceeded");
      const original = await from.send(new GetObjectCommand({ Bucket: source.bucket, Key: object.Key, IfMatch: object.ETag }));
      const bytes = await original.Body?.transformToByteArray();
      if (!bytes || bytes.length !== object.Size) throw new Error("Source object changed or missing");
      total += bytes.length;
      const sha256 = digest(bytes), key = `${prefix}/${object.Key}`;
      if (receipt.copied) {
        let existing;
        try { existing = await to.send(new GetObjectCommand({ Bucket: destination.bucket, Key: key })); }
        catch (error) { if (error?.$metadata?.httpStatusCode !== 404) throw error; }
        if (existing && digest(await existing.Body.transformToByteArray()) !== sha256) throw new Error("Destination conflict: existing object preserved");
        if (!existing) await to.send(new PutObjectCommand({ Bucket: destination.bucket, Key: key, Body: bytes, ContentType: original.ContentType, CacheControl: original.CacheControl, IfNoneMatch: "*" }));
        const readback = await to.send(new GetObjectCommand({ Bucket: destination.bucket, Key: key }));
        if (digest(await readback.Body.transformToByteArray()) !== sha256) throw new Error("Destination verification failed");
      }
      receipt.objects.push({ key: object.Key, destinationKey: key, bytes: bytes.length, sha256, verified: receipt.copied });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  receipt.complete = true;
} finally {
  receipt.finishedAt = new Date().toISOString();
  receipt.totalBytes = total;
  await writeFile(option("--receipt"), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  from.destroy(); to.destroy();
}
console.log(JSON.stringify({ complete: receipt.complete, copied: receipt.copied, objects: receipt.objects.length, bytes: total }));
