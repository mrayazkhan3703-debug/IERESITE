"use client";

import * as React from "react";
import { Link, useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, ProvenanceBadge, EmptyState, LoadingState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { BookOpen, CalendarClock } from "lucide-react";
import { useSiteSettings } from "@/components/providers/site-settings-provider";
import { publicPageCopy } from "@/lib/site-settings";

interface InternationalEntry {
  slug: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceVerifiedAt: string | null;
  freshnessReviewDueAt: string | null;
}

function dateLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : "";
}

export default function IntlView() {
  const route = useRoute();
  const locale = route.locale === "ar" ? "ar" : "en";
  const settings = useSiteSettings();
  const [entries, setEntries] = React.useState<InternationalEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    fetch(`/api/content/international?locale=${locale}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) { setEntries(data?.entries ?? []); setLoadFailed(!data); } })
      .catch(() => { if (active) { setEntries([]); setLoadFailed(true); } });
    return () => { active = false; };
  }, [locale]);

  usePageMeta({
    title: locale === "ar" ? "دليل المشترين الدوليين" : "International Buyers Hub",
    description: locale === "ar" ? "إرشادات منشورة ومراجعة بالمصادر للمشترين الدوليين." : "Published international buyer guidance with source links and review dates.",
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: "International Buyers Hub" },
  });

  const isArabic = locale === "ar";
  const cta = settings.globalCta;
  const ctaLabel = cta.key ? (isArabic ? "تواصل مع مستشار" : "Talk to an advisor") : (isArabic ? cta.labelAr : cta.labelEn) ?? "";
  return <div className="pb-16">
    <section className="border-b border-border/70 bg-sand/50 py-12 sm:py-16">
      <div className="container-page">
        <Breadcrumbs items={[{ label: isArabic ? "الرئيسية" : "Home", to: "/" }, { label: isArabic ? "للمشترين الدوليين" : "International Buyers" }]} />
        <p className="kicker mt-4">{publicPageCopy(settings, "internationalKicker", locale, isArabic ? "مركز المشترين الدوليين" : "International buyers hub")}</p>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {publicPageCopy(settings, "internationalTitle", locale, isArabic ? "إرشادات للمشترين من خارج الإمارات" : "Guidance for buyers purchasing from abroad")}
        </h1>
        <p className="mt-4 max-w-2xl text-balance text-muted-foreground">
          {publicPageCopy(settings, "internationalIntro", locale, isArabic ? "تظهر هنا الإرشادات المنشورة بعد مراجعة مصادرها وتواريخ تحديثها." : "This hub shows published guidance only after its sources and review dates have been checked.")}
        </p>
        <Button asChild size="lg" className="mt-7 rounded-full"><Link to={cta.to}>{ctaLabel}</Link></Button>
      </div>
    </section>

    <section className="container-page py-12">
      <SectionHeading kicker={isArabic ? "إرشادات مراجعة" : "Reviewed guidance"} title={isArabic ? "المقالات الدولية" : "International buyer guides"} />
      {entries === null ? <LoadingState rows={3} /> : loadFailed ? <EmptyState title={isArabic ? "تعذر تحميل الإرشادات" : "Guides could not be loaded"} description={isArabic ? "أعد تحميل الصفحة للمحاولة مجدداً." : "Refresh the page to try again."} /> : entries.length === 0 ? (
        <EmptyState title={isArabic ? "لا توجد إرشادات منشورة حالياً" : "No reviewed guides are published yet"} description={isArabic ? "ستظهر الإرشادات هنا بعد اعتماد المصدر وتاريخ المراجعة." : "Guides will appear here after an editor adds an authoritative source and a current review date."} />
      ) : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{entries.map((entry) => <article key={entry.slug} className="rounded-xl border border-border/70 bg-card p-6">
        <BookOpen className="h-5 w-5 text-brand" aria-hidden />
        <h2 className="mt-3 font-display text-lg font-semibold"><Link to={`/international/${entry.slug}`} className="hover:text-brand-strong">{entry.title}</Link></h2>
        {entry.excerpt && <p className="mt-2 text-sm text-muted-foreground">{entry.excerpt}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {entry.sourceName && entry.sourceUrl && <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{entry.sourceName}</a>}
          {entry.sourceVerifiedAt && <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{isArabic ? "تمت المراجعة" : "Verified"} {dateLabel(entry.sourceVerifiedAt)}</span>}
          {entry.sourceVerifiedAt && <ProvenanceBadge chip={{ sourceType: "VERIFIED", verifiedAt: entry.sourceVerifiedAt }} />}
        </div>
        <Link to={`/international/${entry.slug}`} className="mt-4 inline-block text-sm font-medium text-brand-strong">{isArabic ? "اقرأ الدليل ←" : "Read guide →"}</Link>
      </article>)}</div>}
      <p className="mt-8 text-xs text-muted-foreground">{isArabic ? "هذه معلومات عامة وليست استشارة قانونية أو ضريبية. تحقق من المتطلبات الحالية مع الجهة المختصة أو مستشار مرخص." : "This is general information, not legal or tax advice. Confirm current requirements with the relevant authority or licensed counsel."}</p>
    </section>
  </div>;
}
