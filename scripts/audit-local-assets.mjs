import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Deterministic static-reference check; dynamic/media/provider URLs are outside scope. */
export function summarizeAssets(assets, sources) {
  const known = new Set(assets.map((asset) => asset.url));
  const missing = [];
  let literalReferences = 0;
  let dynamicTemplates = 0;
  for (const source of sources) {
    for (const match of source.text.matchAll(/(["'`])(\/(?:images|brand)\/[^"'`\s?#]+)\1/g)) {
      if (match[2].includes("${")) { dynamicTemplates++; continue; }
      literalReferences++;
      if (!known.has(match[2])) missing.push({ source: source.path, asset: match[2] });
    }
  }
  return {
    status: missing.length ? "FAIL_STATIC_REFERENCES" : "PASS_SCOPED",
    fileCount: assets.length,
    totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    sourceFiles: sources.length, literalReferences, dynamicTemplates, missing,
    largest: [...assets].sort((a, b) => b.bytes - a.bytes).slice(0, 10),
    scope: "public/images and public/brand metadata; quoted literal references in src/db TS/TSX. No binary decoding, credentials, dynamic/media/provider URL verification or rights/source approval.",
  };
}

function walk(root, base = root, depth = 0) {
  if (depth > 20) throw new Error("Asset audit depth exceeded.");
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error("Asset audit refuses symbolic links.");
    const file = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(file, base, depth + 1));
    else if (entry.isFile()) files.push({ file, path: file.slice(base.length + 1).replaceAll("\\", "/") });
    if (files.length > 4096) throw new Error("Asset audit file bound exceeded.");
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const assets = ["images", "brand"].flatMap((folder) => walk(resolve("public", folder)).map(({ file, path }) => ({
      url: `/${folder}/${path}`, bytes: statSync(file).size,
    })));
    const sources = ["src", "db"].flatMap((folder) => walk(resolve(folder))
      .filter(({ file }) => [".ts", ".tsx"].includes(extname(file)))
      .map(({ file, path }) => {
        if (statSync(file).size > 4_000_000) throw new Error("Asset audit source bound exceeded.");
        return { path: `${folder}/${path}`, text: readFileSync(file, "utf8") };
      }));
    const report = { checkedAt: new Date().toISOString(), ...summarizeAssets(assets, sources), assets };
    const output = resolve("test-results/assets/local-assets.json");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, files: report.fileCount, bytes: report.totalBytes,
      sources: report.sourceFiles, references: report.literalReferences, missing: report.missing.length, dynamicTemplates: report.dynamicTemplates }));
    if (report.missing.length) process.exitCode = 1;
  } catch {
    console.error("Local asset metadata/static-reference audit failed closed; no source excerpts emitted.");
    process.exitCode = 1;
  }
}
