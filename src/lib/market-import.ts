import { z } from "zod";

export const MARKET_FIELDS = ["externalId", "date", "areaName", "communitySlug", "propertyType", "amountAed", "sizeSqft", "bedrooms", "transactionType", "projectName"] as const;
export const marketKindSchema = z.enum(["MARKET_TRANSACTION", "MARKET_RENT"]);
export type MarketKind = z.infer<typeof marketKindSchema>;
export const mappingSchema = z.record(z.string().refine((v) => (MARKET_FIELDS as readonly string[]).includes(v), "Unknown market field."), z.string().trim().min(1).max(120)).refine((m) => ["externalId", "date", "areaName", "propertyType", "amountAed"].every((field) => m[field]), "Map every required field.");
export const marketSourceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  url: z.string().url().max(2000).refine((v) => { try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash; } catch { return false; } }, "Use an HTTPS source URL without credentials or query parameters."),
  notes: z.string().trim().min(10).max(2000), datasetKind: marketKindSchema, mapping: mappingSchema,
  staleAfterDays: z.number().int().min(1).max(365).default(90), isIllustrative: z.boolean().default(true), isActive: z.boolean().default(true),
});
export type MarketSourceInput = z.infer<typeof marketSourceSchema>;
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").refine((s) => { const d = new Date(s); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getTime() <= Date.now(); }, "Use a real date that is not in the future.");
const optionalNumber = z.preprocess((v) => v === "" || v == null ? undefined : v, z.coerce.number().finite().min(1).max(1e8).optional());
export const marketRowSchema = z.object({
  externalId: z.string().trim().min(1).max(160), date: calendarDate,
  areaName: z.string().trim().min(1).max(200), communitySlug: z.string().trim().max(180).optional(),
  propertyType: z.string().trim().min(1).max(40), amountAed: z.coerce.number().finite().min(0.01).max(1e11).refine((v) => Number.isSafeInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < .001, "Use an AED amount with at most two decimal places."),
  sizeSqft: optionalNumber,
  bedrooms: z.preprocess((v) => v === "" || v == null ? undefined : v, z.coerce.number().int().min(0).max(20).optional()),
  transactionType: z.enum(["SALE", "MORTGAGE", "GIFT"]).default("SALE"), projectName: z.string().trim().max(200).optional(),
});
export type MarketRow = z.infer<typeof marketRowSchema>;
export function mapMarketRow(raw: Record<string, unknown>, mapping: Record<string, string>) { return Object.fromEntries(Object.entries(mapping).map(([field, column]) => [field, raw[column]]).filter(([, value]) => value !== "" && value != null)); }
export function marketMinor(amount: number) { return BigInt(Math.round(amount * 100)); }
export function marketSourceConfig(value: string | null): MarketSourceInput | null { try { return marketSourceSchema.parse(JSON.parse(value ?? "null")); } catch { return null; } }
export function marketFreshness(retrievedAt: Date | string | null, staleAfterDays = 90, now = new Date()) {
  if (!retrievedAt) return "UNKNOWN";
  const time = new Date(retrievedAt).getTime();
  return !Number.isFinite(time) ? "UNKNOWN" : now.getTime() - time > staleAfterDays * 86_400_000 ? "STALE" : "CURRENT";
}
