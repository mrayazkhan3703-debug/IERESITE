/** U21 audit 2: t("key") usages vs dictionary coverage. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync("src/lib/i18n.ts", "utf8");
const enStart = src.indexOf("  en: {");
const arStart = src.indexOf("  ar: {");
const enBlock = src.slice(enStart, arStart);
const arBlock = src.slice(arStart, src.indexOf("\n};", arStart));
const keyRe = /"((?:[^"\\]|\\.)+)"\s*:\s*"/g;
const dict = new Set<string>();
for (const b of [enBlock, arBlock]) {
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(b))) dict.add(m[1]);
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|jsx?)$/.test(e)) yield p;
  }
}

// match t("key"), t('key', ...), and template keys t(`x`) ignored
const usageRe = /\bt\(\s*["'`]((?:[^"'\\])+?)["'`]\s*[),]/g;
const missing = new Map<string, string[]>();
let total = 0;
for (const f of walk("src")) {
  if (f.includes("i18n.ts")) continue;
  const code = readFileSync(f, "utf8");
  let m: RegExpExecArray | null;
  while ((m = usageRe.exec(code))) {
    total++;
    if (!dict.has(m[1])) {
      const arr = missing.get(m[1]) ?? [];
      arr.push(f);
      missing.set(m[1], arr);
    }
  }
}
console.log(`total static t() usages scanned: ${total}`);
console.log(`used-but-missing keys: ${missing.size}`);
for (const [k, files] of [...missing.entries()].sort()) {
  console.log(`  ?? ${k}  <- ${[...new Set(files.map((f) => f.replace("src/", "")))].slice(0, 3).join(", ")}`);
}
console.log(missing.size === 0 ? "USAGE: OK" : "USAGE: GAPS");
