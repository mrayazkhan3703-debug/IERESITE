import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const examplePaths = new Set([".env.example", ".env.docker.example"]);

export const requiredSourcePaths = [
  "src/server/search/local-provider.ts",
  "src/server/monitoring/local-alerts.ts", "src/server/monitoring/local-transport.ts",
  "tests/local-alert-delivery.smtp.ts", "tests/local-alerts.test.ts",
  "tests/performance/local-navigation.spec.ts", "tests/static-asset-inventory.test.ts",
  "scripts/report-backup-operations.mjs", "tests/backup-operations-report.test.ts",
];

/** Required runtime/test sources must be in the publishable index, not just on disk. */
export function findMissingRequiredSources(trackedPaths) {
  const tracked = new Set(trackedPaths);
  return requiredSourcePaths.filter((path) => !tracked.has(path))
    .map((path) => `Required source missing from Git index: ${path}`);
}

/** Filename/build-context policy only; never reads environment or credential files.
 * @param {string[]} trackedPaths NUL-delimited Git index paths after splitting.
 * @param {string} dockerIgnore Docker ignore policy, not environment contents.
 */
export function findHygieneViolations(trackedPaths, dockerIgnore) {
  const violations = [];
  for (const path of trackedPaths) {
    const name = path.split("/").at(-1) ?? "";
    if (/^\.env(?:\.|$)/i.test(name) && !examplePaths.has(path)) {
      violations.push("Git index contains a non-allowlisted environment filename.");
    }
    if (/\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(name)) {
      violations.push("Git index contains a runtime database filename.");
    }
  }
  const patterns = dockerIgnore.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const required = [".env", ".env.*", "**/.env", "**/.env.*", ".git", "db/*.db", "db/*.sqlite*"];
  for (const pattern of required) {
    if (!patterns.includes(pattern)) violations.push(`Docker context exclusion missing: ${pattern}`);
  }
  const allowedExceptions = new Set([...examplePaths].map((path) => `!${path}`));
  for (const pattern of patterns) {
    // Prevent blanket/nested exceptions from overriding the exclusions above.
    if (pattern.startsWith("!") && !allowedExceptions.has(pattern)) {
      violations.push("Docker context has a non-allowlisted exception.");
    }
  }
  return [...new Set(violations)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  if (index.error || index.status !== 0) {
    console.error("Cannot verify Git index filenames; hygiene check fails closed.");
    process.exitCode = 1;
  } else {
    const trackedPaths = index.stdout.split("\0").filter(Boolean);
    const violations = [...findHygieneViolations(trackedPaths, readFileSync(".dockerignore", "utf8")),
      ...findMissingRequiredSources(trackedPaths)];
    if (violations.length) {
      for (const violation of violations) console.error(violation);
      process.exitCode = 1;
    } else {
      console.log("Repository filename/build-context hygiene passed. No credential contents were read; this is not a secret-content scan.");
    }
  }
}
