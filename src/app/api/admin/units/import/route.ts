import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { parseCsv } from "@/server/ingestion/csv";
import { applyUnitImport, previewUnitImport, type UnitSourceRow } from "@/server/domain/unit-command";

export const dynamic = "force-dynamic";
const numberValue = z.union([z.number(), z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/)]).transform(Number);
const optionalNumber = z.preprocess((value) => value === "" ? null : value, numberValue.nullable().optional());
const rowSchema = z.object({
  externalId: z.string().trim().min(1).max(160),
  unitNumber: z.preprocess((value) => value === "" ? null : value, z.string().trim().max(100).nullable().optional()),
  unitType: z.string().trim().min(1).max(60),
  bedrooms: numberValue,
  bathrooms: numberValue,
  areaSqft: optionalNumber,
  priceMinor: z.preprocess((value) => value === "" ? null : value, z.union([z.string().regex(/^\d+$/).max(19), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).nullable().optional()).transform((value) => value == null ? null : String(value)),
  currency: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().regex(/^[A-Za-z]{3}$/).default("AED")).transform((value) => value.toUpperCase()),
  availabilityStatus: z.preprocess((value) => value === "" ? undefined : value, z.enum(["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN"]).default("AVAILABLE")),
  floor: optionalNumber.transform((value) => value == null ? null : Number.isInteger(value) ? value : NaN),
  aspect: z.string().trim().max(160).nullable().optional(),
});

const inputSchema = z.object({
  projectId: z.string().min(1).max(100),
  format: z.enum(["csv", "json"]),
  data: z.union([z.string(), z.array(z.unknown())]),
  dryRun: z.boolean().default(true),
}).strict();

export const POST = apiHandler(async (req) => {
  const raw = inputSchema.parse(await jsonBody<unknown>(req));
  const actor = await requirePermission(raw.dryRun ? "import:read" : "import:*");
  let records: unknown[];
  if (raw.format === "csv") {
    if (typeof raw.data !== "string") return NextResponse.json({ error: "CSV imports require a CSV string." }, { status: 400 });
    if (new TextEncoder().encode(raw.data).byteLength > 5 * 1024 * 1024) return NextResponse.json({ error: "Unit CSV is limited to 5 MiB." }, { status: 413 });
    records = await parseCsv(raw.data, 501);
  } else {
    if (!Array.isArray(raw.data)) return NextResponse.json({ error: "JSON imports require an array of records." }, { status: 400 });
    records = raw.data;
  }
  if (!records.length || records.length > 500) return NextResponse.json({ error: "Unit imports are limited to 1–500 records." }, { status: 400 });
  const rows: UnitSourceRow[] = records.map((record) => rowSchema.parse(record));
  const result = raw.dryRun
    ? await previewUnitImport(actor, raw.projectId, rows)
    : await applyUnitImport(actor, raw.projectId, rows, clientIp(req));
  return NextResponse.json(result, { status: raw.dryRun ? 200 : 202 });
});
