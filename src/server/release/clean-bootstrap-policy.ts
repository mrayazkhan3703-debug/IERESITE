/** Read-only Phase M gate for a newly migrated, not-yet-populated database. */
export const CLEAN_BOOTSTRAP_TABLES = [
  "organizations", "users", "agents", "contacts", "leads",
  "properties", "projects", "developers", "communities", "mediaAssets",
  "contentEntries", "blogPosts", "marketReports", "marketMetrics",
  "marketTransactions", "marketRents", "testimonials", "faqs",
  "ragSources", "ragDocuments", "importSources", "importRuns",
  "outboxEvents", "jobRuns", "mediaProcessingJobs", "seoMetadata", "redirects",
] as const;

export type CleanBootstrapCounts = Record<(typeof CLEAN_BOOTSTRAP_TABLES)[number], number>;

export function evaluateCleanBootstrap(input: {
  expectedMigrations: number;
  appliedMigrations: number;
  failedMigrations: number;
  roles: number;
  permissions: number;
  extensions: readonly string[];
  counts: CleanBootstrapCounts;
}): { status: "PASS_CLEAN_BOOTSTRAP" | "FAIL_CLEAN_BOOTSTRAP"; reasons: string[] } {
  const reasons: string[] = [];
  if (input.expectedMigrations < 1 || input.appliedMigrations !== input.expectedMigrations || input.failedMigrations !== 0) {
    reasons.push("MIGRATIONS_INCOMPLETE");
  }
  if (input.roles !== 8 || input.permissions < 1) reasons.push("RBAC_FOUNDATION_MISSING");
  for (const extension of ["postgis", "pg_trgm", "vector"]) {
    if (!input.extensions.includes(extension)) reasons.push(`EXTENSION_MISSING_${extension.toUpperCase()}`);
  }
  for (const table of CLEAN_BOOTSTRAP_TABLES) {
    const count = input.counts[table];
    if (!Number.isSafeInteger(count) || count < 0) reasons.push(`INVALID_COUNT_${table}`);
    else if (count > 0) reasons.push(`NONEMPTY_${table}`);
  }
  return { status: reasons.length ? "FAIL_CLEAN_BOOTSTRAP" : "PASS_CLEAN_BOOTSTRAP", reasons };
}
