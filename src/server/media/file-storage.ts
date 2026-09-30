import fs from "node:fs/promises";
import path from "node:path";

/** Local adapter stays behind the same delivery route as R2. Never write new uploads to public/. */
export function localMediaPath(key: string): string {
  if (/^local\/media\/[a-f0-9-]+\.[a-z0-9.]+$/i.test(key)) return path.join(process.cwd(), ".data", "media", key.slice("local/media/".length));
  if (/^[a-f0-9-]+\.[a-z0-9.]+$/i.test(key)) return path.join(process.cwd(), "public", "uploads", key);
  throw new Error("Invalid local media key");
}

export async function readLocalMedia(key: string, range?: { start: number; end: number }): Promise<Buffer | null> {
  try {
    const filename = localMediaPath(key);
    if (!range) return await fs.readFile(filename);
    const handle = await fs.open(filename, "r");
    try {
      const buffer = Buffer.alloc(range.end - range.start + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, range.start);
      return buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
