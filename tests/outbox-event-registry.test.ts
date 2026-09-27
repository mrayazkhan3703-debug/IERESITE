import { expect, test } from "bun:test";
import {
  JOB_HANDLERS,
  OUTBOX_EVENT_TYPES,
  mapOutboxEventToJob,
  type OutboxEventType,
} from "@/server/jobs/outbox";

const routeCoverage = {
  "property.updated": { jobKey: "search.index.property", reason: "Reindex the affected property." },
  "property.published": { jobKey: "search.index.property", reason: "Reindex the newly public property." },
  "property.unpublished": { jobKey: "search.index.property", reason: "Remove the property from public search." },
  "listing.updated": { jobKey: "search.index.property", reason: "Reindex the affected listing." },
  "project.updated": { jobKey: "cms.public-index.refresh", reason: "Refresh public catalog and sitemap." },
  "community.updated": { jobKey: "cms.public-index.refresh", reason: "Refresh public catalog and sitemap." },
  "developer.updated": { jobKey: "cms.public-index.refresh", reason: "Refresh public catalog and sitemap." },
  "agent.updated": { jobKey: "seo.sitemap.generate", reason: "Refresh sitemap after public advisor changes." },
  "agent.created": { jobKey: "seo.sitemap.generate", reason: "Refresh sitemap after public advisor creation." },
  "lead.created": { jobKey: "crm.lead.deliver", reason: "Queue consent-gated CRM lead delivery." },
  "lead.updated": { jobKey: null, reason: "Intentional noop until generic GHL update semantics are defined." },
  "lead.assignment_changed": { jobKey: "crm.lead.assignment.sync", reason: "Reconcile the verified CRM owner mapping." },
  "lead.status_changed": { jobKey: "crm.lead.status.sync", reason: "Reconcile the explicitly mapped CRM status." },
  "media.uploaded": { jobKey: "media.process", reason: "Run the media processing pipeline." },
  "media.updated": { jobKey: "seo.sitemap.generate", reason: "Refresh public references to updated media." },
  "content.published": { jobKey: "seo.sitemap.generate", reason: "Refresh sitemap after publication." },
  "content.updated": { jobKey: "seo.sitemap.generate", reason: "Refresh sitemap after public content changes." },
  "market-report.published": { jobKey: "seo.sitemap.generate", reason: "Refresh sitemap after publication." },
  "market-report.updated": { jobKey: "seo.sitemap.generate", reason: "Refresh sitemap after public report changes." },
  "rag.document.published": { jobKey: "rag.embed.document", reason: "Index only the explicitly published document revision." },
  "rag.document.updated": { jobKey: null, reason: "Intentional noop: edits require review and a later publish event." },
  "rag.source.updated": { jobKey: "rag.reconcile.source", reason: "Reconcile approved chunks against the source state." },
  "market.imported": { jobKey: "search.reindex.all", reason: "Rebuild search after canonical market data changes." },
  "import.staged.requested": { jobKey: "ingestion.import.process", reason: "Process the staged import asynchronously." },
  "search.reindex.requested": { jobKey: "search.reindex.all", reason: "Run the requested full search rebuild." },
  "user.invitation.created": { jobKey: null, reason: "Intentional noop: invitation email is sent after transaction commit." },
  "user.invitation.accepted": { jobKey: null, reason: "Intentional noop: retained as a durable integration hook." },
  "user.updated": { jobKey: null, reason: "Intentional noop: retained as a durable integration hook." },
} satisfies Record<OutboxEventType, { jobKey: string | null; reason: string }>;

test("every outbox event has a matching job handler or an explicit intentional noop", () => {
  expect(Object.keys(routeCoverage).sort()).toEqual([...OUTBOX_EVENT_TYPES].sort());
  const handlerKeys = new Set(JOB_HANDLERS.map((handler) => handler.key));

  for (const eventType of OUTBOX_EVENT_TYPES) {
    const expected = routeCoverage[eventType];
    expect(expected.reason.trim().length).toBeGreaterThan(0);

    const actual = mapOutboxEventToJob("coverage-event", eventType, "coverage", "coverage-aggregate", {
      documentVersion: 1,
    });
    expect(actual?.key ?? null).toBe(expected.jobKey);
    if (expected.jobKey) expect(handlerKeys.has(expected.jobKey)).toBe(true);
    else expect(expected.reason).toContain("Intentional noop");
  }

  expect(() => mapOutboxEventToJob("unknown-event", "unknown.event", "coverage", "coverage-aggregate", {}))
    .toThrow("Unhandled outbox event type");
});
