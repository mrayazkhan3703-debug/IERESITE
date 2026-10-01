import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

for (const locale of ["en", "ar"] as const) for (const mobile of [false, true]) {
  test(`Advisor answer survives stalled search and reload ${locale} ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const id = `synthetic-browser-${locale}-${mobile}`;
    let submittedId = "";
    const reply = locale === "ar" ? "رد اختبار محفوظ" : "Saved test answer";
    let completed = false;
    await page.route("**/api/ai/conversations", route => route.fulfill({ status: 201, json: { conversationId: id } }));
    await page.route(`**/api/ai/conversations/${id}`, route => route.fulfill({ json: { id, messages: completed ? [{ role: "user", content: "Find an apartment" }, { role: "assistant", content: reply }] : [], turns: [] } }));
    await page.route("**/api/search/nl", async route => {
      // Fulfillment is deliberately slower than chat; answer acceptance must not await it.
      await new Promise(resolve => setTimeout(resolve, 5000));
      await route.fulfill({ json: { filters: {}, explanation: "" } }).catch(() => {});
    });
    await page.route("**/api/ai/chat", async route => {
      const body = route.request().postDataJSON();
      submittedId = body.clientRequestId;
      expect(body.conversationId).toBe(id);
      expect(await page.evaluate(() => localStorage.getItem("ie_advisor_conversation"))).toBe(id);
      completed = true;
      await route.fulfill({ json: { conversationId: id, reply, citations: [], toolCalls: [], handoff: false, fallback: false } });
    });
    await page.goto(locale === "ar" ? "/ar/advisor" : "/advisor");
    const consent = page.getByRole("button", { name: locale === "ar" ? "الضرورية فقط" : "Essential only", exact: true });
    if (await consent.isVisible()) await consent.click();
    await page.getByRole("textbox").fill(locale === "ar" ? "ابحث عن شقة" : "Find an apartment");
    await page.getByRole("textbox").press("Enter");
    await expect(page.getByText(reply, { exact: true })).toBeVisible({ timeout: 3500 });
    await expect(page.getByRole("button", { name: locale === "ar" ? "إيقاف الانتظار" : "Stop waiting", exact: true })).toHaveCount(0);
    expect(submittedId).toMatch(/^[a-f0-9]{32}$/);
    await page.reload();
    await expect(page.getByText(reply, { exact: true })).toBeVisible();
    const audit = await new AxeBuilder({ page }).include('main').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
  });
}

test("Advisor cancellation recovers a pending turn without submitting it again", async ({ page }) => {
  const id = "synthetic-pending-browser";
  let chatCalls = 0, finished = false;
  await page.route("**/api/ai/conversations", route => route.fulfill({ status: 201, json: { conversationId: id } }));
  await page.route("**/api/ai/chat", async route => {
    chatCalls++;
    await new Promise(resolve => setTimeout(resolve, 5000));
    await route.fulfill({ status: 202, json: { conversationId: id, status: "PENDING" } }).catch(() => {});
  });
  await page.route(`**/api/ai/conversations/${id}`, route => route.fulfill({ json: {
    id, messages: finished ? [{ role: "user", content: "Hello" }, { role: "assistant", content: "Recovered answer" }] : [{ role: "user", content: "Hello" }],
    turns: [{ clientRequestId: "pending-test-request-1234", status: finished ? "SUCCEEDED" : "PENDING", result: finished ? { conversationId: id, reply: "Recovered answer", citations: [], toolCalls: [], handoff: false, fallback: false } : null }],
  } }));
  await page.goto("/advisor");
  const consent = page.getByRole("button", { name: "Essential only", exact: true });
  if (await consent.isVisible()) await consent.click();
  await page.getByRole("textbox").fill("Hello"); await page.getByRole("textbox").press("Enter");
  await expect.poll(() => chatCalls).toBe(1);
  await page.getByRole("button", { name: "Stop waiting", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recover conversation", exact: true })).toBeVisible();
  finished = true;
  await page.getByRole("button", { name: "Recover conversation", exact: true }).click();
  await expect(page.getByText("Recovered answer", { exact: true })).toBeVisible();
  expect(chatCalls).toBe(1);
});
