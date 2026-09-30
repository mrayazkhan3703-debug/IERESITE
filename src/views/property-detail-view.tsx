"use client";

/**
 * Property detail V2 (U06 — V2 §14).
 *
 * Assembly layer: layout, §14.2 listing summary, three-way About split
 * (verified facts / marketing description / modeled analysis), §14.5 facts
 * table with explicit units, enquiry + documents + payment plan — plus the
 * eight V2 section components (gallery, sticky decision panel, price history,
 * market context, cost of ownership, location intelligence, similar
 * properties, floor-plan viewer). All modeled figures carry MODELED badges;
 * missing fields render UnavailableValue, never a bare dash.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { useRoute } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, StatusBadge, ProvenanceBadge, SectionHeading, ErrorState, LoadingState, PrintHeader } from "@/components/common";
import { UnavailableValue, DataStateBadge } from "@/components/common/data-state";
import { AffordabilityWidget } from "@/components/property/affordability-widget";
import { GalleryV2 } from "@/components/property/gallery-v2";
import { StickyDecisionPanel } from "@/components/property/sticky-decision-panel";
import { ShareSheet } from "@/components/property/share-sheet";
import { PriceHistoryV2 } from "@/components/property/price-history-v2";
import { MarketContext } from "@/components/property/market-context";
import { CostOfOwnership } from "@/components/property/cost-of-ownership";
import { LocationIntelligence } from "@/components/property/location-intelligence";
import { SimilarProperties } from "@/components/property/similar-properties";
import { FloorPlanViewer } from "@/components/property/floor-plan-viewer";
import {
  detailToCard,
  relativeTime,
  useRentBenchmark,
  YIELD_MODEL_ASSUMPTIONS,
  type CommunityDetailLite,
  type PropertyDetailV2,
} from "@/components/property/detail-shared";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { useSavedStore } from "@/components/providers/saved-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { events } from "@/lib/analytics-tracker";
import { formatMoney, formatNumber, formatDate } from "@/lib/money";
import { formatAEDPrecise, formatPctPrecise, fullValueTooltip } from "@/lib/format-precise";
import { yieldBreakdown } from "@/lib/scenario-engine";
import { WHATSAPP_MESSAGES } from "@/lib/config";
import { useSiteSettings } from "@/components/providers/site-settings-provider";
import { localeOf, t } from "@/lib/i18n";
import { BedDouble, Bath, Ruler, MapPin, Heart, FileDown, CalendarClock, ShieldCheck, ChevronRight, Layers, Check, Printer, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PropertyDetailView({
  slug,
  initialData = null,
  manageMetadata = true,
  previewMode = false,
  printOrigin = "https://ieresite.onrender.com",
}: {
  slug: string;
  initialData?: PropertyDetailV2 | null;
  manageMetadata?: boolean;
  previewMode?: boolean;
  printOrigin?: string;
}) {
  const [data, setData] = React.useState<PropertyDetailV2 | null>(initialData);
  const [notFound, setNotFound] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [communityDetail, setCommunityDetail] = React.useState<CommunityDetailLite | null>(null);
  const lastRefreshedIso = data?.listingUpdatedAt ?? data?.updatedAt ?? null;
  const [relativeLastRefreshed, setRelativeLastRefreshed] = React.useState<string | null>(null);
  const leadForm = useLeadForm();
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const contact = useSiteSettings().contact;
  const isFav = useSavedStore((s) => s.isFavorite(slug));
  const toggleFavorite = useSavedStore((s) => s.toggleFavorite);
  const toggleCompare = useSavedStore((s) => s.toggleCompare);
  const inCompare = useSavedStore((s) => s.inCompare(slug));
  const addRecent = useSavedStore((s) => s.addRecent);

  React.useEffect(() => {
    // Reset per-slug state (component instance is reused across slug navigations)
    setNotFound(false);
    setError(null);
    if (initialData?.slug === slug) {
      setData(initialData);
      if (!previewMode) {
        events.propertyView(slug);
        api.post("/api/recently-viewed", { propertySlug: slug }).catch(() => {});
        addRecent(detailToCard(initialData));
      }
      return;
    }
    setData(null);
    api
      .get<PropertyDetailV2>(`/api/properties/${slug}`)
      .then((d) => {
        setData(d);
        events.propertyView(slug);
        api.post("/api/recently-viewed", { propertySlug: slug }).catch(() => {});
        if (d) addRecent(detailToCard(d));
      })
      .catch((e) => {
        if (e instanceof Error && e.message.includes("not found")) setNotFound(true);
        else setError(e instanceof Error ? e.message : t("property.detail.loadError", locale));
      });
  }, [slug, initialData, addRecent, previewMode]);

  usePageMeta(
    data
      ? {
          title: data.title,
          description:
            data.shortDescription ??
            `${data.propertyType} in ${data.community.name}${data.project ? ` — ${data.project.name}` : ""}. ${data.bedrooms === 0 ? "Studio" : `${data.bedrooms} bedroom`}, ${data.bathrooms} bath${data.builtUpAreaSqft ? `, ${formatNumber(data.builtUpAreaSqft)} sqft` : ""}.`,
          jsonLd: [
            {
              "@context": "https://schema.org",
              "@type": "RealEstateListing",
              name: data.title,
              url: `/properties/${data.slug}`,
              datePosted: data.listing?.publishedAt,
              offers: {
                "@type": "Offer",
                price: Number(data.listing?.priceMinor ?? 0) / 100,
                priceCurrency: data.listing?.currency ?? "AED",
                availability: data.listing?.availabilityStatus === "AVAILABLE" ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
              },
              ...(data.media[0] ? { image: [data.media[0].url] } : {}),
              address: {
                "@type": "PostalAddress",
                addressLocality: data.community.name,
                addressRegion: "Dubai",
                addressCountry: "AE",
              },
              numberOfRooms: data.bedrooms === 0 ? 1 : data.bedrooms,
              ...(data.builtUpAreaSqft ? { floorSize: { "@type": "QuantitativeValue", value: data.builtUpAreaSqft, unitCode: "FTK" } } : {}),
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: "/" },
                { "@type": "ListItem", position: 2, name: "Properties", item: "/properties" },
                { "@type": "ListItem", position: 3, name: data.community.name, item: `/communities/${data.community.slug}` },
                { "@type": "ListItem", position: 4, name: data.title, item: `/properties/${data.slug}` },
              ],
            },
          ],
        }
      : {},
    [data?.id],
    manageMetadata
  );

  /* Community detail (supply context for market context card) */
  React.useEffect(() => {
    if (!data) return;
    let cancelled = false;
    api
      .get<CommunityDetailLite>(`/api/communities/${encodeURIComponent(data.community.slug)}`)
      .then((c) => !cancelled && setCommunityDetail(c))
      .catch(() => !cancelled && setCommunityDetail(null));
    return () => {
      cancelled = true;
    };
  }, [data?.community.slug]);

  // Relative labels depend on the current clock. Render a deterministic date
  // for SSR and the first client pass, then enhance it after hydration.
  React.useEffect(() => {
    setRelativeLastRefreshed(relativeTime(lastRefreshedIso));
  }, [lastRefreshedIso]);

  /* Rent benchmark for this listing's community/bedrooms (drives modeled surfaces) */
  const rentBenchmark = useRentBenchmark(data?.community.name ?? null, data?.bedrooms ?? null);

  if (notFound) {
    return (
      <div className="container-page py-20">
        <ErrorState message={t("property.detail.notFound", locale)} />
        <div className="mt-6 text-center">
          <Button asChild variant="outline">
            <Link to="/properties">{t("property.detail.backToSearch", locale)}</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (error) return <div className="container-page py-20"><ErrorState message={error} onRetry={() => location.reload()} /></div>;
  if (!data) return <div className="container-page py-12"><LoadingState rows={4} /></div>;

  const l = data.listing;
  const isSale = l?.listingType !== "RENT";
  const priceMajor = l ? Number(l.priceMinor) / 100 : null;
  const ppsfMajor = priceMajor !== null && data.builtUpAreaSqft && data.builtUpAreaSqft > 0 ? priceMajor / data.builtUpAreaSqft : null;
  const currency = l?.currency ?? "AED";
  const card = detailToCard(data);

  /* Modeled investment snapshot (§14.3 + modeled-analysis block) — deterministic engine */
  const yieldModel =
    isSale && priceMajor !== null && rentBenchmark?.medianAnnualRent && rentBenchmark.medianAnnualRent > 0
      ? yieldBreakdown(
          {
            monthlyScheduledRent: rentBenchmark.medianAnnualRent / 12,
            vacancyAllowancePct: YIELD_MODEL_ASSUMPTIONS.vacancyAllowancePct,
            serviceChargeAnnual: l?.serviceChargePerSqft && data.builtUpAreaSqft ? l.serviceChargePerSqft * data.builtUpAreaSqft : 0,
            maintenanceAnnual: priceMajor * (YIELD_MODEL_ASSUMPTIONS.maintenancePctOfPrice / 100),
            managementPct: YIELD_MODEL_ASSUMPTIONS.managementPct,
            otherAnnual: 0,
          },
          priceMajor
        )
      : null;
  const investmentSnapshot = yieldModel
    ? {
        grossYieldPct: yieldModel.grossYield,
        netYieldPct: yieldModel.netYield,
        effectiveMonthlyRent: yieldModel.effectiveMonthlyRent,
        netIncomeAnnual: yieldModel.noi,
      }
    : null;

  const openEnquiry = (intent = "BUY") =>
    leadForm.open({
      formId: `property_${slug}`,
      intent: l?.listingType === "RENT" ? "RENT" : intent,
      entityType: "PROPERTY",
      entitySlug: slug,
      entityId: data.id,
      entityTitle: data.title,
      agentSlug: data.agent?.slug,
      agentName: data.agent?.name,
      title: "Enquire about this property",
      description: `${data.title} — ${data.community.name}`,
    });

  /* V3-02/§49: WhatsApp/call route through the listing agent — now the
   * Advisory Desk — using the company line with a property-contextual
   * prefilled message; the fallback is the same verified company line. */
  const whatsappHref = data.agent?.whatsappE164
    ? `https://wa.me/${data.agent.whatsappE164.replace(/\D/g, "")}?text=${encodeURIComponent(WHATSAPP_MESSAGES.property(data.title))}`
    : `https://wa.me/${contact.whatsappE164.replace(/\D/g, "")}?text=${encodeURIComponent(WHATSAPP_MESSAGES.property(data.title))}`;
  const callHref = data.agent?.phoneE164
    ? `tel:${data.agent.phoneE164}`
    : `tel:${contact.phoneE164}`;
  const callLabel = data.agent?.phoneDisplay ?? data.agent?.phoneE164 ?? contact.phoneDisplay;

  const scrollToMarketContext = () => {
    document.getElementById("market-context")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* §14.2 summary row */
  const summaryRow = (label: string, value: React.ReactNode, title?: string) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2.5 text-sm last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="num min-w-0 text-right font-medium" title={title}>{value}</dd>
    </div>
  );

  const lastRefreshedFallback = lastRefreshedIso
    // Keep this SSR text stable across Node and Chromium ICU builds. The page
    // label is localized separately; formatting the date in Arabic here made
    // the server and browser disagree on localized month/number text.
    ? formatDate(lastRefreshedIso, "en-AE", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Dubai" })
    : null;
  const lastRefreshed = relativeLastRefreshed ?? lastRefreshedFallback;
  const handover = data.handoverQuarter ?? (data.project?.handoverDate ? formatDate(data.project.handoverDate) : null);

  return (
    <div className="pb-16 md:pb-8">
      {/* Print-only masthead (branded, with canonical URL + demo disclosure) */}
      <div className="container-page pt-4">
        <PrintHeader title={data.title} url={`/properties/${slug}`} isDemoData={data.isDemoData} origin={printOrigin} />
      </div>

      {/* Breadcrumbs */}
      <div className="container-page pt-4 print:hidden">
        <Breadcrumbs
          items={[
            { label: "Home", to: "/" },
            { label: "Properties", to: "/properties" },
            { label: data.community.name, to: `/communities/${data.community.slug}` },
            { label: data.title },
          ]}
        />
      </div>

      {/* Gallery V2 (§14.1) */}
      <div className="container-page mt-4 print:mt-2">
        <GalleryV2 media={data.media} title={data.title} locale={locale} hasFloorPlans={data.floorPlans.length > 0} />
      </div>

      {/* Main */}
      <div className="container-page mt-8 grid gap-10 print:mt-4 print:block lg:grid-cols-[1fr_380px]">
        {/* Left column */}
        <div className="min-w-0">
          {/* Title + actions */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {l?.isExclusive && <Badge className="bg-brand text-primary-foreground">{t("property.detail.exclusive", locale)}</Badge>}
                {l?.isFeatured && <Badge variant="secondary">{t("property.detail.featured", locale)}</Badge>}
                {l && <StatusBadge status={l.availabilityStatus} />}
                {l?.offPlan && <Badge variant="outline">{t("property.detail.offPlan", locale)}</Badge>}
                {data.isDemoData && <ProvenanceBadge chip={{ sourceType: "DEMO", isDemoData: true }} />}
              </div>
              <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{data.title}</h1>
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                <Link to={`/communities/${data.community.slug}`} className="transition-ui hover:text-foreground">{data.community.name}</Link>
                {data.project && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    <Link to={`/projects/${data.project.slug}`} className="transition-ui hover:text-foreground">{data.project.name}</Link>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" className="gap-1.5" aria-pressed={isFav} onClick={() => toggleFavorite(card)}>
                <Heart className={cn("h-4 w-4", isFav && "fill-current text-brand")} aria-hidden />
                {isFav ? t("common.saved", locale) : t("common.save", locale)}
              </Button>
              <ShareSheet title={data.title} slug={slug} locale={locale} variant="inline" />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  events.share(slug, "print");
                  window.print();
                }}
              >
                <Printer className="h-4 w-4" aria-hidden /> {t("property.detail.print", locale)}
              </Button>
            </div>
          </div>

          {/* §19.2 mobile price identity — price/psft readable at 375 without the desktop sidebar */}
          <div className="mt-4 rounded-xl border border-border/70 bg-card p-4 lg:hidden print:hidden">
            {priceMajor !== null ? (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="num font-display text-2xl font-semibold tracking-tight text-ink" title={fullValueTooltip(priceMajor)}>
                  {l?.priceQualifier ? `${l.priceQualifier} ` : ""}
                  {formatAEDPrecise(priceMajor)}
                  {l?.rentFrequency === "YEARLY" && <span className="ml-1 text-sm font-normal text-muted-foreground">/yr</span>}
                  {l?.rentFrequency === "MONTHLY" && <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>}
                </p>
                {ppsfMajor !== null && (
                  <p className="num text-sm text-muted-foreground">
                    {formatAEDPrecise(ppsfMajor)} / sqft
                  </p>
                )}
              </div>
            ) : (
              <p className="font-display text-lg font-semibold">{t("property.panel.priceOnApplication", locale)}</p>
            )}
          </div>

          {/* Quick stats strip */}
          <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-border/70 bg-card p-5 sm:grid-cols-4 print:break-inside-avoid">
            <div className="flex items-center gap-3">
              <BedDouble className="h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <dt className="text-xs text-muted-foreground">{t("common.bedrooms", locale)}</dt>
                <dd className="num text-lg font-semibold">{data.bedrooms === 0 ? t("property.summary.studio", locale) : formatNumber(data.bedrooms)}</dd>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Bath className="h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <dt className="text-xs text-muted-foreground">{t("common.bathrooms", locale)}</dt>
                <dd className="num text-lg font-semibold">{formatNumber(data.bathrooms)}</dd>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Ruler className="h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <dt className="text-xs text-muted-foreground">{t("property.summary.builtUp", locale)}</dt>
                <dd className="num text-lg font-semibold">
                  {data.builtUpAreaSqft ? (
                    <>
                      {formatNumber(data.builtUpAreaSqft)} <span className="text-xs font-normal text-muted-foreground">sqft</span>
                    </>
                  ) : (
                    <UnavailableValue />
                  )}
                </dd>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Layers className="h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <dt className="text-xs text-muted-foreground">{t("common.type", locale)}</dt>
                <dd className="text-lg font-semibold">{data.propertyType.charAt(0) + data.propertyType.slice(1).toLowerCase()}</dd>
              </div>
            </div>
          </dl>

          <div className="mt-8 space-y-8">
            {/* §14.2 Listing summary — Not provided for unknowns, never a bare dash */}
            <section aria-labelledby="summary-heading" className="rounded-xl border border-border/70 bg-card p-5 print:break-inside-avoid">
              <h2 id="summary-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("property.summary.title", locale)}
              </h2>
              <dl className="mt-2 grid gap-x-10 sm:grid-cols-2">
                {summaryRow(
                  isSale ? t("property.summary.price", locale) : t("property.summary.rent", locale),
                  priceMajor !== null ? (
                    <>
                      {l?.priceQualifier ? `${l.priceQualifier} ` : ""}
                      {formatAEDPrecise(priceMajor)}
                      {l?.rentFrequency === "YEARLY" && <span className="ml-1 text-xs font-normal text-muted-foreground">/yr</span>}
                      {l?.rentFrequency === "MONTHLY" && <span className="ml-1 text-xs font-normal text-muted-foreground">/mo</span>}
                    </>
                  ) : (
                    <UnavailableValue label={isSale ? t("property.summary.price", locale) : t("property.summary.rent", locale)} />
                  ),
                  priceMajor !== null ? fullValueTooltip(priceMajor) : undefined
                )}
                {summaryRow(
                  t("property.summary.psqft", locale),
                  ppsfMajor !== null ? (
                    <>
                      {t("property.facts.psqftValue", locale).replace("{v}", formatNumber(Math.round(ppsfMajor)))}
                      {!isSale && <span className="ml-1 text-xs font-normal text-muted-foreground">/ yr</span>}
                    </>
                  ) : (
                    <UnavailableValue label={t("property.summary.psqft", locale)} />
                  ),
                  ppsfMajor !== null ? fullValueTooltip(ppsfMajor) : undefined
                )}
                {summaryRow(t("common.bedrooms", locale), data.bedrooms === 0 ? t("property.summary.studio", locale) : formatNumber(data.bedrooms))}
                {summaryRow(t("common.bathrooms", locale), formatNumber(data.bathrooms))}
                {summaryRow(
                  t("property.summary.builtUp", locale),
                  data.builtUpAreaSqft ? `${formatNumber(data.builtUpAreaSqft)} sqft` : <UnavailableValue label={t("property.summary.builtUp", locale)} />
                )}
                {data.plotAreaSqft
                  ? summaryRow(t("property.summary.plot", locale), `${formatNumber(data.plotAreaSqft)} sqft`)
                  : null}
                {summaryRow(t("common.type", locale), data.propertyType.charAt(0) + data.propertyType.slice(1).toLowerCase())}
                {summaryRow(
                  t("property.summary.furnishing", locale),
                  data.furnishing ? data.furnishing.replace(/_/g, " ").toLowerCase() : <UnavailableValue label={t("property.summary.furnishing", locale)} />
                )}
                {summaryRow(
                  t("property.summary.view", locale),
                  data.view ? data.view.charAt(0) + data.view.slice(1).toLowerCase() : <UnavailableValue label={t("property.summary.view", locale)} />
                )}
                {summaryRow(t("property.summary.availability", locale), l ? <StatusBadge status={l.availabilityStatus} /> : <UnavailableValue label={t("property.summary.availability", locale)} />)}
                {handover ? summaryRow(t("property.summary.handover", locale), handover) : null}
                {summaryRow(t("property.summary.ref", locale), <span className="font-mono text-xs">{data.listingRef}</span>)}
                {data.reraPermit ? summaryRow(t("property.summary.rera", locale), data.reraPermit) : null}
                {summaryRow(
                  t("property.summary.lastRefreshed", locale),
                  lastRefreshed ? (
                    <span title={lastRefreshedFallback ?? undefined}>{lastRefreshed}</span>
                  ) : (
                    <UnavailableValue label={t("property.summary.lastRefreshed", locale)} />
                  )
                )}
              </dl>
            </section>

            {/* §14.4 About — three-way separation */}
            <section aria-labelledby="about-heading">
              <h2 id="about-heading" className="font-display text-xl font-semibold">{t("property.about.title", locale)}</h2>
              <div className="mt-4 space-y-4">
                {/* 1. Verified facts */}
                <div className="rounded-xl border border-border/70 bg-card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t("property.about.verified", locale)}</h3>
                    <p className="text-[11px] text-muted-foreground">{t("property.about.verifiedNote", locale)}</p>
                  </div>
                  {data.highlights.length > 0 ? (
                    <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
                      {data.highlights.map((h, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3"><UnavailableValue label={t("property.about.noHighlights", locale)} /></p>
                  )}
                </div>

                {/* 2. Marketing description */}
                {(data.description || data.shortDescription) && (
                  <div className="rounded-xl border border-border/70 bg-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{t("property.about.marketing", locale)}</h3>
                      <p className="text-[11px] text-muted-foreground">{t("property.about.marketingNote", locale)}</p>
                    </div>
                    {data.shortDescription && data.shortDescription !== data.description && (
                      <p className="mt-3 text-[15px] font-medium leading-relaxed text-foreground/90">{data.shortDescription}</p>
                    )}
                    {data.description && <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">{data.description}</p>}
                  </div>
                )}

                {/* 3. Modeled analysis */}
                {investmentSnapshot && (
                  <div className="rounded-xl border border-brand/25 bg-brand-faint/40 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{t("property.about.modeled", locale)}</h3>
                      <DataStateBadge state="MODELED" />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{t("property.about.modeledNote", locale)}</p>
                    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("property.about.grossYield", locale)}</dt>
                        <dd className="num data-value font-semibold text-brand-strong">{formatPctPrecise(investmentSnapshot.grossYieldPct)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("property.about.netYield", locale)}</dt>
                        <dd className="num data-value font-semibold text-brand-strong">{formatPctPrecise(investmentSnapshot.netYieldPct)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("property.about.effectiveRent", locale)}</dt>
                        <dd className="num data-value font-semibold text-brand-strong" title={fullValueTooltip(investmentSnapshot.effectiveMonthlyRent)}>
                          {formatAEDPrecise(investmentSnapshot.effectiveMonthlyRent)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("property.about.netIncome", locale)}</dt>
                        <dd className="num data-value font-semibold text-brand-strong" title={fullValueTooltip(investmentSnapshot.netIncomeAnnual)}>
                          {formatAEDPrecise(investmentSnapshot.netIncomeAnnual)}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      onClick={scrollToMarketContext}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-strong transition-ui hover:gap-1.5"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden /> {t("property.about.seeMarket", locale)}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* §14.5 Facts table — explicit units */}
            <section aria-labelledby="facts-heading">
              <h2 id="facts-heading" className="font-display text-xl font-semibold">{t("property.facts.title", locale)}</h2>
              <dl className="mt-4 grid gap-x-10 sm:grid-cols-2">
                {summaryRow(t("common.type", locale), data.propertyType.charAt(0) + data.propertyType.slice(1).toLowerCase())}
                {summaryRow(
                  t("property.summary.view", locale),
                  data.view ? data.view.charAt(0) + data.view.slice(1).toLowerCase() : <UnavailableValue label={t("property.summary.view", locale)} />
                )}
                {summaryRow(
                  t("property.summary.furnishing", locale),
                  data.furnishing ? data.furnishing.replace(/_/g, " ").toLowerCase() : <UnavailableValue label={t("property.summary.furnishing", locale)} />
                )}
                {summaryRow(
                  t("property.facts.floor", locale),
                  data.floor !== null && data.totalFloors !== null
                    ? `${formatNumber(data.floor)} / ${formatNumber(data.totalFloors)}`
                    : data.floor !== null
                      ? formatNumber(data.floor)
                      : <UnavailableValue label={t("property.facts.floor", locale)} />
                )}
                {summaryRow(
                  t("property.summary.plot", locale),
                  data.plotAreaSqft ? `${formatNumber(data.plotAreaSqft)} sqft` : <UnavailableValue label={t("property.summary.plot", locale)} />
                )}
                {summaryRow(
                  t("property.facts.pricePerSqft", locale),
                  ppsfMajor !== null ? (
                    <>
                      {t("property.facts.psqftValue", locale).replace("{v}", formatNumber(Math.round(ppsfMajor)))}
                      {!isSale && <span className="ml-1 text-xs font-normal text-muted-foreground">/ yr</span>}
                    </>
                  ) : (
                    <UnavailableValue label={t("property.facts.pricePerSqft", locale)} />
                  )
                )}
                {summaryRow(
                  t("property.facts.serviceCharge", locale),
                  l?.serviceChargePerSqft != null ? (
                    t("property.facts.serviceChargeValue", locale).replace("{v}", formatNumber(l.serviceChargePerSqft))
                  ) : (
                    <UnavailableValue label={t("property.facts.serviceCharge", locale)} />
                  )
                )}
                {summaryRow(t("property.summary.handover", locale), handover ?? <UnavailableValue label={t("property.summary.handover", locale)} />)}
                {summaryRow(t("property.summary.rera", locale), data.reraPermit ?? <UnavailableValue label={t("property.summary.rera", locale)} />)}
                {summaryRow(
                  t("property.facts.listedSince", locale),
                  l?.publishedAt ? formatDate(l.publishedAt) : <UnavailableValue label={t("property.facts.listedSince", locale)} />
                )}
              </dl>
            </section>

            {/* Mortgage affordability (sale listings) — interactive, screen only */}
            {l && isSale && l.priceMinor && (
              <section aria-label={t("property.afford.sectionLabel", locale)} className="print:hidden">
                <AffordabilityWidget priceMinor={l.priceMinor} currency={l.currency} locale={locale} />
              </section>
            )}

            {/* Amenities */}
            {data.amenities.length > 0 && (
              <section aria-labelledby="amenities-heading">
                <h2 id="amenities-heading" className="font-display text-xl font-semibold">{t("property.amenities.title", locale)}</h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.amenities.map((a) => (
                    <Badge key={a.key} variant="secondary" className="px-3 py-1.5 text-sm font-normal">{a.name}</Badge>
                  ))}
                </div>
              </section>
            )}

            {/* Payment plan (off-plan) */}
            {data.paymentPlan && (
              <section aria-labelledby="plan-heading" className="rounded-xl border border-brand/25 bg-brand-faint/60 p-6 print:break-inside-avoid">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="plan-heading" className="font-display text-xl font-semibold">
                    {t("property.plan.title", locale)} — {data.paymentPlan.name}
                  </h2>
                  <ProvenanceBadge chip={{ sourceType: data.paymentPlan.verificationStatus, sourceName: "Developer schedule" }} />
                </div>
                <div className="mt-5 space-y-3">
                  {data.paymentPlan.installments.map((inst) => (
                    <div key={inst.sequence}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium">{inst.label}</span>
                        <span className="num text-muted-foreground">
                          {formatNumber(inst.percent)}%
                          {inst.dueOffsetMonths !== null
                            ? ` · ${
                                inst.dueOffsetMonths > 36
                                  ? t("property.plan.postHandoverMo", locale).replace("{n}", formatNumber(inst.dueOffsetMonths - 36))
                                  : t("property.plan.month", locale).replace("{n}", formatNumber(inst.dueOffsetMonths))
                              }`
                            : ""}
                          {l ? ` · ${formatMoney(String(Math.round((Number(l.priceMinor) * inst.percent) / 100)), { currency: l.currency })}` : ""}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60" role="presentation">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${inst.percent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  {t("property.plan.totals", locale).replace("{p}", formatNumber(data.paymentPlan.totalPercent))}
                  {data.paymentPlan.postHandover ? ` — ${t("property.plan.postHandover", locale)}.` : "."}{" "}
                  {t("property.plan.note", locale)}
                </p>
              </section>
            )}

            {/* Floor plans V2 (§14.6) */}
            <FloorPlanViewer floorPlans={data.floorPlans} title={data.title} currency={currency} locale={locale} />

            {/* Price history V2 (§14.7) */}
            <PriceHistoryV2 priceHistory={data.priceHistory} currency={currency} isDemoData={data.isDemoData} communityName={data.community.name} locale={locale} />

            {/* Market context (§14.8) */}
            <div id="market-context" className="scroll-mt-24">
              <MarketContext
                community={{ name: data.community.name, slug: data.community.slug }}
                communityDetail={communityDetail}
                askingPriceMajor={isSale ? priceMajor : null}
                areaSqft={data.builtUpAreaSqft}
                serviceChargePerSqft={l?.serviceChargePerSqft ?? null}
                rentBenchmark={rentBenchmark}
                locale={locale}
              />
            </div>

            {/* Cost of ownership (§14.9) — purchase scenarios only */}
            {isSale && (
              <CostOfOwnership
                purchasePriceMajor={priceMajor}
                currency={currency}
                areaSqft={data.builtUpAreaSqft}
                serviceChargePerSqft={l?.serviceChargePerSqft ?? null}
                offPlan={l?.offPlan ?? false}
                rentBenchmark={rentBenchmark}
                locale={locale}
              />
            )}

            {/* Location intelligence (§14.10) */}
            <LocationIntelligence lat={data.lat} lng={data.lng} communityName={data.community.name} communitySlug={data.community.slug} nearby={data.nearby} locale={locale} />

            {/* Documents — gated downloads are an online interaction; excluded from PDF */}
            {data.documents.length > 0 && (
              <section aria-labelledby="docs-heading" className="print:hidden">
                <h2 id="docs-heading" className="font-display text-xl font-semibold">{t("property.docs.title", locale)}</h2>
                <div className="mt-4 space-y-2">
                  {data.documents.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        if (d.gated) {
                          openEnquiry();
                        } else {
                          events.brochureDownload(slug);
                          window.open(d.url, "_blank", "noopener");
                        }
                      }}
                      className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-card px-4 py-3 text-sm transition-ui hover:border-brand/40"
                    >
                      <span className="flex items-center gap-2">
                        <FileDown className="h-4 w-4 text-brand" aria-hidden />
                        {d.label ?? d.docType.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-muted-foreground">{d.gated ? t("property.docs.register", locale) : t("property.docs.download", locale)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Sticky decision panel (§14.3) — flows inline in print after the content column */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start print:static" aria-label="Enquiry panel">
          <StickyDecisionPanel
            price={
              l
                ? { minor: l.priceMinor, currency: l.currency, qualifier: l.priceQualifier, rentFrequency: l.rentFrequency }
                : null
            }
            ppsfMajor={ppsfMajor}
            currency={currency}
            listingRef={data.listingRef}
            isSale={isSale}
            agent={data.agent}
            whatsappHref={whatsappHref}
            callHref={callHref}
            callLabel={callLabel}
            bookViewingHref={`/consultation?property=${encodeURIComponent(slug)}`}
            askAiHref={`/advisor?property=${encodeURIComponent(slug)}`}
            advisorHref={data.agent ? `/agents/${data.agent.slug}` : null}
            isSaved={isFav}
            onToggleSave={() => toggleFavorite(card)}
            inCompare={inCompare}
            onToggleCompare={() => toggleCompare(card)}
            onEnquire={() => openEnquiry(isSale ? "BUY" : "RENT")}
            investmentSnapshot={investmentSnapshot}
            shareTitle={data.title}
            locale={locale}
          />

          {/* Project context */}
          {data.project && (
            <div className="rounded-xl border border-border/70 bg-card p-5 text-sm">
              <p className="kicker mb-1.5">{t("property.project.kicker", locale)}</p>
              <Link to={`/projects/${data.project.slug}`} className="font-semibold transition-ui hover:text-brand-strong">
                {data.project.name}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("property.project.status", locale)}: {data.project.status.replace(/_/g, " ").toLowerCase()}
                {data.project.completionPercent !== null && ` · ${formatNumber(data.project.completionPercent)}% ${t("property.project.complete", locale)}`}
                {data.project.handoverDate && ` · ${t("property.project.handover", locale)} ${formatDate(data.project.handoverDate)}`}
              </p>
            </div>
          )}
          {data.developer && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden /> {t("common.developer", locale)}:{" "}
              <Link to={`/developers/${data.developer.slug}`} className="font-medium hover:text-foreground">{data.developer.name}</Link>
              <ProvenanceBadge chip={{ sourceType: data.developer.verificationStatus === "VERIFIED" ? "VERIFIED" : "DEMO" }} />
            </p>
          )}
        </aside>
      </div>

      {/* Similar properties V2 (§14.11) — discovery aid, excluded from the shareable PDF */}
      <SimilarProperties
        similar={data.similar}
        context={{
          currentSlug: slug,
          priceMinor: l?.priceMinor ?? null,
          bedrooms: data.bedrooms,
          communitySlug: data.community.slug,
          propertyType: data.propertyType,
        }}
        locale={locale}
      />

      {!previewMode && <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />}

      {/* Print footnote — contact + disclosure on every PDF page */}
      <div className="container-page mt-8 hidden print:block">
        <p className="border-t border-ink/30 pt-2 text-[10px] leading-relaxed text-muted-foreground">
          Investment Experts · Dubai Real Estate Investment Platform · {contact.phoneDisplay} ({contact.addressLine2}) —
          Figures shown are illustrative demo data unless labeled otherwise and do not constitute investment advice.
          Verify all facts against the live listing at the URL above before acting.
        </p>
      </div>
    </div>
  );
}
