"use client";

/**
 * Project Detail V2 (U07 — V2 §15).
 *
 * Flagship off-plan experience assembled from:
 *  - §15 hero: GalleryV2 (premium mosaic + lightbox; video chip only when a
 *    VIDEO asset exists in the payload);
 *  - §15 summary header: developer/community entity links, construction status
 *    badge + verified-relative-time + DataStateBadge, starting price
 *    (formatAEDPrecise), unit-type summary, explicit handover quarter, last
 *    verification;
 *  - §15.1 payment plan timeline (scenario-engine importFromProject);
 *  - §15.2 unit inventory (filterable + sortable + URL-synced);
 *  - construction progress w/ source; documents (gated honestly);
 *  - location: lazy Leaflet EntityMap + community POI chips + methodology;
 *  - community market context (latest metrics + supply, DataStateBadge);
 *  - similar projects with field-derived "why similar";
 *  - AI project analyst CTA → /advisor?project=slug;
 *  - advisor panel with Book viewing / consultation CTAs.
 *
 * Data honesty: every unknown renders UnavailableValue; demo/illustrative
 * provenance is badged; nothing is fabricated.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, ProvenanceBadge, StatusBadge, ErrorState, LoadingState } from "@/components/common";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { PrintHeader } from "@/components/common/print-header";
import { GalleryV2 } from "@/components/property/gallery-v2";
import { PropertyCard } from "@/components/property/property-card";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { events } from "@/lib/analytics-tracker";
import { formatMoney, formatNumber, formatDate } from "@/lib/money";
import { formatAEDPrecise, formatPctPrecise, fullValueTooltip } from "@/lib/format-precise";
import { SITE_CONTACT, SITE_CONTACT_CHANNELS, WHATSAPP_MESSAGES, companyWhatsappHref } from "@/lib/config";
import { localeOf, t } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import { resolveMetricState } from "@/lib/data-state";
import {
  handoverPresentation,
  humanizeTitle,
  latestMetricsByKey,
  relativeTime,
  type CommunityDetailV2,
} from "@/components/entity/entity-shared";
import { AgentAvatar } from "@/components/entity/agent-avatar";
import { EntityMap } from "@/components/entity/entity-map";
import { PaymentPlanTimeline } from "@/components/project/payment-plan-timeline";
import { ProjectTwinSection } from "@/components/twin/project-twin-section";
import { SimilarProjects } from "@/components/project/similar-projects";
import type { ProjectDetailV2 } from "@/components/project/project-shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarClock,
  MapPin,
  Building2,
  ShieldCheck,
  MessageCircle,
  Phone,
  MessageSquare,
  FileDown,
  Sparkles,
  HardHat,
  Clock3,
  BedDouble,
} from "lucide-react";

const METRIC_ORDER = ["MEDIAN_TRANS_PRICE", "AVG_PRICE_PER_SQFT", "AVG_RENT_1BR", "YIELD_PCT", "TRANSACTION_COUNT"];

export default function ProjectDetailView({ slug }: { slug: string }) {
  const [data, setData] = React.useState<ProjectDetailV2 | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [community, setCommunity] = React.useState<CommunityDetailV2 | null>(null);
  const leadForm = useLeadForm();
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  React.useEffect(() => {
    // Reset per-slug state (component instance is reused across slug navigations)
    setNotFound(false);
    setData(null);
    setCommunity(null);
    api
      .get<ProjectDetailV2>(`/api/projects/${slug}`)
      .then((d) => {
        setData(d);
        events.projectView(slug);
        /* Community context (POI chips + market metrics + supply) */
        api
          .get<CommunityDetailV2>(`/api/communities/${d.community.slug}`)
          .then((c) => setCommunity(c))
          .catch(() => setCommunity(null));
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  usePageMeta(
    data
      ? {
          title: `${data.name} — ${data.community.name} | ${data.developer.name}`,
          description:
            data.summary ??
            `${data.name} by ${data.developer.name} in ${data.community.name}. ${data.status.replace(/_/g, " ").toLowerCase()}, handover ${data.handoverDate ? formatDate(data.handoverDate) : "TBD"}, from ${data.startingPriceMinor ? formatMoney(data.startingPriceMinor, { currency: data.currency }) : "pricing on application"}.`,
          jsonLd: [
            {
              "@context": "https://schema.org",
              "@type": "Residence",
              name: data.name,
              url: `/projects/${data.slug}`,
              description: data.summary ?? undefined,
              address: { "@type": "PostalAddress", addressLocality: data.community.name, addressRegion: "Dubai", addressCountry: "AE" },
              ...(data.media[0] ? { image: [data.media[0].url] } : {}),
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: "/" },
                { "@type": "ListItem", position: 2, name: "New Projects", item: "/projects" },
                { "@type": "ListItem", position: 3, name: data.community.name, item: `/communities/${data.community.slug}` },
                { "@type": "ListItem", position: 4, name: data.name, item: `/projects/${data.slug}` },
              ],
            },
          ],
        }
      : {},
    [data?.id]
  );

  /* ---- derived presentation values (hooks hoisted above early returns) ---- */
  const unitTypeSummary = React.useMemo(() => {
    if (!data) return null;
    if (data.units.length > 0) {
      const beds = [...new Set(data.units.map((u) => u.bedrooms))].sort((a, b) => a - b);
      if (beds.length > 0) {
        const bedLabels = beds.map((b) => (b === 0 ? t("project.summary.studio", locale) : `${formatNumber(b)} ${t("project.summary.bed", locale)}`));
        const types = [...new Set(data.units.map((u) => u.unitType))];
        const typeLabel = types.length === 1 ? humanizeTitle(types[0]) : t("project.summary.mixedTypes", locale);
        return `${typeLabel} · ${bedLabels.join(" · ")}`;
      }
    }
    if (data.availableProperties.length > 0) {
      const beds = [...new Set(data.availableProperties.map((p) => p.bedrooms))].sort((a, b) => a - b);
      return `${t("project.summary.mixedTypes", locale)} · ${beds.map((b) => (b === 0 ? t("project.summary.studio", locale) : `${formatNumber(b)} ${t("project.summary.bed", locale)}`)).join(" · ")}`;
    }
    return null;
  }, [data?.units, data?.availableProperties, locale]);

  /* Community market context (latest per key) */
  const marketMetrics = React.useMemo(() => {
    if (!community) return [];
    const map = latestMetricsByKey(community.metrics);
    return METRIC_ORDER.filter((k) => map.has(k)).map((k) => map.get(k)!);
  }, [community]);

  /* U18 twin: community 1BR rent benchmark (major AED/yr) for the unit-card
     “Run investment analysis” CTA — always labelled MODELED in the UI. */
  const rentBenchmark = React.useMemo(() => {
    if (!community) return null;
    const rent = latestMetricsByKey(community.metrics).get("AVG_RENT_1BR");
    return rent ? rent.valueNumeric : null;
  }, [community]);

  if (notFound) {
    return (
      <div className="container-page py-20">
        <ErrorState message={t("project.detail.notFound", locale)} />
        <div className="mt-6 text-center">
          <Button asChild variant="outline"><Link to="/projects">{t("project.detail.backToProjects", locale)}</Link></Button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="container-page py-12"><LoadingState rows={4} /></div>;

  /* ---- derived presentation values -------------------------------------- */
  const startingPriceMajor = data.startingPriceMinor ? Number(data.startingPriceMinor) / 100 : null;
  const pricedUnits = data.units.filter((u) => u.priceMinor).map((u) => Number(u.priceMinor!) / 100);
  const minUnitPrice = pricedUnits.length > 0 ? Math.min(...pricedUnits) : null;
  const referencePrice = minUnitPrice ?? startingPriceMajor ?? 0;
  const handover = handoverPresentation(data.handoverDate);
  const lastVerified = relativeTime(data.sourceVerifiedAt) ?? (data.sourceVerifiedAt ? formatDate(data.sourceVerifiedAt) : null);
  const verifiedState = resolveMetricState({
    sourceType: data.isDemoData ? "DEMO" : "INTERNAL",
    retrievedAt: data.sourceVerifiedAt,
  });

  const openEnquiry = (intent = "INVEST") =>
    leadForm.open({
      formId: `project_${slug}`,
      intent,
      entityType: "PROJECT",
      entitySlug: slug,
      entityId: data.id,
      entityTitle: data.name,
      title: t("project.cta.enquiryTitle", locale),
      description: `${data.name} — ${data.community.name}`,
    });

  const scrollToEnquiry = () => {
    document.getElementById("project-enquiry")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* V3-02/§49: advisors on project listings are now the Advisory Desk —
   * company line with a project-contextual prefilled WhatsApp message. */
  const primaryAdvisor = data.advisors[0] ?? null;
  const whatsappHref =
    (primaryAdvisor?.whatsappE164
      ? `https://wa.me/${primaryAdvisor.whatsappE164.replace(/\D/g, "")}?text=${encodeURIComponent(WHATSAPP_MESSAGES.project(data.name))}`
      : companyWhatsappHref(WHATSAPP_MESSAGES.project(data.name))) ?? undefined;
  const callHref = primaryAdvisor?.phoneE164
    ? `tel:${primaryAdvisor.phoneE164}`
    : (SITE_CONTACT_CHANNELS.phone.href ?? SITE_CONTACT.phoneHref);
  const callLabel = primaryAdvisor?.phoneDisplay ?? primaryAdvisor?.phoneE164 ?? SITE_CONTACT_CHANNELS.phone.value;

  const summaryRow = (label: string, value: React.ReactNode, title?: string) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2.5 text-sm last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="num min-w-0 text-right font-medium" title={title}>{value}</dd>
    </div>
  );

  return (
    <div className="pb-16 md:pb-8">
      {/* Print masthead */}
      <div className="container-page pt-4 print:hidden">
        <PrintHeader title={data.name} url={`/projects/${slug}`} isDemoData={data.isDemoData} />
      </div>

      {/* Breadcrumbs */}
      <div className="container-page pt-4 print:hidden">
        <Breadcrumbs
          items={[
            { label: t("nav.projects"), to: "/projects" },
            { label: data.community.name, to: `/communities/${data.community.slug}` },
            { label: data.name },
          ]}
        />
      </div>

      {/* §15 premium hero media — mosaic + lightbox + video chip (only when present) */}
      <div className="container-page mt-4 print:mt-2">
        <GalleryV2 media={data.media} title={data.name} locale={locale} hasFloorPlans={false} />
      </div>

      {/* Main */}
      <div className="container-page mt-8 grid gap-10 print:mt-4 print:block lg:grid-cols-[1fr_380px]">
        {/* Left column */}
        <div className="min-w-0 space-y-12">
          {/* §15 summary header */}
          <section aria-labelledby="project-summary-heading">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={data.status} />
              {data.isDemoData && <ProvenanceBadge chip={{ sourceType: "DEMO", isDemoData: true }} />}
              {lastVerified && <DataStateBadge state={verifiedState} />}
            </div>
            <h1 id="project-summary-heading" className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {data.name}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              <Link to={`/communities/${data.community.slug}`} className="flex items-center gap-1.5 transition-ui hover:text-foreground">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden /> {data.community.name}
              </Link>
              <Link to={`/developers/${data.developer.slug}`} className="flex items-center gap-1.5 transition-ui hover:text-foreground">
                <Building2 className="h-4 w-4 shrink-0" aria-hidden /> {data.developer.name}
              </Link>
              {handover && (
                <span className="flex items-center gap-1.5" title={handover.fullLabel ?? undefined}>
                  <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
                  {t("project.summary.handover", locale)} {handover.label}
                </span>
              )}
              {lastVerified && (
                <span className="flex items-center gap-1.5" title={data.sourceVerifiedAt ?? undefined}>
                  <Clock3 className="h-4 w-4 shrink-0" aria-hidden />
                  {t("project.summary.verified", locale).replace("{t}", lastVerified)}
                </span>
              )}
            </p>

            {/* Key facts strip */}
            <dl className="mt-5 grid grid-cols-2 gap-4 rounded-lg border border-border/70 bg-card p-5 sm:grid-cols-4 print:break-inside-avoid">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft" aria-hidden>
                  <span className="font-display text-sm font-bold text-brand-strong">{data.currency === "AED" ? "AED" : data.currency}</span>
                </span>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("project.summary.startingPrice", locale)}</dt>
                  <dd className="num text-lg font-semibold" title={startingPriceMajor !== null ? fullValueTooltip(startingPriceMajor) : undefined}>
                    {startingPriceMajor !== null ? formatAEDPrecise(startingPriceMajor) : <UnavailableValue />}
                  </dd>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <BedDouble className="h-5 w-5 shrink-0 text-brand" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t("project.summary.unitTypes", locale)}</dt>
                  <dd className="text-sm font-semibold leading-snug">{unitTypeSummary ?? <UnavailableValue />}</dd>
                </div>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("project.summary.totalUnits", locale)}</dt>
                <dd className="num mt-1 text-lg font-semibold">
                  {data.totalUnits ? formatNumber(data.totalUnits) : data.units.length > 0 ? formatNumber(data.units.length) : <UnavailableValue />}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("project.summary.completion", locale)}</dt>
                <dd className="num mt-1 text-lg font-semibold">
                  {data.completionPercent !== null ? formatPctPrecise(data.completionPercent, 0) : <UnavailableValue />}
                </dd>
              </div>
            </dl>

            {/* Narrative */}
            <p className="mt-5 text-lg text-muted-foreground">{data.tagline ?? data.summary}</p>
            {data.description && (
              <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">{data.description}</p>
            )}
            {data.highlights.length > 0 && (
              <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
                {data.highlights.map((h, i) => (
                  <li key={i} className="rounded-md border border-border/70 bg-card px-3.5 py-2.5 text-sm">{h}</li>
                ))}
              </ul>
            )}
          </section>

          {/* §15.1 payment plan timeline */}
          {data.paymentPlans.length > 0 && (
            <section aria-labelledby="plans-heading">
              <h2 id="plans-heading" className="font-display text-xl font-semibold">{t("project.plan.title", locale)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("project.plan.sub", locale)}</p>
              <div className="mt-5 space-y-6">
                {data.paymentPlans.map((plan) => (
                  <PaymentPlanTimeline key={plan.id} plan={plan} referencePrice={referencePrice} currency={data.currency} locale={locale} />
                ))}
              </div>
            </section>
          )}

          {/* §15.2 unit inventory + U18 3D digital twin (§31/§32/§33) —
              the U07 unit table is retained inside this section as the 2D
              analytical fallback (3D view / Table view toggle). */}
          {data.units.length > 0 && (
            <ProjectTwinSection
              project={{
                slug,
                name: data.name,
                lat: data.lat,
                lng: data.lng,
                currency: data.currency,
                isDemoData: data.isDemoData,
                community: data.community,
                developer: { id: data.developer.id, name: data.developer.name, slug: data.developer.slug },
                paymentPlans: data.paymentPlans.map((plan) => ({
                  name: plan.name,
                  postHandover: plan.postHandover,
                  installments: plan.installments.map((i) => ({ percent: i.percent, label: i.label })),
                })),
              }}
              units={data.units}
              rentBenchmark={rentBenchmark}
              locale={locale}
              onEnquire={scrollToEnquiry}
            />
          )}
          {data.units.length === 0 && (
            <section aria-labelledby="units-heading">
              <h2 id="units-heading" className="font-display text-xl font-semibold">{t("project.units.title", locale)}</h2>
              <div className="mt-4 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                <p>{t("project.units.empty", locale)}</p>
                <Button size="sm" className="mt-3" onClick={scrollToEnquiry}>
                  {t("project.units.emptyCta", locale)}
                </Button>
              </div>
            </section>
          )}

          {/* Construction progress */}
          <section aria-labelledby="construction-heading">
            <h2 id="construction-heading" className="font-display text-xl font-semibold">{t("project.construction.title", locale)}</h2>
            <div className="mt-4 space-y-3">
              {data.completionPercent !== null && (
                <div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <HardHat className="h-4 w-4" aria-hidden /> {t("project.construction.reported", locale)}
                    </span>
                    <span className="num font-semibold">{formatPctPrecise(data.completionPercent, 0)}</span>
                  </div>
                  <div
                    className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-border/60"
                    role="progressbar"
                    aria-valuenow={Math.round(data.completionPercent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t("project.construction.reported", locale)}
                  >
                    <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${data.completionPercent}%` }} />
                  </div>
                </div>
              )}
              {data.constructionStatus && (
                <p className="text-sm text-muted-foreground">
                  {t("project.construction.stage", locale)}: <span className="font-medium text-foreground">{humanizeTitle(data.constructionStatus)}</span>
                </p>
              )}
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                {data.constructionSourceUrl ? (
                  <a href={data.constructionSourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 transition-ui hover:text-foreground">
                    {t("project.construction.source", locale)}
                    {data.constructionSourceVerifiedAt ? ` · ${t("project.construction.verifiedOn", locale).replace("{d}", formatDate(data.constructionSourceVerifiedAt))}` : ""}
                  </a>
                ) : (
                  <span>
                    {t("project.construction.noSource", locale)}
                    {data.sourceVerifiedAt ? ` · ${t("project.summary.verified", locale).replace("{t}", lastVerified ?? formatDate(data.sourceVerifiedAt))}` : ""}
                  </span>
                )}
              </p>
              {data.statusHistory.length > 0 && (
                <ol className="mt-2 space-y-2 border-l-2 border-border pl-4">
                  {data.statusHistory.map((h, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{humanizeTitle(h.toStatus)}</span>
                      <span className="ml-2 text-muted-foreground">
                        {formatDate(h.createdAt)}
                        {h.reason ? ` — ${h.reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          {/* Documents */}
          <section aria-labelledby="documents-heading">
            <h2 id="documents-heading" className="font-display text-xl font-semibold">{t("project.documents.title", locale)}</h2>
            {data.documents.length > 0 ? (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {data.documents.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (d.gated) openEnquiry();
                        else {
                          events.brochureDownload(slug);
                          window.open(d.url, "_blank", "noopener");
                        }
                      }}
                      className="flex w-full items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-left transition-ui hover:border-brand/40"
                    >
                      <FileDown className="h-5 w-5 shrink-0 text-brand" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.label ?? humanizeTitle(d.docType)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {d.gated ? t("project.documents.gated", locale) : t("project.documents.download", locale)}
                        </span>
                      </span>
                      {d.gated && <Badge variant="outline" className="shrink-0 text-[10px] uppercase">{t("project.documents.gatedBadge", locale)}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{t("project.documents.empty", locale)}</p>
            )}
          </section>

          {/* Amenities */}
          {data.amenities.length > 0 && (
            <section aria-labelledby="amenities-heading">
              <h2 id="amenities-heading" className="font-display text-xl font-semibold">{t("project.amenities.title", locale)}</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {data.amenities.map((a) => (
                  <Badge key={a.key} variant="secondary" className="px-3 py-1.5 text-sm font-normal">{a.name}</Badge>
                ))}
              </div>
            </section>
          )}

          {/* Location & nearby infrastructure */}
          <section aria-labelledby="location-heading">
            <h2 id="location-heading" className="font-display text-xl font-semibold">{t("project.location.title", locale)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.community.name} · <span className="num">{data.lat.toFixed(4)}, {data.lng.toFixed(4)}</span>
            </p>
            <div className="mt-4 overflow-hidden rounded-xl border border-border/70">
              <EntityMap
                center={{ lat: data.lat, lng: data.lng }}
                zoom={14}
                markers={[
                  { lat: data.lat, lng: data.lng, label: data.name, kind: "project", href: `/projects/${data.slug}`, sublabel: data.community.name },
                  ...(community?.projects ?? [])
                    .filter((p) => p.slug !== data.slug)
                    .map((p) => ({ lat: p.lat, lng: p.lng, label: p.name, kind: "project" as const, href: `/projects/${p.slug}` })),
                ]}
                area={community ? { lat: community.lat, lng: community.lng, radiusMeters: community.radiusMeters } : null}
                boundary={community?.boundary ?? null}
                areaLabel={data.community.name}
                locale={locale}
                heightClass="h-64 sm:h-72"
              />
            </div>
            {/* Nearby infrastructure — community POI chips (real data only) */}
            {community && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("project.location.nearby", locale)} — {data.community.name}
                </p>
                <ul className="mt-2 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ...(community.transport ?? []).filter((tr) => /metro|tram|rail/i.test(tr.type)).map((tr) => `${tr.name}${tr.distance ? ` (${tr.distance})` : ""}`),
                    ...(community.schools ?? []).map((s) => (s.rating ? `${s.name} (${s.rating})` : s.name)),
                    ...(community.healthcare ?? []).map((h) => h.name),
                    ...(community.retail ?? []).map((r) => r.name),
                  ].slice(0, 12).map((item) => (
                    <li key={item} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-foreground/85">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                      <span className="truncate">{item}</span>
                    </li>
                  ))}
                </ul>
                {(community.transport ?? []).length + (community.schools ?? []).length + (community.healthcare ?? []).length + (community.retail ?? []).length === 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">{t("project.location.noPoi", locale)}</p>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {t("project.location.poiMethodology", locale)}
                </p>
              </div>
            )}
          </section>

          {/* Community market context */}
          {community && marketMetrics.length > 0 && (
            <section aria-labelledby="market-heading" id="market-context">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="market-heading" className="font-display text-xl font-semibold">
                  {t("project.market.title", locale)} — {community.name}
                </h2>
                <Button asChild variant="ghost" size="sm" className="text-brand-strong">
                  <Link to={`/communities/${community.slug}`}>{t("project.market.fullIntel", locale)} →</Link>
                </Button>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {marketMetrics.map((m) => (
                  <div key={m.metricKey} className="rounded-xl border border-border/70 bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t(`community.metric.${m.metricKey}`, locale)}
                      </p>
                      <DataStateBadge
                        state={resolveMetricState({ sourcePublisher: m.sourceName, sourceType: m.sourceName, methodology: m.methodology, isIllustrative: m.isIllustrative })}
                      />
                    </div>
                    <p className="num mt-2 font-display text-2xl font-semibold">
                      {m.unit === "PERCENT" ? formatPctPrecise(m.valueNumeric, 1) : m.unit === "COUNT" ? formatNumber(m.valueNumeric) : formatAEDPrecise(m.valueNumeric)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{m.sourceName} · {formatDate(m.periodStart)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                {t("project.market.footnote", locale)}
              </p>
            </section>
          )}

          {/* Similar projects */}
          <SimilarProjects
            project={{
              slug: data.slug,
              community: { slug: data.community.slug, name: data.community.name },
              developer: { slug: data.developer.slug, name: data.developer.name },
              startingPriceMinor: data.startingPriceMinor,
              handoverDate: data.handoverDate,
              status: data.status,
            }}
            locale={locale}
          />

          {/* Live listings inside this project */}
          {data.availableProperties.length > 0 && (
            <section aria-labelledby="available-heading">
              <h2 id="available-heading" className="font-display text-xl font-semibold">{t("project.available.title", locale)}</h2>
              <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {data.availableProperties.map((p) => (
                  <PropertyCard
                    key={p.slug}
                    listing={{
                      id: p.slug,
                      slug: p.slug,
                      title: p.title,
                      propertyType: "APARTMENT",
                      listingType: "SALE",
                      bedrooms: p.bedrooms,
                      bathrooms: p.bathrooms,
                      areaSqft: p.areaSqft,
                      price: { minor: p.priceMinor, currency: data.currency },
                      availabilityStatus: p.availabilityStatus,
                      offPlan: true,
                      isFeatured: false,
                      isExclusive: false,
                      community: data.community,
                      project: { id: data.id, name: data.name, slug: data.slug },
                      developer: data.developer,
                      agent: null,
                      cover: p.cover ? { id: p.cover.id, url: p.cover.url } : null,
                      lat: data.lat,
                      lng: data.lng,
                      isDemoData: data.isDemoData,
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sidebar — decision panel */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start" aria-label={t("project.panel.label", locale)} id="project-enquiry">
          <div className="rounded-xl border border-border/70 bg-card p-6 shadow-sm print:hidden">
            {startingPriceMajor !== null ? (
              <>
                <p className="kicker">{t("project.panel.startingFrom", locale)}</p>
                <p className="num font-display text-3xl font-semibold" title={fullValueTooltip(startingPriceMajor)}>
                  {formatAEDPrecise(startingPriceMajor)}
                </p>
                {minUnitPrice !== null && minUnitPrice !== startingPriceMajor && (
                  <p className="num mt-1 text-xs text-muted-foreground" title={fullValueTooltip(minUnitPrice)}>
                    {t("project.panel.fromUnit", locale).replace("{p}", formatAEDPrecise(minUnitPrice))}
                  </p>
                )}
              </>
            ) : (
              <p className="text-lg font-semibold">{t("project.panel.poa", locale)}</p>
            )}

            <dl className="mt-4">
              {summaryRow(t("common.developer", locale),
                <Link to={`/developers/${data.developer.slug}`} className="transition-ui hover:text-brand-strong">{data.developer.name}</Link>)}
              {summaryRow(t("common.community", locale),
                <Link to={`/communities/${data.community.slug}`} className="transition-ui hover:text-brand-strong">{data.community.name}</Link>)}
              {summaryRow(t("project.summary.handover", locale), handover ? handover.label : <UnavailableValue />, handover?.fullLabel ?? undefined)}
              {summaryRow(t("project.summary.completion", locale), data.completionPercent !== null ? formatPctPrecise(data.completionPercent, 0) : <UnavailableValue />)}
              {data.totalUnits && summaryRow(t("project.summary.totalUnits", locale), formatNumber(data.totalUnits))}
              {data.launchDate && summaryRow(t("project.panel.launched", locale), formatDate(data.launchDate))}
              {summaryRow(t("project.summary.verified", locale).replace("{t}", "").trim() || t("project.panel.lastVerified", locale), lastVerified ?? <UnavailableValue />, data.sourceVerifiedAt ?? undefined)}
            </dl>

            <div className="mt-5 space-y-2.5">
              <Button className="w-full" size="lg" onClick={() => openEnquiry()}>
                {t("project.cta.requestAvailability", locale)}
              </Button>
              <Button asChild variant="outline" className="w-full gap-2">
                <a href={callHref} onClick={() => events.callClick(`project:${slug}`)}>
                  <Phone className="h-4 w-4" aria-hidden /> {callLabel}
                </a>
              </Button>
              <Button asChild variant="outline" className="w-full gap-2">
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" onClick={() => events.whatsappClick(`project:${slug}`)}>
                  <MessageCircle className="h-4 w-4" aria-hidden /> {t("cta.whatsapp", locale)}
                </a>
              </Button>
              <Button asChild variant="outline" className="w-full gap-2">
                <Link to="/consultation" query={{ project: slug }}>
                  <CalendarClock className="h-4 w-4" aria-hidden /> {t("project.cta.bookViewing", locale)}
                </Link>
              </Button>
              {/* AI project analyst */}
              <Button
                asChild
                variant="ghost"
                className="w-full gap-2 text-brand-strong hover:text-brand"
                onClick={() => events.aiRecommendation("PROJECT", slug)}
              >
                <Link to="/advisor" query={{ project: slug }}>
                  <Sparkles className="h-4 w-4" aria-hidden /> {t("project.cta.askAi", locale)}
                </Link>
              </Button>
              {data.documents
                .filter((d) => d.docType === "BROCHURE")
                .map((d) => (
                  <Button
                    key={d.id}
                    variant="ghost"
                    className="w-full gap-2 text-muted-foreground"
                    onClick={() => {
                      if (d.gated) openEnquiry();
                      else {
                        events.brochureDownload(slug);
                        window.open(d.url, "_blank", "noopener");
                      }
                    }}
                  >
                    <FileDown className="h-4 w-4" aria-hidden /> {d.label ?? t("project.documents.brochure", locale)}
                  </Button>
                ))}
            </div>

            {/* Advisor panel (V3-02: project listings route through the
             * Advisory Desk — central company contact, no unverified
             * capacity claims) */}
            {primaryAdvisor && (
              <div className="mt-5 rounded-lg bg-sand/60 p-4">
                <p className="kicker mb-2">{t("project.panel.projectAdvisor", locale)}</p>
                <Link to={`/agents/${primaryAdvisor.slug}`} className="flex items-center gap-3 transition-ui">
                  <AgentAvatar
                    name={primaryAdvisor.name}
                    photoUrl={primaryAdvisor.photoUrl}
                    photo={primaryAdvisor.photo}
                    alt={primaryAdvisor.name}
                    rounded="rounded-full"
                    className="h-11 w-11"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold transition-ui group-hover:text-brand-strong">{primaryAdvisor.name}</span>
                    {primaryAdvisor.jobTitle && (
                      <span className="block truncate text-xs text-muted-foreground">{primaryAdvisor.jobTitle}</span>
                    )}
                  </span>
                </Link>
                {primaryAdvisor.slug === "advisory-desk" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">{t("property.panel.deskNote", locale)}</p>
                )}
                <Button asChild variant="ghost" size="sm" className="mt-2 w-full justify-start px-0 text-brand-strong">
                  <Link to={`/agents/${primaryAdvisor.slug}`}>{t("project.panel.advisorProfile", locale)} →</Link>
                </Button>
              </div>
            )}

            {/* Developer context */}
            <div className="mt-3 rounded-lg bg-sand/60 p-4 text-sm">
              <p className="kicker mb-1.5">{t("common.developer", locale)}</p>
              <Link to={`/developers/${data.developer.slug}`} className="font-semibold transition-ui hover:text-brand-strong">
                {data.developer.name}
              </Link>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{data.developer.summary}</p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {humanizeTitle(data.developer.verificationStatus)}
                {data.developer.lastVerifiedAt && ` · ${t("project.summary.verified", locale).replace("{t}", relativeTime(data.developer.lastVerifiedAt) ?? formatDate(data.developer.lastVerifiedAt))}`}
              </p>
            </div>

            {/* Community context */}
            <div className="mt-3 rounded-lg bg-sand/60 p-4 text-sm">
              <p className="kicker mb-1.5">{t("common.community", locale)}</p>
              <Link to={`/communities/${data.community.slug}`} className="font-semibold transition-ui hover:text-brand-strong">
                {data.community.name}
              </Link>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{data.community.summary}</p>
              {community?.avgPricePerSqftMinor && (
                <p className="num mt-2 text-xs text-muted-foreground">
                  {t("project.panel.communityPpsf", locale)}{" "}
                  {formatAEDPrecise(Number(community.avgPricePerSqftMinor) / 100)} / sqft
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* §55 mobile sticky CTA — Call / WhatsApp / Enquire stacked above the global tab bar
           (same contract as the property action bar: bottom = tab bar + safe-area,
           44px targets, content padding already provided by the root pb-16 + shell) */}
      <div
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden print:hidden"
        role="region"
        aria-label={t("project.panel.label", locale)}
      >
        <div className="grid grid-cols-3 items-stretch gap-1 px-2 py-2">
          <a
            href={callHref}
            onClick={() => events.callClick(`project:${slug}`)}
            className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium text-foreground transition-ui hover:bg-secondary"
          >
            <Phone className="h-5 w-5 text-brand" aria-hidden />
            {t("property.cta.call", locale)}
          </a>
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => events.whatsappClick(`project:${slug}`)}
              className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium text-foreground transition-ui hover:bg-secondary"
            >
              <MessageCircle className="h-5 w-5 text-brand" aria-hidden />
              {t("cta.whatsapp", locale)}
            </a>
          ) : (
            <span className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium text-muted-foreground/50">
              <MessageCircle className="h-5 w-5" aria-hidden />
              {t("cta.whatsapp", locale)}
            </span>
          )}
          <button
            type="button"
            onClick={() => openEnquiry()}
            className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg bg-brand px-1 text-[11px] font-semibold text-primary-foreground transition-ui hover:bg-brand-strong"
          >
            <MessageSquare className="h-5 w-5" aria-hidden />
            {t("cta.enquire", locale)}
          </button>
        </div>
      </div>

      <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />
    </div>
  );
}
