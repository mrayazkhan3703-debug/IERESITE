import nodemailer from "nodemailer";
import type { AlertNotice } from "./local-alerts";

const allowedHealthUrls = new Set([
  "http://web:3000/api/health", "http://worker:3001/health",
]);

export async function readLocalHealth(url: string, allowFixture = false): Promise<unknown> {
  const parsed = new URL(url);
  const fixture = allowFixture && parsed.origin === "http://127.0.0.1:39031" &&
    ["/api/health", "/health"].includes(parsed.pathname) && !parsed.search && !parsed.hash;
  if (!allowedHealthUrls.has(url) && !fixture) throw new Error("Non-allowlisted monitor URL");
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5_000) });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_384) return null;
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return null; }
}

export function createLocalAlertDelivery(fixtureId?: string) {
  if (fixtureId !== undefined && !/^[a-f0-9]{32}$/.test(fixtureId)) throw new Error("Invalid local alert fixture ID");
  const recipient = fixtureId ? `iere-monitor-${fixtureId}@localhost` : "iere-operator@localhost";
  const transport = nodemailer.createTransport({
    host: fixtureId ? "monitor-test-catcher" : "mail-catcher", port: 1025,
    secure: false, ignoreTLS: true, connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 5_000,
  });
  return async (notice: AlertNotice): Promise<boolean> => {
    const result = await transport.sendMail({
      from: "IERE Local Monitor <iere-monitor@localhost>", to: recipient,
      subject: `[IERE LOCAL CANDIDATE] ${notice.state} ${notice.key}`,
      text: [
        "Local Docker monitoring only. Candidate thresholds, not approved production paging.",
        `State: ${notice.state}`, `Condition: ${notice.key}`, `Observed: ${notice.observedAt}`,
        "Review docs/agent/WORKER_RUNBOOK.md. Do not replay or delete unexplained dead letters.",
      ].join("\n"),
    });
    return result.accepted.map(String).includes(recipient);
  };
}
