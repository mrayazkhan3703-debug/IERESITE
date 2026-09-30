import { marketFreshness, marketSourceConfig } from "@/lib/market-import";
export function marketProvenance(run: { id: string; snapshotRetrievedAt: Date | null; appliedAt: Date | null; importSource: { url: string | null; configJson: string | null } } | null) {
  if (!run) return null;
  const source = marketSourceConfig(run.importSource.configJson);
  return { importRunId: run.id, sourceUrl: run.importSource.url, retrievedAt: run.snapshotRetrievedAt?.toISOString() ?? null, appliedAt: run.appliedAt?.toISOString() ?? null, freshness: marketFreshness(run.snapshotRetrievedAt, source?.staleAfterDays), reviewState: run.appliedAt ? "EDITOR_REVIEWED" : "UNAPPLIED" };
}
