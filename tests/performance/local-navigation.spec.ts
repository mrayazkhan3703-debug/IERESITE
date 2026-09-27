import { expect, test } from "../accessibility/fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type Capture = {
  lcpMs: number | null;
  cls: number;
  longTaskCount: number;
  longTaskMs: number;
  layoutShifts: { atMs: number; value: number; sources: { element: string; fromY: number; toY: number }[] }[];
};
declare global {
  interface Window { __ierePerformance: Capture }
}

test.use({ locale: "en-GB", timezoneId: "UTC", contextOptions: { reducedMotion: "reduce" } });

for (const route of ["/", "/ar", "/buy", "/calculators/roi"]) {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`local delivery measurement: ${route} ${viewport.name}`, async ({ page, blockedExternalOrigins }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(() => {
        const capture: Capture = { lcpMs: null, cls: 0, longTaskCount: 0, longTaskMs: 0, layoutShifts: [] };
        let shiftSessionStart = 0;
        let lastShiftAt = 0;
        let shiftSessionValue = 0;
        window.__ierePerformance = capture;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) capture.lcpMs = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
              sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
            };
            if (!shift.hadRecentInput) {
              if (capture.layoutShifts.length < 30) {
                capture.layoutShifts.push({
                  atMs: shift.startTime,
                  value: shift.value,
                  sources: (shift.sources ?? []).map((source) => ({
                    // No text, URLs, input values, or arbitrary attributes in artifacts.
                    element: source.node instanceof Element ? source.node.tagName.toLowerCase() : "unknown",
                    fromY: source.previousRect.y,
                    toY: source.currentRect.y,
                  })),
                });
              }
              if (shift.startTime - lastShiftAt < 1_000 && shift.startTime - shiftSessionStart < 5_000) {
                shiftSessionValue += shift.value;
              } else {
                shiftSessionStart = shift.startTime;
                shiftSessionValue = shift.value;
              }
              lastShiftAt = shift.startTime;
              capture.cls = Math.max(capture.cls, shiftSessionValue);
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          capture.longTaskCount += list.getEntries().length;
          for (const entry of list.getEntries()) capture.longTaskMs += entry.duration;
        }).observe({ type: "longtask", buffered: true });
      });

      const samples = [];
      for (let sample = 1; sample <= 3; sample++) {
        const response = await page.goto(route, { waitUntil: "networkidle" });
        expect(response?.status()).toBe(200);
        await page.evaluate(() => document.fonts.ready);
        // Fixed observation window, rather than a production CWV observation.
        await page.waitForTimeout(1_000);
        const metrics = await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
          const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
          return {
            ttfbMs: navigation.responseStart - navigation.requestStart,
            domContentLoadedMs: navigation.domContentLoadedEventEnd,
            fcpMs: fcp,
            ...window.__ierePerformance,
            resourceCount: resources.length,
            transferredBytes: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
            encodedBodyBytes: resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
            scriptBodyBytes: resources.filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
              .reduce((sum, entry) => sum + entry.encodedBodySize, 0),
          };
        });
        expect(metrics.fcpMs).not.toBeNull();
        expect(metrics.lcpMs).not.toBeNull();
        expect(metrics.ttfbMs).toBeGreaterThanOrEqual(0);
        expect(metrics.resourceCount).toBeGreaterThan(0);
        samples.push({ sample, ...metrics });
      }

      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const report = {
        route,
        viewport,
        browser: testInfo.project.use.browserName,
        capturedAtUtc: new Date().toISOString(),
        scope: "Unthrottled local Docker browser; HTTP cache disabled by routing; 3 navigations per fresh context; external origins blocked; 1s post-networkidle observation.",
        samples,
        median: {
          ttfbMs: median(samples.map((value) => value.ttfbMs)),
          fcpMs: median(samples.map((value) => value.fcpMs!)),
          lcpMs: median(samples.map((value) => value.lcpMs!)),
          cls: median(samples.map((value) => value.cls)),
          scriptBodyBytes: median(samples.map((value) => value.scriptBodyBytes)),
        },
        blockedOrigins: [...blockedExternalOrigins].sort(),
        budget: "This harness records measurements without evaluating a performance budget. Production CWV remains unverified.",
      };
      const reportPath = testInfo.outputPath("local-navigation-metrics.json");
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      await testInfo.attach("local-navigation-metrics", { path: reportPath, contentType: "application/json" });
      console.log(JSON.stringify({ route, viewport: viewport.name, median: report.median }));
    });
  }
}
