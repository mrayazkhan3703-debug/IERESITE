/**
 * Evidence / provenance + data-quality read models for the Admin V2 modules
 * (V2 Upgrade Master Prompt §39 — "evidence/provenance" + "data quality" tabs).
 *
 * READ-ONLY governance queries over the existing prisma models — no schema
 * changes, no mutations (V1 data governance: records are reported, never
 * silently "fixed" from the console).
 *
 * Two surfaces:
 *  1. getEvidenceOverview()  — per-domain provenance coverage, freshness and
 *     data-state distribution (U09 resolveMetricState run server-side in
 *     batch over each domain's rows).
 *  2. getDataQualitySummary() — U09 validation pipeline (§19.5/§38) executed
 *     over the FULL market tables (rents + transactions) with exclusion
 *     reason distribution and per-community per-sqft coverage, plus the
 *     canonical DQ rule catalogue and open DataQualityIssue counts.
 */
import { db } from "@/lib/db";
import { getDataState, resolveMetricState, type DataState, type MetricState } from "@/lib/data-state";
import {
  validateRentRecords,
  validateTransactionRecords,
  RENT_EXCLUSION_REASONS,
  TRANSACTION_EXCLUSION_REASONS,
  type MarketValidationSummary,
} from "@/server/domain/read-models";

/** Domain keys shown in the Evidence tab (grouped per §39 evidence/provenance). */
export const EVIDENCE_DOMAINS = [
  "properties",
  "projects",
  "market_metrics",
  "transactions",
  "rents",
  "agents",
] as const;
export type EvidenceDomain = (typeof EVIDENCE_DOMAINS)[number];

export interface EvidenceDomainReport {
  key: EvidenceDomain;
  label: string;
  /** Total records in the domain. */
  records: number;
  /** Share of records with a source-publisher field recorded (§40 provenance coverage — SQL conditional count). */
  sourceRecorded: number;
  sourceRecordedPct: number;
  /** Stricter, per-domain "verifiable provenance" definition (labelled in UI — see coverageNote). */
  verifiableProvenance: number;
  verifiableProvenancePct: number;
  coverageNote: string;
  /** Records flagged demo/illustrative (honesty disclosure). */
  demoFlagged: number;
  demoFlaggedPct: number;
  /** Most recent source retrieval / ingest timestamp observed in the domain. */
  lastRetrievedAt: string | null;
  /** resolveMetricState (U09) distribution over the domain's rows. */
  stateDistribution: Partial<Record<MetricState, number>>;
}

export interface EvidenceOverview {
  dataState: DataState;
  generatedAt: string;
  domains: EvidenceDomainReport[];
  totals: {
    records: number;
    sourceRecordedPct: number;
    verifiableProvenancePct: number;
    demoFlaggedPct: number;
  };
}

