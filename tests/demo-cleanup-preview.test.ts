import { expect, test } from "bun:test";
import { cleanupFingerprint, signCleanupPreview, requireCleanupPreview } from "@/server/domain/demo-cleanup-preview";
const key = "synthetic-cleanup-signing-key-only-32";
test("review approval binds administrator, exact versions and expiry", () => {
  const fingerprint = cleanupFingerprint([{ id: "fixture", updatedAt: "version-1" }]);
  const token = signCleanupPreview("owner", fingerprint, key, 1000);
  expect(() => requireCleanupPreview(token, "owner", fingerprint, key, 2000)).not.toThrow();
  expect(() => requireCleanupPreview(token, "other", fingerprint, key, 2000)).toThrow();
  expect(() => requireCleanupPreview(token, "owner", cleanupFingerprint([{ id: "fixture", updatedAt: "version-2" }]), key, 2000)).toThrow();
  expect(() => requireCleanupPreview(token, "owner", fingerprint, key, 601000)).toThrow();
  expect(() => requireCleanupPreview(token + "tampered", "owner", fingerprint, key, 2000)).toThrow();
});
