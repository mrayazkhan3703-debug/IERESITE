import { expect, test } from "bun:test";
import { summarizeAssets } from "../scripts/audit-local-assets.mjs";

// Avoid the repository's local-* scratch-file ignore rule; this is CI source.

test("local asset inventory validates literal paths without claiming dynamic or provider coverage", () => {
  const result = summarizeAssets([{ url: "/images/brand/hero.jpg", bytes: 120 }, { url: "/brand/logo.png", bytes: 30 }], [
    { path: "src/example.tsx", text: 'const hero="/images/brand/hero.jpg"; const missing="/images/no.jpg"; const dynamic=`/images/${slug}.jpg`; const remote="https://provider.invalid/image.jpg";' },
  ]);
  expect(result.status).toBe("FAIL_STATIC_REFERENCES");
  expect(result.missing).toEqual([{ source: "src/example.tsx", asset: "/images/no.jpg" }]);
  expect(result.literalReferences).toBe(2);
  expect(result.dynamicTemplates).toBe(1);
  expect(result.totalBytes).toBe(150);
  expect(result.largest[0].bytes).toBe(120);
});

test("static reference inventory passes only its bounded scope", () => {
  expect(summarizeAssets([{ url: "/brand/logo.png", bytes: 20 }], [{ path: "src/logo.ts", text: 'const logo="/brand/logo.png";' }]).status).toBe("PASS_SCOPED");
});
