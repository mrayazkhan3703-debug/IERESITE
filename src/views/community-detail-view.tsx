"use client";

/**
 * Community Detail V2 (U08 — V2 §16).
 *
 * The community page is rebuilt as a DECISION page, not an editorial guide:
 *  - header: overview + lifestyle + property-type distribution + mini-map
 *    (approximate community area + live property/project markers);
 *  - inventory tabs: for-sale / to-rent / new projects with "browse all" links
 *    that carry the community filter;
 *  - market section: latest metrics (DataStateBadge), price/sqft + yield trend,
 *    observed transaction and rent trends, observed vs MODELED yields, supply
 *    pipeline;
 *  - popular developments grid;
 *  - living: POI chips (only real categories) + straight-line commute context;
 *  - related research (real published reports/guides, relevance-filtered);
 *  - process FAQs (published content, deduplicated, framed honestly);
 *  - advisor specialists with capacity;
 *  - Compare community CTA → /compare?community={slug} (U12 will consume).
 */

import { mediaPreviewUrl } from "@/lib/media-preview";
import * as React from "react";
import { Link } from "@/lib/router";
import { useRoute } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, ErrorState, LoadingState } from "@/components/common";
import { PropertyCard } from "@/components/property/property-card";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { formatNumber } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import { resolveMetricState } from "@/lib/data-state";
import { localeOf, t } from "@/lib/i18n";
import {
  humanizeTitle,
  handoverPresentation,
  type CommunityDetailV2,
  type EntityListingLite,
} from "@/components/entity/entity-shared";
import { AgentAvatar } from "@/components/entity/agent-avatar";
import { EntityMap } from "@/components/entity/entity-map";
import { EntityMarket } from "@/components/entity/entity-market";
import { EntityPoiCommute } from "@/components/entity/entity-poi";
import { EntityFaqs, EntityResearch } from "@/components/entity/entity-faqs";
import { DistributionBar } from "@/components/entity/entity-charts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Scale, ArrowRight, Building2, MapPin, Sparkles } from "lucide-react";
import { CommunityImage } from "@/components/community-image";

function listingCardDto(p: EntityListingLite, community: { id: string; name: string; slug: string }, isDemoData: boolean) {
  return {
    id: p.slug,
    slug: p.slug,
    title: p.title,
    propertyType: "APARTMENT",
    listingType: p.listingType as "SALE" | "RENT",
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    areaSqft: p.areaSqft,
    price: { minor: p.priceMinor, currency: p.currency },
    availabilityStatus: p.availabilityStatus,
    offPlan: false,
    isFeatured: false,
    isExclusive: false,
    community,
    project: null,
    developer: null,
    agent: null,
    cover: p.cover ? { ...p.cover } : null,
    lat: p.lat,
    lng: p.lng,
    isDemoData,
  };
}

