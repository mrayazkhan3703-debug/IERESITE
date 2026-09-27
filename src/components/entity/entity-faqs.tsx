"use client";

/**
 * Entity FAQs + related research (U08 — §16/§17 shared blocks).
 *
 * - EntityFaqs: published FAQ entries from the content API, deduplicated by
 *   question (seed re-runs duplicate rows) and filtered to the caller's
 *   relevant groups. These are process FAQs, never community-specific facts —
 *   the heading says so explicitly. Omitted entirely when nothing publishes.
 * - EntityResearch: published market reports + guides/articles relevant to the
 *   entity, filtered by caller-provided matchers. Gated reports show a gated
 *   badge and route to the report page. No fabricated relevance — the filter
 *   runs over real published titles.
 */

import * as React from "react";
import { api } from "@/lib/api-client";
import { t, type Locale } from "@/lib/i18n";
import { dedupeFaqs } from "./entity-shared";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Link } from "@/lib/router";
import { Badge } from "@/components/ui/badge";
import { FileText, BookOpen, Lock } from "lucide-react";

interface FaqRow {
  id: string;
  groupKey: string;
  question: string;
  answer: string;
}

const GROUP_ORDER = ["OFF_PLAN", "BUYING", "INVESTMENT", "INTERNATIONAL", "GENERAL", "AI_ADVISOR", "PRIVACY"];

export function EntityFaqs({
  groups,
  heading,
  locale,
}: {
  /** FAQ group keys relevant to this entity page (e.g. ["OFF_PLAN", "BUYING"]). */
  groups: string[];
  /** Explicit heading — keeps the "process FAQ" framing honest per caller. */
  heading: string;
  locale?: Locale;
}) {
  const [faqs, setFaqs] = React.useState<FaqRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ faqs: FaqRow[] }>(`/api/content/faqs?locale=${locale ?? (document.documentElement.lang === "ar" ? "ar" : "en")}`)
      .then((r) => {
        if (cancelled) return;
        const relevant = dedupeFaqs(r.faqs ?? []).filter((f) => groups.includes(f.groupKey));
        setFaqs(relevant);
      })
      .catch(() => !cancelled && setFaqs([]));
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (faqs === null || faqs.length === 0) return null;

  const sorted = [...faqs].sort((a, b) => GROUP_ORDER.indexOf(a.groupKey) - GROUP_ORDER.indexOf(b.groupKey));

  return (
    <section aria-labelledby="entity-faqs-heading">
      <h2 id="entity-faqs-heading" className="font-display text-xl font-semibold">{heading}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("entity.faqs.sub", locale)}</p>
      <Accordion type="single" collapsible className="mt-4 rounded-xl border border-border/70 bg-card px-4">
        {sorted.map((f) => (
          <AccordionItem key={f.id} value={f.id} className="border-border/60">
            <AccordionTrigger className="text-left text-sm font-medium hover:no-underline">
              {f.question}
            </AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{f.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

interface ReportRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  periodLabel: string | null;
  gated: boolean;
  publishedAt: string | null;
}

interface GuideRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentType: string;
  readingMinutes: number | null;
}

export function EntityResearch({
  title,
  reportFilter,
  guideSlugs,
  locale = "en",
}: {
  title: string;
  /** Matcher over published reports — relevance decided by the caller. */
  reportFilter: (r: ReportRow) => boolean;
  /** Relevant published guide/article slugs (empty = reports only). */
  guideSlugs?: string[];
  locale?: Locale;
}) {
  const [reports, setReports] = React.useState<ReportRow[] | null>(null);
  const [guides, setGuides] = React.useState<GuideRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ reports: ReportRow[] }>("/api/market/reports")
      .then((r) => !cancelled && setReports((r.reports ?? []).filter(reportFilter)))
      .catch(() => !cancelled && setReports([]));
    if (guideSlugs && guideSlugs.length > 0) {
      api
        .get<{ entries: GuideRow[] }>("/api/content/guides")
        .then((r) => {
          if (cancelled) return;
          const seen = new Set<string>();
          setGuides(
            (r.entries ?? []).filter((g) => {
              if (!guideSlugs.includes(g.slug) || seen.has(g.slug)) return false;
              seen.add(g.slug);
              return true;
            })
          );
        })
        .catch(() => !cancelled && setGuides([]));
    } else {
      setGuides([]);
    }
  }, []);

  const nothing = (reports ?? []).length === 0 && (guides ?? []).length === 0;
  if (reports === null || nothing) return null;

  return (
    <section aria-labelledby="entity-research-heading">
      <h2 id="entity-research-heading" className="font-display text-xl font-semibold">{title}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(reports ?? []).map((r) => (
          <Link
            key={r.id}
            to={`/market/reports/${r.slug}`}
            className="group flex flex-col rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              {r.gated && (
                <Badge variant="outline" className="gap-1 text-[10px] uppercase tracking-wide">
                  <Lock className="h-3 w-3" aria-hidden /> {t("entity.research.gated", locale)}
                </Badge>
              )}
            </div>
            <h3 className="mt-2 font-display font-semibold leading-snug group-hover:text-brand-strong">{r.title}</h3>
            {r.summary && <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{r.summary}</p>}
            {r.periodLabel && <p className="mt-2 text-[11px] text-muted-foreground">{r.periodLabel}</p>}
          </Link>
        ))}
        {(guides ?? []).map((g) => (
          <Link
            key={g.id}
            to={g.contentType === "ARTICLE" ? `/insights/${g.slug}` : `/guides/${g.slug}`}
            className="group flex flex-col rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              {g.readingMinutes && (
                <span className="num text-[11px] text-muted-foreground">
                  {t("entity.research.minutes", locale).replace("{n}", String(g.readingMinutes))}
                </span>
              )}
            </div>
            <h3 className="mt-2 font-display font-semibold leading-snug group-hover:text-brand-strong">{g.title}</h3>
            {g.excerpt && <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{g.excerpt}</p>}
          </Link>
        ))}
      </div>
    </section>
  );
}
