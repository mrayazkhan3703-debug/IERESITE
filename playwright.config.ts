import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/accessibility",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/accessibility",
  snapshotPathTemplate: "{testDir}/snapshots/{testFileName}/{arg}{ext}",
  timeout: 45_000,
  use: {
    baseURL: process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3000",
    browserName: "chromium",
    headless: true,
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
});
