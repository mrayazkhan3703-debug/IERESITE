import { createHash } from "crypto";

export function hashRagContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
