/**
 * U20 (§40 CRM / Lead Continuity V2) — runtime drill against the live dev DB.
 *
 * Validates, using ONLY production code paths (no mocks of the lead service,
 * outbox or CRM adapter):
 *
 *  PART A — lead capture + outbox + dedupe
 *    1. submitLead() with a distinct email → lead + lead_context + outbox
 *       `lead.created` event must exist immediately after the call.
 *    2. Re-submitting the same contact/intent/entity within 24h → soft-dedupe
 *       must return duplicate:true with the SAME leadId (no new row).
 *
 *  PART B — CRM outage → retry → DLQ (§40 "Do not lose leads")
 *    3. A second lead is written directly (simulating a lead captured while
 *       the CRM is already down — no outbox event to drain).
 *    4. deliverLeadToCrm() is invoked with CRM_PROVIDER=hubspot but NO
 *       credentials → the HubSpot adapter throws (BLOCKED_LIVE_CRM_CREDENTIALS)
 *       → crm_sync_record goes RETRYING with backoff, then DEAD after the
 *       5th attempt, and a dead_letter_event is written.
 *
 *  Replay is performed through the ADMIN API (POST /api/admin/dlq) from the
 *  orchestrating shell with an owner session cookie; the dev server's localdev
 *  adapter then delivers the lead and flips the record to DELIVERED. Run this
 *  script again with `--verify` to confirm the end state.
 *
 * Usage (bun, project root):
 *   DATABASE_URL=file:.../db/custom.db bun tests/u20-crm-drill.ts          # parts A+B
 *   DATABASE_URL=file:.../db/custom.db bun tests/u20-crm-drill.ts --verify # post-replay verification
 */
import { db, parseJson } from "@/lib/db";
import { submitLead } from "@/server/domain/lead-service";
import { deliverLeadToCrm } from "@/server/crm/adapter";

const MODE = process.argv.includes("--verify") ? "verify" : "drill";

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(34, " ")} ${value === null || value === undefined ? "—" : String(value)}`);
}

async function drill() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);
  const email = `u20-drill-${stamp}@investmentexperts.dev`;

  console.log("\n=== U20 PART A — lead capture / outbox / dedupe ===");
  console.log(`distinct contact email: ${email}`);

  const first = await submitLead({
    intent: "BUY",
    name: "U20 Drill Lead",
    email,
    phone: "+971500000020",
    message: "U20 continuity drill — verifying lead_context completeness end-to-end.",
    entityType: "PROPERTY",
    entitySlug: "marina-2br-sea-view-azure-12",
    consentContact: true,
    consentMarketing: false,
    preferredLocale: "en",
    sourceChannel: "WEBSITE",
    landingUrl: "/properties/marina-2br-sea-view-azure-12?utm_source=newsletter",
    referrer: "https://www.google.com/",
    utmSource: "newsletter",
    utmMedium: "email",
    utmCampaign: "u20-drill",
    utmContent: "compare-cta",
    utmTerm: "dubai-marina-2br",
    sessionId: `drill-${stamp}`,
    deviceClass: "DESKTOP",
    pagePath: "/properties/marina-2br-sea-view-azure-12",
    searchState: { community: "dubai-marina", propertyType: "apartment", bedrooms: "2" },
    aiConversationId: undefined,
  });
  console.log(`lead created: ${first.leadId} (ref ${first.reference}, duplicate=${first.duplicate})`);

  const outboxRow = await db.outboxEvent.findFirst({
    where: { aggregateType: "lead", aggregateId: first.leadId, eventType: "lead.created" },
  });
  const contextRow = await db.leadContext.findUnique({ where: { leadId: first.leadId } });
  console.log("lead_context captured:");
  line("landingUrl", contextRow?.landingUrl);
  line("referrer", contextRow?.referrer);
  line("utmSource/Medium/Campaign", `${contextRow?.utmSource ?? "—"}/${contextRow?.utmMedium ?? "—"}/${contextRow?.utmCampaign ?? "—"}`);
  line("utmContent/Term", `${contextRow?.utmContent ?? "—"}/${contextRow?.utmTerm ?? "—"}`);
  line("pagePath", contextRow?.pagePath);
  line("sessionId", contextRow?.sessionId);
  line("deviceClass", contextRow?.deviceClass);
  line("locale", contextRow?.locale);
  line("searchStateJson", contextRow?.searchStateJson);
  console.log("outbox event:");
  line("eventType", outboxRow?.eventType);
  line("aggregateId", outboxRow?.aggregateId);
  line("publishedAt", outboxRow?.publishedAt ?? "(pending drain — dev server scheduler will deliver)");

  const second = await submitLead({
    intent: "BUY",
    name: "U20 Drill Lead",
    email,
    message: "Repeat submission within 24h — should soft-dedupe.",
    entityType: "PROPERTY",
    entitySlug: "marina-2br-sea-view-azure-12",
    consentContact: true,
    consentMarketing: false,
    preferredLocale: "en",
    sourceChannel: "WEBSITE",
  });
  const leadsForContact = await db.lead.count({ where: { contact: { email } } });
  console.log("re-submission (same email/intent/entity):");
  line("returned leadId", second.leadId);
  line("duplicate flag", second.duplicate);
  line("same leadId as first", second.leadId === first.leadId);
  line("leads rows for contact", `${leadsForContact} (expect 1)`);
  const repeatEvents = await db.leadEvent.findMany({ where: { leadId: first.leadId, eventType: "REPEAT_SUBMISSION" } });
  line("REPEAT_SUBMISSION events", repeatEvents.length);

  console.log("\n=== U20 PART B — CRM outage drill (hubspot without credentials) ===");
  // Simulate the production adapter being unreachable: the HubSpot adapter
  // throws when CRM_API_URL/CRM_API_KEY are absent (BLOCKED_LIVE_CRM_CREDENTIALS).
  // Only THIS process sees the provider override — the dev server keeps localdev.
  process.env.CRM_PROVIDER = "hubspot";
  delete process.env.CRM_API_URL;
  delete process.env.CRM_API_KEY;

  const outageEmail = `u20-outage-${stamp}@investmentexperts.dev`;
  const contact = await db.contact.create({
    data: {
      email: outageEmail,
      phoneE164: "+971500000021",
      name: "U20 Outage Drill",
      dedupeKey: `email:${outageEmail}`,
    },
  });
  const outageLead = await db.lead.create({
    data: {
      contactId: contact.id,
      intent: "CONSULT",
      status: "NEW",
      sourceChannel: "WEBSITE",
      message: "Captured while CRM is down — must survive to DLQ and replay.",
      preferredLocale: "en",
    },
  });
  await db.leadContext.create({
    data: {
      leadId: outageLead.id,
      landingUrl: "/consultation",
      referrer: "https://www.investmentexperts.dev/",
      utmSource: "drill",
      pagePath: "/consultation",
      locale: "en",
      deviceClass: "DESKTOP",
    },
  });
  await db.leadEvent.create({
    data: { leadId: outageLead.id, eventType: "CREATED", payloadJson: JSON.stringify({ drill: "u20-outage" }), actorType: "USER" },
  });
  console.log(`outage lead: ${outageLead.id} (ref ${outageLead.id.slice(-8).toUpperCase()}) — written directly (no outbox event)`);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let error: string | null = null;
    try {
      await deliverLeadToCrm(outageLead.id);
    } catch (err) {
      error = String(err).slice(0, 160);
    }
    const record = await db.crmSyncRecord.findFirst({ where: { leadId: outageLead.id }, orderBy: { createdAt: "desc" } });
    console.log(`attempt ${attempt}: threw=${error ? "yes" : "no"}${error ? ` (${error})` : ""}`);
    line("  crm_sync_record.status", record?.status);
    line("  attempts", record?.attempts);
    line("  nextRetryAt", record?.nextRetryAt?.toISOString());
    line("  lastError", record?.lastError?.slice(0, 80));
  }

  const deadLetters = await db.deadLetterEvent.findMany({
    where: { jobKey: "crm.lead.deliver", sourceId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const deadLetter = deadLetters.find(
    (d) => parseJson<{ leadId?: string }>(d.payloadJson, {}).leadId === outageLead.id,
  );
  console.log("dead_letter_event:");
  line("id", deadLetter?.id);
  line("jobKey", deadLetter?.jobKey);
  line("attempts", deadLetter?.attempts);
  line("error", deadLetter?.error?.slice(0, 80));
  line("replayedAt", deadLetter?.replayedAt ?? "(pending admin replay)");

  console.log(`
