import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Read-only, disposable CI comparison. Never fetch a hosted/customer origin.
const variants = [
  { name: 'baseline-repeat', origin: 'http://web-test:3000', fresh: false },
  { name: 'long-keepalive-repeat', origin: 'http://iere-navigation-keepalive:3000', fresh: false },
  { name: 'baseline-fresh-page', origin: 'http://web-test:3000', fresh: true },
];
const browser = await chromium.launch();
const rows = [];
try {
  for (const variant of variants) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce', serviceWorkers: 'block', locale: 'en-GB' });
    await context.route('**/*', route => new URL(route.request().url()).origin === variant.origin
      ? route.continue() : route.abort('blockedbyclient'));
    let page;
    let documentNetwork;
    for (let sample = 1; sample <= 3; sample++) {
      if (!page || variant.fresh) {
        if (page) await page.close();
        page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150,
          downloadThroughput: 200000, uploadThroughput: 93750 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        cdp.on('Network.responseReceived', event => {
          if (event.type === 'Document') documentNetwork = { timing: event.response.timing,
            protocol: event.response.protocol, connectionReused: event.response.connectionReused };
        });
        await page.addInitScript(() => {
          window.__navigationLcp = null;
          new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__navigationLcp = entry.startTime; })
            .observe({ type: 'largest-contentful-paint', buffered: true });
        });
      }
      documentNetwork = undefined;
      const response = await page.goto(variant.origin, { waitUntil: 'networkidle', timeout: 45000 });
      if (response?.status() !== 200) throw new Error('Unexpected local document status');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(3000);
      const measured = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        return { lcpMs: window.__navigationLcp, navigation: navigation.toJSON() };
      });
      rows.push({ variant: variant.name, sample, ...measured, documentNetwork });
      console.log(JSON.stringify({ variant: variant.name, sample, lcpMs: measured.lcpMs,
        requestStartMs: measured.navigation.requestStart, documentNetwork }));
    }
    await context.close();
  }
  await writeFile('test-results/navigation-diagnosis.json', JSON.stringify({
    scope: 'Disposable read-only local comparison, not release acceptance; original budgets stay unchanged', rows,
  }, null, 2));
} finally { await browser.close(); }