export default function CommunityDetailView({ slug }: { slug: string }) {
  const [data, setData] = React.useState<CommunityDetailV2 | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const leadForm = useLeadForm();
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  React.useEffect(() => {
    setNotFound(false);
    setData(null);
    api.get<CommunityDetailV2>(`/api/communities/${slug}`).then(setData).catch(() => setNotFound(true));
  }, [slug]);

  usePageMeta(
    data
      ? {
          title: `${data.name}, Dubai — Area Guide, Prices & Property`,
          description:
            data.summary ??
            `${data.name} area guide: average price per sqft, lifestyle, transport, schools and current property inventory in ${data.name}, Dubai.`,
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "Place",
            url: `/communities/${data.slug}`,
            name: data.name,
            address: { "@type": "PostalAddress", addressLocality: data.name, addressRegion: "Dubai", addressCountry: "AE" },
            geo: { "@type": "GeoCoordinates", latitude: data.lat, longitude: data.lng },
          },
        }
      : {},
    [data?.id]
  );

  if (notFound) {
    return (
      <div className="container-page py-20">
        <ErrorState message={t("community.detail.notFound", locale)} />
        <div className="mt-6 text-center">
          <Button asChild variant="outline"><Link to="/communities">{t("community.detail.backToCommunities", locale)}</Link></Button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="container-page py-12"><LoadingState rows={4} /></div>;

  const communityRef = { id: data.id, name: data.name, slug: data.slug };
  const avgPpsf = data.avgPricePerSqftMinor ? Number(data.avgPricePerSqftMinor) / 100 : null;

  /* Related research relevance (real published reports, deterministic rules) */
  const isWaterfront = /WATERFRONT|ISLAND/.test(data.areaType) || /marina|palm|beach|jbr|bluewaters|island/i.test(data.name);
  const isSuburban = /SUBURBAN/.test(data.areaType) || /jvc|ranch|hill|spring|meadow|green|souk/i.test(data.name);
  const reportFilter = (r: { slug: string }) =>
    r.slug === "dubai-investment-briefing-h2-2026" ||
    (isWaterfront && r.slug === "waterfront-outlook-q3-2026") ||
    (isSuburban && r.slug === "suburban-yield-playbook-2026");

  const openBriefing = () =>
    leadForm.open({
      formId: `community_${slug}`,
      intent: "BUY",
      entityType: "COMMUNITY",
      entitySlug: slug,
      entityId: data.id,
      entityTitle: `${data.name} area briefing`,
      title: t("community.cta.briefingTitle", locale).replace("{c}", data.name),
      description: t("community.cta.briefingDesc", locale),
    });

  return (
    <div className="pb-16">
      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0">
          <CommunityImage slug={data.slug} imageUrl={data.image?.url} alt={data.image?.altText ?? `${data.name}, Dubai`} className="h-full w-full object-cover" loading="eager" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/45 to-ink/25" />
        </div>
        <div className="container-page relative pt-16 pb-10 sm:pt-24 sm:pb-14">
          <Breadcrumbs
            items={[{ label: t("nav.communities"), to: "/communities" }, { label: data.name }]}
            className="text-white/70 [&_a]:text-white/70 [&_a:hover]:text-white [&_span]:text-white/90"
          />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium capitalize text-white/90 backdrop-blur">
              {humanizeTitle(data.areaType)}
            </span>
            {avgPpsf !== null && (
              <span className="num rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
                {t("community.hero.ppsf", locale)} {formatAEDPrecise(avgPpsf)} / sqft
              </span>
            )}
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold text-white sm:text-4xl">{data.name}</h1>
          <p className="mt-3 max-w-2xl text-balance text-white/80">{data.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.lifestyleTags.map((tag) => (
              <span key={tag} className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
                {tag}
              </span>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/properties" query={{ community: slug }}>
                {t("community.cta.viewListings", locale).replace("{n}", formatNumber(data.properties.length))}
              </Link>
            </Button>
            {/* Compare community — U12 consumes the param */}
            <Button
              asChild
              size="lg"
              variant="outline"
              className="gap-2 rounded-full border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <Link to="/compare" query={{ community: slug }}>
                <Scale className="h-4 w-4" aria-hidden /> {t("community.cta.compare", locale)}
              </Link>
            </Button>
            {/* V3-F §20 — contextual AI entry. The advisor scopes property/project
                server-side only (src/server/ai/advisor.ts), so the community CTA
                falls back to a prefilled ?q= comparison query the user can edit. */}
            <Button
              asChild
              size="lg"
              variant="outline"
              className="gap-2 rounded-full border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <Link
                to="/advisor"
                query={{
                  q: `Compare ${data.name} with similar Dubai communities for investment — price per sqft, rents, yield and supply. What should I know before buying here?`,
                }}
              >
                <Sparkles className="h-4 w-4" aria-hidden /> {t("community.cta.askAi", locale)}
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-full border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={openBriefing}
            >
              {t("community.cta.talkSpecialist", locale).replace("{c}", data.name)}
            </Button>
          </div>
        </div>
      </section>

      <div className="container-page mt-10 space-y-14">
        {/* Overview + type distribution + mini-map */}
        <section aria-labelledby="overview-heading" className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 id="overview-heading" className="font-display text-xl font-semibold">{t("community.overview.title", locale)}</h2>
            <p className="mt-3 leading-relaxed text-foreground/85">{data.description ?? data.summary}</p>
            {data.propertyTypeCounts.length > 0 && (
              <div className="mt-5 rounded-xl border border-border/70 bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("community.overview.typeMix", locale)}</p>
                <div className="mt-3">
                  <DistributionBar
                    segments={data.propertyTypeCounts.map((c) => ({ label: humanizeTitle(c.propertyType), value: c.count }))}
                    ariaLabel={t("community.overview.typeMix", locale)}
                  />
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                  {data.propertyTypeCounts.map((c) => (
                    <li key={c.propertyType} className="num flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />
                      {humanizeTitle(c.propertyType)} · {formatNumber(c.count)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">{t("community.overview.typeMixNote", locale)}</p>
              </div>
            )}
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold">{t("community.map.title", locale)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("community.map.sub", locale)}</p>
            <div className="mt-3 overflow-hidden rounded-xl border border-border/70">
              <EntityMap
                center={{ lat: data.lat, lng: data.lng }}
                zoom={14}
                markers={[
                  ...data.properties.map((p) => ({
                    lat: p.lat,
                    lng: p.lng,
                    label: p.title,
                    kind: "property" as const,
                    href: `/properties/${p.slug}`,
                  })),
                  ...data.projects.map((p) => ({
                    lat: p.lat,
                    lng: p.lng,
                    label: p.name,
                    kind: "project" as const,
                    href: `/projects/${p.slug}`,
                    sublabel: humanizeTitle(p.status),
                  })),
                ]}
                area={{ lat: data.lat, lng: data.lng, radiusMeters: data.radiusMeters }}
                boundary={data.boundary}
                areaLabel={data.name}
                locale={locale}
                heightClass="h-72"
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("community.map.methodology", locale)}</p>
          </div>
        </section>

        {/* Inventory tabs */}
        <section aria-labelledby="inventory-heading">
          <SectionHeading
            kicker={t("community.inventory.kicker", locale)}
            title={t("community.inventory.title", locale).replace("{c}", data.name)}
          />
          <Tabs defaultValue="sale" className="mt-5">
            <TabsList aria-label={t("community.inventory.tabsAria", locale)}>
              <TabsTrigger value="sale">
                {t("community.inventory.forSale", locale)}
                <span className="num ml-1.5 rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{formatNumber(data.saleProperties.length)}</span>
              </TabsTrigger>
              <TabsTrigger value="rent">
                {t("community.inventory.forRent", locale)}
                <span className="num ml-1.5 rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{formatNumber(data.rentProperties.length)}</span>
              </TabsTrigger>
              <TabsTrigger value="projects">
                {t("community.inventory.newProjects", locale)}
                <span className="num ml-1.5 rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{formatNumber(data.projects.length)}</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sale" className="mt-5">
              {data.saleProperties.length > 0 ? (
                <>
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {data.saleProperties.slice(0, 6).map((p) => (
                      <PropertyCard key={p.slug} listing={listingCardDto(p, communityRef, data.isDemoData)} />
                    ))}
                  </div>
                  <div className="mt-5">
                    <Button asChild variant="outline" className="gap-2">
                      <Link to="/properties" query={{ community: slug }}>
                        {t("community.inventory.browseAllSale", locale).replace("{n}", formatNumber(data.saleProperties.length))}
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("community.inventory.noSale", locale)}</p>
              )}
            </TabsContent>

            <TabsContent value="rent" className="mt-5">
              {data.rentProperties.length > 0 ? (
                <>
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {data.rentProperties.slice(0, 6).map((p) => (
                      <PropertyCard key={p.slug} listing={listingCardDto(p, communityRef, data.isDemoData)} />
                    ))}
                  </div>
                  <div className="mt-5">
                    <Button asChild variant="outline" className="gap-2">
                      <Link to="/properties" query={{ mode: "rent", community: slug }}>
                        {t("community.inventory.browseAllRent", locale).replace("{n}", formatNumber(data.rentProperties.length))}
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("community.inventory.noRent", locale)}</p>
              )}
            </TabsContent>

            <TabsContent value="projects" className="mt-5">
              {data.projects.length > 0 ? (
                <>
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {data.projects.map((p) => {
                      const price = p.startingPriceMinor ? Number(p.startingPriceMinor) / 100 : null;
                      const handover = handoverPresentation(p.handoverDate);
                      return (
                        <Link
                          key={p.slug}
                          to={`/projects/${p.slug}`}
                          className="group overflow-hidden rounded-xl border border-border/70 transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-md"
                        >
                          <div className="aspect-[16/9] overflow-hidden bg-sand">
                            {p.cover && mediaPreviewUrl(p.cover) && (
                              <img src={mediaPreviewUrl(p.cover) ?? undefined} alt={p.cover.altText ?? p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                            )}
                          </div>
                          <div className="p-4">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="font-display font-semibold group-hover:text-brand-strong">{p.name}</h3>
                              <Badge variant="secondary">{humanizeTitle(p.status)}</Badge>
                            </div>
                            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <Building2 className="h-3 w-3" aria-hidden />{" "}
                              <Link to={`/developers/${p.developerSlug}`} className="transition-ui hover:text-foreground">{p.developerName}</Link>
                            </p>
                            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              {price !== null ? (
                                <span className="num text-sm font-semibold text-brand-strong" title={t("project.similar.fromPrice", locale)}>
                                  {t("common.from", locale)} {formatAEDPrecise(price)}
                                </span>
                              ) : (
                                <span className="text-xs italic text-muted-foreground/70">{t("project.similar.poa", locale)}</span>
                              )}
                              {handover && <span className="text-xs text-muted-foreground">{t("project.summary.handover", locale)} {handover.label}</span>}
                              {p.totalUnits && <span className="num text-xs text-muted-foreground">{formatNumber(p.totalUnits)} {t("project.similar.units", locale)}</span>}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                  <div className="mt-5">
                    <Button asChild variant="outline" className="gap-2">
                      <Link to="/projects" query={{ community: slug }}>
                        {t("community.inventory.browseAllProjects", locale)}
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("community.inventory.noProjects", locale)}</p>
              )}
            </TabsContent>
          </Tabs>
        </section>

        {/* Market intelligence */}
        <section aria-labelledby="market-heading">
          <h2 id="market-heading" className="font-display text-xl font-semibold">
            {t("community.market.title", locale).replace("{c}", data.name)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("community.market.sub", locale)}</p>
          <div className="mt-5">
            <EntityMarket
              community={{
                name: data.name,
                slug: data.slug,
                currency: data.currency,
                metrics: data.metrics,
                supplyPipeline: data.supplyPipeline,
                projects: data.projects,
              }}
              locale={locale}
            />
          </div>
        </section>

        {/* Living & commute */}
        <section aria-labelledby="living-heading">
          <h2 id="living-heading" className="font-display text-xl font-semibold">{t("community.living.title", locale)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("community.living.sub", locale)}</p>
          <div className="mt-5">
            <EntityPoiCommute
              community={{
                name: data.name,
                lat: data.lat,
                lng: data.lng,
                transport: data.transport,
                schools: data.schools,
                healthcare: data.healthcare,
                retail: data.retail,
              }}
              locale={locale}
            />
          </div>
        </section>

        {/* Related research */}
        <EntityResearch
          title={t("community.research.title", locale)}
          reportFilter={reportFilter}
          guideSlugs={["off-plan-vs-secondary", "reading-payment-plans-like-a-lender", "rental-income-landlord-guide"]}
          locale={locale}
        />

        {/* FAQs (process-level, honestly framed) */}
        <EntityFaqs
          groups={data.projects.length > 0 ? ["OFF_PLAN", "BUYING", "INVESTMENT"] : ["BUYING", "INVESTMENT"]}
          heading={t("community.faqs.title", locale)}
          locale={locale}
        />

        {/* Advisor specialists */}
        {data.agents.length > 0 && (
          <section aria-labelledby="agents-heading">
            <SectionHeading
              kicker={t("community.agents.kicker", locale)}
              title={t("community.agents.title", locale).replace("{c}", data.name)}
              action={
                <Button asChild variant="ghost" size="sm" className="text-brand-strong">
                  <Link to="/agents" query={{ community: slug }}>{t("community.agents.all", locale)} →</Link>
                </Button>
              }
            />
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.agents.map((a) => {
                return (
                  <Link
                    key={a.slug}
                    to={`/agents/${a.slug}`}
                    className="group flex flex-col rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-md"
                  >
                    <div className="flex items-center gap-3">
                      <AgentAvatar
                        name={a.name}
                        photoUrl={a.photoUrl}
                        photo={a.photo}
                        alt={a.name}
                        rounded="rounded-full"
                        className="h-12 w-12"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-semibold group-hover:text-brand-strong">{a.name}</p>
                        {a.jobTitle && <p className="truncate text-xs text-muted-foreground">{a.jobTitle}</p>}
                      </div>
                    </div>
                    <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground/70">
                      <MapPin className="h-3 w-3" aria-hidden /> {t("community.agents.coversArea", locale)}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />
    </div>
  );
}
