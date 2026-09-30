"use client";

/**
 * International Investor Entry — current, published CMS guidance only.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Globe2, Languages } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";

interface ReviewedGuide { slug: string; title: string; excerpt: string | null }

export function InternationalEntry({ locale }: { locale: Locale }) {
  const [guides, setGuides] = React.useState<ReviewedGuide[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    setGuides(null);
    setFailed(false);
    fetch(`/api/content/international?locale=${locale}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) { setGuides(data?.entries?.slice(0, 3) ?? []); setFailed(!data); } })
      .catch(() => { if (active) { setGuides([]); setFailed(true); } });
    return () => { active = false; };
  }, [locale]);
  return (
    <section className="section-contrast section-sm" aria-labelledby="intl-heading">
      <div className="container-page">
        <div className="mb-6 max-w-2xl">
          <p className="kicker mb-2">{t("home.intl.kicker", locale)}</p>
          <h2 id="intl-heading" className="type-h2">
            {t("home.intl.title", locale)}
          </h2>
          <p className="mt-2 text-balance text-muted-foreground">{t("home.intl.subtitle", locale)}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {guides?.map((guide) => (
            <Link
              key={guide.slug}
              to={`/international/${guide.slug}`}
              className="group rounded-xl border border-border/70 bg-card p-5 transition-ui hover:border-brand/40 hover:shadow-md"
            >
              <Globe2 className="h-5 w-5 text-brand" aria-hidden />
              <h3 className="mt-3 font-display text-base font-semibold text-ink group-hover:text-brand-strong">
                {guide.title}
              </h3>
              {guide.excerpt && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{guide.excerpt}</p>}
              <span className="mt-3 inline-block text-sm font-medium text-brand-strong">{locale === "ar" ? "اقرأ الدليل ←" : "Read the guide →"}</span>
            </Link>
          ))}
        </div>
        {guides === null ? <p className="text-sm text-muted-foreground" role="status">{locale === "ar" ? "جارٍ تحميل الإرشادات المراجعة…" : "Loading reviewed guidance…"}</p> : guides.length === 0 ? <p className="text-sm text-muted-foreground">{failed ? (locale === "ar" ? "تعذر تحميل الإرشادات." : "Guidance could not be loaded.") : (locale === "ar" ? "ستظهر الإرشادات هنا بعد مراجعتها ونشرها." : "Guides appear here after source review and publication.")}</p> : null}
        <Link to="/international" className="mt-5 inline-block text-sm font-semibold text-brand-strong underline underline-offset-2">{locale === "ar" ? "مركز المشترين الدوليين" : "Visit the international buyers hub"}</Link>

        {locale === "ar" ? (
          <p className="mt-5 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-faint px-4 py-3 text-sm text-brand-strong">
            <Languages className="h-4 w-4 shrink-0" aria-hidden />
            هذا المركز متاح بالكامل بالعربية — يمكنك التبديل بين الإنجليزية والعربية من أعلى الصفحة في أي وقت.
          </p>
        ) : null}
      </div>
    </section>
  );
}