/** Upper bound of rows per domain fed through resolveMetricState (bounded batch). */
const STATE_SAMPLE_CAP = 2000;

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function distributionFor(rows: { provenance: Parameters<typeof resolveMetricState>[0] }[]): Partial<Record<MetricState, number>> {
  const dist: Partial<Record<MetricState, number>> = {};
  for (let i = 0; i < Math.min(rows.length, STATE_SAMPLE_CAP); i += 1) {
    const state = resolveMetricState(rows[i].provenance);
    dist[state] = (dist[state] ?? 0) + 1;
  }
  return dist;
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/**
 * Evidence / provenance overview across the six governed data domains.
 * Coverage definitions per domain (documented in the admin UI):
 *  - properties:        source pointer = sourceId OR sourceUpdatedAt
 *  - projects:          source pointer = sourceId OR sourceVerifiedAt
 *  - market metrics:    citable provenance = sourceUrl (sourceName always recorded)
 *  - transactions/rents: community linkage = communityId resolved to a platform community
 *  - agents:            verified origin = sourceType other than DEMO_SEED
 */
export async function getEvidenceOverview(): Promise<EvidenceOverview> {
  const [
    props,
    projects,
    metrics,
    transactions,
    rents,
    agents,
    propsSourcePointer,
    projectsSourcePointer,
    metricsWithUrl,
    txsResolved,
    rentsResolved,
    agentsNonDemo,
    metricsMaxRetrieved,
    propsMaxSource,
    projectsMaxVerified,
  ] = await Promise.all([
    db.property.findMany({
      where: { deletedAt: null },
      select: { sourceType: true, sourceId: true, sourceUpdatedAt: true, isDemoData: true, updatedAt: true },
    }),
    db.project.findMany({
      where: { deletedAt: null },
      select: { sourceType: true, sourceId: true, sourceVerifiedAt: true, isDemoData: true, updatedAt: true },
    }),
    db.marketMetric.findMany({
      select: { sourceName: true, sourceUrl: true, methodology: true, retrievedAt: true, isIllustrative: true },
      take: STATE_SAMPLE_CAP,
    }),
    db.marketTransaction.findMany({
      select: { source: true, communityId: true, isIllustrative: true, createdAt: true },
      take: STATE_SAMPLE_CAP,
    }),
    db.marketRent.findMany({
      select: { source: true, communityId: true, isIllustrative: true, createdAt: true, contractDate: true },
      take: STATE_SAMPLE_CAP,
    }),
    db.agent.findMany({
      select: { sourceType: true, isDemoData: true, updatedAt: true },
    }),
    // "SQL count conditional aggregation" — provenance coverage counts:
    db.property.count({ where: { deletedAt: null, OR: [{ sourceId: { not: null } }, { sourceUpdatedAt: { not: null } }] } }),
    db.project.count({ where: { deletedAt: null, OR: [{ sourceId: { not: null } }, { sourceVerifiedAt: { not: null } }] } }),
    db.marketMetric.count({ where: { sourceUrl: { not: null } } }),
    db.marketTransaction.count({ where: { communityId: { not: null } } }),
    db.marketRent.count({ where: { communityId: { not: null } } }),
    db.agent.count({ where: { sourceType: { not: "DEMO_SEED" } } }),
    db.marketMetric.aggregate({ _max: { retrievedAt: true } }),
    db.property.aggregate({ where: { deletedAt: null }, _max: { sourceUpdatedAt: true } }),
    db.project.aggregate({ where: { deletedAt: null }, _max: { sourceVerifiedAt: true } }),
  ]);

  const metricsMaxRetrievedAt = metricsMaxRetrieved._max.retrievedAt
    ?? metrics.map((m) => m.retrievedAt).reduce<Date | null>((acc, d) => (!acc || d > acc ? d : acc), null);

  const domains: EvidenceDomainReport[] = [
    {
      key: "properties",
      label: "Properties",
      records: props.length,
      sourceRecorded: props.filter((p) => p.sourceType).length,
      sourceRecordedPct: pct(props.filter((p) => p.sourceType).length, props.length),
      verifiableProvenance: propsSourcePointer,
      verifiableProvenancePct: pct(propsSourcePointer, props.length),
      coverageNote: "sourceId / sourceUpdatedAt external pointer",
      demoFlagged: props.filter((p) => p.isDemoData).length,
      demoFlaggedPct: pct(props.filter((p) => p.isDemoData).length, props.length),
      lastRetrievedAt: isoOrNull(
        props
          .map((p) => p.sourceUpdatedAt)
          .reduce<Date | null>((acc, d) => (!acc || (d && d > acc) ? d : acc), null)
      ),
      stateDistribution: distributionFor(
        props.map((p) => ({ provenance: { sourcePublisher: p.sourceType, retrievedAt: p.sourceUpdatedAt, isDemoData: p.isDemoData } }))
      ),
    },
    {
      key: "projects",
      label: "Projects",
      records: projects.length,
      sourceRecorded: projects.filter((p) => p.sourceType).length,
      sourceRecordedPct: pct(projects.filter((p) => p.sourceType).length, projects.length),
      verifiableProvenance: projectsSourcePointer,
      verifiableProvenancePct: pct(projectsSourcePointer, projects.length),
      coverageNote: "sourceId / sourceVerifiedAt verification pointer",
      demoFlagged: projects.filter((p) => p.isDemoData).length,
      demoFlaggedPct: pct(projects.filter((p) => p.isDemoData).length, projects.length),
      lastRetrievedAt: isoOrNull(projectsMaxVerified._max.sourceVerifiedAt),
      stateDistribution: distributionFor(
        projects.map((p) => ({ provenance: { sourcePublisher: p.sourceType, retrievedAt: p.sourceVerifiedAt, isDemoData: p.isDemoData } }))
      ),
    },
    {
      key: "market_metrics",
      label: "Market metrics",
      records: metrics.length,
      sourceRecorded: metrics.filter((m) => m.sourceName).length,
      sourceRecordedPct: pct(metrics.filter((m) => m.sourceName).length, metrics.length),
      verifiableProvenance: metricsWithUrl,
      verifiableProvenancePct: pct(metricsWithUrl, metrics.length),
      coverageNote: "sourceUrl citable URL (sourceName always recorded)",
      demoFlagged: metrics.filter((m) => m.isIllustrative).length,
      demoFlaggedPct: pct(metrics.filter((m) => m.isIllustrative).length, metrics.length),
      lastRetrievedAt: isoOrNull(metricsMaxRetrievedAt),
      stateDistribution: distributionFor(
        metrics.map((m) => ({
          provenance: {
            sourcePublisher: m.sourceName,
            methodology: m.methodology,
            retrievedAt: m.retrievedAt,
            isIllustrative: m.isIllustrative,
          },
        }))
      ),
    },
    {
      key: "transactions",
      label: "Transactions (DLD)",
      records: transactions.length,
      sourceRecorded: transactions.filter((t) => t.source).length,
      sourceRecordedPct: pct(transactions.filter((t) => t.source).length, transactions.length),
      verifiableProvenance: txsResolved,
      verifiableProvenancePct: pct(txsResolved, transactions.length),
      coverageNote: "communityId resolved to platform community",
      demoFlagged: transactions.filter((t) => t.isIllustrative).length,
      demoFlaggedPct: pct(transactions.filter((t) => t.isIllustrative).length, transactions.length),
      lastRetrievedAt: isoOrNull(
        transactions.map((t) => t.createdAt).reduce<Date | null>((acc, d) => (!acc || d > acc ? d : acc), null)
      ),
      stateDistribution: distributionFor(
        transactions.map((t) => ({
          provenance: { sourcePublisher: t.source, retrievedAt: t.createdAt, isIllustrative: t.isIllustrative },
        }))
      ),
    },
    {
      key: "rents",
      label: "Rents (DLD)",
      records: rents.length,
      sourceRecorded: rents.filter((r) => r.source).length,
      sourceRecordedPct: pct(rents.filter((r) => r.source).length, rents.length),
      verifiableProvenance: rentsResolved,
      verifiableProvenancePct: pct(rentsResolved, rents.length),
      coverageNote: "communityId resolved to platform community",
      demoFlagged: rents.filter((r) => r.isIllustrative).length,
      demoFlaggedPct: pct(rents.filter((r) => r.isIllustrative).length, rents.length),
      lastRetrievedAt: isoOrNull(
        rents.map((r) => r.createdAt).reduce<Date | null>((acc, d) => (!acc || d > acc ? d : acc), null)
      ),
      stateDistribution: distributionFor(
        rents.map((r) => ({ provenance: { sourcePublisher: r.source, retrievedAt: r.createdAt, isIllustrative: r.isIllustrative } }))
      ),
    },
    {
      key: "agents",
      label: "Advisors / agents",
      records: agents.length,
      sourceRecorded: agents.filter((a) => a.sourceType).length,
      sourceRecordedPct: pct(agents.filter((a) => a.sourceType).length, agents.length),
      verifiableProvenance: agentsNonDemo,
      verifiableProvenancePct: pct(agentsNonDemo, agents.length),
      coverageNote: "sourceType beyond DEMO_SEED origin",
      demoFlagged: agents.filter((a) => a.isDemoData).length,
      demoFlaggedPct: pct(agents.filter((a) => a.isDemoData).length, agents.length),
      lastRetrievedAt: isoOrNull(
        agents.map((a) => a.updatedAt).reduce<Date | null>((acc, d) => (!acc || d > acc ? d : acc), null)
      ),
      stateDistribution: distributionFor(
        agents.map((a) => ({ provenance: { sourcePublisher: a.sourceType, isDemoData: a.isDemoData } }))
      ),
    },
  ];

  const totalRecords = domains.reduce((sum, d) => sum + d.records, 0);
  const totalSourceRecorded = domains.reduce((sum, d) => sum + d.sourceRecorded, 0);
  const totalVerifiable = domains.reduce((sum, d) => sum + d.verifiableProvenance, 0);
  const totalDemo = domains.reduce((sum, d) => sum + d.demoFlagged, 0);

  return {
    dataState: getDataState(),
    generatedAt: new Date().toISOString(),
    domains,
    totals: {
      records: totalRecords,
      sourceRecordedPct: pct(totalSourceRecorded, totalRecords),
      verifiableProvenancePct: pct(totalVerifiable, totalRecords),
      demoFlaggedPct: pct(totalDemo, totalRecords),
    },
  };
}

/* ============================================================================
 * Data-quality summary (§39 "data quality" tab + §19.5/§38 pipeline outputs).
 * ==========================================================================*/

export interface DqRule {
  key: string;
  domain: "RENTS" | "TRANSACTIONS" | "BOTH";
  severity: "HARD" | "SOFT";
  description: string;
}

/** Canonical rule catalogue (mirrors RENT_EXCLUSION_REASONS / TRANSACTION_EXCLUSION_REASONS). */
export const DQ_RULES: DqRule[] = [
  { key: "zero_bedrooms_non_studio", domain: "RENTS", severity: "HARD", description: "Zero-bedroom rent contract on a non-studio property type — excluded from every chart, statistic and listing." },
  { key: "non_positive_rent", domain: "RENTS", severity: "HARD", description: "Annual rent ≤ 0 — excluded from every chart, statistic and listing." },
  { key: "non_positive_amount", domain: "TRANSACTIONS", severity: "HARD", description: "Transaction amount ≤ 0 — excluded from every chart, statistic and listing." },
  { key: "missing_size", domain: "BOTH", severity: "SOFT", description: "Size missing — row stays valid for absolute-value statistics but is excluded from per-sqft derived metrics." },
  { key: "non_positive_size", domain: "BOTH", severity: "SOFT", description: "Size ≤ 0 — excluded from per-sqft derived metrics only." },
];

export interface PerSqftCoverageRow {
  areaName: string;
  validRecords: number;
  perSqftEligible: number;
  coveragePct: number;
}

export interface DataQualitySummary {
  generatedAt: string;
  dataState: DataState;
  rents: MarketValidationSummary;
  transactions: MarketValidationSummary;
  /** Per-community share of hard-valid rows carrying a usable size (per-sqft computable). */
  perSqftCoverage: PerSqftCoverageRow[];
  rules: DqRule[];
  /** Open DataQualityIssue rows from the ingestion pipeline (existing module). */
  openIssues: number;
  openIssuesBySeverity: { severity: string; count: number }[];
}

/**
 * Run the U09 validation pipeline over the FULL market tables and summarize.
 * Query-scoped governance only — nothing is mutated or deleted (§38).
 */
export async function getDataQualitySummary(): Promise<DataQualitySummary> {
  const [rentRows, txRows, openIssues, openIssuesBySeverity] = await Promise.all([
    db.marketRent.findMany({
      select: { areaName: true, bedrooms: true, propertyType: true, annualRentMinor: true, sizeSqft: true },
      take: 10000,
    }),
    db.marketTransaction.findMany({
      select: { areaName: true, amountMinor: true, sizeSqft: true },
      take: 10000,
    }),
    db.dataQualityIssue.count({ where: { status: "OPEN" } }),
    db.dataQualityIssue.groupBy({ by: ["severity"], where: { status: "OPEN" }, _count: { _all: true } }),
  ]);

  const rentsValidated = validateRentRecords(rentRows);
  const txsValidated = validateTransactionRecords(txRows);

  // Per-community per-sqft coverage across BOTH domains (union of areas).
  const coverage = new Map<string, { valid: number; eligible: number }>();
  for (const r of rentsValidated.validRows) {
    const e = coverage.get(r.areaName) ?? { valid: 0, eligible: 0 };
    e.valid += 1;
    if (r.sizeSqft !== null && r.sizeSqft !== undefined && r.sizeSqft > 0) e.eligible += 1;
    coverage.set(r.areaName, e);
  }
  for (const t of txsValidated.validRows) {
    const e = coverage.get(t.areaName) ?? { valid: 0, eligible: 0 };
    e.valid += 1;
    if (t.sizeSqft !== null && t.sizeSqft !== undefined && t.sizeSqft > 0) e.eligible += 1;
    coverage.set(t.areaName, e);
  }

  const perSqftCoverage: PerSqftCoverageRow[] = Array.from(coverage.entries())
    .map(([areaName, e]) => ({
      areaName,
      validRecords: e.valid,
      perSqftEligible: e.eligible,
      coveragePct: pct(e.eligible, e.valid),
    }))
    .sort((a, b) => b.validRecords - a.validRecords);

  return {
    generatedAt: new Date().toISOString(),
    dataState: getDataState(),
    rents: rentsValidated.validation,
    transactions: txsValidated.validation,
    perSqftCoverage,
    rules: DQ_RULES,
    openIssues,
    openIssuesBySeverity: openIssuesBySeverity.map((g) => ({ severity: g.severity, count: g._count._all })),
  };
}

/** Canonical exclusion-reason keys (re-exported for the CSV report writer). */
export { RENT_EXCLUSION_REASONS, TRANSACTION_EXCLUSION_REASONS };
