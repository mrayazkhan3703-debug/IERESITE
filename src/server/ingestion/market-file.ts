import { parse } from "csv-parse/sync";
import { HttpError } from "@/server/auth";
export const MARKET_FILE_BYTES = 2 * 1024 * 1024;
export function parseMarketFile(data: string, format: "CSV" | "JSON"): Record<string, unknown>[] {
  if (Buffer.byteLength(data, "utf8") > MARKET_FILE_BYTES) throw new HttpError(413, "Market files are limited to 2 MiB.", "MARKET_FILE_LIMIT");
  let rows: unknown;
  try {
    rows = format === "JSON" ? JSON.parse(data) : parse(data, {
      bom: true, trim: true, skip_empty_lines: true, max_record_size: 16 * 1024,
      columns(headers: string[]) {
        const clean = headers.map((v) => v.trim());
        if (clean.some((v) => !v || v.length > 120 || ["__proto__", "constructor", "prototype"].includes(v)) || new Set(clean).size !== clean.length || clean.length > 40) throw new Error("Invalid headers");
        return clean;
      },
    });
  } catch { throw new HttpError(400, "Invalid file. Use a JSON array or CSV with unique headers and consistent columns.", "MARKET_FILE_INVALID"); }
  if (!Array.isArray(rows) || !rows.length || rows.length > 500 || rows.some((r) => !r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length > 40)) throw new HttpError(400, "Supply 1–500 object records with at most 40 columns.", "MARKET_ROW_LIMIT");
  return rows as Record<string, unknown>[];
}
