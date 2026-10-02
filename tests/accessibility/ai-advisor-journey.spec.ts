import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";

const db = new PrismaClient();
const aiSessionToken = randomBytes(32).toString("base64url");
const consentToken = randomBytes(32).toString("base64url");
const aiSessionKey = createHash("sha256").update(aiSessionToken).digest("hex");
const consentSessionKey = createHash("sha256").update(consentToken).digest("hex");

async function cleanup() {
  const conversations = await db.aiConversation.findMany({ where: { sessionKey: aiSessionKey }, select: { id: true } });
  const conversationIds = conversations.map(({ id }) => id);
  await db.aiConversation.deleteMany({ where: { sessionKey: aiSessionKey } });
  if (conversationIds.length) {
    const remainingMessages = await db.aiMessage.count({ where: { conversationId: { in: conversationIds } } });
    const remainingTraces = await db.aiToolExecution.count({ where: { conversationId: { in: conversationIds } } });
    if (remainingMessages !== 0 || remainingTraces !== 0) {
      throw new Error("Synthetic AI conversation records were not fully cleaned up.");
    }
  }

  const websiteSession = await db.websiteSession.findUnique({ where: { sessionKey: consentSessionKey }, select: { id: true } });
  if (websiteSession) {
    await db.analyticsEvent.deleteMany({ where: { sessionId: websiteSession.id } });
    await db.attributionTouchpoint.deleteMany({ where: { sessionId: websiteSession.id } });
  }
  await db.consent.deleteMany({ where: { sessionKey: consentSessionKey } });
  await db.websiteSession.deleteMany({ where: { sessionKey: consentSessionKey } });

  const remainingConversations = await db.aiConversation.count({ where: { sessionKey: aiSessionKey } });
  const remainingConsent = await db.consent.count({ where: { sessionKey: consentSessionKey } });
  const remainingWebsiteSessions = await db.websiteSession.count({ where: { sessionKey: consentSessionKey } });
  if (remainingConversations !== 0 || remainingConsent !== 0 || remainingWebsiteSessions !== 0) {
    throw new Error("Synthetic AI browser fixtures were not fully cleaned up.");
  }
}

test.beforeAll(async () => {
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

test("AI advisor persists an anonymous local-mock conversation with optional consent denied", async ({ page }) => {
  test.setTimeout(90_000);
  const baseURL = process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3000";
  await page.context().addCookies([
    { name: "ie_ai_session", value: aiSessionToken, url: baseURL, httpOnly: true, sameSite: "Lax" },
    { name: "ie_consent_session", value: consentToken, url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);

  await page.goto("/advisor");
  await expect(page.getByRole("heading", { name: "AI Property Advisor" })).toBeVisible();
  const consentResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/analytics/consent" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Essential only", exact: true }).click();
  const consentResponse = await consentResponsePromise;
  expect(consentResponse.status()).toBe(200);

  const question = "Tell me what you can verify before answering.";
  await page.getByRole("textbox", { name: "Message the AI advisor" }).fill(question);
  const chatResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/ai/chat" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  const chatResponse = await chatResponsePromise;
  const responseBody = await chatResponse.json() as {
    conversationId: string;
    reply: string;
    citations: unknown[];
    toolCalls: unknown[];
    handoff: boolean;
    fallback: boolean;
  };
  expect(chatResponse.status(), JSON.stringify(responseBody)).toBe(200);
  const result = responseBody;
  expect(result.reply).toContain("Local AI mock is enabled. No external model was called");
  expect(result.citations).toEqual([]);
  expect(result.toolCalls).toEqual([]);
  expect(result.handoff).toBe(false);
  expect(result.fallback).toBe(false);
  await expect(page.getByRole("log", { name: "Advisor conversation" })).toContainText(result.reply);

  const conversation = await db.aiConversation.findUniqueOrThrow({ where: { id: result.conversationId } });
  expect(conversation).toMatchObject({
    userId: null,
    sessionKey: aiSessionKey,
    locale: "en",
    messageCount: 2,
    topicSummary: question,
    status: "ACTIVE",
  });
  const messages = await db.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" } });
  expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
    { role: "user", content: question },
    { role: "assistant", content: result.reply },
  ]);
  expect(await db.aiUsage.count({ where: { conversationId: conversation.id } })).toBe(0);

  const consent = await db.consent.findMany({ where: { subjectType: "VISITOR", sessionKey: consentSessionKey } });
  expect(consent).toHaveLength(3);
  expect(consent.every((row) => row.status === "DENIED")).toBe(true);
});
