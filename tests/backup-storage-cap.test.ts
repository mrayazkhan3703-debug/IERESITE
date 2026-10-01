import { expect, test } from "bun:test";
import { checkStorageCap } from "../scripts/backup-adapter.mjs";

test("optional cap counts the entire bucket, follows pagination, and never mutates", async () => {
  const requests: string[] = [];
  const store = { send: async (command: { constructor: { name: string } }) => {
    requests.push(command.constructor.name);
    return requests.length === 1 ? { Contents: [{ Size: 20 }], IsTruncated: true, NextContinuationToken: "next" } : { Contents: [{ Size: 30 }] };
  } };
  await checkStorageCap(store, { bucket: "iere", maxStoredBytes: 100 }, 50);
  expect(requests).toEqual(["ListObjectsV2Command", "ListObjectsV2Command"]);
});
test("cap rejects excess storage and invalid or looping listings", async () => {
  await expect(checkStorageCap({ send: async () => ({ Contents: [{ Size: 51 }] }) }, { bucket: "iere", maxStoredBytes: 100 }, 50)).rejects.toThrow("STORAGE_CAP_REACHED");
  await expect(checkStorageCap({ send: async () => ({ Contents: [{ Size: -1 }] }) }, { bucket: "iere", maxStoredBytes: 100 }, 1)).rejects.toThrow("STORAGE_CAP_CHECK_FAILED");
  await expect(checkStorageCap({ send: async () => ({ IsTruncated: true, NextContinuationToken: "repeated" }) }, { bucket: "iere", maxStoredBytes: 100 }, 1)).rejects.toThrow("STORAGE_CAP_CHECK_FAILED");
});
test("legacy configurations retain their existing behavior", async () => {
  let calls = 0;
  await checkStorageCap({ send: async () => { calls++; } }, { bucket: "iere" }, 1);
  expect(calls).toBe(0);
});
