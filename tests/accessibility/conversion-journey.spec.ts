import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";

const db = new PrismaClient();

async function removeSyntheticLead(email: string) {
  const contact = await db.contact.findFirst({ where: { email }, select: { id: true } });
  if (!contact) return;

  const lead = await db.lead.findFirst({ where: { contactId: contact.id }, select: { id: true } });
  if (lead) {
    const outbox = await db.outboxEvent.findMany({
      where: { aggregateType: "lead", aggregateId: lead.id },
      select: { id: true },
    });
    const jobKeys = outbox.map(({ id }) => `outbox:${id}:crm.lead.deliver`);
    if (jobKeys.length) await db.jobRun.deleteMany({ where: { idempotencyKey: { in: jobKeys } } });
    const bookings = await db.booking.findMany({ where: { leadId: lead.id }, select: { id: true } });
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { resourceType: "lead", resourceId: lead.id },
          { resourceType: "booking", resourceId: { in: bookings.map(({ id }) => id) } },
        ],
      },
    });
    await db.crmSyncRecord.deleteMany({ where: { leadId: lead.id } });
    await db.booking.deleteMany({ where: { leadId: lead.id } });
    await db.viewing.deleteMany({ where: { leadId: lead.id } });
    await db.outboxEvent.deleteMany({ where: { aggregateType: "lead", aggregateId: lead.id } });
    await db.lead.delete({ where: { id: lead.id } });
  }

  await db.contact.delete({ where: { id: contact.id } });
}

test.afterAll(async () => {
  const staleContacts = await db.contact.findMany({
    where: { email: { startsWith: "iere-e2e-" } },
    select: { email: true },
  });
  for (const contact of staleContacts) {
    if (contact.email) await removeSyntheticLead(contact.email);
  }
  const remainingFixtures = await db.contact.count({ where: { email: { startsWith: "iere-e2e-" } } });
  if (remainingFixtures !== 0) throw new Error("Synthetic conversion E2E records were not fully cleaned up.");
  await db.$disconnect();
});

test("property consultation persists a lead and reaches the local CRM adapter", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `iere-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`;

  try {
    await page.goto("/", { waitUntil: "networkidle" });
    const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
    await primaryNavigation.getByRole("button", { name: "Properties", exact: true }).click();
    await primaryNavigation.getByRole("link", { name: "Buy", exact: true }).click();
    await expect(page).toHaveURL(/\/buy$/);
    // The SSR shell/footer can expose headings before listing data commits.
    // Wait for an actual rendered result; this journey tests consultation,
    // while query-specific search behavior has its own route/API coverage.
    const propertyLink = page.locator('main a[href^="/properties/"]')
      .filter({ has: page.getByRole("heading", { level: 3 }) }).first();
    await expect(propertyLink).toBeVisible({ timeout: 15_000 });
    await propertyLink.click();
    await expect(page).toHaveURL(/\/properties\/[^/?]+$/);
    const propertySlug = new URL(page.url()).pathname.split("/").at(-1);
    expect(propertySlug).toBeTruthy();

    await page.getByRole("link", { name: "Book viewing", exact: true }).click();
    await expect(page).toHaveURL(/\/consultation\?property=/);
    await page.getByRole("radiogroup", { name: "Select date" }).getByRole("radio").first().click();
    await page.getByRole("radiogroup", { name: "Select time slot" }).getByRole("radio").first().click();
    await page.getByLabel(/Full name/).fill("Synthetic E2E Consultation");
    await page.getByLabel("Phone *").fill(`+9715${Math.floor(10000000 + Math.random() * 89999999)}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel(/I agree to be contacted about this request/).check();

    const consultationResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/consultations" && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Send consultation request" }).click();
    const consultationResponse = await consultationResponsePromise;
    expect(consultationResponse.status()).toBe(201);
    const result = await consultationResponse.json() as {
      leadId: string;
      booking?: { reference: string; status: string };
    };
    expect(result.leadId).toBeTruthy();
    expect(result.booking?.status).toBe("REQUESTED");
    await expect(page.getByRole("heading", { name: "Consultation request received" })).toBeVisible();
    await expect(page.getByText(/preferred time request, not a confirmed appointment/i)).toBeVisible();

    const lead = await db.lead.findUnique({ where: { id: result.leadId }, select: { intent: true, sourceChannel: true } });
    expect(lead).toEqual({ intent: "CONSULT", sourceChannel: "WEBSITE" });
    const booking = await db.booking.findUnique({ where: { leadId: result.leadId }, select: { status: true } });
    expect(booking?.status).toBe("REQUESTED");

    const event = await db.outboxEvent.findFirst({
      where: { aggregateType: "lead", aggregateId: result.leadId, eventType: "lead.created" },
      select: { id: true },
    });
    expect(event).not.toBeNull();
    const deliveryJobKey = `outbox:${event!.id}:crm.lead.deliver`;
    await expect.poll(async () =>
      (await db.jobRun.findUnique({ where: { idempotencyKey: deliveryJobKey }, select: { status: true } }))?.status,
      { timeout: 30_000, intervals: [250, 500, 1000] }
    ).toBe("SUCCEEDED");
    const crmRecord = await db.crmSyncRecord.findUnique({
      where: { idempotencyKey: `lead:${result.leadId}:v1` },
      select: { provider: true, status: true },
    });
    expect(crmRecord).toEqual({ provider: "localdev", status: "DELIVERED" });
  } finally {
    await removeSyntheticLead(email);
  }
});
