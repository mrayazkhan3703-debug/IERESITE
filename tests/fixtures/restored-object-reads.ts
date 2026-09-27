import { createHash } from "node:crypto";
import { GetObjectCommand, ListBucketsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

// Runs ONLY in a disposable internal network against a restored archive.
// These are synthetic fixture credentials, not inherited working credentials.
async function verify() {
const client = new S3Client({ endpoint: "http://restored-objects:8333", region: "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: "restore_fixture", secretAccessKey: "restore_fixture_only" }, maxAttempts: 1 });
const buckets = await client.send(new ListBucketsCommand({}));
let objectCount = 0;
let totalBytes = 0;
let etagVerified = 0;
const inventory = createHash("sha256");
for (const bucket of [...(buckets.Buckets ?? [])].sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""))) {
  if (!bucket.Name) throw new Error("Restored bucket name missing");
  let continuation: string | undefined;
  do {
    const listing = await client.send(new ListObjectsV2Command({ Bucket: bucket.Name, ContinuationToken: continuation, MaxKeys: 100 }));
    for (const item of listing.Contents ?? []) {
      if (!item.Key || item.Size === undefined || item.Size < 0 || item.Size > 32 * 1024 * 1024) throw new Error("Restored object exceeds verification bounds");
      if (++objectCount > 200 || (totalBytes += item.Size) > 256 * 1024 * 1024) throw new Error("Restored inventory exceeds verification bounds");
      const response = await client.send(new GetObjectCommand({ Bucket: bucket.Name, Key: item.Key }));
      if (!response.Body) throw new Error("Restored object body missing");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.Body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > item.Size) throw new Error("Restored object size mismatch");
        chunks.push(chunk);
      }
      if (size !== item.Size || response.ContentLength !== item.Size) throw new Error("Restored object size mismatch");
      const bytes = Buffer.concat(chunks);
      const etag = response.ETag?.replaceAll('"', "");
      if (etag && /^[a-f0-9]{32}$/i.test(etag)) {
        if (createHash("md5").update(bytes).digest("hex") !== etag.toLowerCase()) throw new Error("Restored object ETag mismatch");
        etagVerified++;
      }
      // Contents and keys never leave this isolated verifier; report aggregate evidence only.
      inventory.update(JSON.stringify([bucket.Name, item.Key, size, createHash("sha256").update(bytes).digest("hex")]));
    }
    if (listing.IsTruncated && !listing.NextContinuationToken) throw new Error("Incomplete restored inventory");
    continuation = listing.IsTruncated ? listing.NextContinuationToken : undefined;
  } while (continuation);
}
if (objectCount === 0) throw new Error("Archive contains no listed S3 objects; object-read gate cannot pass");
console.log(JSON.stringify({ objectCount, totalBytes, etagVerified, inventorySha256: inventory.digest("hex") }));
}

try { await verify(); } catch (error) {
  const name = error instanceof Error && /^[a-z0-9]+$/i.test(error.name) ? error.name : "UnknownFailure";
  const empty = error instanceof Error && error.message.startsWith("Archive contains no listed S3 objects");
  console.log(JSON.stringify({ errorClass: name, emptyArchive: empty }));
  process.exitCode = 1;
}
