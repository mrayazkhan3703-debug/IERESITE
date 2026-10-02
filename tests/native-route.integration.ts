import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web-test:3000";
const origin = new URL(baseUrl);
if (origin.protocol !== "http:" || origin.username || origin.password || !["web-test", "web", "localhost", "127.0.0.1", "host.docker.internal"].includes(origin.hostname)) throw new Error("Native route tests require a local test server");
const id = `native-route-${crypto.randomUUID()}`;
const locales = ["", "/ar"];

async function cleanup() {
  await db.seoMetadata.deleteMany({ where: { routeKey: `projects/${id}` } });
  await db.project.deleteMany({ where: { id } });
  await db.developer.deleteMany({ where: { id } });
  await db.community.deleteMany({ where: { id } });
}

beforeAll(async () => {
  await db.$transaction(async (tx) => {
    await tx.community.create({ data: { id, slug: id, name: "SYNTHETIC native route fixture", lat: 25.12, lng: 55.2, publicationStatus: "PUBLISHED", isDemoData: true, locationPrecision: "APPROXIMATE" } });
    await tx.developer.create({ data: { id, slug: id, name: "SYNTHETIC native route fixture", isDemoData: true } });
    await tx.project.create({ data: { id, slug: id, name: "SYNTHETIC native route fixture", developerId: id, communityId: id, lat: 25.12, lng: 55.2, publicationStatus: "DRAFT", isDemoData: true, locationPrecision: "APPROXIMATE" } });
    await tx.seoMetadata.create({ data: { routeKey: `projects/${id}`, title: "SYNTHETIC route metadata fixture" } });
  });
});
afterAll(async () => { await cleanup(); await db.$disconnect(); });

test("all concrete static EN/AR modules retain server locale and canonical/privacy contracts", async () => {
  const contract = readFileSync("src/server/seo/route-contract.ts", "utf8");
  const section = contract.split("const EXACT_ROUTES:")[1].split("const DYNAMIC_ROUTES:")[0];
  for (const match of section.matchAll(/^  "([^"]+)": \{([^\n]+)\}/gm)) {
    const path = match[1];
    const canonicalPath = match[2].match(/canonicalPath: "([^"]+)"/)?.[1] ?? path;
    const noindex = match[2].includes("noindex: true");
    for (const prefix of locales) {
      const requested = `${prefix}${path === "/" ? "" : path}` || "/";
      const response = await fetch(`${baseUrl}${requested}`);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html.includes(`<html lang="${prefix ? "ar" : "en"}" dir="${prefix ? "rtl" : "ltr"}"`)).toBe(true);
      const canonical = `${prefix}${canonicalPath === "/" ? "" : canonicalPath}`;
      const expectedCanonical = `rel="canonical" href="http://localhost:3000${canonical}"`;
      if (!html.includes(expectedCanonical)) {
        const actualCanonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] ?? "missing";
        throw new Error(`Canonical mismatch for ${requested}: expected http://localhost:3000${canonical}, received ${actualCanonical}`);
      }
      expect(html.includes(`name="robots" content="${noindex ? "noindex, nofollow" : "index, follow"}"`)).toBe(true);
    }
  }
});

test("native entity routes reject draft rows, then accept explicit publication with server metadata", async () => {
  for (const prefix of locales) expect((await fetch(`${baseUrl}${prefix}/projects/${id}`)).status).toBe(404);
  await db.project.update({ where: { id }, data: { publicationStatus: "PUBLISHED" } });
  for (const prefix of locales) {
    const response = await fetch(`${baseUrl}${prefix}/projects/${id}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html.includes("SYNTHETIC route metadata fixture")).toBe(true);
    expect(html.includes(`rel="canonical" href="http://localhost:3000${prefix}/projects/${id}"`)).toBe(true);
  }
});

test("all native entity families fail closed for missing records in both locales", async () => {
  for (const prefix of locales) {
    for (const family of ["projects", "developers", "communities", "agents", "market/reports", "guides", "international", "insights"]) {
      const response = await fetch(`${baseUrl}${prefix}/${family}/${id}-missing`);
      expect(response.status).toBe(404);
      expect((await response.text()).includes("noindex")).toBe(true);
    }
  }
});
