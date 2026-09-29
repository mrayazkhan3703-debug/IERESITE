import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { canManageCatalogResource } from "@/server/domain/resource-policy";

export type UnitValues = {
  unitNumber?: string | null;
  unitType: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft?: number | null;
  priceMinor?: string | null;
  currency: string;
  availabilityStatus: "AVAILABLE" | "RESERVED" | "SOLD" | "RENTED" | "HELD" | "WITHDRAWN";
  floor?: number | null;
  aspect?: string | null;
  changeReason?: string | null;
};

export type UnitSourceRow = UnitValues & { externalId: string };

function validateValues(input: UnitValues) {
  if (!input.unitType.trim() || input.unitType.length > 60) throw new HttpError(422, "Enter a valid unit type.", "UNIT_TYPE_INVALID");
  if (!Number.isFinite(input.bedrooms) || input.bedrooms < 0 || input.bedrooms > 30 || !Number.isFinite(input.bathrooms) || input.bathrooms < 0 || input.bathrooms > 30) {
    throw new HttpError(422, "Bedrooms and bathrooms must be between 0 and 30.", "UNIT_ROOMS_INVALID");
  }
  if (input.areaSqft != null && (!Number.isFinite(input.areaSqft) || input.areaSqft <= 0 || input.areaSqft > 100_000_000)) throw new HttpError(422, "Enter a valid unit area.", "UNIT_AREA_INVALID");
  if (input.priceMinor != null && (!/^\d+$/.test(input.priceMinor) || BigInt(input.priceMinor) <= 0n || BigInt(input.priceMinor) > 9_223_372_036_854_775_807n)) throw new HttpError(422, "Price must fit in a positive PostgreSQL minor-unit amount.", "UNIT_PRICE_INVALID");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new HttpError(422, "Choose a three-letter currency code.", "UNIT_CURRENCY_INVALID");
  if (input.floor != null && (!Number.isInteger(input.floor) || input.floor < -10 || input.floor > 300)) throw new HttpError(422, "Floor must be a whole number between -10 and 300.", "UNIT_FLOOR_INVALID");
}

function snapshot(input: Omit<UnitValues, "availabilityStatus"> & { availabilityStatus: string }) {
  return {
    unitNumber: input.unitNumber?.trim() || null, unitType: input.unitType.trim().toUpperCase(),
    bedrooms: input.bedrooms, bathrooms: input.bathrooms, areaSqft: input.areaSqft ?? null,
    priceMinor: input.priceMinor ?? null, currency: input.currency.toUpperCase(),
    availabilityStatus: input.availabilityStatus, floor: input.floor ?? null, aspect: input.aspect?.trim() || null,
  };
}

function databaseValues(input: Record<string, unknown>) {
  const priceMinor = input.priceMinor;
  return { ...input, priceMinor: priceMinor == null || priceMinor === "" ? null : BigInt(String(priceMinor)) };
}

async function requireProjectAccess(actor: SessionUser, projectId: string, tx: Prisma.TransactionClient = db as unknown as Prisma.TransactionClient) {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, ownerOrganizationId: true, deletedAt: true } });
  if (!project || project.deletedAt) throw new HttpError(404, "Project not found.", "NOT_FOUND");
  if (!canManageCatalogResource(actor, project.ownerOrganizationId)) throw new HttpError(403, "You cannot manage units in this project.", "RESOURCE_FORBIDDEN");
  return project;
}

