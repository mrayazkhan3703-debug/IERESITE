import { createServer } from "node:http";
import { LocalAlertMonitor, evaluateLocalHealth, localAlertPolicy } from "./server/monitoring/local-alerts";
import { createLocalAlertDelivery, readLocalHealth } from "./server/monitoring/local-transport";

// No application config, database client, provider keys, or domain writes.
let stopping = false;
let lastSampleAt = 0;
let lastDeliveryFailureAt = 0;
const send = createLocalAlertDelivery();
const monitor = new LocalAlertMonitor(async (notice) => {
  let accepted = false;
  try { accepted = await send(notice); } catch { /* Redacted failure only. */ }
  if (!accepted) lastDeliveryFailureAt = Date.now();
  console.log(JSON.stringify({ event: accepted ? "monitor.delivered" : "monitor.delivery_failed", ...notice }));
  return accepted;
});
const server = createServer((request, response) => {
  if (request.url !== "/health") { response.writeHead(404); response.end(); return; }
  const fresh = lastSampleAt > 0 && Date.now() - lastSampleAt < localAlertPolicy.pollMs * 3;
  response.writeHead(fresh && !stopping ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ service: "iere-local-monitor", sampling: fresh, stopping, lastDeliveryFailureAt,
    policy: "candidate-local-only", persistentState: false }));
});
server.listen(3002, "0.0.0.0");
let wake: (() => void) | null = null;
const stop = () => { stopping = true; wake?.(); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
try {
  while (!stopping) {
    const [web, worker] = await Promise.all([
      readLocalHealth("http://web:3000/api/health"), readLocalHealth("http://worker:3001/health"),
    ]);
    if (stopping) break;
    await monitor.observe(evaluateLocalHealth(web, worker), Date.now());
    lastSampleAt = Date.now();
    if (!stopping) await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { wake = null; resolve(); }, localAlertPolicy.pollMs);
      wake = () => { clearTimeout(timer); wake = null; resolve(); };
    });
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
