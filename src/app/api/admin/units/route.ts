import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { HttpError, requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { createManualUnitCommand, deleteManualUnitCommand, updateUnitCommand } from "@/server/domain/unit-command";
import { catalogReadFilter } from "@/server/domain/resource-policy";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Admin unit studio: audited manual overrides and provenance-preserving imports.
 */
const querySchema = z.object({
  project: z.string().max(200).optional(), // project slug
  availability: z.enum(["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN", "all"]).default("all"),
  type: z.string().max(40).optional(), // unitType
  beds: z.coerce.number().int().min(0).max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  format: z.enum(["json", "csv"]).default("json"),
});

const valuesSchema = z.object({
  projectId: z.string().min(1),
  propertyId: z.string().min(1).nullable().optional(),
  unitNumber: z.string().trim().max(100).nullable().optional(),
  unitType: z.string().trim().min(1).max(60),
  bedrooms: z.number().finite().min(0).max(30),
  bathrooms: z.number().finite().min(0).max(30),
  areaSqft: z.number().finite().positive().max(100_000_000).nullable().optional(),
  priceMinor: z.string().regex(/^\d+$/).max(19).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  availabilityStatus: z.enum(["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN"]),
  floor: z.number().int().min(-10).max(300).nullable().optional(),
  aspect: z.string().trim().max(160).nullable().optional(),
  changeReason: z.string().trim().max(500).nullable().optional(),
}).strict();

const CSV_COLUMNS = [
  "externalId",
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
  const actor = await requirePermission("project:read");
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) raw[k] = v;
  const q = querySchema.parse(raw);

  const projectFilter = q.project
    ? {
        OR: [{ project: { slug: q.project } }, { property: { project: { slug: q.project } } }],
      }
    : {};

  const scope = catalogReadFilter(actor);
  const unitScope = actor.roles.includes("OWNER") ? {} : {
    OR: [
      { project: { is: scope } },
      { projectId: null, property: { is: { project: { is: scope } } } },
    ],
  };
  const where = {
    AND: [unitScope, projectFilter],
    ...(q.availability !== "all" ? { availabilityStatus: q.availability } : {}),
    ...(q.type ? { unitType: q.type } : {}),
    ...(q.beds !== undefined ? { bedrooms: q.beds } : {}),
  };

  const [total, units, projects, properties] = await Promise.all([
    db.propertyUnit.count({ where }),
    db.propertyUnit.findMany({
      where,
      orderBy: [{ projectId: "asc" }, { unitNumber: "asc" }],
      skip: q.format === "csv" ? 0 : (q.page - 1) * q.pageSize,
      take: q.format === "csv" ? 5000 : q.pageSize,
      include: {
        project: { select: { id: true, name: true, slug: true, ownerOrganizationId: true } },
        property: { select: { id: true, title: true, slug: true, projectId: true } },
        statusHistory: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    }),
    db.project.findMany({
      where: { AND: [catalogReadFilter(actor), { deletedAt: null }] },
      take: 200,
      select: { id: true, name: true, slug: true, _count: { select: { units: true } } },
      orderBy: { name: "asc" },
    }),
    db.property.findMany({ where: { AND: [catalogReadFilter(actor), { deletedAt: null }] }, select: { id: true, title: true, projectId: true }, orderBy: { title: "asc" }, take: 500 }),
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
    sourceType: u.sourceType,
    sourceKey: u.sourceKey,
    sourceSnapshot: parseObject(u.sourceSnapshotJson),
    editorOverrides: parseObject(u.editorOverridesJson),
    projectId: u.projectId,
    propertyId: u.propertyId,
    floor: u.floor,
    aspect: u.aspect,
    project: u.project ? { name: u.project.name, slug: u.project.slug } : null,
    property: u.property ? { id: u.property.id, title: u.property.title, slug: u.property.slug, projectId: u.property.projectId } : null,
    updatedAt: u.updatedAt.toISOString(),
    statusHistory: u.statusHistory.map((history) => ({ fromStatus: history.fromStatus, toStatus: history.toStatus, reason: history.reason, createdAt: history.createdAt.toISOString() })),
  }));

  if (q.format === "csv") {
    const header = CSV_COLUMNS.join(",");
    const body = rows
      .map((r) =>
        [
          r.sourceKey ?? r.id,
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
    availabilityOptions: ["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN"],
    typeOptions: Array.from(new Set(units.map((u) => u.unitType))).sort(),
    projects: projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug, unitCount: p._count.units })),
    properties,
    units: rows,
    /* Governance note surfaced in the UI. */
    managedVia: "admin-and-import",
  });
});

function parseObject(value: string | null): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(value ?? "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("project:create");
  const input = valuesSchema.parse(await jsonBody<unknown>(req));
  const { projectId, propertyId, changeReason, ...values } = input;
  return NextResponse.json(await createManualUnitCommand(actor, projectId, values, propertyId ?? null, clientIp(req)), { status: 201 });
});

const patchSchema = valuesSchema.extend({ unitId: z.string().min(1), expectedUpdatedAt: z.string().datetime() }).strict();
export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("project:update");
  const input = patchSchema.parse(await jsonBody<unknown>(req));
  const { unitId, expectedUpdatedAt, projectId: _projectId, propertyId, changeReason, ...values } = input;
  return NextResponse.json(await updateUnitCommand(actor, unitId, expectedUpdatedAt, { ...values, changeReason }, propertyId ?? null, clientIp(req)));
});

export const DELETE = apiHandler(async (req) => {
  const actor = await requirePermission("project:update");
  const input = z.object({ unitId: z.string().min(1), expectedUpdatedAt: z.string().datetime() }).strict().parse(await jsonBody<unknown>(req));
  return NextResponse.json(await deleteManualUnitCommand(actor, input.unitId, input.expectedUpdatedAt, clientIp(req)));
});
