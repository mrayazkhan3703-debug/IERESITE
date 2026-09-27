/**
 * Next.js instrumentation — boots the background job scheduler (ADR-007)
 * and warms the search index on server start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureIndex } = await import("@/server/search/service");
    const { generateSitemap } = await import("@/server/seo/sitemap");
    // warm search index in background (first request would otherwise pay the cost)
    ensureIndex()
      .then(() => console.log("[instrumentation] search index ready"))
      .catch((err) => console.error("[instrumentation] index build failed:", err));
    // ensure sitemap has content
    generateSitemap().catch(() => {});
  }
}
