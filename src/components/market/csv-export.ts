"use client";

/**
 * Shared CSV export (U10 §19.4) — client-side generation from the SAME
 * filtered dataset (re-fetches every page of the current filter, capped).
 * Blob + URL.createObjectURL per platform rule; no server round-trip.
 */

import { api, qs } from "@/lib/api-client";
import { events } from "@/lib/analytics-tracker";
import type { MarketResponse, MarketRow } from "./market-types";

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function fetchAllFilteredRows(
  variant: "transactions" | "rents",
  filterQuery: Record<string, string>,
  cap = 600
): Promise<MarketRow[]> {
  const pageSize = 50;
  const rows: MarketRow[] = [];
  let page = 1;
  for (;;) {
    const res = await api.get<MarketResponse>(`/api/market/${variant}${qs({ ...filterQuery, page: String(page), pageSize: String(pageSize) })}`);
    rows.push(...res.rows);
    const totalPages = Math.max(1, Math.ceil((res.total ?? 0) / pageSize));
    if (page >= totalPages || rows.length >= cap) break;
    page += 1;
  }
  return rows.slice(0, cap);
}

export async function exportMarketCsv(
  variant: "transactions" | "rents",
  filterQuery: Record<string, string>
): Promise<{ rows: number } | { error: string }> {
  try {
    const rows = await fetchAllFilteredRows(variant, filterQuery);
    const isTx = variant === "transactions";
    const header = [
      "date",
      "area",
      "property_type",
      isTx ? "registration_type" : "bedrooms",
      isTx ? "amount_aed" : "annual_rent_aed",
      "size_sqft",
      isTx ? "aed_per_sqft" : "",
      "project",
      "source",
      "state",
    ]
      .filter(Boolean)
      .join(",");
    const body = rows
      .map((r) => {
        const date = r.transactionDate ?? r.contractDate ?? "";
        const amountMinor = r.amountMinor ?? r.annualRentMinor ?? "";
        const amountAed = amountMinor ? (Number(amountMinor) / 100).toFixed(0) : "";
        const ppsft = r.pricePerSqftMinor ? (Number(r.pricePerSqftMinor) / 100).toFixed(0) : "";
        return [
          csvEscape(date.slice(0, 10)),
          csvEscape(r.areaName),
          csvEscape(r.propertyType),
          isTx ? csvEscape(r.transactionType ?? "") : csvEscape(r.bedrooms ?? ""),
          csvEscape(amountAed),
          csvEscape(r.sizeSqft ?? ""),
          csvEscape(ppsft),
          csvEscape(r.projectName ?? ""),
          csvEscape(r.source),
          csvEscape(r.state ?? (r.isIllustrative ? "ILLUSTRATIVE" : "")),
        ].join(",");
      })
      .join("\n");

    const csv = `${header}\n${body}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `investment-experts-${variant}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    events.marketExport(variant, rows.length);
    return { rows: rows.length };
  } catch {
    return { error: "export failed" };
  }
}
