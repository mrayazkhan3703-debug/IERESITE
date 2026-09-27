/**
 * V3-02 team migration — replaces fictional demo agents with the verified
 * 25-member team + central Advisory Desk fallback (V3 §11/§12/§54).
 *
 * Run: bun run scripts/v3-team-migration.ts   (idempotent — upserts)
 *
 * Steps:
 *  1. Upsert Advisory Desk agent (company contact, logo avatar).
 *  2. Upsert the 25 verified members (no invented attributes — all
 *     languages/specialties/communities/years/bio cleared to null/0/"").
 *  3. Reassign ALL listings to the Advisory Desk (honest fallback: no
 *     verified listing→advisor mapping exists).
 *  4. Reassign LeadAssignment / Lead.ownerAgent / Viewing / Booking rows
 *     that reference fictional agents → Advisory Desk.
 *  5. Delete the six fictional agents (+ join rows they own).
 *  6. Normalize stale demo content sources (example.dev guide URLs).
 *  7. Print a summary.
 */

import { PrismaClient } from "@prisma/client";
import { TEAM_MEMBERS, ADVISORY_DESK, FICTIONAL_AGENT_SLUGS } from "../db/team-data";

const db = new PrismaClient();

async function main() {
  const summary: Record<string, number> = {};

  /* 1 — Advisory Desk ------------------------------------------------- */
  const desk = await db.agent.upsert({
    where: { slug: ADVISORY_DESK.slug },
    create: {
      slug: ADVISORY_DESK.slug,
      name: ADVISORY_DESK.name,
      jobTitle: ADVISORY_DESK.jobTitle,
      bio: "",
      phoneE164: ADVISORY_DESK.phoneE164,
      whatsappE164: ADVISORY_DESK.whatsappE164,
      phoneDisplay: ADVISORY_DESK.phoneDisplay,
      email: null,
      languagesJson: null,
      specialtiesJson: null,
      communitiesJson: null,
      yearsExperience: 0,
      active: true,
      sortWeight: ADVISORY_DESK.sortWeight,
      isDemoData: false,
      sourceType: "VERIFIED_TEAM",
      department: ADVISORY_DESK.department,
      publicAdvisor: ADVISORY_DESK.publicAdvisor,
      photoUrl: ADVISORY_DESK.photoUrl,
    },
    update: {
      name: ADVISORY_DESK.name,
      jobTitle: ADVISORY_DESK.jobTitle,
      bio: "",
      phoneE164: ADVISORY_DESK.phoneE164,
      whatsappE164: ADVISORY_DESK.whatsappE164,
      phoneDisplay: ADVISORY_DESK.phoneDisplay,
      email: null,
      languagesJson: null,
      specialtiesJson: null,
      communitiesJson: null,
      yearsExperience: 0,
      active: true,
      sortWeight: ADVISORY_DESK.sortWeight,
      isDemoData: false,
      sourceType: "VERIFIED_TEAM",
      department: ADVISORY_DESK.department,
      publicAdvisor: ADVISORY_DESK.publicAdvisor,
      photoUrl: ADVISORY_DESK.photoUrl,
    },
  });
  summary.advisoryDesk = 1;

  /* 2 — 25 verified members -------------------------------------------- */
  for (const m of TEAM_MEMBERS) {
    const data = {
      name: m.name,
      jobTitle: m.jobTitle,
      bio: "",
      phoneE164: m.phoneE164,
      whatsappE164: m.whatsappE164,
      phoneDisplay: m.phoneDisplay,
      email: null,
      languagesJson: null,
      specialtiesJson: null,
      communitiesJson: null,
      yearsExperience: 0,
      active: true,
      leadCapacityState: "AVAILABLE" as const, // legacy column, default state; never displayed
      leadCapacityNote: null,
      sortWeight: 26 - m.order, // supplied sheet order (member 01 first)
      isDemoData: false,
      sourceType: "VERIFIED_TEAM",
      department: m.department,
      publicAdvisor: m.publicAdvisor,
      photoUrl: m.photoUrl,
    };
    await db.agent.upsert({
      where: { slug: m.slug },
      create: { slug: m.slug, ...data },
      update: data,
    });
    // join-table rows from the fictional era must not survive on real people
    // (AgentLanguage/AgentSpecialty carry no relation — resolve id first)
    const member = await db.agent.findUnique({ where: { slug: m.slug }, select: { id: true } });
    if (member) {
      await db.agentLanguage.deleteMany({ where: { agentId: member.id } });
      await db.agentSpecialty.deleteMany({ where: { agentId: member.id } });
      await db.agentCommunity.deleteMany({ where: { agentId: member.id } });
    }
  }
  summary.membersUpserted = TEAM_MEMBERS.length;

  /* 3 — reassign ALL listings to the Advisory Desk ---------------------- */
  const listingsReassigned = await db.listing.updateMany({
    where: { agentId: { not: desk.id } },
    data: { agentId: desk.id },
  });
  summary.listingsReassigned = listingsReassigned.count;

  /* 4 — reassign lead/viewing/booking references from fictional agents -- */
  const fictional = await db.agent.findMany({
    where: { slug: { in: [...FICTIONAL_AGENT_SLUGS] } },
    select: { id: true, slug: true },
  });
  const fictionalIds = fictional.map((f) => f.id);

  const assignments = fictionalIds.length
    ? await db.leadAssignment.updateMany({ where: { agentId: { in: fictionalIds } }, data: { agentId: desk.id } })
    : { count: 0 };
  const ownedLeads = fictionalIds.length
    ? await db.lead.updateMany({ where: { ownerAgentId: { in: fictionalIds } }, data: { ownerAgentId: desk.id } })
    : { count: 0 };
  const viewings = fictionalIds.length
    ? await db.viewing.updateMany({ where: { agentId: { in: fictionalIds } }, data: { agentId: desk.id } })
    : { count: 0 };
  const bookings = fictionalIds.length
    ? await db.booking.updateMany({ where: { agentId: { in: fictionalIds } }, data: { agentId: desk.id } })
    : { count: 0 };
  summary.leadAssignmentsReassigned = assignments.count;
  summary.ownedLeadsReassigned = ownedLeads.count;
  summary.viewingsReassigned = viewings.count;
  summary.bookingsReassigned = bookings.count;

  /* 5 — delete fictional agents (+ their join rows) ---------------------- */
  for (const id of fictionalIds) {
    await db.agentLanguage.deleteMany({ where: { agentId: id } });
    await db.agentSpecialty.deleteMany({ where: { agentId: id } });
    await db.agentCommunity.deleteMany({ where: { agentId: id } });
    await db.agent.delete({ where: { id } });
  }
  summary.fictionalAgentsDeleted = fictionalIds.length;

  /* 6 — normalize stale demo content source URLs ------------------------ */
  const guideSources = await db.contentEntry.updateMany({
    where: { sourceUrl: "https://example.dev/guides" },
    data: { sourceUrl: "/guides" },
  });
  summary.contentSourcesNormalized = guideSources.count;

  /* 7 — summary ---------------------------------------------------------- */
  const total = await db.agent.count();
  const publicAdvisors = await db.agent.count({ where: { publicAdvisor: true } });
  const listingsOnDesk = await db.listing.count({ where: { agentId: desk.id } });
  console.log("V3 team migration complete:");
  console.log(JSON.stringify({ ...summary, agentsTotal: total, publicAdvisors, listingsOnDesk }, null, 2));
}

main()
  .catch((err) => {
    console.error("V3 team migration FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
