/**
 * Property/project ingestion pipeline (Q07, PART E feed contracts):
 * validation → normalization → duplicate detection → idempotent upserts →
 * partial-failure handling → import runs/records with per-record errors →
 * data-quality issue tracking → outbox search indexing → audit history.
 */

import { db } from "@/lib/db";
import { emitEvent } from "@/server/jobs/outbox";
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { parseCatalogJson } from "@/server/domain/catalog-source";
import { feedRecordSchema, type FeedRecord } from "./feed-record";
import { editorialValue } from "./editorial-value";
import { propertyPublicationChecks } from "@/lib/property-publication";
import { PUBLIC_AGENT_WHERE, PUBLIC_PROJECT_WHERE } from "@/server/domain/visibility";
export { feedRecordSchema } from "./feed-record";
export type { FeedRecord } from "./feed-record";
export { CsvParseError, parseCsv, parseCsvStream } from "./csv";

/** Data quality rules (APPENDIX AE distilled) */
function qualityChecks(rec: FeedRecord): { ruleKey: string; severity: "INFO" | "WARNING" | "ERROR"; message: string }[] {
  const issues: { ruleKey: string; severity: "INFO" | "WARNING" | "ERROR"; message: string }[] = [];
  if (rec.priceAed > 30_000_000 && rec.propertyType === "APARTMENT") {
    issues.push({ ruleKey: "price_outlier", severity: "WARNING", message: `Apartment priced at AED ${rec.priceAed.toLocaleString()} — above typical band; verify.` });
  }
  if (rec.priceAed < 300_000 && rec.listingType === "SALE" && rec.propertyType !== "STUDIO") {
    issues.push({ ruleKey: "price_low_outlier", severity: "WARNING", message: `Sale price AED ${rec.priceAed.toLocaleString()} below typical entry band.` });
  }
  if (!rec.lat || !rec.lng) {
    issues.push({ ruleKey: "missing_coords", severity: "WARNING", message: "Missing coordinates — geocoding required for map indexing." });
  }
  if (rec.bedrooms > 7) {
    issues.push({ ruleKey: "bedroom_outlier", severity: "INFO", message: `${rec.bedrooms} bedrooms — unusually large; verify.` });
  }
  if (rec.areaSqft && rec.areaSqft < 250) {
    issues.push({ ruleKey: "area_outlier", severity: "WARNING", message: `Area ${rec.areaSqft} sqft below habitable minimum.` });
  }
  if (!rec.description) {
    issues.push({ ruleKey: "missing_description", severity: "INFO", message: "No description provided." });
  }
  return issues;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function checksum(rec: FeedRecord): string {
  return createHash("sha256").update(JSON.stringify(rec)).digest("hex").slice(0, 32);
}

export interface ImportSummary {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "DRY_RUN";
  total: number;
  created: number;
  updated: number;
  wouldCreate: number;
  wouldUpdate: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  failed: number;
  qualityIssues: number;
}

/**
 * Run an import: records are processed with per-record outcomes; malformed rows
 * never corrupt canonical data; duplicates are flagged, not silently merged.
 */
export async function runImport(opts: {
  sourceId: string;
  records: unknown[];
  triggeredBy?: string;
  dryRun?: boolean;
  runId?: string;
  recordNumbers?: number[];
  importRunChunkId?: string;
  finalize?: boolean;
  client?: Prisma.TransactionClient;
}): Promise<ImportSummary> {
  const client = opts.client ?? db;
  const source = await client.importSource.findUniqueOrThrow({ where: { id: opts.sourceId } });
  const companyScoped = source.ownerOrganizationId !== null || source.name.startsWith("INTERACTIVE_UPLOAD_");
  const referenceScope = source.ownerOrganizationId
    ? { OR: [{ ownerOrganizationId: null }, { ownerOrganizationId: source.ownerOrganizationId }] }
    : { ownerOrganizationId: null };
  async function findSourceProperty(externalId: string) {
    const linked = await client.importRecord.findFirst({
      where: { entityKind: "PROPERTY", externalKey: externalId, importRun: { importSourceId: source.id }, propertyId: { not: null }, action: { in: ["CREATED", "UPDATED"] } },
      orderBy: { createdAt: "desc" }, include: { property: true },
    });
    if (linked?.property) {
      if (linked.property.ownerOrganizationId !== source.ownerOrganizationId) throw new Error("Imported property ownership changed; reconcile before refreshing.");
      return linked.property;
    }
    // Legacy global feeds predate source associations. Company uploads never
    // claim those records merely because their external identifiers coincide.
    if (companyScoped) return null;
    return client.property.findFirst({ where: { sourceId: externalId, sourceType: "IMPORT", ownerOrganizationId: null, importRecords: { none: { action: { in: ["CREATED", "UPDATED"] } } } } });
  }
  if (opts.recordNumbers && opts.recordNumbers.length !== opts.records.length) {
    throw new Error("Import record numbers must match the supplied record count");
  }
  const run = opts.runId
    ? await client.importRun.findUniqueOrThrow({ where: { id: opts.runId } })
    : await client.importRun.create({
      data: { importSourceId: opts.sourceId, status: "RUNNING", startedAt: new Date(), triggeredBy: opts.triggeredBy ?? "admin" },
    });
  if (run.importSourceId !== opts.sourceId) throw new Error("The staged import source does not match its run");

  const summary: ImportSummary = {
    runId: run.id,
    status: opts.dryRun ? "DRY_RUN" : "SUCCEEDED",
    total: opts.records.length,
    created: 0,
    updated: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    failed: 0,
    qualityIssues: 0,
  };

  for (const [recordIndex, raw] of opts.records.entries()) {
    const recordNumber = opts.recordNumbers?.[recordIndex];
    const recordMeta = recordNumber === undefined ? {} : {
      recordNumber,
      ...(opts.importRunChunkId ? { importRunChunkId: opts.importRunChunkId } : {}),
    };
    if (recordNumber !== undefined) {
      const priorRecord = await client.importRecord.findUnique({
        where: { importRunId_recordNumber: { importRunId: run.id, recordNumber } },
      });
      if (priorRecord) {
        if (priorRecord.action === "CREATED") summary.created++;
        else if (priorRecord.action === "UPDATED") summary.updated++;
        else if (priorRecord.action === "SKIPPED_DUPLICATE") summary.skippedDuplicate++;
        else if (priorRecord.action === "SKIPPED_INVALID") summary.skippedInvalid++;
        else if (priorRecord.action === "FAILED") summary.failed++;
        else if (priorRecord.action === "DRY_RUN") {
          const plannedAction = parseCatalogJson(priorRecord.issuesJson).plannedAction;
          if (plannedAction === "UPDATE") summary.wouldUpdate++;
          else summary.wouldCreate++;
        }
        continue;
      }
    }
    const parsed = feedRecordSchema.safeParse(raw);
    if (!parsed.success) {
      summary.skippedInvalid++;
      await client.importRecord.create({
        data: {
          importRunId: run.id,
          ...recordMeta,
          entityKind: "PROPERTY",
          externalKey: typeof raw === "object" && raw && "externalId" in raw ? String((raw as { externalId: unknown }).externalId) : null,
          action: "SKIPPED_INVALID",
          issuesJson: JSON.stringify(parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message }))),
          rawJson: JSON.stringify(raw).slice(0, 4000),
        },
      });
      continue;
    }
    const rec = parsed.data;
    const cs = checksum(rec);

    const repeatedKey = await client.importRecord.findFirst({
      where: { importRunId: run.id, entityKind: "PROPERTY", externalKey: rec.externalId, action: { in: ["DRY_RUN", "CREATED", "UPDATED", "SKIPPED_DUPLICATE"] } },
      select: { checksum: true },
    });
    if (repeatedKey) {
      const identical = repeatedKey.checksum === cs;
      if (identical) summary.skippedDuplicate++;
      else summary.skippedInvalid++;
      await client.importRecord.create({ data: { importRunId: run.id, ...recordMeta, entityKind: "PROPERTY", externalKey: rec.externalId,
        action: identical ? "SKIPPED_DUPLICATE" : "SKIPPED_INVALID", checksum: cs,
        issuesJson: JSON.stringify([{ path: "externalId", message: identical ? "Repeated source ID with identical content; reuse the first row." : "Repeated source ID has conflicting values; reconcile the source file before importing." }]),
      } });
      continue;
    }

    // Duplicate detection: same externalId already imported with identical content
    const existing = await client.importRecord.findFirst({
      where: { entityKind: "PROPERTY", externalKey: rec.externalId, checksum: cs, action: { in: ["CREATED", "UPDATED"] }, importRun: { importSourceId: source.id }, property: { ownerOrganizationId: source.ownerOrganizationId, contentHash: cs } },
    });
    if (existing) {
      summary.skippedDuplicate++;
      await client.importRecord.create({
        data: { importRunId: run.id, ...recordMeta, entityKind: "PROPERTY", externalKey: rec.externalId, action: "SKIPPED_DUPLICATE", checksum: cs },
      });
      continue;
    }

    try {
      // Resolve community by name (normalized contains)
      const communityName = rec.community.trim();
      const communitySlug = slugify(rec.community);
      const exactCommunities = await client.community.findMany({
        where: { ...referenceScope, name: { equals: communityName, mode: "insensitive" } }, take: 2,
      });
      if (exactCommunities.length > 1) throw new Error(`Ambiguous community reference: ${rec.community}`);
      const exactCommunity = exactCommunities[0];
      const slugCommunity = exactCommunity ? null : await client.community.findFirst({ where: { ...referenceScope, slug: communitySlug } });
      const partialCommunities = exactCommunity || slugCommunity ? [] : await client.community.findMany({
        where: { ...referenceScope, name: { contains: communityName, mode: "insensitive" } },
        take: 2,
      });
      if (partialCommunities.length > 1) throw new Error(`Ambiguous community reference: ${rec.community}`);
      const community = exactCommunity ?? slugCommunity ?? partialCommunities[0] ?? null;
      if (!community) throw new Error(`Unknown community: ${rec.community}`);

      // Preview and apply resolve the same parents. Existing slugs must match
      // both ownership and supplied parent identities; never silently relink.
      const developerSlug = rec.developer ? slugify(rec.developer) : null;
      const projectSlug = rec.project ? slugify(rec.project) : null;
      if (rec.project && !rec.developer) throw new Error(`Developer mapping required for project: ${rec.project}`);
      const mappedDeveloper = developerSlug ? await client.developer.findUnique({ where: { slug: developerSlug } }) : null;
      if (mappedDeveloper && mappedDeveloper.ownerOrganizationId !== null && mappedDeveloper.ownerOrganizationId !== source.ownerOrganizationId) throw new Error("Developer belongs to another organization.");
      const mappedProject = projectSlug ? await client.project.findUnique({ where: { slug: projectSlug } }) : null;
      if (mappedProject?.deletedAt) throw new Error("The mapped project has been removed; reconcile before importing.");
      if (mappedProject && (mappedProject.ownerOrganizationId !== null && mappedProject.ownerOrganizationId !== source.ownerOrganizationId)) throw new Error("Project belongs to another organization.");
      if (mappedProject && (mappedProject.communityId !== community.id || mappedProject.developerId !== mappedDeveloper?.id)) throw new Error("Project parent mapping conflicts with the existing catalog; reconcile before importing.");
      const agent = rec.agentEmail ? await client.agent.findFirst({ where: { ...PUBLIC_AGENT_WHERE, ...referenceScope, email: rec.agentEmail } }) : null;
      if (rec.agentEmail && !agent) throw new Error("Agent email does not resolve to an available profile.");
      const existingProperty = await findSourceProperty(rec.externalId);

      if (opts.dryRun) {
        const plannedAction = existingProperty ? "UPDATE" : "CREATE";
        const overrides = parseCatalogJson(existingProperty?.editorOverridesJson ?? null);
        const listing = existingProperty ? await client.listing.findFirst({ where: { propertyId: existingProperty.id }, orderBy: { createdAt: "desc" } }) : null;
        const listingOverrides = parseCatalogJson(listing?.editorOverridesJson ?? null);
        const publicationCommunity = existingProperty ? await client.community.findUniqueOrThrow({ where: { id: existingProperty.communityId } }) : community;
        const publicationProjectId = existingProperty ? existingProperty.projectId : mappedProject?.id;
        const now = new Date();
        const publicationIssues = propertyPublicationChecks({
          title: editorialValue(overrides, "title", rec.title), propertyType: editorialValue(overrides, "propertyType", rec.propertyType),
          bedrooms: editorialValue(overrides, "bedrooms", rec.bedrooms), bathrooms: editorialValue(overrides, "bathrooms", rec.bathrooms),
          lat: editorialValue(overrides, "lat", rec.lat ?? existingProperty?.lat ?? community.lat),
          lng: editorialValue(overrides, "lng", rec.lng ?? existingProperty?.lng ?? community.lng),
          communityStatus: publicationCommunity.publicationStatus,
          projectSelected: Boolean(existingProperty ? existingProperty.projectId : rec.project),
          projectPublic: Boolean(publicationProjectId && await client.project.findFirst({ where: { id: publicationProjectId, ...PUBLIC_PROJECT_WHERE }, select: { id: true } })),
          listingType: editorialValue(listingOverrides, "listingType", rec.listingType), rentFrequency: editorialValue(listingOverrides, "rentFrequency", rec.rentFrequency ?? listing?.rentFrequency),
          listings: [{ pricePositive: editorialValue(listingOverrides, "priceAed", rec.priceAed) > 0, availability: editorialValue(listingOverrides, "availabilityStatus", editorialValue(listingOverrides, "availability", rec.availability)), publishedAt: now, expiresAt: listing?.expiresAt ?? null }],
        }, now).filter(check => !check.ready).map(({ path, message }) => ({ field: path, message }));
        if (existingProperty) summary.wouldUpdate++;
        else summary.wouldCreate++;
        await client.importRecord.create({
          data: {
            importRunId: run.id,
            ...recordMeta,
            entityKind: "PROPERTY",
            externalKey: rec.externalId,
            action: "DRY_RUN",
            checksum: cs,
            issuesJson: JSON.stringify({ plannedAction, publicationIssues }),
            rawJson: JSON.stringify(rec),
          },
        });
        continue;
      }

      // Resolve project/developer only when the source supplied an explicit
      // developer identity. Ambiguous references require human reconciliation.
      let projectId: string | null = null;
      if (rec.project) {
        const dev = mappedDeveloper ?? await client.developer.create({
          data: { name: rec.developer!, slug: developerSlug!, ownerOrganizationId: source.ownerOrganizationId, sourceType: "IMPORT", retrievedAt: new Date() },
        });
        const developerId = dev.id;
        const project = mappedProject ?? await client.project.create({
          data: {
            name: rec.project,
            slug: projectSlug!,
            ownerOrganizationId: source.ownerOrganizationId,
            developerId,
            communityId: community.id,
            lat: rec.lat ?? community.lat,
            lng: rec.lng ?? community.lng,
            locationPrecision: rec.lat !== undefined && rec.lng !== undefined ? "APPROXIMATE" : "COMMUNITY_CENTROID",
            locationSourceType: "IMPORT",
            retrievedAt: new Date(),
            publicationStatus: "DRAFT",
            sourceType: "IMPORT",
          },
        });
        projectId = project.id;
      }

      // Property upsert keyed by sourceId (idempotency)
      let propertyId: string;
      if (existingProperty) {
        const propertyOverrides = parseCatalogJson(existingProperty.editorOverridesJson);
        const manualCoordinates = Object.prototype.hasOwnProperty.call(propertyOverrides, "lat") || Object.prototype.hasOwnProperty.call(propertyOverrides, "lng");
        await client.property.update({
          where: { id: existingProperty.id },
          data: {
            title: Object.prototype.hasOwnProperty.call(propertyOverrides, "title") ? String(propertyOverrides.title) : rec.title,
            propertyType: Object.prototype.hasOwnProperty.call(propertyOverrides, "propertyType") ? String(propertyOverrides.propertyType) : rec.propertyType,
            bedrooms: Object.prototype.hasOwnProperty.call(propertyOverrides, "bedrooms") ? Number(propertyOverrides.bedrooms) : rec.bedrooms,
            bathrooms: Object.prototype.hasOwnProperty.call(propertyOverrides, "bathrooms") ? Number(propertyOverrides.bathrooms) : rec.bathrooms,
            builtUpAreaSqft: editorialValue(propertyOverrides, "builtUpAreaSqft", rec.areaSqft ?? existingProperty.builtUpAreaSqft),
            lat: editorialValue(propertyOverrides, "lat", rec.lat ?? existingProperty.lat),
            lng: editorialValue(propertyOverrides, "lng", rec.lng ?? existingProperty.lng),
            view: editorialValue(propertyOverrides, "view", rec.view ?? existingProperty.view),
            furnishing: editorialValue(propertyOverrides, "furnishing", rec.furnishing ?? existingProperty.furnishing),
            description: Object.prototype.hasOwnProperty.call(propertyOverrides, "description") ? String(propertyOverrides.description ?? "") || null : rec.description ?? null,
            handoverQuarter: editorialValue(propertyOverrides, "handoverQuarter", rec.handover ?? existingProperty.handoverQuarter),
            sourceUpdatedAt: rec.sourceUpdatedAt ? new Date(rec.sourceUpdatedAt) : null,
            retrievedAt: new Date(),
            locationPrecision: editorialValue(propertyOverrides, "locationPrecision", !manualCoordinates && rec.lat !== undefined && rec.lng !== undefined ? "APPROXIMATE" : existingProperty.locationPrecision),
            locationSourceType: manualCoordinates ? "MANUAL_ADMIN" : "IMPORT",
            contentHash: cs,
            sourceSnapshotJson: JSON.stringify(rec),
          },
        });
        propertyId = existingProperty.id;
        summary.updated++;
        const listing = await client.listing.findFirst({ where: { propertyId } });
        if (listing) {
          const listingOverrides = parseCatalogJson(listing.editorOverridesJson);
          const effectivePrice = Object.prototype.hasOwnProperty.call(listingOverrides, "priceAed") ? Number(listingOverrides.priceAed) : rec.priceAed;
          const effectiveAvailability = Object.prototype.hasOwnProperty.call(listingOverrides, "availabilityStatus")
            ? String(listingOverrides.availabilityStatus)
            : Object.prototype.hasOwnProperty.call(listingOverrides, "availability") ? String(listingOverrides.availability) : rec.availability;
          const newPrice = BigInt(Math.round(effectivePrice * 100));
          const statusChanged = effectiveAvailability !== listing.availabilityStatus;
          await client.listing.update({
            where: { id: listing.id },
            data: {
              listingType: editorialValue(listingOverrides, "listingType", rec.listingType),
              rentFrequency: editorialValue(listingOverrides, "rentFrequency", rec.rentFrequency ?? listing.rentFrequency),
              priceMinor: newPrice,
              availabilityStatus: effectiveAvailability,
              offPlan: editorialValue(listingOverrides, "offPlan", rec.offPlan),
              sourceSnapshotJson: JSON.stringify({ listingType: rec.listingType, rentFrequency: rec.rentFrequency, priceAed: rec.priceAed, availability: rec.availability, offPlan: rec.offPlan }),
            },
          });
          if (newPrice !== listing.priceMinor) {
            await client.priceHistory.create({ data: { propertyId, listingId: listing.id, priceMinor: newPrice, sourceType: "IMPORT" } });
          }
          if (statusChanged) await client.listingStatusHistory.create({
            data: { listingId: listing.id, fromStatus: listing.availabilityStatus, toStatus: effectiveAvailability, changedBy: opts.triggeredBy ?? "admin", reason: "Source refresh" },
          });
        } else {
          const listing = await client.listing.create({
            data: {
              propertyId,
              listingType: rec.listingType,
              rentFrequency: rec.rentFrequency ?? null,
              priceMinor: BigInt(Math.round(rec.priceAed * 100)),
              currency: "AED",
              availabilityStatus: rec.availability,
              offPlan: rec.offPlan,
              agentId: agent?.id ?? null,
              publishedAt: null,
              sourceSnapshotJson: JSON.stringify({ listingType: rec.listingType, rentFrequency: rec.rentFrequency, priceAed: rec.priceAed, availability: rec.availability, offPlan: rec.offPlan }),
            },
          });
          await client.priceHistory.create({ data: { propertyId, listingId: listing.id, priceMinor: listing.priceMinor, sourceType: "IMPORT" } });
          await client.listingStatusHistory.create({ data: { listingId: listing.id, fromStatus: null, toStatus: rec.availability, changedBy: opts.triggeredBy ?? "admin", reason: "Imported source listing" } });
        }
      } else {
        const property = await client.property.create({
          data: {
            title: rec.title,
            slug: `${slugify(rec.title)}-${createHash("sha256").update(`${source.id}:${rec.externalId}`).digest("hex").slice(0, 12)}`,
            ownerOrganizationId: source.ownerOrganizationId,
            communityId: community.id,
            projectId,
            propertyType: rec.propertyType,
            bedrooms: rec.bedrooms,
            bathrooms: rec.bathrooms,
            builtUpAreaSqft: rec.areaSqft ?? null,
            lat: rec.lat ?? community.lat,
            lng: rec.lng ?? community.lng,
            locationPrecision: rec.lat !== undefined && rec.lng !== undefined ? "APPROXIMATE" : "COMMUNITY_CENTROID",
            locationSourceType: "IMPORT",
            view: rec.view ?? null,
            furnishing: rec.furnishing ?? null,
            handoverQuarter: rec.handover ?? null,
            description: rec.description ?? null,
            publicationStatus: "DRAFT",
            sourceType: "IMPORT",
            sourceId: rec.externalId,
            sourceSnapshotJson: JSON.stringify(rec),
            editorOverridesJson: null,
            sourceUpdatedAt: rec.sourceUpdatedAt ? new Date(rec.sourceUpdatedAt) : null,
            retrievedAt: new Date(),
            contentHash: cs,
          },
        });
        propertyId = property.id;
        summary.created++;
        const listing = await client.listing.create({
          data: {
            propertyId,
            listingType: rec.listingType,
            rentFrequency: rec.rentFrequency ?? null,
            priceMinor: BigInt(Math.round(rec.priceAed * 100)),
            currency: "AED",
            availabilityStatus: rec.availability,
            offPlan: rec.offPlan,
            sourceSnapshotJson: JSON.stringify({ listingType: rec.listingType, rentFrequency: rec.rentFrequency, priceAed: rec.priceAed, availability: rec.availability, offPlan: rec.offPlan }),
            editorOverridesJson: null,
            agentId: agent?.id ?? null,
            publishedAt: null,
            statusHistory: { create: { fromStatus: null, toStatus: rec.availability, changedBy: opts.triggeredBy ?? "admin", reason: "Imported source listing" } },
          },
        });
        await client.priceHistory.create({ data: { propertyId, listingId: listing.id, priceMinor: listing.priceMinor, sourceType: "IMPORT" } });
      }

      // Record outcome + quality issues
      await client.importRecord.create({
        data: {
          importRunId: run.id,
          ...recordMeta,
          entityKind: "PROPERTY",
          externalKey: rec.externalId,
          propertyId,
          action: existingProperty ? "UPDATED" : "CREATED",
          checksum: cs,
          rawJson: JSON.stringify(rec),
        },
      });

      const issues = qualityChecks(rec);
      for (const issue of issues) {
        summary.qualityIssues++;
        await client.dataQualityIssue.create({
          data: {
            entityKind: "PROPERTY",
            entityId: propertyId,
            propertyId,
            severity: issue.severity,
            ruleKey: issue.ruleKey,
            message: issue.message,
          },
        });
      }

      // Outbox → search index sync
      await emitEvent("property", propertyId, "property.updated", { propertyId, source: "import" }, client);
    } catch (err) {
      summary.failed++;
      await client.importRecord.create({
        data: {
          importRunId: run.id,
          ...recordMeta,
          entityKind: "PROPERTY",
          externalKey: rec.externalId,
          action: "FAILED",
          issuesJson: JSON.stringify([{ message: String(err).slice(0, 300) }]),
        },
      });
    }
  }

  if (opts.finalize === false) return summary;

  if (!opts.dryRun && summary.failed > 0) summary.status = "PARTIAL";
  await client.importRun.update({
    where: { id: run.id },
    data: {
      status: summary.status,
      finishedAt: new Date(),
      recordsTotal: summary.total,
      recordsCreated: summary.created,
      recordsUpdated: summary.updated,
      recordsSkipped: summary.skippedDuplicate + summary.skippedInvalid,
      recordsFailed: summary.failed,
      duplicatesDetected: summary.skippedDuplicate,
    },
  });

  return summary;
}
