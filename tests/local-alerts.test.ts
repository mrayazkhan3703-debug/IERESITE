import { expect, test } from "bun:test";
import { LocalAlertMonitor, evaluateLocalHealth, localAlertPolicy, type AlertNotice } from "@/server/monitoring/local-alerts";
import { createLocalAlertDelivery, readLocalHealth } from "@/server/monitoring/local-transport";

const healthy = { checks: { database: { ok: true }, scheduler: { ok: true } }, scheduler: { running: true },
  queue: { dead: 0, failed: 0, oldestDueAgeSec: null } };
const good = evaluateLocalHealth({ status: "ok" }, healthy);
const bad = { ...good, "queue.terminal": true };

test("health schema fails closed and unavailable data does not invent queue recovery", () => {
  expect(good).toEqual({ "web.unavailable": false, "worker.unavailable": false, "queue.terminal": false, "queue.overdue": false });
  expect(evaluateLocalHealth(null, null)).toEqual({ "web.unavailable": true, "worker.unavailable": true, "queue.terminal": null, "queue.overdue": null });
  expect(evaluateLocalHealth({ status: "ok" }, { ...healthy, queue: { ...healthy.queue, dead: 10 } })["queue.terminal"]).toBe(true);
  expect(evaluateLocalHealth({ status: "ok" }, { ...healthy, queue: { ...healthy.queue, dead: -1 } })["worker.unavailable"]).toBe(true);
  expect(evaluateLocalHealth({ status: "ok" }, { ...healthy, queue: { ...healthy.queue, oldestDueAgeSec: 61 } })["queue.overdue"]).toBe(true);
});

test("two samples fire, suppress repeats, remind after cooldown and confirm recovery", async () => {
  const sent: AlertNotice[] = [];
  const monitor = new LocalAlertMonitor(async (notice) => { sent.push(notice); return true; });
  await monitor.observe(bad, 0);
  expect(sent).toHaveLength(0);
  await monitor.observe(bad, 30_000);
  expect(sent.map((n) => n.state)).toEqual(["FIRING"]);
  await monitor.observe(bad, 60_000);
  expect(sent).toHaveLength(1);
  await monitor.observe(bad, 30_000 + localAlertPolicy.reminderMs);
  expect(sent).toHaveLength(2);
  await monitor.observe({ ...good, "queue.terminal": null }, 960_000);
  await monitor.observe(good, 990_000);
  expect(sent).toHaveLength(2);
  await monitor.observe(good, 1_020_000);
  expect(sent.map((n) => n.state)).toEqual(["FIRING", "FIRING", "RESOLVED"]);
  await monitor.observe(good, 1_050_000);
  expect(sent).toHaveLength(3);
});

test("failed delivery is retryable and no recovery is sent for an undelivered incident", async () => {
  let attempts = 0;
  const monitor = new LocalAlertMonitor(async () => { attempts++; throw new Error("synthetic-secret-do-not-log"); });
  await monitor.observe(bad, 0);
  await monitor.observe(bad, 30_000);
  await monitor.observe(bad, 60_000);
  expect(attempts).toBe(1);
  await monitor.observe(bad, 90_000);
  expect(attempts).toBe(2);
  await monitor.observe(good, 150_000);
  await monitor.observe(good, 180_000);
  expect(attempts).toBe(2);
});

test("a transient failure does not notify and sender/reader reject external targets", async () => {
  let sent = 0;
  const monitor = new LocalAlertMonitor(async () => { sent++; return true; });
  await monitor.observe(bad, 0);
  await monitor.observe(good, 30_000);
  await monitor.observe(bad, 60_000);
  expect(sent).toBe(0);
  expect(() => createLocalAlertDelivery("unsafe@external.example")).toThrow();
  await expect(readLocalHealth("https://external.example/health")).rejects.toThrow("Non-allowlisted");
  await expect(readLocalHealth("http://worker:3001/health?token=unsafe")).rejects.toThrow();
});
