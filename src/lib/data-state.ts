/**
 * Data-state machine (V2 Upgrade Master Prompt §5.1 + §37).
 *
 * Production must never silently present fixture values as real market data.
 * This module is the single source of truth for environment-level data honesty:
 *
 *  - `DataState` answers "what kind of dataset is this environment running?"
 *  - `resolveMetricState()` answers "how may THIS figure be presented?" by
 *    combining the global state with the record-level provenance fields
 *    (sourcePublisher / sourceType / methodology / retrievedAt /
 *    verificationStatus / isIllustrative …).
 *
 * Client-safe: reads NEXT_PUBLIC_DATA_STATE only (inlined by Next at build
 * time; defaults to LOCAL_DEMO because this sandbox ships demo fixtures).
 * See docs/V2_DATA_PROVENANCE.md for the full rule tables.
 */

/** Environment-level dataset state (§5.1). */
export type DataState =
  | "LOCAL_DEMO"
  | "STAGING_FIXTURE"
  | "PRODUCTION_VERIFIED"
  | "PRODUCTION_UNVERIFIED";

export const DATA_STATES: readonly DataState[] = [
  "LOCAL_DEMO",
  "STAGING_FIXTURE",
  "PRODUCTION_VERIFIED",
  "PRODUCTION_UNVERIFIED",
] as const;

/**
 * Per-metric presentation state (§37 suggested statuses).
 * One canonical enum for every published figure on the platform.
 */
export type MetricState =
  | "VERIFIED_SOURCE"
  | "APPROVED_INTERNAL"
  | "MODELED"
  | "USER_INPUT"
  | "ILLUSTRATIVE"
  | "STALE"
  | "UNAVAILABLE";

export const METRIC_STATES: readonly MetricState[] = [
  "VERIFIED_SOURCE",
  "APPROVED_INTERNAL",
  "MODELED",
  "USER_INPUT",
  "ILLUSTRATIVE",
  "STALE",
  "UNAVAILABLE",
] as const;

/** Provenance fields available on market records (all optional — models differ). */
export interface MetricProvenance {
  /** Publisher of the figure, e.g. "DLD" / "Dubai Statistics Center". */
  sourcePublisher?: string | null;
  /** Source classification, e.g. "VERIFIED" / "MODEL" / "USER" / "DEMO". */
  sourceType?: string | null;
  /** Transformation/methodology note, e.g. "Modeled from comparables". */
  methodology?: string | null;
  /** When the figure was retrieved from the source. */
  retrievedAt?: Date | string | null;
  /** Explicit verification marker on the record, e.g. "VERIFIED" / "APPROVED". */
  verificationStatus?: string | null;
  /** Record flags itself as illustrative. */
  isIllustrative?: boolean | null;
  /** Record flags itself as demo/fixture data. */
  isDemoData?: boolean | null;
  /** Stale-after policy in days (defaults to DEFAULT_STALE_AFTER_DAYS). */
  staleAfterDays?: number | null;
}

/** Market data is considered stale after 180 days without a refresh (§37 stale-after policy). */
export const DEFAULT_STALE_AFTER_DAYS = 180;

/**
 * Read the global data state from NEXT_PUBLIC_DATA_STATE.
 * Accepts kebab/camel/screaming-snake spellings; anything unrecognized or
 * missing falls back to LOCAL_DEMO — the safe (dishonest-proof) default,
 * since this sandbox genuinely runs the demo seed.
 */
export function getDataState(): DataState {
  const raw = process.env.NEXT_PUBLIC_DATA_STATE;
  if (!raw) return "LOCAL_DEMO";
  const normalized = raw.trim().toUpperCase().replace(/[-\s]+/g, "_");
  return (DATA_STATES as readonly string[]).includes(normalized)
    ? (normalized as DataState)
    : "LOCAL_DEMO";
}

/** Demo/staging environments must disclose themselves on every data surface. */
export function isDemoDataState(state: DataState): boolean {
  return state === "LOCAL_DEMO" || state === "STAGING_FIXTURE";
}

export interface ResolveMetricStateOptions {
  /** Override the global state (selftest / deterministic callers). */
  globalState?: DataState;
  /** Override "now" for deterministic staleness evaluation. */
  now?: Date;
}

function contains(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toUpperCase().includes(needle);
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Resolve the presentation state for a single figure from the global data
 * state + the record's provenance. Evaluation order (first match wins):
 *
 *  1. UNAVAILABLE   — no source evidence at all (caller should also hide the value);
 *  2. ILLUSTRATIVE  — global state is LOCAL_DEMO / STAGING_FIXTURE (an environment
 *                     that ships fixtures can never present rows as verified —
 *                     even if a fixture row claims a verified source);
 *  3. STALE         — retrievedAt older than staleAfterDays (default 180d);
 *  4. VERIFIED_SOURCE / APPROVED_INTERNAL / MODELED / USER_INPUT — explicit
 *                     verification/method markers on the record;
 *  5. ILLUSTRATIVE  — record flags itself illustrative/demo;
 *  6. APPROVED_INTERNAL — PRODUCTION_VERIFIED dataset with a real publisher
 *                     but no per-record marker (pipeline-approved internal figure);
 *  7. ILLUSTRATIVE  — PRODUCTION_UNVERIFIED with no verification evidence
 *                     (unverified production values stay illustrative until verified).
 */
export function resolveMetricState(
  provenance: MetricProvenance,
  options: ResolveMetricStateOptions = {}
): MetricState {
  const globalState = options.globalState ?? getDataState();
  const now = options.now ?? new Date();

  // 1. No source evidence whatsoever — honest "not available".
  const hasSource =
    !!provenance.sourcePublisher ||
    !!provenance.sourceType ||
    !!provenance.methodology ||
    !!provenance.verificationStatus;
  if (!hasSource) return "UNAVAILABLE";

  // 2. Demo / staging environments disqualify every record from
  //    verified presentation — fixtures are illustrative by definition.
  if (isDemoDataState(globalState)) return "ILLUSTRATIVE";

  // 3. Freshness policy.
  const retrieved = toTime(provenance.retrievedAt);
  const staleAfterDays =
    typeof provenance.staleAfterDays === "number" && provenance.staleAfterDays > 0
      ? provenance.staleAfterDays
      : DEFAULT_STALE_AFTER_DAYS;
  if (retrieved !== null && now.getTime() - retrieved > staleAfterDays * 86_400_000) {
    return "STALE";
  }

  // 4. Explicit record-level markers (verificationStatus, sourceType or methodology).
  //    Negative markers ("UNVERIFIED" / "NOT_VERIFIED") must never satisfy the
  //    VERIFIED check — substring containment alone would match them.
  const markers = [
    provenance.verificationStatus,
    provenance.sourceType,
    provenance.methodology,
  ];
  const marksVerified = (m: string | null | undefined) =>
    contains(m, "VERIFIED") && !contains(m, "UNVERIFIED") && !contains(m, "NOT_VERIFIED");
  if (markers.some(marksVerified)) return "VERIFIED_SOURCE";
  if (markers.some((m) => contains(m, "APPROVED"))) return "APPROVED_INTERNAL";
  if (markers.some((m) => contains(m, "MODEL"))) return "MODELED";
  if (markers.some((m) => contains(m, "USER"))) return "USER_INPUT";

  // 5. Record self-identifies as illustrative / demo.
  if (provenance.isIllustrative || provenance.isDemoData) return "ILLUSTRATIVE";

  // 6–7. Production defaults by global verification posture.
  return globalState === "PRODUCTION_VERIFIED" ? "APPROVED_INTERNAL" : "ILLUSTRATIVE";
}
