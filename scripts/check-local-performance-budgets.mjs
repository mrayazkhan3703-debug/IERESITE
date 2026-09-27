import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const candidateBudgets = { lcpMs: 2_500, cls: 0.1, scriptBodyBytes: 512_000, interactionFrameMs: 200 };
export function assessCandidateReport(report) {
  if (report.policy !== "CANDIDATE_LOCAL_NOT_APPROVED" || report.samples?.length !== 3) throw new Error("Invalid candidate report scope");
  return Object.entries(candidateBudgets).flatMap(([key, limit]) => {
    const measured = report.metrics?.[key];
    if (key === "interactionFrameMs" && report.route !== "/calculators/roi" && measured === null) return [];
    if (typeof measured !== "number" || !Number.isFinite(measured) || measured < 0) throw new Error("Missing/invalid candidate measurement");
    return measured > limit ? [{ key, limit, measured, status: "FAIL" }] : [];
  });
}

const reports = [];
function visit(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const target = resolve(path, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.name === "throttled-budget-metrics.json") reports.push(JSON.parse(readFileSync(target, "utf8")));
  }
}
function main() {
visit(resolve("test-results/performance"));
const expected = [
  ...["/", "/ar", "/buy", "/calculators/roi", "/consultation", "/account/login"].map((r) => `mobile-4g-cpu4:${r}`),
  ...["/", "/calculators/roi"].map((r) => `desktop-cpu2:${r}`),
];
const identities = reports.map((r) => `${r.profile?.name}:${r.route}`).sort();
if (reports.length !== 8 || JSON.stringify(identities) !== JSON.stringify(expected.sort())) {
  console.error("Missing/duplicate throttled evidence: expect all eight current cases"); process.exitCode = 1;
} else {
  const failures = reports.flatMap((r) => assessCandidateReport(r)
    .map((a) => ({ route: r.route, profile: r.profile.name, ...a })));
  console.log(JSON.stringify({ policy: "CANDIDATE_LOCAL_NOT_APPROVED", cases: reports.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch { console.error("Candidate performance evidence is missing/invalid"); process.exitCode = 1; }
}
