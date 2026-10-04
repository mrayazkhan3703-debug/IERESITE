"use client";
import * as React from "react";
import { parse } from "csv-parse/browser/esm/sync";
import { INVENTORY_IMPORT_FIELDS, REQUIRED_INVENTORY_IMPORT_FIELDS, canonicalInventoryHeader, type InventoryImportField } from "@/lib/inventory-import-fields";

export type InventoryColumnSelection = Partial<Record<InventoryImportField, string>>;
export function inventoryMappingKey(mapping: InventoryColumnSelection | null): string {
  return mapping ? JSON.stringify(Object.fromEntries(Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b)))) : "canonical";
}
function sourceColumns(source: string, format: "csv" | "json"): string[] {
  if (!source.trim()) return [];
  const json: unknown = format === "json" ? JSON.parse(source) : null;
  if (format === "json" && (!Array.isArray(json) || json.length > 500)) throw new Error("JSON must contain an array of at most 500 inventory records.");
  const columns: string[] = format === "csv"
    ? (parse(source, { bom: true, to: 1, max_record_size: 65536 }) as string[][])[0] ?? []
    : [...new Set((json as unknown[]).flatMap(row => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : []))];
  const trimmed = columns.map(column => column.trim());
  if (trimmed.length > 100 || trimmed.some(column => !column || column.length > 200 || ["__proto__", "constructor", "prototype"].includes(column)) || new Set(trimmed.map(column => column.toLowerCase())).size !== trimmed.length) throw new Error("Use at most 100 distinct, nonempty source columns with names up to 200 characters.");
  return format === "csv" ? trimmed : columns;
}
export function InventoryColumnMapper({ source, format, value, onChange, disabled }: {
  source: string; format: "csv" | "json"; value: InventoryColumnSelection | null;
  onChange: (value: InventoryColumnSelection | null) => void; disabled: boolean;
}) {
  const parsed = React.useMemo(() => { try { return { columns: sourceColumns(source, format), error: "" }; } catch (error) { return { columns: [], error: error instanceof Error ? error.message : "Read the file before mapping columns." }; } }, [source, format]);
  return <fieldset disabled={disabled} className="my-3 rounded-lg border border-border/70 p-3">
    <legend className="px-1 text-sm font-medium">Source column mapping</legend>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value !== null} onChange={event => {
      if (!event.target.checked) { onChange(null); return; }
      const mapping: InventoryColumnSelection = {};
      for (const column of parsed.columns) { const field = canonicalInventoryHeader(column); if (field) mapping[field] = column; }
      onChange(mapping);
    }} />Map company export columns</label>
    <p className="mt-2 text-xs text-muted-foreground">Match your source columns to inventory fields. Unmapped columns are ignored; the original source file stays private and unchanged. Changing the mapping requires a new validation preview.</p>
    {value !== null && <>
      {parsed.error && <p role="alert" className="mt-2 text-sm text-destructive">{parsed.error}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{INVENTORY_IMPORT_FIELDS.map(field => <label key={field} className="space-y-1 text-xs">
        <span className="block">{field}{REQUIRED_INVENTORY_IMPORT_FIELDS.some(required => required === field) ? " (required)" : ""}</span>
        <select aria-label={`Source column for ${field}`} value={value[field] ?? ""} onChange={event => { const next = { ...value }; if (event.target.value) next[field] = event.target.value; else delete next[field]; onChange(next); }} className="w-full rounded-md border border-input bg-background p-2">
          <option value="">Do not import this field</option>
          {parsed.columns.map(column => <option key={column} value={column} disabled={Object.entries(value).some(([other, chosen]) => other !== field && chosen === column)}>{column}</option>)}
        </select>
      </label>)}</div>
    </>}
  </fieldset>;
}
