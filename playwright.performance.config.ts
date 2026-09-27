import { defineConfig } from "@playwright/test";
import browserConfig from "./playwright.config";

export default defineConfig({
  ...browserConfig,
  testDir: "./tests/performance",
  outputDir: "test-results/performance",
  retries: 0,
  timeout: 60_000,
});
