import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseScannerReport, reviewedFixture, safeSnapshotPath, sanitizeFinding, scannerImage } from "../scripts/verify-repository-secrets.mjs";

test("secret evidence drops all source/credential/author fields", () => {
  const synthetic = { File: "src/example.ts", RuleID: "generic-api-key", StartLine: 42, Commit: "a".repeat(40),
    Match: "synthetic sensitive excerpt", Secret: "synthetic credential", Email: "synthetic@example.invalid", Description: "private context" };
  expect(sanitizeFinding(synthetic, "working-source")).toEqual({
    scope: "working-source", file: "src/example.ts", rule: "generic-api-key", line: 42, commit: "a".repeat(40),
  });
  expect(JSON.stringify(sanitizeFinding(synthetic, "working-source"))).not.toContain("synthetic");
  expect(scannerImage).toMatch(/@sha256:[a-f0-9]{64}$/);
});

test("snapshot copies cannot escape their explicit root", () => {
  expect(safeSnapshotPath(resolve("scan-fixture-root"), "src/example.ts")).toBe(resolve("scan-fixture-root/src/example.ts"));
  for (const path of ["../private", "src/../../private", "/private", "src/./example", ""]) {
    expect(() => safeSnapshotPath(resolve("scan-fixture-root"), path)).toThrow();
  }
});

test("secret scans fail closed on absent, inconsistent or malformed reports", () => {
  expect(parseScannerReport("[]", 0)).toEqual([]);
  expect(parseScannerReport('[{"RuleID":"synthetic"}]', 1)).toHaveLength(1);
  for (const [report, status] of [
    ["", 0], [" ", 0], ["not-json", 0], ["{}", 0], ["null", 0],
    ["[]", 1], ['[{"RuleID":"synthetic"}]', 0], ["[null]", 1],
    ["[[]]", 1], ["[]", 2], ["[]", null],
  ] as const) {
    expect(() => parseScannerReport(report, status)).toThrow();
  }
});

test("a changed value at the same finding path/line cannot inherit fixture approval", () => {
  const source = "API response = ExamplePublicDTO";
  const finding = { file: "docs/synthetic.md", rule: "generic-api-key", line: 4 };
  const reviews = [{ file: finding.file, rule: finding.rule,
    sourceLineSha256: createHash("sha256").update(source).digest("hex"), classification: "SOURCE_TYPE_REFERENCE" }];
  expect(reviewedFixture(finding, source, reviews)).toEqual(reviews[0]);
  expect(reviewedFixture(finding, "API response = changed synthetic candidate", reviews)).toBeUndefined();
  expect(reviewedFixture({ ...finding, file: "other.md" }, source, reviews)).toBeUndefined();
  expect(reviewedFixture({ ...finding, rule: "other-rule" }, source, reviews)).toBeUndefined();
});