NEXT (orchestrator):
  1. curl login → cookie jar (owner@investmentexperts.dev)
  2. curl GET  /api/admin/jobs            → dead letter visible in admin DLQ module
  3. curl POST /api/admin/dlq {"deadLetterId":"${deadLetter?.id ?? "<id>}"}
  4. wait ~20s (dev-server scheduler tick) for the replayed crm.lead.deliver job
  5. bun tests/u20-crm-drill.ts --verify
`);

  await db.$disconnect();
}

async function verify() {
  console.log("\n=== U20 VERIFY — post-replay end state ===");
  const dead = await db.deadLetterEvent.findMany({
    where: { jobKey: "crm.lead.deliver" },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  for (const d of dead) {
    const payload = parseJson<{ leadId?: string }>(d.payloadJson, {});
    if (!payload.leadId) continue;
    const [record, events, jobRuns] = await Promise.all([
      db.crmSyncRecord.findFirst({ where: { leadId: payload.leadId }, orderBy: { createdAt: "desc" } }),
      db.leadEvent.findMany({ where: { leadId: payload.leadId, eventType: { in: ["CRM_RETRY", "CRM_DEAD", "CRM_DELIVERED", "DLQ_REPLAY"] } }, orderBy: { createdAt: "asc" } }),
      db.jobRun.findMany({ where: { jobKey: "crm.lead.deliver" }, orderBy: { createdAt: "desc" }, take: 6 }),
    ]);
    console.log(`dead letter ${d.id.slice(-8)} → lead ${payload.leadId.slice(-8).toUpperCase()}`);
    line("replayedAt", d.replayedAt?.toISOString());
    line("crm_sync_record.status", record?.status);
    line("externalId", record?.externalId);
    line("deliveredAt", record?.deliveredAt?.toISOString());
    line("attempts (total)", record?.attempts);
    console.log("  lead events (CRM lifecycle):");
    for (const e of events) console.log(`    ${e.createdAt.toISOString()} ${e.eventType}`);
    const replayJobs = jobRuns.filter((j) => j.idempotencyKey.startsWith("replay:"));
    for (const j of replayJobs) line("replay jobRun", `${j.status} (idempotencyKey=${j.idempotencyKey})`);
  }
  await db.$disconnect();
}

if (MODE === "verify") {
  await verify();
} else {
  await drill();
}