export async function createManualUnitCommand(actor: SessionUser, projectId: string, input: UnitValues, propertyId: string | null, ip: string | null) {
  validateValues(input);
  return db.$transaction(async (tx) => {
    await requireProjectAccess(actor, projectId, tx);
    if (propertyId) {
      const property = await tx.property.findFirst({ where: { id: propertyId, deletedAt: null, projectId }, select: { id: true } });
      if (!property) throw new HttpError(422, "Choose a property linked to this project.", "UNIT_PROPERTY_INVALID");
    }
    const values = snapshot(input);
    const unit = await tx.propertyUnit.create({ data: { ...databaseValues(values), projectId, propertyId, sourceType: "MANUAL" } });
    await tx.propertyUnitStatusHistory.create({ data: { unitId: unit.id, fromStatus: null, toStatus: unit.availabilityStatus, reason: input.changeReason?.trim() || "Unit created in Admin", changedBy: actor.id } });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "unit.create", resourceType: "property_unit", resourceId: unit.id, before: null, after: { ...values, projectId, propertyId, sourceType: unit.sourceType }, ip }, tx);
    await emitEvent("project", projectId, "project.updated", { projectId, unitId: unit.id }, tx);
    return { id: unit.id, updatedAt: unit.updatedAt.toISOString(), sourceType: unit.sourceType };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateUnitCommand(actor: SessionUser, unitId: string, expectedUpdatedAt: string, input: UnitValues, propertyId: string | null, ip: string | null) {
  validateValues(input);
  const expected = new Date(expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new HttpError(400, "Invalid unit version.", "INVALID_VERSION");
  return db.$transaction(async (tx) => {
    const current = await tx.propertyUnit.findUnique({ where: { id: unitId } });
    if (!current?.projectId) throw new HttpError(404, "Project unit not found.", "NOT_FOUND");
    const project = await requireProjectAccess(actor, current.projectId, tx);
    if (current.updatedAt.getTime() !== expected.getTime()) throw new HttpError(409, "This unit changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
    if (propertyId) {
      const property = await tx.property.findFirst({ where: { id: propertyId, deletedAt: null, projectId: current.projectId }, select: { id: true } });
      if (!property) throw new HttpError(422, "Choose a property linked to this project.", "UNIT_PROPERTY_INVALID");
    }
    const before = snapshot({ ...current, priceMinor: current.priceMinor?.toString() ?? null, changeReason: undefined });
    const values = snapshot(input);
    const changed = await tx.propertyUnit.updateMany({ where: { id: current.id, updatedAt: expected }, data: { ...databaseValues(values), propertyId, updatedAt: new Date(), ...(current.sourceType === "IMPORT" ? { editorOverridesJson: JSON.stringify({ ...safeObject(current.editorOverridesJson), ...values }) } : {}) } });
    if (changed.count !== 1) throw new HttpError(409, "This unit changed during the save. Refresh and retry.", "VERSION_CONFLICT");
    if (current.availabilityStatus !== values.availabilityStatus) {
      await tx.propertyUnitStatusHistory.create({ data: { unitId: current.id, fromStatus: current.availabilityStatus, toStatus: values.availabilityStatus, reason: input.changeReason?.trim() || null, changedBy: actor.id } });
    }
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "unit.update", resourceType: "property_unit", resourceId: current.id, before: { ...before, propertyId: current.propertyId }, after: { ...values, propertyId, sourceType: current.sourceType, editorOverrides: current.sourceType === "IMPORT" ? { ...safeObject(current.editorOverridesJson), ...values } : null }, ip }, tx);
    await emitEvent("project", project.id, "project.updated", { projectId: project.id, unitId: current.id }, tx);
    const updated = await tx.propertyUnit.findUniqueOrThrow({ where: { id: current.id }, select: { updatedAt: true } });
    return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteManualUnitCommand(actor: SessionUser, unitId: string, expectedUpdatedAt: string, ip: string | null) {
  const expected = new Date(expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new HttpError(400, "Invalid unit version.", "INVALID_VERSION");
  return db.$transaction(async (tx) => {
    const unit = await tx.propertyUnit.findUnique({ where: { id: unitId } });
    if (!unit?.projectId) throw new HttpError(404, "Project unit not found.", "NOT_FOUND");
    const project = await requireProjectAccess(actor, unit.projectId, tx);
    if (unit.sourceType !== "MANUAL") throw new HttpError(409, "Imported source rows cannot be deleted here. Remove them at the source or use an import reconciliation.", "IMPORTED_UNIT_PROTECTED");
    if (unit.updatedAt.getTime() !== expected.getTime()) throw new HttpError(409, "This unit changed since it was loaded. Refresh and retry.", "VERSION_CONFLICT");
    const before = snapshot({ ...unit, priceMinor: unit.priceMinor?.toString() ?? null });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "unit.delete", resourceType: "property_unit", resourceId: unit.id, before: { ...before, projectId: project.id }, after: null, ip }, tx);
    await tx.propertyUnit.delete({ where: { id: unit.id } });
    await emitEvent("project", project.id, "project.updated", { projectId: project.id, unitId: unit.id, deleted: true }, tx);
    return { ok: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function previewUnitImport(actor: SessionUser, projectId: string, rows: UnitSourceRow[]) {
  await requireProjectAccess(actor, projectId);
  if (rows.length < 1 || rows.length > 500) throw new HttpError(422, "Unit import must contain between 1 and 500 rows.", "UNIT_IMPORT_SIZE");
  const keys = rows.map((row) => row.externalId.trim());
  if (keys.some((key) => !key || key.length > 160) || new Set(keys).size !== keys.length) throw new HttpError(422, "Every imported unit needs a unique externalId within the file.", "UNIT_IMPORT_KEYS");
  rows.forEach(validateValues);
  const current = await db.propertyUnit.findMany({ where: { projectId, sourceType: "IMPORT", sourceKey: { in: keys } }, select: { id: true, sourceKey: true, sourceSnapshotJson: true, editorOverridesJson: true, unitNumber: true, updatedAt: true } });
  const manuals = await db.propertyUnit.findMany({ where: { projectId, sourceType: "MANUAL", unitNumber: { in: rows.map((row) => row.unitNumber?.trim()).filter((value): value is string => Boolean(value)) } }, select: { unitNumber: true } });
  const byKey = new Map(current.map((unit) => [unit.sourceKey, unit]));
  const manualNumbers = new Set(manuals.map((unit) => unit.unitNumber));
  const incomingNumbers = rows.map((row) => row.unitNumber?.trim()).filter((value): value is string => Boolean(value));
  const duplicateNumbers = new Set(incomingNumbers.filter((value, index) => incomingNumbers.indexOf(value) !== index));
  const changes = rows.map((row) => {
    const existing = byKey.get(row.externalId);
    const unitNumber = row.unitNumber?.trim() ?? "";
    const manualConflict = !existing && Boolean(unitNumber && manualNumbers.has(unitNumber)) || Boolean(unitNumber && duplicateNumbers.has(unitNumber));
    const values = snapshot(row);
    const previousSource = safeObject(existing?.sourceSnapshotJson);
    const unchanged = existing && JSON.stringify(previousSource) === JSON.stringify(values);
    return { externalId: row.externalId, unitNumber: values.unitNumber, action: manualConflict ? "CONFLICT" : !existing ? "CREATE" : unchanged ? "UNCHANGED" : "UPDATE", existingId: existing?.id ?? null, changedFields: existing ? Object.keys(values).filter((key) => JSON.stringify(previousSource[key]) !== JSON.stringify((values as Record<string, unknown>)[key])) : Object.keys(values) };
  });
  return { total: rows.length, creates: changes.filter((row) => row.action === "CREATE").length, updates: changes.filter((row) => row.action === "UPDATE").length, unchanged: changes.filter((row) => row.action === "UNCHANGED").length, conflicts: changes.filter((row) => row.action === "CONFLICT").length, rows: changes };
}

export async function applyUnitImport(actor: SessionUser, projectId: string, rows: UnitSourceRow[], ip: string | null) {
  const preview = await previewUnitImport(actor, projectId, rows);
  if (preview.conflicts) throw new HttpError(409, "Resolve unit-number collisions with manually managed units before applying this import.", "UNIT_IMPORT_CONFLICT");
  return db.$transaction(async (tx) => {
    const project = await requireProjectAccess(actor, projectId, tx);
    let created = 0; let updatedCount = 0; let unchanged = 0;
    for (const row of rows) {
      const sourceKey = row.externalId.trim();
      const sourceValues = snapshot(row);
      const existing = await tx.propertyUnit.findUnique({ where: { projectId_sourceKey: { projectId, sourceKey } } });
      const overrides = safeObject(existing?.editorOverridesJson);
      const effectiveValues = { ...sourceValues, ...overrides };
      if (existing && JSON.stringify(safeObject(existing.sourceSnapshotJson)) === JSON.stringify(sourceValues)) { unchanged += 1; continue; }
      const updatedUnit = existing
        ? await tx.propertyUnit.update({ where: { id: existing.id }, data: { ...databaseValues(effectiveValues), sourceSnapshotJson: JSON.stringify(sourceValues), sourceType: "IMPORT" } })
        : await tx.propertyUnit.create({ data: { ...databaseValues(sourceValues), projectId, sourceType: "IMPORT", sourceKey, sourceSnapshotJson: JSON.stringify(sourceValues) } });
      if (!existing) {
        created += 1;
        await tx.propertyUnitStatusHistory.create({ data: { unitId: updatedUnit.id, fromStatus: null, toStatus: updatedUnit.availabilityStatus, reason: `Source import ${sourceKey}`, changedBy: actor.id } });
      } else {
        if (updatedUnit.availabilityStatus !== existing.availabilityStatus) await tx.propertyUnitStatusHistory.create({ data: { unitId: existing.id, fromStatus: existing.availabilityStatus, toStatus: updatedUnit.availabilityStatus, reason: `Source import ${sourceKey}`, changedBy: actor.id } });
        updatedCount += 1;
      }
      await audit({ actorId: actor.id, organizationId: actor.organizationId, actorType: "USER", action: existing ? "unit.import_update" : "unit.import_create", resourceType: "property_unit", resourceId: updatedUnit.id, before: existing ? { ...snapshot({ ...existing, priceMinor: existing.priceMinor?.toString() ?? null }), sourceSnapshot: safeObject(existing.sourceSnapshotJson), editorOverrides: overrides } : null, after: { ...effectiveValues, projectId, sourceType: "IMPORT", sourceKey, sourceSnapshot: sourceValues, editorOverrides: overrides }, ip }, tx);
    }
    await emitEvent("project", project.id, "project.updated", { projectId, unitImport: { created, updated: updatedCount, unchanged } }, tx);
    return { created, updated: updatedCount, unchanged, total: rows.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function safeObject(value: string | null | undefined): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(value ?? "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}
