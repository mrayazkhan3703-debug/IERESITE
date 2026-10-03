import { describe, expect, test } from "bun:test";
import { requireReviewedImport, type ImportPreview } from "@/server/ingestion/preview-approval";

const reviewed: ImportPreview = { dryRun: true, status: "DRY_RUN", triggeredBy: "owner@example.invalid", snapshotSha256: "a".repeat(64), inputFormat: "CSV", recordsTotal: 2, recordCursor: 2 };
const input = { email: "owner@example.invalid", sha256: "a".repeat(64), format: "CSV" };

describe("durable import preview approval", () => {
  test("allows the same administrator to commit the complete reviewed file", () => {
    expect(() => requireReviewedImport(reviewed, input)).not.toThrow();
  });
  test("rejects absent, queued, incomplete and non-preview runs", () => {
    for (const preview of [null, { ...reviewed, status: "QUEUED" }, { ...reviewed, recordCursor: 1 }, { ...reviewed, dryRun: false }, { ...reviewed, recordsTotal: 0, recordCursor: 0 }]) {
      expect(() => requireReviewedImport(preview, input)).toThrow("Complete and review validation");
    }
  });
  test("rejects another actor, edited content or a different format", () => {
    for (const changed of [{ ...input, email: "other@example.invalid" }, { ...input, sha256: "b".repeat(64) }, { ...input, format: "JSON" }]) {
      expect(() => requireReviewedImport(reviewed, changed)).toThrow("does not match");
    }
  });
});
