import { expect, test } from "./fixtures";

test("large original static portraits use small responsive same-origin delivery", async ({ page }) => {
  // UI-only placeholder roster; supplied image is reused only to test its delivery.
  await page.route("**/api/agents", (route) => route.fulfill({ json: { agents: [{
    id: "synthetic-image", slug: "synthetic-image", name: "SYNTHETIC image delivery fixture", jobTitle: "",
    department: "other", photoUrl: "/images/team/member-25.jpg", photo: null, phoneE164: null, whatsappE164: null,
  }] } }));
  await page.goto("/about/team");
  const portrait = page.getByRole("img", { name: "SYNTHETIC image delivery fixture", exact: true });
  await portrait.scrollIntoViewIfNeeded();
  await expect(portrait).toHaveAttribute("srcset", /\/_next\/image/);
  await expect.poll(() => portrait.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const source = await portrait.evaluate((image) => (image as HTMLImageElement).currentSrc);
  const url = new URL(source);
  expect(url.pathname).toBe("/_next/image");
  expect(Number(url.searchParams.get("w"))).toBeLessThanOrEqual(256);
  const delivered = await page.request.get(source);
  expect(delivered.ok()).toBe(true);
  expect((await delivered.body()).length).toBeLessThan(100_000);
});
