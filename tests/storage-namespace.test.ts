import { expect, test } from "bun:test";
import { namespacedObjectKey } from "@/server/storage/namespace";

test("keeps legacy keys and gives production a separate physical namespace", () => {
  expect(namespacedObjectKey("", "private/imports/file.json")).toBe("private/imports/file.json");
  expect(namespacedObjectKey("railway-main", "media/cover.avif")).toBe("railway-main/media/cover.avif");
});
test("rejects unsafe namespaces and object paths", () => {
  for (const key of ["", "/media/photo", "../photo", "media/../photo", "media\\photo", "media//photo"]) expect(() => namespacedObjectKey("railway-main", key)).toThrow();
  for (const prefix of ["../main", "/main", "main/", "main//media"]) expect(() => namespacedObjectKey(prefix, "media/photo")).toThrow();
});
