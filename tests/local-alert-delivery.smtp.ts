import { expect, test } from "bun:test";
import { z } from "zod";
import { evaluateLocalHealth, LocalAlertMonitor } from "@/server/monitoring/local-alerts";
import { createLocalAlertDelivery, readLocalHealth } from "@/server/monitoring/local-transport";

// Dedicated monitor-test profile only: not part of shared-database integrations.

test("local monitor confirms SMTP delivery, suppresses repeats and resolves only known healthy samples", async () => {
  const fixtureId = crypto.randomUUID().replaceAll("-", "");
  const recipient = `iere-monitor-${fixtureId}@localhost`;
  const healthy = { checks: { database: { ok: true }, scheduler: { ok: true } }, scheduler: { running: true },
    queue: { dead: 0, failed: 0, oldestDueAgeSec: null } };
  let phase: "terminal" | "unavailable" | "healthy" | "redirect" | "oversized" = "terminal";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 39031, fetch(request) {
    if (phase === "redirect") return new Response(null, { status: 302, headers: { location: "https://not-contacted.invalid/" } });
    if (phase === "oversized") return new Response("x".repeat(20_000));
    if (new URL(request.url).pathname === "/api/health") return Response.json({ status: "ok" });
    if (phase === "unavailable") return new Response("synthetic-sensitive-body-not-logged", { status: 503 });
    return Response.json(phase === "terminal" ? { ...healthy, queue: { ...healthy.queue, dead: 10 } } : healthy);
  } });
  const monitor = new LocalAlertMonitor(createLocalAlertDelivery(fixtureId));
  const sample = async (now: number) => {
    const [web, worker] = await Promise.all([
      readLocalHealth("http://127.0.0.1:39031/api/health", true),
      readLocalHealth("http://127.0.0.1:39031/health", true),
    ]);
    await monitor.observe(evaluateLocalHealth(web, worker), now);
  };
  try {
    await sample(0); await sample(30_000); await sample(60_000);
    phase = "unavailable";
    await sample(90_000); await sample(120_000);
    phase = "healthy";
    await sample(150_000); await sample(180_000); await sample(210_000);
    const response = await fetch(`http://monitor-test-catcher:8025/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`);
    expect(response.ok).toBe(true);
    const search = z.object({ messages: z.array(z.object({ ID: z.string(), Subject: z.string() })) }).parse(await response.json());
    expect(search.messages).toHaveLength(4);
    expect(search.messages.map((m) => m.Subject).sort()).toEqual([
      "[IERE LOCAL CANDIDATE] FIRING queue.terminal", "[IERE LOCAL CANDIDATE] FIRING worker.unavailable",
      "[IERE LOCAL CANDIDATE] RESOLVED queue.terminal", "[IERE LOCAL CANDIDATE] RESOLVED worker.unavailable",
    ].sort());
    for (const message of search.messages) {
      expect(message.ID).toMatch(/^[a-z0-9_-]+$/i);
      const result = await fetch(`http://monitor-test-catcher:8025/api/v1/message/${message.ID}`);
      expect(result.ok).toBe(true);
      const content = z.object({ Text: z.string() }).parse(await result.json());
      expect(content.Text).toContain("Candidate thresholds");
      expect(content.Text).toContain("Do not replay or delete unexplained dead letters");
      expect(content.Text).not.toContain("synthetic-sensitive-body");
    }
    phase = "redirect";
    expect(await readLocalHealth("http://127.0.0.1:39031/health", true)).toBeNull();
    phase = "oversized";
    expect(await readLocalHealth("http://127.0.0.1:39031/health", true)).toBeNull();
    console.log(JSON.stringify({ event: "monitor.fixture_verified", messages: search.messages.length, fixtureId }));
  } finally { await server.stop(true); }
}, 30_000);
