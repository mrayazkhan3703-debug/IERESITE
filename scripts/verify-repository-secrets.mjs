import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

export const scannerImage = "ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f";
const binaryExtensions = /\.(?:png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|mp[34]|mov|pdf|zip|gz|tar|7z)$/i;

export function safeSnapshotPath(root, path) {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some((part) => !part || part === ".." || part === ".")) {
    throw new Error("Unsafe scan path");
  }
  const target = resolve(root, path);
  if (!target.startsWith(resolve(root) + sep)) throw new Error("Scan path escapes source root");
  return target;
}

export function sanitizeFinding(finding, scope) {
  // Never retain Match, Secret, Description, author/email, entropy or excerpts.
  const rawPath = String(finding.File ?? "").replaceAll("\\", "/").replace(/^\/snapshot\//, "");
  const file = /^[A-Za-z0-9 ._/-]{1,240}$/.test(rawPath) ? rawPath : "[unprintable-path]";
  return { scope, file,
    rule: /^[a-z0-9-]{1,80}$/.test(String(finding.RuleID)) ? finding.RuleID : "unknown-rule",
    line: Number.isSafeInteger(finding.StartLine) && finding.StartLine > 0 ? finding.StartLine : null,
    commit: /^[a-f0-9]{40}$/.test(String(finding.Commit)) ? finding.Commit : null };
}

export function reviewedFixture(finding, sourceLine, reviews) {
  const hash = createHash("sha256").update(sourceLine).digest("hex");
  return reviews.find((review) => review.file === finding.file && review.rule === finding.rule && review.sourceLineSha256 === hash);
}

function classifyFindings(root, findings) {
  const { reviews } = JSON.parse(readFileSync(join(root, "security", "reviewed-secret-fixtures.json"), "utf8"));
  if (!Array.isArray(reviews)) throw new Error("Review manifest invalid");
  return findings.map((finding) => {
    let source;
    if (finding.scope === "git-history") {
      if (!finding.commit || !finding.file || finding.file === "[unprintable-path]") return finding;
      const history = run(["git", "show", `${finding.commit}:${finding.file}`], { cwd: root });
      if (history.status !== 0) throw new Error("Cannot validate historical review scope");
      source = history.stdout;
    } else source = readFileSync(safeSnapshotPath(root, finding.file), "utf8");
    const line = source.split(/\r?\n/)[(finding.line ?? 0) - 1];
    if (line === undefined) throw new Error("Cannot validate review line");
    const review = reviewedFixture(finding, line, reviews);
    return review ? { ...finding, disposition: "REVIEWED_NON_CREDENTIAL", classification: review.classification } : finding;
  });
}

function run(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options });
  // Do not echo command stdout/stderr: even a failing scanner must not print source.
  if (result.error || result.status === null) throw new Error("Scan command could not complete");
  return result;
}

export function parseScannerReport(stdout, status) {
  if (![0, 1].includes(status)) throw new Error("Scanner failed; no clean-result claim");
  let findings;
  // A successful process without a report is not evidence of a clean scan.
  try { findings = JSON.parse(stdout); } catch { throw new Error("Scanner report invalid"); }
  if (!Array.isArray(findings) || findings.length > 10_000 ||
    findings.some((finding) => !finding || typeof finding !== "object" || Array.isArray(finding)) ||
    (status === 1 && !findings.length) || (status === 0 && findings.length)) {
    throw new Error("Scanner result scope invalid");
  }
  return findings;
}

function scan(root, source, scope) {
  const result = run(["docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--tmpfs", "/tmp",
    "--mount", `type=bind,source=${source},target=${scope === "git-history" ? "/repo" : "/snapshot"},readonly`,
    "--mount", `type=bind,source=${join(root, "security", "gitleaks.toml")},target=/policy.toml,readonly`,
    "-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=/repo",
    scannerImage, scope === "git-history" ? "git" : "dir", scope === "git-history" ? "/repo" : "/snapshot",
    ...(scope === "git-history" ? ["--log-opts=--all"] : []),
    "--config=/policy.toml", "--gitleaks-ignore-path=/nonexistent", "--ignore-gitleaks-allow",
    "--redact=100", "--no-banner", "--no-color", "--log-level=error", "--timeout=120",
    "--report-format=json", "--report-path=-"]);
  const findings = parseScannerReport(result.stdout, result.status);
  return findings.map((finding) => sanitizeFinding(finding, scope));
}

export function verifyRepositorySecrets(root = process.cwd()) {
  root = resolve(root);
  const index = run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root });
  if (index.status !== 0) throw new Error("Cannot enumerate repository source");
  const history = run(["git", "rev-parse", "--is-shallow-repository"], { cwd: root });
  if (history.status !== 0 || history.stdout.trim() !== "false") throw new Error("Full local Git history unavailable");
  const paths = [...new Set(index.stdout.split("\0").filter(Boolean))];
  if (!paths.length || paths.length > 5_000) throw new Error("Repository scan file bound exceeded");
  const taskDirectory = mkdtempSync(join(tmpdir(), "iere-secret-scan-"));
  const snapshot = join(taskDirectory, "snapshot");
  mkdirSync(snapshot);
  let files = 0; let binaryFilesExcluded = 0; let totalBytes = 0;
  try {
    for (const path of paths) {
      const source = safeSnapshotPath(root, path);
      if (!existsSync(source)) continue; // Deleted working files still covered in history.
      const stat = lstatSync(source);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Non-regular repository file requires separate review");
      if (binaryExtensions.test(path)) { binaryFilesExcluded++; continue; }
      totalBytes += stat.size;
      if (stat.size > 2 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) throw new Error("Repository text scan bound exceeded");
      const target = safeSnapshotPath(snapshot, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      files++;
    }
    const candidates = classifyFindings(root, [...scan(root, snapshot, "working-source"), ...scan(root, root, "git-history")]);
    const findings = candidates.filter((finding) => !finding.disposition);
    const reviewed = candidates.filter((finding) => finding.disposition);
    const report = { capturedAtUtc: new Date().toISOString(), scannerImage, status: findings.length ? "REVIEW_REQUIRED" : "PASS_SCOPED",
      scope: "Git-index and nonignored working text files plus all local Git history; ignored runtime env files not read. Binary assets excluded from working scan. No provider contact; secret excerpts omitted.",
      sourceFiles: files, sourceBytes: totalBytes, binaryFilesExcluded, findings, reviewed };
    const evidence = join(root, "test-results", "security");
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, "repository-secret-scan.json"), JSON.stringify(report, null, 2) + "\n");
    return report;
  } finally {
    // Only the exact mkdtemp-owned copy is removable, never the workspace/parent.
    if (dirname(taskDirectory) !== resolve(tmpdir()) || !/^iere-secret-scan-[A-Za-z0-9]+$/.test(basename(taskDirectory))) {
      throw new Error("Temporary scan cleanup target invalid");
    }
    rmSync(taskDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = verifyRepositorySecrets();
    console.log(JSON.stringify(report, null, 2));
    if (report.findings.length) process.exitCode = 1;
  } catch {
    console.error("Repository secret scan failed; no source, credentials or scanner error excerpts printed.");
    process.exitCode = 1;
  }
}
