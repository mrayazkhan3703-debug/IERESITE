import { z } from "zod";

// Deliberately local-only candidate policy. These are not approved paging/SLOs.
export const localAlertPolicy = Object.freeze({
  pollMs: 30_000, confirmations: 2, backlogAgeSec: 60,
  reminderMs: 15 * 60_000, deliveryRetryMs: 60_000,
});
export const alertKeys = ["web.unavailable", "worker.unavailable", "queue.terminal", "queue.overdue"] as const;
export type AlertKey = typeof alertKeys[number];
export type Observation = Record<AlertKey, boolean | null>;
export type AlertNotice = { key: AlertKey; state: "FIRING" | "RESOLVED"; observedAt: string };
type Entry = { bad: number; good: number; notified: boolean; lastSent: number; lastAttempt: number | null };

const workerHealth = z.object({
  checks: z.object({ database: z.object({ ok: z.boolean() }), scheduler: z.object({ ok: z.boolean() }) }),
  scheduler: z.object({ running: z.boolean() }),
  queue: z.object({
    dead: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    oldestDueAgeSec: z.number().nonnegative().nullable(),
  }),
});
const webHealth = z.object({ status: z.literal("ok") });

export function evaluateLocalHealth(web: unknown, worker: unknown): Observation {
  const webResult = webHealth.safeParse(web);
  const result = workerHealth.safeParse(worker);
  const operational = result.success && result.data.checks.database.ok &&
    result.data.checks.scheduler.ok && result.data.scheduler.running;
  return {
    "web.unavailable": !webResult.success,
    "worker.unavailable": !operational,
    // Unknown is NOT healthy: an unavailable/malformed sample must not resolve a queue incident.
    "queue.terminal": result.success ? result.data.queue.dead + result.data.queue.failed > 0 : null,
    "queue.overdue": result.success ? (result.data.queue.oldestDueAgeSec ?? 0) > localAlertPolicy.backlogAgeSec : null,
  };
}

export class LocalAlertMonitor {
  private entries = new Map<AlertKey, Entry>();
  constructor(private readonly deliver: (notice: AlertNotice) => Promise<boolean>) {}

  async observe(observation: Observation, now: number): Promise<void> {
    for (const key of alertKeys) {
      const entry = this.entries.get(key) ?? { bad: 0, good: 0, notified: false, lastSent: 0, lastAttempt: null };
      this.entries.set(key, entry);
      const unhealthy = observation[key];
      if (unhealthy === null) { entry.bad = 0; entry.good = 0; continue; }
      entry.bad = unhealthy ? Math.min(entry.bad + 1, localAlertPolicy.confirmations) : 0;
      entry.good = unhealthy ? 0 : Math.min(entry.good + 1, localAlertPolicy.confirmations);
      const firing = entry.bad >= localAlertPolicy.confirmations &&
        (!entry.notified || now - entry.lastSent >= localAlertPolicy.reminderMs);
      const resolved = entry.notified && entry.good >= localAlertPolicy.confirmations;
      if (!firing && !resolved) continue;
      if (entry.lastAttempt !== null && now - entry.lastAttempt < localAlertPolicy.deliveryRetryMs) continue;
      entry.lastAttempt = now;
      let accepted = false;
      try { accepted = await this.deliver({ key, state: resolved ? "RESOLVED" : "FIRING", observedAt: new Date(now).toISOString() }); }
      catch { /* No provider exception/body in logs. A failed send remains retryable. */ }
      if (accepted) {
        entry.notified = !resolved;
        entry.lastSent = now;
      }
    }
  }
}
