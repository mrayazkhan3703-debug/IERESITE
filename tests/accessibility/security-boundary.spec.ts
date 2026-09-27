import { expect, test } from "./fixtures";

test("browser blocks external origins before contacting them", async ({ page, blockedExternalOrigins }) => {
  await expect(page.goto("https://example.invalid/iere-local-network-denial")).rejects.toThrow();
  expect([...blockedExternalOrigins]).toEqual(["https://example.invalid"]);
});

test("anonymous requests cannot read admin data or perform account/admin operations", async ({ page }) => {
  const adminOverview = await page.request.get("/api/admin/overview");
  expect(adminOverview.status()).toBe(401);
  expect(await adminOverview.json()).toMatchObject({ code: "AUTH_REQUIRED" });

  const adminProperties = await page.request.get("/api/admin/properties");
  expect(adminProperties.status()).toBe(401);
  expect(await adminProperties.json()).toMatchObject({ code: "AUTH_REQUIRED" });

  const crossSiteMutation = await page.request.post("/api/admin/properties", { data: {} });
  expect(crossSiteMutation.status()).toBe(403);
  expect(await crossSiteMutation.json()).toMatchObject({ code: "CSRF" });

  const authenticatedShapeButAnonymous = await page.request.post("/api/admin/properties", {
    data: {},
    headers: { "X-Requested-With": "fetch" },
  });
  expect(authenticatedShapeButAnonymous.status()).toBe(401);
  expect(await authenticatedShapeButAnonymous.json()).toMatchObject({ code: "AUTH_REQUIRED" });

  const accountExport = await page.request.post("/api/account/export", {
    data: {},
    headers: { "X-Requested-With": "fetch" },
  });
  expect(accountExport.status()).toBe(401);
  expect(await accountExport.json()).toMatchObject({ code: "AUTH_REQUIRED" });
});
