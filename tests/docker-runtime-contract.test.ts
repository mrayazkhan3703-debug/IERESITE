import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";

test("production runtime owns its working directory without running as root", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const runtime = dockerfile.split(" AS runtime")[1];
  expect(runtime).toBeDefined();
  expect(runtime).toContain("COPY --from=build --chown=bun:bun /app /app");
  expect(runtime).toMatch(/RUN chown bun:bun \/app\s+USER bun/);
  expect(runtime).not.toMatch(/USER root/);
});
