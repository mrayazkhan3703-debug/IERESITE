import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createMarketReport, retireMarketReport, reviewMarketReport, rollbackMarketReport, updateMarketReport } from "@/server/domain/market-report-command";
import { publicDocumentDownloadUrls } from "@/server/media/public-download-url";

const prefix = `market-report-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const editorId = `${prefix}-editor`;
const reviewerId = `${prefix}-reviewer`;
const editor: SessionUser = {
  sessionId: `${prefix}-editor-session`, id: editorId, email: "market-report-editor@example.invalid", name: "Market report editor",
  organizationId: null, roles: ["ADMIN"], permissions: ["content:update"], mfaVerified: true,
};
const reviewer: SessionUser = {
  sessionId: `${prefix}-review-session`, id: reviewerId, email: "market-report-reviewer@example.invalid", name: "Market report reviewer",
  organizationId: null, roles: ["ADMIN"], permissions: ["content:update"], mfaVerified: true,
};

async function cleanup() {
  const reports = await db.marketReport.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } });
  const ids = reports.map((report) => report.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await db.marketReport.deleteMany({ where: { id: { in: ids } } });
  }
  await db.redirect.deleteMany({ where: { OR: [{ fromPath: { contains: prefix } }, { toPath: { contains: prefix } }] } });
  await db.mediaAsset.deleteMany({ where: { storageKey: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { in: [editorId, reviewerId] } } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: editorId, email: editor.email } });
  await db.user.create({ data: { id: reviewerId, email: reviewer.email } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional MarketReport CMS commands", () => {
  test("requires distinct review, explicit provenance for non-illustrative publication, and reversible retirement", async () => {
    const created = await createMarketReport(editor, {
      slug: `${prefix}-report`, title: "Integration fixture report", summary: "Fixture only", periodLabel: "Test period",
      methodology: null, dataSourceName: null, dataSourceUrl: null, retrievedAt: null,
      body: "Fixture report body.", gated: true, isIllustrative: false, submitForReview: true,
    }, "127.0.0.1");
    let report = await db.marketReport.findUniqueOrThrow({ where: { id: created.id } });
    expect(report.status).toBe("IN_REVIEW");
    expect(report.isIllustrative).toBe(false);
    expect(await db.marketReportRevision.count({ where: { marketReportId: report.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { resourceId: report.id, action: "market_report.create_draft" } })).toBe(1);

    await expect(reviewMarketReport(editor, report.id, report.updatedAt.toISOString(), "APPROVE", "", null))
      .rejects.toMatchObject({ status: 409, code: "SELF_REVIEW_BLOCKED" });
    await reviewMarketReport(reviewer, report.id, report.updatedAt.toISOString(), "APPROVE", "Reviewed fixture", null);
    report = await db.marketReport.findUniqueOrThrow({ where: { id: report.id } });
    await expect(reviewMarketReport(reviewer, report.id, report.updatedAt.toISOString(), "PUBLISH", "", null))
      .rejects.toMatchObject({ status: 422, code: "REPORT_PROVENANCE_REQUIRED" });

    await expect(updateMarketReport(editor, {
      reportId: report.id, expectedUpdatedAt: new Date(report.updatedAt.getTime() - 1).toISOString(),
      slug: report.slug, title: "Stale overwrite", body: report.body, gated: true, isIllustrative: false,
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });

    await updateMarketReport(editor, {
      reportId: report.id, expectedUpdatedAt: report.updatedAt.toISOString(), slug: `${prefix}-report-renamed`,
      title: report.title, summary: report.summary, periodLabel: report.periodLabel, methodology: "Fixture methodology",
      dataSourceName: "Test source name only", dataSourceUrl: "https://example.invalid/source", retrievedAt: new Date().toISOString(),
      body: report.body, gated: report.gated, isIllustrative: false, submitForReview: true,
    }, null);
    report = await db.marketReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(report.status).toBe("IN_REVIEW");
    expect(report.approvedBy).toBeNull();
    expect((await db.redirect.findUniqueOrThrow({ where: { fromPath: `/market/reports/${prefix}-report` } })).toPath).toBe(`/market/reports/${prefix}-report-renamed`);
    await reviewMarketReport(reviewer, report.id, report.updatedAt.toISOString(), "APPROVE", "Second review", null);
    report = await db.marketReport.findUniqueOrThrow({ where: { id: report.id } });
    await reviewMarketReport(reviewer, report.id, report.updatedAt.toISOString(), "PUBLISH", "", null);
    report = await db.marketReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(report.status).toBe("PUBLISHED");
    expect(report.publishedAt).not.toBeNull();
    expect(await db.marketReport.findFirst({ where: { id: report.id, status: "PUBLISHED", publishedAt: { lte: new Date() } } })).not.toBeNull();
    expect(await db.outboxEvent.count({ where: { aggregateId: report.id, eventType: "market-report.published" } })).toBe(1);

    await retireMarketReport(editor, report.id, report.updatedAt.toISOString(), false, null);
    report = await db.marketReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(report.status).toBe("RETIRED");
    expect(report.publishedAt).toBeNull();
    expect(await db.marketReport.findFirst({ where: { id: report.id, status: "PUBLISHED" } })).toBeNull();
    await retireMarketReport(editor, report.id, report.updatedAt.toISOString(), true, null);
    report = await db.marketReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(report.status).toBe("DRAFT");
    expect(await db.marketReportRevision.count({ where: { marketReportId: report.id } })).toBe(7);
  });

  test("restores historical content only as a new draft revision and rejects unsafe sources", async () => {
    const created = await createMarketReport(editor, {
      slug: `${prefix}-history`, title: "Original title", body: "Original body.", gated: false, isIllustrative: true,
    }, null);
    const original = await db.marketReportRevision.findFirstOrThrow({ where: { marketReportId: created.id, version: 1 } });
    let report = await db.marketReport.findUniqueOrThrow({ where: { id: created.id } });
    await expect(updateMarketReport(editor, {
      reportId: report.id, expectedUpdatedAt: report.updatedAt.toISOString(), slug: report.slug, title: "Unsafe source URL",
      body: "Changed body.", gated: false, isIllustrative: true, dataSourceUrl: "javascript:alert(1)",
    }, null)).rejects.toMatchObject({ status: 422, code: "MARKET_REPORT_SOURCE_URL" });
    await updateMarketReport(editor, {
      reportId: report.id, expectedUpdatedAt: report.updatedAt.toISOString(), slug: report.slug, title: "Changed title",
      body: "Changed body.", gated: false, isIllustrative: true,
    }, null);
    report = await db.marketReport.findUniqueOrThrow({ where: { id: report.id } });
    await rollbackMarketReport(editor, report.id, original.id, report.updatedAt.toISOString(), null);
    report = await db.marketReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(report.title).toBe("Original title");
    expect(report.body).toBe("Original body.");
    expect(report.status).toBe("DRAFT");
    expect(report.publishedAt).toBeNull();
    expect(await db.marketReportRevision.count({ where: { marketReportId: report.id } })).toBe(3);
  });

  test("exposes only supported same-origin public document downloads", async () => {
    const minio = await db.mediaAsset.create({ data: {
      storageKey: `public/media/${prefix}-report.pdf`, url: "/api/media/pending/content",
      mimeType: "application/pdf", sizeBytes: 2048, kind: "DOCUMENT", isPrivate: false,
    } });
    const legacy = await db.mediaAsset.create({ data: {
      storageKey: `${prefix}/legacy-report.pdf`, url: `/uploads/${prefix}-legacy-report.pdf`,
      mimeType: "application/pdf", sizeBytes: 1024, kind: "DOCUMENT", isPrivate: false,
    } });
    const privateAsset = await db.mediaAsset.create({ data: {
      storageKey: `${prefix}/private-report.pdf`, url: `/uploads/${prefix}-private-report.pdf`,
      mimeType: "application/pdf", sizeBytes: 1024, kind: "DOCUMENT", isPrivate: true,
    } });
    const urls = await publicDocumentDownloadUrls([minio.id, legacy.id, privateAsset.id]);
    expect(urls.get(minio.id)).toBe(`/api/media/${encodeURIComponent(minio.id)}/content`);
    expect(urls.get(legacy.id)).toBe(`/uploads/${prefix}-legacy-report.pdf`);
    expect(urls.has(privateAsset.id)).toBe(false);
  });
});
