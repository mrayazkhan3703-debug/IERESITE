"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, LoadingState, ProvenanceBadge } from "@/components/common";
import { formatDate } from "@/lib/money";
import { BookOpen, Clock, ArrowRight } from "lucide-react";

interface Entry {
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  readingMinutes: number | null;
  publishedAt: string | null;
  sourceName: string | null;
  sourceVerifiedAt: string | null;
}

export function ContentIndexView({
  variant,
  heading,
  kicker,
  description,
}: {
  variant: "guides" | "insights" | "international";
  heading: string;
  kicker: string;
  description: string;
}) {
  const [entries, setEntries] = React.useState<Entry[] | null>(null);

  usePageMeta({
    title: heading,
    description,
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: heading },
  });

  React.useEffect(() => {
    const type = variant === "insights" ? "articles" : "guides";
    api.get<{ entries: Entry[] }>(`/api/content/${type}`).then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [variant]);

  const base = variant === "insights" ? "/insights" : variant === "international" ? "/international" : "/guides";

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: heading }]} />
      <div className="mt-4">
        <SectionHeading kicker={kicker} title={heading} description={description} as="h1" />
      </div>

      {entries === null ? (
        <LoadingState rows={3} />
      ) : entries.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">Content coming soon.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e, i) => (
            <Link
              key={e.slug}
              to={`${base}/${e.slug}`}
              className={
                "group relative flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card p-6 shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_16px_36px_-12px_rgba(0,0,0,0.16)] " +
                (i === 0 ? "sm:col-span-2 lg:col-span-2" : "")
              }
            >
              {/* Hover accent line */}
              <span
                className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-brand to-brand-strong transition-transform duration-300 group-hover:scale-x-100"
                aria-hidden
              />
              <div className="flex items-center justify-between gap-3">
                <span className="kicker rounded-full bg-brand-soft/70 px-2.5 py-1">{e.category ?? variant}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {e.readingMinutes && (
                    <>
                      <Clock className="h-3 w-3" aria-hidden />
                      <span className="num">{e.readingMinutes} min</span>
                    </>
                  )}
                </span>
              </div>
              <h2
                className={
                  "mt-3 font-display font-semibold leading-snug group-hover:text-brand-strong " +
                  (i === 0 ? "text-2xl lg:text-3xl" : "text-xl")
                }
              >
                {e.title}
              </h2>
              <p className={"mt-2 line-clamp-3 flex-1 text-muted-foreground " + (i === 0 ? "text-sm lg:text-base" : "text-sm")}>
                {e.excerpt}
              </p>
              <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                {e.publishedAt && <span>{formatDate(e.publishedAt)}</span>}
                {e.sourceName && <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" aria-hidden /> {e.sourceName}</span>}
                {e.sourceVerifiedAt && <ProvenanceBadge chip={{ sourceType: "VERIFIED", sourceName: e.sourceName ?? undefined, verifiedAt: e.sourceVerifiedAt }} />}
                <ArrowRight
                  className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-brand"
                  aria-hidden
                />
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GuidesView() {
  return (
    <ContentIndexView
      variant="guides"
      heading="Dubai Property Guides"
      kicker="Investor education"
      description="Step-by-step guides for buying, selling, off-plan and international purchases — with verified fee and procedure references, review dates and source links."
    />
  );
}
