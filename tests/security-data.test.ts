import { expect, test } from "bun:test";
import { readAuditData, redactAuditData, serializeAuditData } from "@/server/audit-data";
import { csvCell } from "@/lib/csv-cell";
import { safeOperationalError } from "@/server/jobs/safe-error";
import { t } from "@/lib/i18n";

test("footer labels data status without making unsupported inventory provenance claims", () => {
  expect(t("footer.dataNotice", "en")).toContain("source details");
  expect(t("footer.dataNotice", "en")).not.toContain("IE Right");
  expect(t("footer.dataNotice", "ar")).toContain("المصدر");
  expect(t("advisor.disclosure", "en")).toContain("demo records are not verified inventory");
  expect(t("advisor.disclosure", "ar")).toContain("التجريبية");
});

test("audit redaction handles nested credentials, case variants and bigint usage", () => {
  const value = { AccessToken: "fixture-secret", nested: { authorization: "fixture-secret", DATABASE_URL: "fixture-secret", passwordHash: "fixture-secret" }, promptTokens: 5, totalTokens: 8n, name: "Safe name" };
  const snapshot = serializeAuditData(value)!;
  expect(snapshot).not.toContain("fixture-secret");
  expect(JSON.parse(snapshot)).toMatchObject({ AccessToken: "[REDACTED]", promptTokens: 5, totalTokens: "8", name: "Safe name" });
  expect(readAuditData(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item))).toEqual(JSON.parse(snapshot));
});
test("oversized and broken legacy snapshots remain readable without partial sensitive text", () => {
  expect(JSON.parse(serializeAuditData({ note: "x".repeat(5000) })!)).toMatchObject({ truncated: true });
  expect(readAuditData('{"broken":"')).toMatchObject({ unavailable: true });
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  expect(redactAuditData(cyclic)).toEqual({ self: "[CIRCULAR]" });
  expect(serializeAuditData(undefined)).toBeNull();
});
test("CSV strings cannot become formulas and preserve punctuation and line breaks", () => {
  expect(csvCell('=HYPERLINK("fixture")')).toBe('"\'=HYPERLINK(""fixture"")"');
  for (const value of ["+SUM(1)", "-1+1", "@SUM(1)", "  =1", "\tname", "\nname"]) expect(csvCell(value)).toStartWith('"\'');
  expect(csvCell('Area, "name"\nnext')).toBe('"Area, ""name""\nnext"');
  expect(csvCell(-12)).toBe("-12"); expect(csvCell(null)).toBe("");
});
test("monitoring suppresses provider credentials, payloads and personal data in errors", () => {
  expect(safeOperationalError("token=fixture-secret customer@example.invalid")).not.toContain("fixture-secret");
  expect(safeOperationalError("customer@example.invalid")).not.toContain("customer@");
  expect(safeOperationalError(null)).toBeNull();
});
