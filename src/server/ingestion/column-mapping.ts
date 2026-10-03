import { z } from "zod";
import { INVENTORY_IMPORT_FIELDS } from "@/lib/inventory-import-fields";

export const columnMappingSchema = z.partialRecord(z.enum(INVENTORY_IMPORT_FIELDS), z.string().min(1).max(200)).superRefine((mapping, ctx) => {
  const columns = Object.values(mapping);
  if (!columns.length) ctx.addIssue({ code: "custom", message: "Choose at least one column or use canonical fields." });
  if (new Set(columns).size !== columns.length) ctx.addIssue({ code: "custom", message: "Each source column can map to only one inventory field." });
  if (columns.some(column => !column.trim() || ["__proto__", "prototype", "constructor"].includes(column))) ctx.addIssue({ code: "custom", message: "Unsafe or empty source column." });
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;
export function serializeColumnMapping(mapping?: ColumnMapping | null): string | null {
  if (mapping == null) return null;
  const validated = columnMappingSchema.parse(mapping);
  return JSON.stringify(Object.fromEntries(Object.entries(validated).sort(([a], [b]) => a.localeCompare(b))));
}
export function readColumnMapping(value?: string | null): ColumnMapping | null {
  if (!value) return null;
  if (value.length > 10000) throw new Error("Invalid recorded column mapping");
  return columnMappingSchema.parse(JSON.parse(value));
}
const numbers = new Set(["bedrooms", "bathrooms", "areaSqft", "priceAed", "lat", "lng"]);
export function mapInventoryColumns(raw: Record<string, unknown>, mapping: ColumnMapping): Record<string, unknown> {
  return Object.fromEntries(Object.entries(mapping).map(([field, column]) => {
    let value: unknown = Object.hasOwn(raw, column) ? raw[column] : undefined;
    if (typeof value === "string") {
      value = value.trim();
      if (value === "") value = undefined;
      else if (numbers.has(field) && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value as string)) value = Number(value);
      else if (field === "offPlan") {
        if (/^(true|yes|1)$/i.test(value as string)) value = true;
        else if (/^(false|no|0)$/i.test(value as string)) value = false;
      }
    }
    return [field, value];
  }));
}
