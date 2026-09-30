"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, LoadingState, ErrorState, ProvenanceBadge } from "@/components/common";
import { extractToc, ReadingProgress, TableOfContents } from "@/components/common/article-reading";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { formatDate } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { ContentBody, contentBlocksToToc } from "@/components/common/content-body";
import type { ContentBlock } from "@/lib/content-blocks";
import { BookOpen, ShieldCheck, CalendarClock, Phone } from "lucide-react";
import { useRoute } from "@/lib/router";

interface EntryDetail {
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  blocks: ContentBlock[] | null;
  category: string | null;
  tags: string[];
  readingMinutes: number | null;
  publishedAt: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceVerifiedAt: string | null;
  freshnessReviewDueAt: string | null;
  contentType: string;
  localeAlternates: { en: string; ar: string; "x-default": string } | null;
}

export function GuideArticleView({
  slug,
  base,
  baseLabel,
  fallbackCategory,
  leadContext,
}: {
  slug: string;
  base: "guides" | "insights" | "international" | "pages";
  baseLabel: string;
  fallbackCategory: string;
  leadContext?: { intent: string; entityTitle: string };
}) {
  const [entry, setEntry] = React.useState<EntryDetail | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const route = useRoute();
  const leadForm = useLeadForm();
  const articleRef = React.useRef<HTMLElement | null>(null);
  const toc = React.useMemo(() => entry?.blocks?.length ? contentBlocksToToc(entry.blocks) : extractToc(entry?.body ?? ""), [entry]);

  React.useEffect(() => {
    // Reset per-slug state (component instance is reused across slug navigations)
    setNotFound(false);
    setEntry(null);
    const section = base === "international" ? "international" : base;
    const endpoint = base === "international" ? "international" : base === "pages" ? "pages" : base === "insights" ? "articles" : "guides";
    api.get<{ entry: EntryDetail }>(`/api/content/${endpoint}?slug=${encodeURIComponent(slug)}&section=${section}&locale=${route.locale === "ar" ? "ar" : "en"}`)
      .then((r) => setEntry(r.entry))
      .catch(() => setNotFound(true));
  }, [slug, base, route.locale]);

  usePageMeta(
    entry
      ? {
          title: entry.title,
          description: entry.excerpt ?? undefined,
          localeAlternates: entry.localeAlternates,
          jsonLd: [
            {
              "@context": "https://schema.org",
              "@type": "Article",
              headline: entry.title,
              datePublished: entry.publishedAt,
              ...(entry.sourceName ? { publisher: { "@type": "Organization", name: entry.sourceName } } : {}),
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: "/" },
                { "@type": "ListItem", position: 2, name: baseLabel, item: `/${base}` },
                { "@type": "ListItem", position: 3, name: entry.title, item: `/${base}/${entry.slug}` },
              ],
            },
          ],
        }
      : {},
    [entry?.slug]
  );

  if (notFound) {
    return (
      <div className="container-page py-20">
        <ErrorState message="Article not found" />
        <div className="mt-6 text-center"><Button asChild variant="outline"><Link to={`/${base}`}>All {baseLabel.toLowerCase()}</Link></Button></div>
      </div>
    );
  }
  if (!entry) return <div className="container-page py-12"><LoadingState rows={3} /></div>;

  return (
    <div className="container-page py-8 pb-16">
      <ReadingProgress targetRef={articleRef} />
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: baseLabel, to: `/${base}` }, { label: entry.title }]} />

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_300px]">
        <article ref={articleRef} className="min-w-0 scroll-mt-24">
          <p className="kicker">{entry.category ?? fallbackCategory}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{entry.title}</h1>
          <p className="mt-3 text-lg text-muted-foreground">{entry.excerpt}</p>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-sand/40 px-4 py-3 text-xs text-muted-foreground">
            {entry.publishedAt && <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" aria-hidden /> Published {formatDate(entry.publishedAt)}</span>}
            {entry.readingMinutes && <span className="num">{entry.readingMinutes} min read</span>}
            {entry.sourceName && (
              <span className="flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5" aria-hidden />
                {entry.sourceUrl ? (
                  <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{entry.sourceName}</a>
                ) : (
                  entry.sourceName
                )}
              </span>
            )}
            {entry.sourceVerifiedAt && <ProvenanceBadge chip={{ sourceType: "VERIFIED", verifiedAt: entry.sourceVerifiedAt }} />}
            {entry.freshnessReviewDueAt && new Date(entry.freshnessReviewDueAt) < new Date() && (
              <span className="rounded bg-warning/15 px-2 py-0.5 font-semibold text-warning">Review due</span>
            )}
          </div>

          <div className="mt-8 max-w-2xl text-[15px] leading-relaxed">
            <ContentBody body={entry.body} blocks={entry.blocks} locale={route.locale === "ar" ? "ar" : "en"} />
          </div>
        </article>

        {/* Sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {toc.length >= 3 && <TableOfContents items={toc} />}
          <div className="rounded-xl border border-brand/30 bg-brand-faint p-5">
            <p className="kicker">Talk to an advisor</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {leadContext?.entityTitle ?? "Turn this guidance into a plan with a specialist."}
            </p>
            <Button
              className="mt-3 w-full"
              size="sm"
              onClick={() =>
                leadForm.open({
                  formId: `${base}_${slug}`,
                  intent: leadContext?.intent ?? "CONSULT",
                  entityType: "GUIDE",
                  entitySlug: slug,
                  entityTitle: entry.title,
                  title: "Book a consultation",
                })
              }
            >
              <Phone className="h-4 w-4" aria-hidden /> Book a consultation
            </Button>
            <Button asChild variant="ghost" size="sm" className="mt-2 h-auto p-0 text-xs text-brand-strong underline-offset-4 hover:underline">
              <Link to="/advisor">Ask the AI Advisor</Link>
            </Button>
          </div>
          <div className="mt-4 rounded-xl border border-info/30 bg-info/5 p-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-info">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Content governance
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Guides carry source links and verification dates; regulatory content is reviewed on a schedule.
              This is general information, not legal or tax advice.
            </p>
          </div>
        </aside>
      </div>

      <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />
    </div>
  );
}

export default function GuideView({ slug }: { slug: string }) {
  return <GuideArticleView slug={slug} base="guides" baseLabel="Guides" fallbackCategory="Guide" />;
}
