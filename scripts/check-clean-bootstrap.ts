/** Read-only check. Never runs a seed, deletes rows, or prints database values. */
import { readdir } from "node:fs/promises";
import { CLEAN_BOOTSTRAP_TABLES, evaluateCleanBootstrap } from "../src/server/release/clean-bootstrap-policy";

async function main() {
  if (process.env.APP_ENV !== "staging" || !/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("STAGING_POSTGRES_REQUIRED");
  }
  const { db } = await import("../src/lib/db");
  try {
    const migrations = (await readdir("prisma/migrations", { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).length;
    const [migrationRows, extensionRows, roles, permissions, countValues] = await Promise.all([
      db.$queryRaw<{ applied: number; failed: number }[]>`
        SELECT COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
               COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS failed
        FROM "_prisma_migrations"`,
      db.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pg_trgm', 'vector')`,
      db.role.count(),
      db.permission.count(),
      Promise.all([
        db.organization.count(), db.user.count(), db.agent.count(), db.contact.count(), db.lead.count(),
        db.property.count(), db.project.count(), db.developer.count(), db.community.count(), db.mediaAsset.count(),
        db.contentEntry.count(), db.blogPost.count(), db.marketReport.count(), db.marketMetric.count(),
        db.marketTransaction.count(), db.marketRent.count(), db.testimonial.count(), db.faq.count(),
        db.ragSource.count(), db.ragDocument.count(), db.importSource.count(), db.importRun.count(),
        db.outboxEvent.count(), db.jobRun.count(), db.mediaProcessingJob.count(), db.seoMetadata.count(), db.redirect.count(),
      ]),
    ]);
    const counts = Object.fromEntries(CLEAN_BOOTSTRAP_TABLES.map((key, index) => [key, countValues[index]])) as
      Record<(typeof CLEAN_BOOTSTRAP_TABLES)[number], number>;
    const result = evaluateCleanBootstrap({
      expectedMigrations: migrations,
      appliedMigrations: migrationRows[0]?.applied ?? -1,
      failedMigrations: migrationRows[0]?.failed ?? -1,
      roles, permissions, extensions: extensionRows.map((row) => row.extname), counts,
    });
    console.log(JSON.stringify({ ...result, expectedMigrations: migrations,
      appliedMigrations: migrationRows[0]?.applied ?? -1, roles, permissions,
      extensions: extensionRows.map((row) => row.extname).sort(), counts }));
    if (result.status !== "PASS_CLEAN_BOOTSTRAP") process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error(JSON.stringify({ status: "FAIL_CLEAN_BOOTSTRAP", reasons: ["CHECK_UNAVAILABLE"] }));
  process.exitCode = 2;
});
