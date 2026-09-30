"use client";

import * as React from "react";
import { Link, useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, EmptyState, LoadingState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { BriefcaseBusiness, CalendarClock } from "lucide-react";

type Opening = { slug: string; title: string; department: string; location: string; employmentType: string; workplaceType: string; summary: string; description: string; closesAt: string | null };
export default function CareerOpeningView({ slug }: { slug: string }) {
  const route = useRoute();
  const locale = route.locale === "ar" ? "ar" : "en";
  const [opening, setOpening] = React.useState<Opening | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    fetch(`/api/careers/openings/${encodeURIComponent(slug)}?locale=${locale}`).then((response) => response.ok ? response.json() : null).then((data) => { if (active) { setOpening(data?.opening ?? null); setFailed(!data); } }).catch(() => { if (active) { setFailed(true); setOpening(null); } });
    return () => { active = false; };
  }, [slug, locale]);
  usePageMeta(opening ? { title: `${opening.title} — Careers`, description: opening.summary } : {} , [opening?.slug]);
  if (!opening) return <div className="container-page py-16">{failed ? <EmptyState title="Opening not found" description="This role may have closed or is no longer available." /> : <LoadingState rows={3} />}</div>;
  const topic = `Application: ${opening.title}`;
  return <article className="container-page py-8 pb-16">
    <Breadcrumbs items={[{ label: locale === "ar" ? "الرئيسية" : "Home", to: "/" }, { label: locale === "ar" ? "الوظائف" : "Careers", to: "/careers" }, { label: opening.title }]} />
    <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-border/70 bg-card p-6 sm:p-10">
      <BriefcaseBusiness className="h-6 w-6 text-brand" aria-hidden />
      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">{opening.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{opening.department} · {opening.location} · {opening.employmentType} · {opening.workplaceType}</p>
      {opening.closesAt && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{locale === "ar" ? "آخر موعد" : "Applications close"}: {new Date(opening.closesAt).toLocaleDateString()}</p>}
      <p className="mt-6 text-lg font-medium">{opening.summary}</p>
      <div className="mt-5 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85">{opening.description}</div>
      <Button asChild size="lg" className="mt-8"><Link to="/contact" query={{ topic }}>{locale === "ar" ? "تواصل للتقديم" : "Apply via contact"}</Link></Button>
    </div>
  </article>;
}
