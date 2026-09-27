import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { verificationKeys, redactR2Failure, verifyConditionalCompletion, verifyConditionalPut,
  cipherReadback, boundedRemoteBody } from "../scripts/r2-backup-verification.mjs";

test("verification keys are isolated from real backup runs", () => {
  expect(verificationKeys({ provider: "cloudflare-r2", prefix: "private/iere" }, "a".repeat(32))).toEqual({
    payload: `private/iere/verification/${"a".repeat(32)}/synthetic-payload.bin.age`,
    receipt: `private/iere/verification/${"a".repeat(32)}/synthetic-receipt.json`,
  });
  for (const runId of ["../escape", "", "A".repeat(32)]) {
    expect(() => verificationKeys({ provider: "cloudflare-r2", prefix: "private/iere" }, runId)).toThrow("INVALID_SYNTHETIC_INPUT");
  }
  expect(() => verificationKeys({ provider: "s3-compatible", prefix: "private/iere" }, "a".repeat(32))).toThrow();
});

test("errors never include provider messages, credentials, URLs, paths or stack traces", () => {
  const error = Object.assign(new Error("secret-bearing provider message"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
  expect(redactR2Failure(error, "upload")).toEqual({ status: "FAIL_SCOPED_R2_SYNTHETIC", stage: "upload",
    reason: "AccessDenied", httpStatus: 403, operationalBackup: "NOT_VERIFIED" });
  expect(redactR2Failure(error, "private-path").stage).toBe("unknown");
  expect(JSON.stringify(redactR2Failure(new Error("secret-bearing message"), "recover"))).not.toContain("secret-bearing");
  expect(redactR2Failure(new Error("CONDITIONAL_COMPLETION_NOT_ENFORCED"), "upload").reason).toBe("CONDITIONAL_COMPLETION_NOT_ENFORCED");
});

test("conditional PUT requires a real precondition rejection; ordinary errors and ignored guards fail", async () => {
  const rejected = { send: async () => { throw Object.assign(new Error("hidden"), { $metadata: { httpStatusCode: 412 } }); } };
  expect(await verifyConditionalPut(rejected, "iere", "owned-synthetic", Buffer.from("ciphertext"))).toBe(true);
  await expect(verifyConditionalPut({ send: async () => ({}) }, "iere", "owned-synthetic", Buffer.from("ciphertext")))
    .rejects.toThrow("CONDITIONAL_PUT_NOT_ENFORCED");
  await expect(verifyConditionalPut({ send: async () => { throw new Error("OTHER_FAILURE"); } }, "iere", "owned-synthetic", Buffer.from("ciphertext")))
    .rejects.toThrow("OTHER_FAILURE");
});

test("conditional multipart checks rejection and aborts only its owned upload on failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iere-r2-unit-"));
  try {
    const path = join(directory, "test.age"); await writeFile(path, "age-encryption.org/v1\nSYNTHETIC");
    for (const completion of ["reject", "ignore", "error"] as const) {
      const calls: string[] = [];
      const store = { send: async (command: { constructor: { name: string }; input: { IfNoneMatch?: string } }) => {
        const name = command.constructor.name; calls.push(name);
        if (name === "CreateMultipartUploadCommand") return { UploadId: "owned-test" };
        if (name === "UploadPartCommand") return { ETag: "protocol-token" };
        if (name === "CompleteMultipartUploadCommand") {
          expect(command.input.IfNoneMatch).toBe("*");
          if (completion === "reject") throw Object.assign(new Error("hidden"), { $metadata: { httpStatusCode: 412 } });
          if (completion === "error") throw new Error("OTHER_FAILURE");
        }
        return {};
      } };
      if (completion === "reject") expect(await verifyConditionalCompletion(store, "iere", "owned-synthetic", path)).toBe(true);
      else await expect(verifyConditionalCompletion(store, "iere", "owned-synthetic", path))
        .rejects.toThrow(completion === "ignore" ? "CONDITIONAL_COMPLETION_NOT_ENFORCED" : "OTHER_FAILURE");
      expect(calls.at(-1)).toBe("AbortMultipartUploadCommand");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("readback checks age header and full hash; plaintext and existing destinations rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iere-r2-readback-"));
  try {
    const encrypted = Buffer.from("age-encryption.org/v1\nSYNTHETIC CIPHER");
    const store = { send: async () => ({ Body: Readable.from([encrypted.subarray(0, 8), encrypted.subarray(8)]) }) };
    const path = join(directory, "readback.age");
    const result = await cipherReadback(store, "iere", "owned", path);
    expect(result.bytes).toBe(encrypted.length); expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(path)).toEqual(encrypted);
    await expect(cipherReadback(store, "iere", "owned", path)).rejects.toThrow();
    await expect(cipherReadback({ send: async () => ({ Body: Readable.from([Buffer.from("plaintext")]) }) }, "iere", "owned", join(directory, "bad.age")))
      .rejects.toThrow("PLAINTEXT_OBJECT");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("receipt downloads are bounded and missing/oversized bodies fail closed", async () => {
  expect((await boundedRemoteBody(Readable.from([Buffer.from("abc"), Buffer.from("def")]), 6)).toString()).toBe("abcdef");
  await expect(boundedRemoteBody(Readable.from([Buffer.alloc(4097)]))).rejects.toThrow("INVALID_RECEIPT");
  await expect(boundedRemoteBody(null)).rejects.toThrow("INVALID_RECEIPT");
});
