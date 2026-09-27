import { expect, test as base } from "@playwright/test";

export { expect };

export const test = base.extend<{ blockedExternalOrigins: Set<string> }>({
  blockedExternalOrigins: [async ({ context, baseURL }, use, testInfo) => {
    const allowedOrigin = new URL(baseURL ?? "http://127.0.0.1:3000").origin;
    const hostname = new URL(allowedOrigin).hostname;
    if (!["localhost", "127.0.0.1", "web-test", "web", "host.docker.internal"].includes(hostname)) {
      throw new Error("Local browser tests require a local application origin.");
    }
    const blocked = new Set<string>();
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== allowedOrigin) {
        // Record only origins; paths/queries may contain sensitive tokens.
        blocked.add(url.origin);
        await route.abort("blockedbyclient");
      } else {
        await route.continue();
      }
    });
    await use(blocked);
    if (blocked.size) await testInfo.attach("blocked-external-origins", {
      body: JSON.stringify([...blocked].sort()), contentType: "application/json",
    });
  }, { auto: true }],
});
