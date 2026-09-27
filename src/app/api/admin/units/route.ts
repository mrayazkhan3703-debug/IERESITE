import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Admin Units module (V2 §39 "units"): read-only inventory of PropertyUnit
 * rows grouped by project, with project/availability/type/beds filters,
 * pagination and CSV export.
 *
 * Write operations are intentionally disabled — units are managed via the
 * ingestion pipelines (CSV import / seed), consistent with V1 data
 * governance. Read permission mirrors the properties module.
 */
const querySchema = z.object({
  project: z.string().max(200).optional(), // project slug
  availability: z.enum(["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "all"]).default("all"),
  type: z.string().max(40).optional(), // unitType
  beds: z.coerce.number().int().min(0).max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  format: z.enum(["json", "csv"]).default("json"),
});

const CSV_COLUMNS = [
  "unitNumber",
  "project",
  "property",
  "unitType",
  "bedrooms",
  "bathrooms",
  "areaSqft",
  "priceMinor",
  "currency",
  "availabilityStatus",
  "floor",
  "aspect",
] as const;

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET = apiHandler(async (req) => {
  await requirePermission("property:read");
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) raw[k] = v;
  const q = querySchema.parse(raw);

  const projectFilter = q.project
    ? {
        OR: [{ project: { slug: q.project } }, { property: { project: { slug: q.project } } }],
      }
    : {};

  const where = {
    ...projectFilter,
    ...(q.availability !== "all" ? { availabilityStatus: q.availability } : {}),
    ...(q.type ? { unitType: q.type } : {}),
    ...(q.beds !== undefined ? { bedrooms: q.beds } : {}),
  };

  const [total, units, projects] = await Promise.all([
    db.propertyUnit.count({ where }),
    db.propertyUnit.findMany({
      where,
      orderBy: [{ projectId: "asc" }, { unitNumber: "asc" }],
      skip: q.format === "csv" ? 0 : (q.page - 1) * q.pageSize,
      take: q.format === "csv" ? 5000 : q.pageSize,
      include: {
        project: { select: { name: true, slug: true } },
        property: { select: { title: true, slug: true } },
      },
    }),
    db.project.findMany({
      where: { units: { some: {} } },
      select: { id: true, name: true, slug: true, _count: { select: { units: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const rows = units.map((u) => ({
    id: u.id,
    unitNumber: u.unitNumber,
    unitType: u.unitType,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    areaSqft: u.areaSqft,
    priceMinor: u.priceMinor?.toString() ?? null,
    currency: u.currency,
    availabilityStatus: u.availabilityStatus,
    floor: u.floor,
    aspect: u.aspect,
    project: u.project ? { name: u.project.name, slug: u.project.slug } : null,
    property: u.property ? { title: u.property.title, slug: u.property.slug } : null,
    updatedAt: u.updatedAt.toISOString(),
  }));

  if (q.format === "csv") {
    const header = CSV_COLUMNS.join(",");
    const body = rows
      .map((r) =>
        [
          r.unitNumber,
          r.project?.name ?? "",
          r.property?.title ?? "",
          r.unitType,
          r.bedrooms,
          r.bathrooms,
          r.areaSqft ?? "",
          r.priceMinor ?? "",
          r.currency,
          r.availabilityStatus,
          r.floor ?? "",
          r.aspect ?? "",
        ]
          .map(csvEscape)
          .join(",")
      )
      .join("\n");
    return new NextResponse(`\uFEFF${header}\n${body}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="units-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    /* distinct availability values present (for the filter dropdown) */
    availabilityOptions: ["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD"],
    typeOptions: Array.from(new Set(units.map((u) => u.unitType))).sort(),
    projects: projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug, unitCount: p._count.units })),
    units: rows,
    /* Governance note surfaced in the UI (writes disabled — ingestion-managed). */
    managedVia: "ingestion",
  });
});
