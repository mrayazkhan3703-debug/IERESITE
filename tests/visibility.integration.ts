import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { generateSitemap } from "@/server/seo/sitemap";

const baseUrl = process.env.TEST_BASE_URL ?? "http://host.docker.internal:3000";
const prefix = "visibility-contract";
const now = new Date();
const past = new Date(now.getTime() - 60_000);
const future = new Date(now.getTime() + 86_400_000);

async function cleanup() {
  await db.sitemapEntry.deleteMany({ where: { path: { contains: prefix } } });
  await db.project.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.community.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.developer.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.agent.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.testimonial.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.contentEntry.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.marketReport.deleteMany({ where: { id: { startsWith: prefix } } });
}

beforeAll(async () => {
  await cleanup();
  await db.developer.create({
    data: { id: `${prefix}-developer`, name: "Visibility Contract Developer", slug: `${prefix}-developer` },
  });
  await db.community.createMany({
    data: [
      { id: `${prefix}-community-public`, name: "Visibility Public Community", slug: `${prefix}-community-public`, lat: 25.2, lng: 55.3, publicationStatus: "PUBLISHED" },
      { id: `${prefix}-community-draft`, name: "Visibility Draft Community", slug: `${prefix}-community-draft`, lat: 25.2, lng: 55.3, publicationStatus: "DRAFT" },
    ],
  });
  await db.project.createMany({
    data: [
      { id: `${prefix}-project-public`, developerId: `${prefix}-developer`, communityId: `${prefix}-community-public`, name: "Visibility Public Project", slug: `${prefix}-project-public`, lat: 25.2, lng: 55.3, publicationStatus: "PUBLISHED" },
      { id: `${prefix}-project-draft`, developerId: `${prefix}-developer`, communityId: `${prefix}-community-public`, name: "Visibility Draft Project", slug: `${prefix}-project-draft`, lat: 25.2, lng: 55.3, publicationStatus: "DRAFT" },
    ],
  });
  await db.agent.createMany({
    data: [
      { id: `${prefix}-agent-public`, name: "Visibility Public Advisor", slug: `${prefix}-agent-public`, active: true, publicAdvisor: true },
      { id: `${prefix}-agent-private`, name: "Visibility Private Advisor", slug: `${prefix}-agent-private`, active: true, publicAdvisor: false },
    ],
  });
  await db.testimonial.createMany({
    data: [
      { id: `${prefix}-testimonial-public`, clientName: "Consented Client", quote: "Verified fixture", verified: true, consentCapturedAt: past },
      { id: `${prefix}-testimonial-no-consent`, clientName: "Private Client", quote: "Must not leak", verified: true, consentCapturedAt: null },
    ],
  });
  await db.contentEntry.createMany({
    data: [
      { id: `${prefix}-content-public`, slug: `${prefix}-content-public`, title: "Visible article", body: "Fixture", contentType: "ARTICLE", locale: "en", status: "PUBLISHED", publishedAt: past },
      { id: `${prefix}-content-future`, slug: `${prefix}-content-future`, title: "Future article", body: "Fixture", contentType: "ARTICLE", locale: "en", status: "PUBLISHED", publishedAt: future },
    ],
  });
  await db.marketReport.createMany({
    data: [
      { id: `${prefix}-report-public`, slug: `${prefix}-report-public`, title: "Visible report", status: "PUBLISHED", publishedAt: past },
      { id: `${prefix}-report-future`, slug: `${prefix}-report-future`, title: "Future report", status: "PUBLISHED", publishedAt: future },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("public API visibility contract", () => {
  test("map excludes draft communities and projects", async () => {
    const response = await fetch(`${baseUrl}/api/map`);
    expect(response.status).toBe(200);
    const body = await response.json() as { communities: { slug: string }[]; projects: { slug: string }[] };
    expect(body.communities.some((item) => item.slug === `${prefix}-community-public`)).toBe(true);
    expect(body.communities.some((item) => item.slug === `${prefix}-community-draft`)).toBe(false);
    expect(body.projects.some((item) => item.slug === `${prefix}-project-public`)).toBe(true);
    expect(body.projects.some((item) => item.slug === `${prefix}-project-draft`)).toBe(false);
  });

  test("advisor roster excludes active but non-public staff", async () => {
    const response = await fetch(`${baseUrl}/api/agents`);
    expect(response.status).toBe(200);
    const body = await response.json() as { agents: { slug: string }[] };
    expect(body.agents.some((item) => item.slug === `${prefix}-agent-public`)).toBe(true);
    expect(body.agents.some((item) => item.slug === `${prefix}-agent-private`)).toBe(false);
  });

  test("content requires consent and an effective publication time", async () => {
    const [testimonialResponse, articleResponse] = await Promise.all([
      fetch(`${baseUrl}/api/content/testimonials`),
      fetch(`${baseUrl}/api/content/articles`),
    ]);
    const testimonials = await testimonialResponse.json() as { testimonials: { id: string }[] };
    const articles = await articleResponse.json() as { entries: { slug: string }[] };
    expect(testimonials.testimonials.map((item) => item.id)).toContain(`${prefix}-testimonial-public`);
    expect(testimonials.testimonials.map((item) => item.id)).not.toContain(`${prefix}-testimonial-no-consent`);
    expect(articles.entries.map((item) => item.slug)).toContain(`${prefix}-content-public`);
    expect(articles.entries.map((item) => item.slug)).not.toContain(`${prefix}-content-future`);
  });

  test("future reports are absent from list, detail, and generated sitemap", async () => {
    const [listResponse, futureResponse] = await Promise.all([
      fetch(`${baseUrl}/api/market/reports`),
      fetch(`${baseUrl}/api/market/reports/${prefix}-report-future`),
    ]);
    const reports = await listResponse.json() as { reports: { slug: string }[] };
    expect(reports.reports.map((item) => item.slug)).toContain(`${prefix}-report-public`);
    expect(reports.reports.map((item) => item.slug)).not.toContain(`${prefix}-report-future`);
    expect(futureResponse.status).toBe(404);

    await generateSitemap();
    const paths = (await db.sitemapEntry.findMany({ where: { path: { contains: prefix } }, select: { path: true } })).map((item) => item.path);
    expect(paths).toContain(`/market/reports/${prefix}-report-public`);
    expect(paths).not.toContain(`/market/reports/${prefix}-report-future`);
    expect(paths).toContain(`/projects/${prefix}-project-public`);
    expect(paths).not.toContain(`/projects/${prefix}-project-draft`);
  });
});
