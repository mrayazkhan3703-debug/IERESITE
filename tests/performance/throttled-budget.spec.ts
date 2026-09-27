import { expect, test } from "../accessibility/fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Candidate local regression policy, not approved field CWV/INP or a production SLO.
const budgets = { lcpMs: 2_500, cls: 0.1, scriptBodyBytes: 512_000, interactionFrameMs: 200 };
const profiles = [
  { name: "mobile-4g-cpu4", width: 390, height: 844, cpu: 4, latency: 150, download: 1_600_000 / 8, upload: 750_000 / 8,
    routes: ["/", "/ar", "/buy", "/calculators/roi", "/consultation", "/account/login"] },
  { name: "desktop-cpu2", width: 1280, height: 900, cpu: 2, latency: 40, download: 10_000_000 / 8, upload: 5_000_000 / 8,
    routes: ["/", "/calculators/roi"] },
];
type ElementSummary = { tag: string; region: string; width: number; height: number };
type ShiftSource = ElementSummary & { previous?: { x: number; y: number; width: number; height: number }; current?: { x: number; y: number; width: number; height: number } };
type BudgetCapture = {
  lcpMs: number | null; cls: number; longTaskMs: number;
  lcpElement: ElementSummary | null;
  shifts: { atMs: number; value: number; sources: ShiftSource[] }[];
};
declare global { interface Window { __iereBudget: BudgetCapture } }
test.use({ locale: "en-GB", timezoneId: "UTC", contextOptions: { reducedMotion: "reduce" } });

for (const profile of profiles) for (const route of profile.routes) {
  test(`candidate throttled budget: ${route} ${profile.name}`, async ({ page, blockedExternalOrigins }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: profile.width, height: profile.height });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: profile.latency,
      downloadThroughput: profile.download, uploadThroughput: profile.upload });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
    await page.addInitScript(() => {
      const metrics: BudgetCapture = { lcpMs: null, cls: 0, longTaskMs: 0, lcpElement: null, shifts: [] };
      const summarize = (node: Node | null | undefined): ElementSummary => {
        const el = node instanceof Element ? node : null;
        const rect = el?.getBoundingClientRect();
        return { tag: el?.tagName.toLowerCase() ?? "unknown",
          region: el?.closest("[data-consent-banner]") ? "consent" : el?.closest("header") ? "header" :
            el?.closest("footer") ? "footer" : el?.closest("#main-content") ? "main" : "outside-main",
          width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0) };
      };
      window.__iereBudget = metrics;
      let start = 0; let last = 0; let value = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) {
        metrics.lcpMs = e.startTime;
        metrics.lcpElement = summarize((e as PerformanceEntry & { element?: Element }).element);
      } })
        .observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const shift = e as PerformanceEntry & { hadRecentInput: boolean; value: number; sources?: { node?: Node; previousRect?: DOMRectReadOnly; currentRect?: DOMRectReadOnly }[] };
          if (shift.hadRecentInput) continue;
          if (metrics.shifts.length < 20) metrics.shifts.push({ atMs: shift.startTime, value: shift.value,
            sources: (shift.sources ?? []).slice(0, 5).map((s) => {
              const bounds = (rect?: DOMRectReadOnly) => rect ? { x: Math.round(rect.x), y: Math.round(rect.y),
                width: Math.round(rect.width), height: Math.round(rect.height) } : undefined;
              return { ...summarize(s.node), previous: bounds(s.previousRect), current: bounds(s.currentRect) };
            }) });
          if (shift.startTime - last < 1_000 && shift.startTime - start < 5_000) value += shift.value;
          else { start = shift.startTime; value = shift.value; }
          last = shift.startTime; metrics.cls = Math.max(metrics.cls, value);
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => { for (const e of list.getEntries()) metrics.longTaskMs += e.duration; })
        .observe({ type: "longtask", buffered: true });
    });
    const samples = [];
    try {
      for (let sample = 1; sample <= 3; sample++) {
        const response = await page.goto(route, { waitUntil: "networkidle" });
        expect(response?.status()).toBe(200);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator("#main-content h1").first()).toBeVisible();
        await page.waitForTimeout(3_000);
        const navigation = await page.evaluate(() => {
          const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
          return { ...window.__iereBudget, scriptBodyBytes: resources.filter((e) => new URL(e.name).pathname.endsWith(".js"))
            .reduce((sum, e) => sum + e.encodedBodySize, 0),
            slowResources: [...resources].sort((a, b) => b.duration - a.duration).slice(0, 6)
              .map((e) => ({ type: e.initiatorType, startMs: e.startTime, endMs: e.responseEnd, durationMs: e.duration,
                bytes: e.encodedBodySize })) };
        });
        expect(navigation.lcpMs).not.toBeNull();
        const interactions: number[] = [];
        if (route === "/calculators/roi") {
          // Real pointer input, not evaluate(element.click()). A browser-side next-frame
          // probe measures this synthetic scenario only; it is NOT Event Timing/INP.
          for (const name of ["Upside", "Downside", "Base", "Upside", "Base"]) {
            const tab = page.getByRole("tab", { name: new RegExp(`^${name}`) });
            await tab.scrollIntoViewIfNeeded();
            await tab.evaluate((element) => {
              element.addEventListener("pointerdown", () => {
                const start = performance.now();
                requestAnimationFrame(() => requestAnimationFrame(() => {
                  element.setAttribute("data-local-frame-ms", String(performance.now() - start));
                }));
              }, { once: true });
              element.removeAttribute("data-local-frame-ms");
            });
            await tab.click();
            await expect(tab).toHaveAttribute("aria-selected", "true");
            await expect(tab).toHaveAttribute("data-local-frame-ms", /\d/);
            const value = Number(await tab.getAttribute("data-local-frame-ms"));
            expect(Number.isFinite(value)).toBe(true);
            interactions.push(value);
          }
        }
        samples.push({ sample, ...navigation, interactionFrameMs: interactions.length ? Math.max(...interactions) : null });
      }
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const metrics = { lcpMs: median(samples.map((s) => s.lcpMs!)), cls: median(samples.map((s) => s.cls)),
        scriptBodyBytes: median(samples.map((s) => s.scriptBodyBytes)),
        interactionFrameMs: route === "/calculators/roi" ? median(samples.map((s) => s.interactionFrameMs!)) : null };
      const assessments = Object.entries(budgets).map(([key, limit]) => {
        const measured = metrics[key as keyof typeof metrics];
        return { key, limit, measured, status: measured === null ? "NOT_APPLICABLE" : measured <= limit ? "PASS" : "FAIL" };
      });
      const report = { route, profile, capturedAtUtc: new Date().toISOString(), budgets, metrics, samples, assessments,
        status: assessments.some((a) => a.status === "FAIL") ? "FAIL" : "PASS", policy: "CANDIDATE_LOCAL_NOT_APPROVED",
        scope: "Pinned Chromium, 3 repeat navigations per case, HTTP cache disabled, CDP CPU/network throttling, 3s post-idle window. Synthetic two-frame pointer response, NOT INP/field CWV. External map origins blocked.",
        blockedOrigins: [...blockedExternalOrigins].sort() };
      const path = testInfo.outputPath("throttled-budget-metrics.json");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(report, null, 2));
      await testInfo.attach("throttled-budget-metrics", { path, contentType: "application/json" });
      console.log(JSON.stringify({ route, profile: profile.name, metrics, candidateBudget: report.status }));
      // Collect all failing routes before enforcing: these assertions verify instrumentation,
      // not budget success. A separate aggregation command fails on candidate budget violations.
    } finally { await cdp.detach(); }
  });
}
