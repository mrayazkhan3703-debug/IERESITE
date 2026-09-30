import { describe, expect, test } from "bun:test";
import { marketRowSchema, marketSourceSchema, mapMarketRow, marketMinor, marketFreshness } from "@/lib/market-import";
import { parseMarketFile } from "@/server/ingestion/market-file";
import { parseMarketReportEmbeds } from "@/lib/market-report-embeds";

const mapping = { externalId: "ID", date: "Date", areaName: "Area", propertyType: "Type", amountAed: "Amount" };
describe("bounded market source ingestion", () => {
  test("maps source headers and preserves string record IDs", () => {
    const [row] = parseMarketFile('ID,Date,Area,Type,Amount\n0007,2026-01-15,"Marina, Dubai",APARTMENT,1250000.25', "CSV");
    const parsed = marketRowSchema.parse(mapMarketRow(row, mapping));
    expect(parsed.externalId).toBe("0007"); expect(parsed.areaName).toBe("Marina, Dubai");
    expect(marketMinor(parsed.amountAed)).toBe(125000025n);
    expect(parsed.transactionType).toBe("SALE");
  });
  test("rejects invalid dates, non-positive amounts and duplicate headers", () => {
    const base = { externalId: "one", date: "2026-01-15", areaName: "Fixture", propertyType: "APARTMENT", amountAed: 100 };
    for (const date of ["2026-02-30", "junk", "2099-01-01"]) expect(marketRowSchema.safeParse({ ...base, date }).success).toBe(false);
    for (const amountAed of [0, -1, Infinity]) expect(marketRowSchema.safeParse({ ...base, amountAed }).success).toBe(false);
    expect(() => parseMarketFile("ID,ID\na,b", "CSV")).toThrow();
    expect(() => parseMarketFile(JSON.stringify(Array(501).fill(base)), "JSON")).toThrow();
    expect(() => parseMarketFile("[]", "JSON")).toThrow();
  });
  test("source configuration requires safe provenance and complete known mapping", () => {
    const source = { name: "Synthetic source", url: "https://example.invalid/dataset", notes: "Fixture methodology only", datasetKind: "MARKET_TRANSACTION", mapping };
    expect(marketSourceSchema.parse(source).isIllustrative).toBe(true);
    for (const url of ["http://example.invalid", "https://name:password@example.invalid", "https://example.invalid?token=secret"]) expect(marketSourceSchema.safeParse({ ...source, url }).success).toBe(false);
    expect(marketSourceSchema.safeParse({ ...source, mapping: { ID: "id" } }).success).toBe(false);
    expect(marketFreshness("2026-01-01", 90, new Date("2026-09-30"))).toBe("STALE");
  });
  test("report embeds are constrained and keep Markdown ordering", () => {
    expect(parseMarketReportEmbeds("Intro\n[[market-data:rents:dubai-marina]]\nEnd")).toEqual([{ markdown: "Intro\n" }, { embed: { kind: "rents", community: "dubai-marina" } }, { markdown: "\nEnd" }]);
    for (const body of ["[[market-data:script:alert]]", "[[market-data:rents:https://evil.invalid]]", "[[market-data:rents]]".repeat(4)]) expect(() => parseMarketReportEmbeds(body)).toThrow();
  });
});
