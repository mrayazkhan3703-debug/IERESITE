import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig } from "@/lib/config";

function client(endpoint: string): S3Client {
  const config = getConfig();
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 object storage credentials are not configured");
  }
  return new S3Client({
    endpoint,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
}

function storageConfig() {
  const config = getConfig();
  if (config.STORAGE_PROVIDER !== "s3" || !config.S3_ENDPOINT) {
    throw new Error("Object storage requires configured S3-compatible storage");
  }
  return config;
}

export async function putPrivateObject(input: { key: string; body: Buffer; contentType: string }): Promise<void> {
  const config = storageConfig();
  await client(config.S3_ENDPOINT!).send(new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: "private, no-store",
  }));
}

/** Public media is served through an application route, never a public bucket ACL. */
export async function putPublicObject(input: { key: string; body: Buffer; contentType: string }): Promise<void> {
  const config = storageConfig();
  await client(config.S3_ENDPOINT!).send(new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: "public, max-age=3600, stale-while-revalidate=86400",
  }));
}

export async function getPublicObject(key: string, range?: { start: number; end: number }): Promise<Buffer | null> {
  const config = storageConfig();
  try {
    const response = await client(config.S3_ENDPOINT!).send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
    if (!response.Body) return null;
    return Buffer.from(await response.Body.transformToByteArray());
  } catch (error) {
    if (typeof error === "object" && error !== null && "$metadata" in error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
    }
    throw error;
  }
}

/** Private import/source objects are never served through the public media route. */
export async function* getPrivateObjectStream(key: string): AsyncGenerator<Uint8Array> {
  const config = storageConfig();
  const response = await client(config.S3_ENDPOINT!).send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  if (!response.Body) throw new Error("Private object storage returned an empty body");
  const body = response.Body as unknown as AsyncIterable<Uint8Array>;
  for await (const chunk of body) yield new Uint8Array(chunk);
}

export async function deletePublicObject(key: string): Promise<void> {
  const config = storageConfig();
  await client(config.S3_ENDPOINT!).send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}

export async function deletePrivateObject(key: string): Promise<void> {
  const config = storageConfig();
  await client(config.S3_ENDPOINT!).send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}

export async function signedPrivateObjectUrl(key: string, expiresIn = 300): Promise<string> {
  const config = storageConfig();
  const endpoint = config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT!;
  return getSignedUrl(
    client(endpoint),
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    { expiresIn },
  );
}
