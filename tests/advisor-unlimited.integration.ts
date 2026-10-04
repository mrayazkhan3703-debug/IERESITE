import { afterAll, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { aiDailyUsageTotals } from "@/server/ai/usage-totals";
import { advisorFollowupContext } from "@/server/ai/followup-context";
import { hasApprovedKnowledge } from "@/server/rag/availability";
import { LOCAL_EMBEDDING_VERSION } from "@/server/rag/pipeline";

if (!["localhost", "127.0.0.1", "postgres", "host.docker.internal"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Disposable database required");
const id = "unlimited-" + crypto.randomUUID(), day = new Date("2050-01-01T00:00:00Z");
afterAll(async () => {
  await db.aiUsage.deleteMany({ where: { model: id } });
  await db.aiConversation.deleteMany({ where: { id } });
  await db.property.deleteMany({ where: { id } });
  await db.community.deleteMany({ where: { id } });
  await db.ragDocument.deleteMany({ where: { sourceId: id } });
  await db.ragSource.deleteMany({ where: { id } });
  await db.$disconnect();
});

test("SQL accounting includes more than ten thousand rows and conservative unknown usage", async () => {
  await db.aiUsage.createMany({ data: Array.from({ length: 10001 }, () => ({ provider: "mock", model: id, kind: "CHAT", status: "SUCCEEDED", createdAt: day, reservedTokens: 2 })) });
  await db.aiUsage.createMany({ data: [
    { provider: "mock", model: id, kind: "CHAT", status: "FAILED", createdAt: day, reservedTokens: 0 },
    { provider: "mock", model: id, kind: "NL_SEARCH", status: "SUCCEEDED", createdAt: day, reservedTokens: 0, promptTokens: 3, completionTokens: 4 },
    { provider: "mock", model: id, kind: "CHAT", status: "SUCCEEDED", createdAt: new Date(day.getTime() - 1), reservedTokens: 99999 },
  ] });
  expect(await aiDailyUsageTotals(db, day, 1024)).toEqual({ requestsToday: 10003, reservedTokensToday: 21033 });
});

test("saved follow-ups reread current public facts, retain demo/period, and exclude withdrawn references", async () => {
  await db.community.create({ data: { id, slug: id, name: "Synthetic local community", lat: 25, lng: 55, publicationStatus: "PUBLISHED" } });
  await db.property.create({ data: { id, slug: id, title: "Synthetic follow-up fixture", communityId: id, lat: 25, lng: 55, publicationStatus: "PUBLISHED", isDemoData: true,
    listings: { create: { priceMinor: 545400, listingType: "SHORT_TERM", rentFrequency: null, publishedAt: new Date(Date.now() - 1000) } } } });
  await db.aiConversation.create({ data: { id, sessionKey: "b".repeat(64), messageCount: 1000 } });
  await db.aiMessage.createMany({ data: Array.from({ length: 65 }, (_, n) => ({ conversationId: id, role: n % 2 ? "assistant" : "user", content: "Synthetic bounded historical message " + n })) });
  await db.aiTurn.create({ data: { conversationId: id, clientRequestId: id, requestHash: "a".repeat(64), deadlineAt: new Date(), status: "SUCCEEDED", resultJson: JSON.stringify({ attachments: [{ kind: "property_card", slug: id, isDemoData: false, title: "Do not trust stored facts" }] }) } });
  const context = await advisorFollowupContext(id);
  expect(context).toContain('"isDemoData":true'); expect(context).toContain('"rentFrequency":null');
  expect(context).toContain('"listingType":"SHORT_TERM"'); expect(context).toContain('"priceAed":5454');
  expect(context).not.toContain("Do not trust stored facts");
  expect(await advisorFollowupContext(id + "-unowned")).toBe("");
  await db.listing.updateMany({ where: { propertyId: id }, data: { rentFrequency: "MONTHLY" } });
  expect(await advisorFollowupContext(id)).toContain('"rentFrequency":"MONTHLY"');
  await db.community.update({ where: { id }, data: { publicationStatus: "DRAFT" } });
  expect(await advisorFollowupContext(id)).not.toContain('"slug":"' + id + '"');
  await db.community.update({ where: { id }, data: { publicationStatus: "PUBLISHED" } });
  await db.listing.updateMany({ where: { propertyId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await advisorFollowupContext(id)).not.toContain('"slug":"' + id + '"');
});

test("actual Advisor generation continues after sixty messages in unlimited mode, capped remains compatible", async () => {
  for (const mode of ["unlimited", "capped"]) {
    const child = Bun.spawn([process.execPath, "tests/fixtures/advisor-long-conversation.ts", id, mode], { stdout: "pipe", stderr: "pipe" });
    const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status) throw Error("Local long conversation fixture failed: " + err);
    const result = JSON.parse(out.split("\n").find(line => line.startsWith("LONG_EVIDENCE "))!.slice(14));
    expect(result.reply).toContain(mode === "unlimited" ? "No external model was called" : "length limit");
    expect((await db.aiConversation.findUniqueOrThrow({ where: { id } })).messageCount).toBe(1002);
  }
});

test("knowledge capability requires current approved indexed revisions and freshness", async () => {
  const now = new Date("2049-01-01T00:00:00Z"), past = new Date(now.getTime() - 1000), future = new Date(now.getTime() + 1000);
  await db.ragSource.create({ data: { id, title: "Synthetic local source", trustTier: "INTERNAL", isActive: true, isApproved: true, approvedById: id, approvedAt: past, verifiedAt: past, freshnessReviewDueAt: future } });
  await db.ragDocument.create({ data: { id, sourceId: id, slug: id, title: id, content: "Synthetic fixture", contentHash: "a".repeat(64), locale: "ar", status: "ACTIVE", approvedById: id, approvedAt: past,
    chunks: { create: { sequence: 0, documentVersion: 1, content: "Synthetic fixture", tokenCount: 4, embeddingJson: "[]", embeddingVersion: LOCAL_EMBEDDING_VERSION, isActive: true } } } });
  expect(await hasApprovedKnowledge("ar", now)).toBe(true);
  await db.ragDocument.update({ where: { id }, data: { version: 2 } });
  expect(await hasApprovedKnowledge("ar", now)).toBe(false);
  await db.ragChunk.updateMany({ where: { documentId: id }, data: { documentVersion: 2 } });
  expect(await hasApprovedKnowledge("ar", now)).toBe(true);
  await db.ragSource.update({ where: { id }, data: { freshnessReviewDueAt: past } });
  expect(await hasApprovedKnowledge("ar", now)).toBe(false);
});
