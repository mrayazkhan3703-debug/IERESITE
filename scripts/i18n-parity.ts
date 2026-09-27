/**
 * U21 one-off audit: i18n dictionary key parity between en and ar.
 * Parses src/lib/i18n.ts object literals (key: "value") per locale block.
 * Usage: bun run scripts/i18n-parity.ts
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/lib/i18n.ts", import.meta.url), "utf8");

function extractKeys(block: string): { keys: Set<string>; dupes: string[]; empty: string[] } {
  const keys = new Set<string>();
  const dupes: string[] = [];
  const empty: string[] = [];
  const re = /"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const k = m[1];
    if (keys.has(k)) dupes.push(k);
    keys.add(k);
    if (m[2].trim() === "") empty.push(k);
  }
  return { keys, dupes, empty };
}

const enStart = src.indexOf("  en: {");
const arStart = src.indexOf("  ar: {");
if (enStart < 0 || arStart < 0) {
  console.error("FATAL: could not locate en/ar dictionary blocks");
  process.exit(1);
}
const enBlock = src.slice(enStart, arStart);
const arEnd = src.indexOf("\n};", arStart);
const arBlock = src.slice(arStart, arEnd);

const en = extractKeys(enBlock);
const ar = extractKeys(arBlock);

const missingInAr = [...en.keys].filter((k) => !ar.keys.has(k)).sort();
const missingInEn = [...ar.keys].filter((k) => !en.keys.has(k)).sort();

console.log(`en keys: ${en.keys.size} (dupes: ${en.dupes.length}, empty: ${en.empty.length})`);
console.log(`ar keys: ${ar.keys.size} (dupes: ${ar.dupes.length}, empty: ${ar.empty.length})`);
if (en.dupes.length) console.log("en duplicate keys:", en.dupes.join(", "));
if (ar.dupes.length) console.log("ar duplicate keys:", ar.dupes.join(", "));
if (en.empty.length) console.log("en empty values:", en.empty.join(", "));
if (ar.empty.length) console.log("ar empty values:", ar.empty.join(", "));
console.log(`missing in ar (en-only): ${missingInAr.length}`);
missingInAr.forEach((k) => console.log(`  AR< ${k}`));
console.log(`missing in en (ar-only): ${missingInEn.length}`);
missingInEn.forEach((k) => console.log(`  EN< ${k}`));
console.log(
  missingInAr.length === 0 && missingInEn.length === 0 && !en.dupes.length && !ar.dupes.length
    ? "PARITY: OK"
    : "PARITY: MISMATCH"
);
