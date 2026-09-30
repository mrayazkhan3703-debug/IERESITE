"use client";

/**
 * Developer Detail V2 (U08 — V2 §17).
 *
 * Developer intelligence page:
 *  - overview + verification status badge (existing field) + delivery summary
 *    aggregated from real projects (total / completed / under construction);
 *  - Current projects vs Completed projects in two partitions (status split),
 *    each card carrying community link, inventory counts (declared total units
 *    AND actual unit records — both shown when they differ), starting price
 *    (formatAEDPrecise) and handover quarter;
 *  - locations summary — community chips across the portfolio;
 *  - payment-plan patterns — aggregated from the developer's PUBLISHED plan
 *    schedules via planStructure (e.g. "10 / 50 / 40 / 0"); presented as
 *    observed patterns with verification badges, no editorializing;
 *  - related market data — one line per community (avg price/sqft, DataStateBadge);
 *  - articles/reports + FAQs (published content only);
 *  - RED LINE (§17): no "best developer" scores, no invented ratings — every
 *    aggregated figure links back to project-level source fields.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { useRoute } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, ProvenanceBadge, ErrorState, LoadingState } from "@/components/common";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { formatNumber, formatDate } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import { resolveMetricState } from "@/lib/data-state";
import { localeOf, t } from "@/lib/i18n";
import { WHATSAPP_MESSAGES } from "@/lib/config";
import { useSiteSettings } from "@/components/providers/site-settings-provider";
import { events } from "@/lib/analytics-tracker";
import {
  handoverPresentation,
  humanizeTitle,
  planStructure,
  planStructureSegments,
  relativeTime,
  type DeveloperDetailV2,
  type CommunityDetailV2,
} from "@/components/entity/entity-shared";
import { EntityMap } from "@/components/entity/entity-map";
import { EntityFaqs, EntityResearch } from "@/components/entity/entity-faqs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ExternalLink, Phone, MapPin, HardHat, CheckCircle2, Layers, FileText, Info, MessageCircle } from "lucide-react";

export default function DeveloperDetailView({ slug }: { slug: string }) {
  const contact = useSiteSettings().contact;
  const [data, setData] = React.useState<DeveloperDetailV2 | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [communityMetrics, setCommunityMetrics] = React.useState<CommunityDetailV2 | null>(null);
  const leadForm = useLeadForm();
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  React.useEffect(() => {
    setNotFound(false);
    setData(null);
    setCommunityMetrics(null);
    api
      .get<DeveloperDetailV2>(`/api/developers/${slug}`)
      .then((d) => {
        setData(d);
        /* Related market data — first active project's community (single line) */
        const firstCommunity = d.projects.find((p) => p.status === "UNDER_CONSTRUCTION")?.community ?? d.projects[0]?.community ?? null;
        if (firstCommunity) {
          api
            .get<CommunityDetailV2>(`/api/communities/${firstCommunity.slug}`)
            .then((c) => setCommunityMetrics(c))
            .catch(() => setCommunityMetrics(null));
        }
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  usePageMeta(
    data
      ? {
          title: `${data.name} — Projects, Track Record & Developer Profile`,
          description: data.summary ?? `${data.name} developer profile: current projects, communities, payment plans and verified delivery information.`,
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "Organization",
            url: `/developers/${data.slug}`,
            name: data.name,
            description: data.summary ?? undefined,
            ...(data.websiteUrl ? { sameAs: [data.websiteUrl] } : {}),
          },
        }
      : {},
    [data?.id]
  );

  /* Payment-plan patterns — group plans by derived structure signature (hoisted
   * above early returns so hook order is stable across renders) */
  const planPatterns = data?.paymentPlanPatterns;
  const patterns = React.useMemo(() => {
    if (!planPatterns) return [];
    const groups = new Map<string, { segments: string; projects: { slug: string; name: string }[]; verificationStatuses: Set<string>; installmentsCount: number }>();
    for (const plan of planPatterns) {
      const s = planStructure(plan.installments);
      const sig = planStructureSegments(s);
      const e = groups.get(sig) ?? { segments: sig, projects: [], verificationStatuses: new Set<string>(), installmentsCount: plan.installments.length };
      e.projects.push({ slug: plan.projectSlug, name: plan.projectName });
      e.verificationStatuses.add(plan.verificationStatus);
      groups.set(sig, e);
    }
    return Array.from(groups.values()).sort((a, b) => b.projects.length - a.projects.length);
  }, [planPatterns]);

  if (notFound) {
    return (
      <div className="container-page py-20">
        <ErrorState message={t("developer.detail.notFound", locale)} />
        <div className="mt-6 text-center"><Button asChild variant="outline"><Link to="/developers">{t("developer.detail.backToDevelopers", locale)}</Link></Button></div>
      </div>
    );
  }
  if (!data) return <div className="container-page py-12"><LoadingState rows={3} /></div>;

  const active = data.projects.filter((p) => ["OFF_PLAN", "UNDER_CONSTRUCTION"].includes(p.status));
  const delivered = data.projects.filter((p) => !["OFF_PLAN", "UNDER_CONSTRUCTION"].includes(p.status));

  /* Locations summary — community chips across the portfolio */
  const communityMap = new Map<string, { name: string; slug: string; count: number }>();
  for (const p of data.projects) {
    const e = communityMap.get(p.community.slug) ?? { name: p.community.name, slug: p.community.slug, count: 0 };
    e.count += 1;
    communityMap.set(p.community.slug, e);
  }
  const locations = Array.from(communityMap.values()).sort((a, b) => b.count - a.count);

  /* Related market data — avg ppsf from the anchor community */
  const anchorPpsf = communityMetrics?.avgPricePerSqftMinor ? Number(communityMetrics.avgPricePerSqftMinor) / 100 : null;

  const totalDeclaredUnits = data.projects.reduce((s, p) => s + (p.totalUnits ?? 0), 0);
  const totalUnitRecords = data.projects.reduce((s, p) => s + p.unitCount, 0);

  const openBriefing = () =>
    leadForm.open({
      formId: `developer_${slug}`,
      intent: "INVEST",
      entityType: "DEVELOPER",
      entitySlug: slug,
      entityId: data.id,
      entityTitle: `${data.name} developer briefing`,
      title: t("developer.cta.briefingTitle", locale).replace("{d}", data.name),
    });

  const verifiedAt = relativeTime(data.lastVerifiedAt) ?? (data.lastVerifiedAt ? formatDate(data.lastVerifiedAt) : null);
  const verifiedState = resolveMetricState({ verificationStatus: data.verificationStatus, retrievedAt: data.lastVerifiedAt });

  return (
    <div className="container-page py-8 pb-16">
      <Breadcrumbs items={[{ label: t("nav.developers"), to: "/developers" }, { label: data.name }]} />

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-12">
          {/* Header + delivery summary */}
          <section aria-labelledby="dev-heading">
            <div className="flex items-start gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-brand-soft font-display text-2xl font-semibold text-brand-strong" aria-hidden>
                {data.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 id="dev-heading" className="font-display text-3xl font-semibold tracking-tight">{data.name}</h1>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-brand" aria-hidden />
                    {humanizeTitle(data.verificationStatus)}
                    {verifiedAt && ` · ${t("project.summary.verified", locale).replace("{t}", verifiedAt)}`}
                  </span>
                  {data.foundedYear && <span className="num">{t("developer.header.founded", locale)} {data.foundedYear}</span>}
                  {data.websiteUrl && (
                    <a href={data.websiteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 underline underline-offset-2 transition-ui hover:text-foreground">
                      {t("developer.header.website", locale)} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                  <DataStateBadge state={verifiedState} />
                </p>
              </div>
            </div>

            {data.summary && <p className="mt-5 max-w-2xl text-lg text-muted-foreground">{data.summary}</p>}
            {data.description && <p className="mt-4 whitespace-pre-line leading-relaxed text-foreground/85">{data.description}</p>}

            {/* Delivery summary — aggregated from real projects */}
            <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-border/70 bg-card p-5 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">{t("developer.delivery.total", locale)}</dt>
                <dd className="num mt-1 text-2xl font-semibold">{formatNumber(data.deliverySummary.total)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("developer.delivery.underConstruction", locale)}</dt>
                <dd className="num mt-1 text-2xl font-semibold">{formatNumber(data.deliverySummary.underConstruction)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("developer.delivery.offPlan", locale)}</dt>
                <dd className="num mt-1 text-2xl font-semibold">{formatNumber(data.deliverySummary.offPlan)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("developer.delivery.completed", locale)}</dt>
                <dd className="num mt-1 text-2xl font-semibold">{formatNumber(data.deliverySummary.completed)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("developer.delivery.footnote", locale)}
              {totalDeclaredUnits > 0 && (
                <>
                  {" "}
                  {t("developer.delivery.unitsFootnote", locale)
                    .replace("{declared}", formatNumber(totalDeclaredUnits))
                    .replace("{records}", formatNumber(totalUnitRecords))}
                </>
              )}
            </p>

            {/* Locations summary */}
            {locations.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("developer.locations.title", locale)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {locations.map((c) => (
                    <Link
                      key={c.slug}
                      to={`/communities/${c.slug}`}
                      className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm transition-ui hover:border-brand/50"
                    >
                      <MapPin className="h-3.5 w-3.5 text-brand" aria-hidden /> {c.name}
                      <span className="num rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{formatNumber(c.count)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Current projects */}
          <section aria-labelledby="active-heading">
            <SectionHeadingA kicker={t("developer.projects.currentKicker", locale)} title={t("developer.projects.current", locale)} />
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              {active.map((p) => (
                <ProjectTile key={p.id} p={p} locale={locale} />
              ))}
              {active.length === 0 && <p className="text-sm text-muted-foreground">{t("developer.projects.noCurrent", locale)}</p>}
            </div>
          </section>

          {/* Completed projects */}
          {delivered.length > 0 && (
            <section aria-labelledby="delivered-heading">
              <SectionHeadingA kicker={t("developer.projects.trackRecord", locale)} title={t("developer.projects.completed", locale)} />
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                {delivered.map((p) => (
                  <ProjectTile key={p.id} p={p} locale={locale} />
                ))}
              </div>
            </section>
          )}

          {/* Payment-plan patterns */}
          {patterns.length > 0 && (
            <section aria-labelledby="plans-heading">
              <h2 id="plans-heading" className="font-display text-xl font-semibold">{t("developer.plans.title", locale)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("developer.plans.sub", locale)}</p>
              <div className="mt-4 space-y-4">
                {patterns.map((pat) => (
                  <div key={pat.segments} className="rounded-xl border border-border/70 bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="num font-display text-lg font-semibold">
                        {t("developer.plans.structureLabel", locale)} <span className="text-brand-strong">{pat.segments}</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {[...pat.verificationStatuses].map((v) => (
                          <ProvenanceBadge key={v} chip={{ sourceType: v === "VERIFIED" ? "VERIFIED" : v === "PUBLISHED" ? "PUBLISHED" : "UNVERIFIED", sourceName: t("project.plan.source", locale) }} />
                        ))}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("developer.plans.segmentsLegend", locale)}
                      {" · "}
                      {t("project.plan.stagesCount", locale).replace("{n}", formatNumber(pat.installmentsCount))}
                      {" · "}
                      {t("developer.plans.usedBy", locale).replace("{n}", formatNumber(pat.projects.length))}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {pat.projects.map((pr) => (
                        <li key={pr.slug}>
                          <Link to={`/projects/${pr.slug}`} className="rounded-full border border-border/70 bg-secondary/60 px-2.5 py-0.5 text-[11px] font-medium transition-ui hover:border-brand/40 hover:text-brand-strong">
                            {pr.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("developer.plans.footnote", locale)}
              </p>
            </section>
          )}

          {/* Portfolio map */}
          {data.projects.length > 0 && (
            <section aria-labelledby="devmap-heading">
              <h2 id="devmap-heading" className="font-display text-xl font-semibold">{t("developer.map.title", locale)}</h2>
              <div className="mt-3 overflow-hidden rounded-xl border border-border/70">
                <EntityMap
                  center={{ lat: data.projects[0].lat, lng: data.projects[0].lng }}
                  zoom={11}
                  markers={data.projects.map((p) => ({
                    lat: p.lat,
                    lng: p.lng,
                    label: p.name,
                    kind: "project" as const,
                    href: `/projects/${p.slug}`,
                    sublabel: `${p.community.name} · ${humanizeTitle(p.status)}`,
                  }))}
                  locale={locale}
                  heightClass="h-64 sm:h-72"
                />
              </div>
            </section>
          )}

          {/* Related market data */}
          {communityMetrics && (
            <section aria-labelledby="relatedmarket-heading">
              <h2 id="relatedmarket-heading" className="font-display text-xl font-semibold">{t("developer.market.title", locale)}</h2>
              <div className="mt-3 rounded-xl border border-border/70 bg-card p-4">
                <p className="text-sm">
                  <Link to={`/communities/${communityMetrics.slug}`} className="font-semibold transition-ui hover:text-brand-strong">
                    {communityMetrics.name}
                  </Link>
                  <span className="text-muted-foreground"> · {t("community.metric.AVG_PRICE_PER_SQFT", locale)}: </span>
                  {anchorPpsf !== null ? (
                    <span className="num font-medium">{formatAEDPrecise(anchorPpsf)} / sqft</span>
                  ) : (
                    <UnavailableValue />
                  )}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <DataStateBadge
                    state={resolveMetricState({
                      sourcePublisher: communityMetrics.metrics[0]?.sourceName ?? null,
                      sourceType: communityMetrics.metrics[0]?.sourceName ?? null,
                      isIllustrative: communityMetrics.metrics[0]?.isIllustrative ?? null,
                    })}
                  />
                  {communityMetrics.metrics[0]?.sourceName ?? ""}
                </p>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("developer.market.footnote", locale)}</p>
            </section>
          )}

          {/* Articles / reports + FAQs */}
          <EntityResearch
            title={t("developer.research.title", locale)}
            reportFilter={() => true}
            guideSlugs={["off-plan-explained", "reading-payment-plans-like-a-lender", "market-cycles-timing"]}
            locale={locale}
          />
          <EntityFaqs groups={["OFF_PLAN", "INVESTMENT"]} heading={t("developer.faqs.title", locale)} locale={locale} />
        </div>

        {/* Sidebar */}
        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label={t("developer.panel.label", locale)}>
          <div className="rounded-xl border border-border/70 bg-card p-6">
            <p className="kicker">{t("developer.panel.briefing", locale)}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("developer.panel.briefingDesc", locale).replace("{d}", data.name)}
            </p>
            <Button className="mt-4 w-full" onClick={openBriefing}>
              {t("developer.panel.request", locale)}
            </Button>
            <Button asChild variant="outline" className="mt-2.5 w-full gap-2">
              <a href={`tel:${contact.phoneE164}`} className="num" onClick={() => events.callClick("developer_panel")}>
                <Phone className="h-4 w-4" aria-hidden /> {contact.phoneDisplay}
              </a>
            </Button>
            <Button asChild variant="ghost" className="mt-2.5 w-full gap-2 text-muted-foreground">
              <a
                href={`https://wa.me/${contact.whatsappE164.replace(/\D/g, "")}?text=${encodeURIComponent(WHATSAPP_MESSAGES.generic)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => events.whatsappClick("developer_panel")}
              >
                <MessageCircle className="h-4 w-4" aria-hidden /> {t("cta.whatsapp", locale)}
              </a>
            </Button>
            <p className="mt-3 text-[11px] text-muted-foreground">
              <FileText className="mr-1 inline h-3 w-3" aria-hidden />
              {t("developer.panel.noScores", locale)}
            </p>
          </div>
        </aside>
      </div>

      <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />
    </div>
  );
}

function SectionHeadingA({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <p className="kicker">{kicker}</p>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
    </div>
  );
}

function ProjectTile({ p, locale }: { p: DeveloperDetailV2["projects"][number]; locale: "en" | "ar" }) {
  const price = p.startingPrice ? Number(p.startingPrice.minor) / 100 : null;
  const handover = handoverPresentation(p.handoverDate);
  const unitLabel =
    p.totalUnits !== null && p.unitCount > 0 && p.unitCount !== p.totalUnits
      ? t("developer.projects.unitsBoth", locale).replace("{declared}", formatNumber(p.totalUnits)).replace("{records}", formatNumber(p.unitCount))
      : p.totalUnits !== null
        ? `${formatNumber(p.totalUnits)} ${t("project.similar.units", locale)}`
        : p.unitCount > 0
          ? `${formatNumber(p.unitCount)} ${t("project.similar.units", locale)}`
          : null;
  return (
    <Link to={`/projects/${p.slug}`} className="group overflow-hidden rounded-xl border border-border/70 transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-md">
      <div className="aspect-[16/9] overflow-hidden bg-sand">
        {p.cover && (
          <img src={p.cover.url} alt={p.cover.altText ?? p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display font-semibold group-hover:text-brand-strong">{p.name}</h3>
          <Badge variant="secondary" className="shrink-0">{humanizeTitle(p.status)}</Badge>
        </div>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden /> {p.community.name}
        </p>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          {price !== null ? (
            <span className="num font-semibold text-brand-strong">
              {t("common.from", locale)} {formatAEDPrecise(price)}
            </span>
          ) : (
            <span className="text-xs italic text-muted-foreground/70">{t("project.similar.poa", locale)}</span>
          )}
          {handover && (
            <span className="text-xs text-muted-foreground" title={handover.fullLabel ?? undefined}>
              {t("project.summary.handover", locale)} {handover.label}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {p.completionPercent !== null && p.completionPercent > 0 && (
            <span className="num flex items-center gap-1">
              {p.status === "UNDER_CONSTRUCTION" ? <HardHat className="h-3 w-3" aria-hidden /> : <CheckCircle2 className="h-3 w-3" aria-hidden />}
              {formatNumber(p.completionPercent)}% {t("developer.projects.complete", locale)}
            </span>
          )}
          {unitLabel && (
            <span className="num flex items-center gap-1">
              <Layers className="h-3 w-3" aria-hidden /> {unitLabel}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
