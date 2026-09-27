import { createHash } from "node:crypto";
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({ endpoint: "http://restored-objects:8333", region: "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: "restore_fixture", secretAccessKey: "restore_fixture_only" }, maxAttempts: 1 });
const bucket = "iere-restore-synthetic";
await client.send(new CreateBucketCommand({ Bucket: bucket }));
const objects = [
  { key: "private/imports/synthetic.csv", bytes: Buffer.from("id,description\nfixture,not-real-property-data\n") },
  { key: "public/media/synthetic.bin", bytes: Buffer.from(Array.from({ length: 256 }, (_, i) => i)) },
];
const inventory = createHash("sha256");
for (const object of objects) {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: object.key, Body: object.bytes, ContentType: "application/octet-stream" }));
  inventory.update(JSON.stringify([bucket, object.key, object.bytes.length, createHash("sha256").update(object.bytes).digest("hex")]));
}
console.log(JSON.stringify({ objectCount: objects.length, totalBytes: objects.reduce((sum, o) => sum + o.bytes.length, 0),
  inventorySha256: inventory.digest("hex") }));
