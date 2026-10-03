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

    // Duplicate detection: same externalId already imported with identical content
    const existing = await client.importRecord.findFirst({
      where: { entityKind: "PROPERTY", externalKey: rec.externalId, checksum: cs, action: { in: ["CREATED", "UPDATED"] } },
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
      const exactCommunity = await client.community.findFirst({
        where: { name: { equals: communityName, mode: "insensitive" } },
      });
      const slugCommunity = exactCommunity ? null : await client.community.findUnique({ where: { slug: communitySlug } });
      const partialCommunities = exactCommunity || slugCommunity ? [] : await client.community.findMany({
        where: { name: { contains: communityName, mode: "insensitive" } },
        take: 2,
      });
      if (partialCommunities.length > 1) throw new Error(`Ambiguous community reference: ${rec.community}`);
      const community = exactCommunity ?? slugCommunity ?? partialCommunities[0] ?? null;
      if (!community) throw new Error(`Unknown community: ${rec.community}`);

      if (opts.dryRun) {
        const existingProperty = await client.property.findFirst({ where: { sourceId: rec.externalId, sourceType: "IMPORT" }, select: { id: true } });
        const plannedAction = existingProperty ? "UPDATE" : "CREATE";
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
            issuesJson: JSON.stringify({ plannedAction }),
            rawJson: JSON.stringify(rec),
          },
        });
        continue;
      }

      // Resolve project/developer only when the source supplied an explicit
      // developer identity. Ambiguous references require human reconciliation.
      let projectId: string | null = null;
      if (rec.project) {
        if (!rec.developer) throw new Error(`Developer mapping required for project: ${rec.project}`);
        const developerSlug = slugify(rec.developer);
        const dev = await client.developer.upsert({
          where: { slug: developerSlug },
          create: { name: rec.developer, slug: developerSlug, sourceType: "IMPORT", retrievedAt: new Date() },
          update: {},
        });
        const developerId = dev.id;
        const projectSlug = slugify(rec.project);
        const project = await client.project.upsert({
          where: { slug: projectSlug },
          create: {
            name: rec.project,
            slug: projectSlug,
            developerId: developerId!, // verified non-null below via throw
            communityId: community.id,
            lat: rec.lat ?? community.lat,
            lng: rec.lng ?? community.lng,
            locationPrecision: rec.lat !== undefined && rec.lng !== undefined ? "APPROXIMATE" : "COMMUNITY_CENTROID",
            locationSourceType: "IMPORT",
            retrievedAt: new Date(),
            publicationStatus: "DRAFT",
            sourceType: "IMPORT",
          },
          update: {},
        }).catch(async (err) => {
          // projectSlug collision with different developer → append hash suffix
          if (String(err).includes("Unique")) {
            return client.project.upsert({
              where: { slug: `${projectSlug}-${cs.slice(0, 4)}` },
              create: {
                name: rec.project!,
                slug: `${projectSlug}-${cs.slice(0, 4)}`,
                developerId: developerId!,
                communityId: community.id,
                lat: rec.lat ?? community.lat,
                lng: rec.lng ?? community.lng,
                locationPrecision: rec.lat !== undefined && rec.lng !== undefined ? "APPROXIMATE" : "COMMUNITY_CENTROID",
                locationSourceType: "IMPORT",
                retrievedAt: new Date(),
                publicationStatus: "DRAFT",
                sourceType: "IMPORT",
              },
              update: {},
            });
          }
          throw err;
        });
        projectId = project.id;
      }

      const agent = rec.agentEmail ? await client.agent.findFirst({ where: { email: rec.agentEmail } }) : null;

      // Property upsert keyed by sourceId (idempotency)
      const existingProperty = await client.property.findFirst({ where: { sourceId: rec.externalId, sourceType: "IMPORT" } });
      let propertyId: string;
      if (existingProperty) {
        const propertyOverrides = parseCatalogJson(existingProperty.editorOverridesJson);
        await client.property.update({
          where: { id: existingProperty.id },
          data: {
            title: Object.prototype.hasOwnProperty.call(propertyOverrides, "title") ? String(propertyOverrides.title) : rec.title,
            propertyType: Object.prototype.hasOwnProperty.call(propertyOverrides, "propertyType") ? String(propertyOverrides.propertyType) : rec.propertyType,
            bedrooms: Object.prototype.hasOwnProperty.call(propertyOverrides, "bedrooms") ? Number(propertyOverrides.bedrooms) : rec.bedrooms,
            bathrooms: Object.prototype.hasOwnProperty.call(propertyOverrides, "bathrooms") ? Number(propertyOverrides.bathrooms) : rec.bathrooms,
            builtUpAreaSqft: rec.areaSqft,
            lat: rec.lat ?? existingProperty.lat,
            lng: rec.lng ?? existingProperty.lng,
            view: rec.view,
            furnishing: rec.furnishing,
            description: Object.prototype.hasOwnProperty.call(propertyOverrides, "description") ? String(propertyOverrides.description ?? "") || null : rec.description ?? null,
            handoverQuarter: rec.handover,
            sourceUpdatedAt: rec.sourceUpdatedAt ? new Date(rec.sourceUpdatedAt) : null,
            retrievedAt: new Date(),
            locationPrecision: rec.lat !== undefined && rec.lng !== undefined ? "APPROXIMATE" : existingProperty.locationPrecision,
            locationSourceType: "IMPORT",
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
              listingType: rec.listingType,
              priceMinor: newPrice,
              availabilityStatus: effectiveAvailability,
              offPlan: rec.offPlan,
              sourceSnapshotJson: JSON.stringify({ listingType: rec.listingType, priceAed: rec.priceAed, availability: rec.availability, offPlan: rec.offPlan }),
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
              priceMinor: BigInt(Math.round(rec.priceAed * 100)),
              currency: "AED",
              availabilityStatus: rec.availability,
              offPlan: rec.offPlan,
              agentId: agent?.id ?? null,
              publishedAt: null,
              sourceSnapshotJson: JSON.stringify({ listingType: rec.listingType, priceAed: rec.priceAed, availability: rec.availability, offPlan: rec.offPlan }),
            },
          });
          await client.priceHistory.create({ data: { propertyId, listingId: listing.id, priceMinor: listing.priceMinor, sourceType: "IMPORT" } });
          await client.listingStatusHistory.create({ data: { listingId: listing.id, fromStatus: null, toStatus: rec.availability, changedBy: opts.triggeredBy ?? "admin", reason: "Imported source listing" } });
        }
      } else {
        const property = await client.property.create({
          data: {
            title: rec.title,
            slug: `${slugify(rec.title)}-${cs.slice(0, 6)}`,
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
            priceMinor: BigInt(Math.round(rec.priceAed * 100)),
            currency: "AED",
            availabilityStatus: rec.availability,
            offPlan: rec.offPlan,
            sourceSnapshotJson: JSON.stringify({ listingType: rec.listingType, priceAed: rec.priceAed, availability: rec.availability, offPlan: rec.offPlan }),
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
