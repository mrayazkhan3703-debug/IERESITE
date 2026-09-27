"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, LoadingState, ErrorState } from "@/components/common";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { InvestScenarioStudio } from "@/components/market/invest-scenario-studio";
import { useSavedStore } from "@/components/providers/saved-provider";
import { formatMoney } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import { events } from "@/lib/analytics-tracker";
import { Button } from "@/components/ui/button";
import { Calculator, TrendingUp, Landmark, Home, Coins, BookOpen, Phone, ArrowRight, Scale, Sparkles, Plus, X } from "lucide-react";

/**
 * Investment Hub V2 (V2 §20) — decision workspace, not a calculator directory.
 * Scenario studio + saved scenarios + opportunity shortlist + market data +
 * compare + advisor handoff.
 */

const TOOLS = [
  { to: "/calculators/roi", title: "ROI Scenario", desc: "Total return over a horizon with your appreciation assumption.", icon: TrendingUp },
  { to: "/calculators/yield", title: "Rental Yield", desc: "Gross & net yield with vacancy allowance.", icon: Calculator },
  { to: "/calculators/mortgage", title: "Mortgage", desc: "Borrower-category aware payments and regulatory LTV context.", icon: Landmark },
  { to: "/calculators/payment-plan", title: "Payment Plan", desc: "Off-plan cash-flow schedule by stage with 100% validation.", icon: Home },
  { to: "/calculators/currency", title: "Currency", desc: "AED conversions with indicative rates.", icon: Coins },
];

interface ListingDTO {
  slug: string; title: string; community: { name: string; slug: string };
  price: { minor: string; currency: string }; bedrooms: number; areaSqft: number | null;
  cover?: { url: string; altText?: string | null } | null;
}

interface CommunityCardDTO {
  slug: string;
  name: string;
  summary?: string | null;
  listingCount?: number | null;
  avgPricePerSqft?: { minor: string; currency: string } | null;
  lifestyleTags?: string[];
}

const SHORTLIST_KEY = "ie_shortlist_v2";

export default function InvestView() {
  usePageMeta({
    title: "Dubai Property Investment Hub — Scenarios, Opportunities & Evidence",
    description:
      "A decision workspace for Dubai property investors: saved ROI scenarios, opportunity shortlists, sourced market data, comparison and advisor handoff — evidence first, never guarantees.",
  });

  const compare = useSavedStore((s) => s.compare);
  const [listings, setListings] = React.useState<ListingDTO[] | null>(null);
  const [communityCards, setCommunityCards] = React.useState<CommunityCardDTO[] | null>(null);
  const [error, setError] = React.useState(false);
  const [shortlist, setShortlist] = React.useState<string[]>([]);

  // Load shortlist from localStorage
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SHORTLIST_KEY);
      if (raw) setShortlist(JSON.parse(raw));
    } catch {}
  }, []);

  const persistShortlist = (next: string[]) => {
    setShortlist(next);
    try { localStorage.setItem(SHORTLIST_KEY, JSON.stringify(next)); } catch {}
  };

  const toggleShortlist = (slug: string) => {
    const next = shortlist.includes(slug) ? shortlist.filter((s) => s !== slug) : [...shortlist, slug];
    persistShortlist(next.slice(0, 8));
    events.shortlistToggled(slug, !shortlist.includes(slug));
  };

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lRes, cRes] = await Promise.all([
          fetch("/api/properties?limit=6"),
          fetch("/api/communities?limit=9"),
        ]);
        const lData = lRes.ok ? await lRes.json() : null;
        const cData = cRes.ok ? await cRes.json() : null;
        if (cancelled) return;
        setListings(lData?.properties ?? lData?.listings ?? null);
        setCommunityCards(((cData?.communities ?? []) as CommunityCardDTO[]).slice(0, 3));
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const shortlisted = (listings ?? []).filter((l) => shortlist.includes(l.slug));

  return (
    <div className="pb-16">
      {/* Hero */}
      <section className="border-b border-border/70 bg-sand/50 py-12 sm:py-16">
        <div className="container-page">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Invest" }]} />
          <p className="kicker mt-4">Decision workspace</p>
          <h1 className="mt-3 max-w-3xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Model the investment before you fall for the marble
          </h1>
          <p className="mt-4 max-w-2xl text-balance text-muted-foreground">
            Scenario tools with transparent assumptions. A shortlist you control. Sourced market data.
            Compare like an underwriter — then talk to a human who knows the buildings.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/invest/opportunities">
                <TrendingUp className="h-4 w-4" aria-hidden /> Browse opportunities
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full">
              <Link to="/compare">
                <Scale className="h-4 w-4" aria-hidden /> Comparison lab
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Scenario studio (§20: scenario tools + saved scenarios) */}
      <section className="border-b border-border/70 bg-white py-12" aria-labelledby="scenario-studio">
        <div className="container-page">
          <SectionHeading
            kicker="Scenario studio"
            title="Run the numbers, save the scenario"
            description="Deterministic shared engine (ROI, IRR, break-even) with downside / base / upside — saved locally so you can revisit and compare later. Projections, never guarantees."
          />
          <div className="mt-6">
            <InvestScenarioStudio />
          </div>
        </div>
      </section>

      {/* Opportunity shortlist (§20) */}
      <section className="border-b border-border/70 bg-sand/40 py-12" aria-labelledby="shortlist">
        <div className="container-page">
          <SectionHeading
            kicker="Shortlist"
            title="Your candidate properties"
            description="Add opportunities to a shortlist from the grid below. Shortlist + saved scenarios travel with you into a consultation."
          />
          {error && <div className="mt-4"><ErrorState message="Opportunities could not be loaded right now." /></div>}
          {listings === null && !error && <div className="mt-4"><LoadingState rows={2} /></div>}
          {listings && (
            <>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {listings.slice(0, 6).map((l) => {
                  const inList = shortlist.includes(l.slug);
                  return (
                    <div key={l.slug} className="group relative overflow-hidden rounded-xl border border-border/70 bg-card transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.12)]">
                      <Link to={`/properties/${l.slug}`} className="block">
                        <div className="aspect-[16/10] overflow-hidden bg-sand">
                          {l.cover?.url ? (
                            <img src={l.cover.url} alt={l.cover.altText ?? l.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground/40"><Home className="h-8 w-8" aria-hidden /></div>
                          )}
                        </div>
                        <div className="p-4">
                          <p className="text-xs font-medium text-muted-foreground">{l.community.name}</p>
                          <h3 className="mt-0.5 line-clamp-1 font-display text-base font-semibold group-hover:text-brand-strong">{l.title}</h3>
                          <p className="num mt-1 text-sm font-semibold text-foreground">
                            {formatAEDPrecise(Number(l.price.minor) / 100)}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {l.bedrooms === 0 ? "Studio" : `${l.bedrooms} BR`}{l.areaSqft ? ` · ${l.areaSqft.toLocaleString()} sqft` : ""}
                            </span>
                          </p>
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggleShortlist(l.slug)}
                        aria-pressed={inList}
                        aria-label={inList ? `Remove ${l.title} from shortlist` : `Add ${l.title} to shortlist`}
                        className={inList
                          ? "absolute right-3 top-3 z-10 rounded-full bg-ink p-2 text-background shadow-md transition-transform hover:scale-110"
                          : "absolute right-3 top-3 z-10 rounded-full bg-background/90 p-2 text-muted-foreground backdrop-blur transition-all hover:scale-110 hover:text-brand-strong"}
                      >
                        {inList ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                      </button>
                    </div>
                  );
                })}
              </div>

              {shortlisted.length > 0 && (
                <div className="mt-6 rounded-xl border border-brand/30 bg-brand-faint/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">
                      Shortlist · {shortlisted.length} {shortlisted.length === 1 ? "property" : "properties"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline"><Link to="/consultation?context=invest">Discuss with an advisor</Link></Button>
                      <Button asChild size="sm"><Link to="/compare">Compare in the lab</Link></Button>
                    </div>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {shortlist.map((s) => {
                      const item = (listings ?? []).find((x) => x.slug === s);
                      return (
                        <li key={s}>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">
                            {item?.title ?? s}
                            <button type="button" onClick={() => toggleShortlist(s)} aria-label={`Remove ${item?.title ?? s}`} className="text-muted-foreground hover:text-destructive">
                              <X className="h-3 w-3" aria-hidden />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Market data summary (§20) */}
      <section className="border-b border-border/70 bg-white py-12" aria-labelledby="market-summary">
        <div className="container-page">
          <SectionHeading kicker="Market data" title="Three communities, sourced" description="Every figure carries its data state. Open a community for the full intelligence page." />
          {communityCards === null && !error && <div className="mt-4"><LoadingState rows={1} /></div>}
          {communityCards && (
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {communityCards.map((c) => (
                <Link
                  key={c.slug}
                  to={`/communities/${c.slug}`}
                  className="group rounded-xl border border-border/70 bg-card p-5 transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.12)]"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-lg font-semibold group-hover:text-brand-strong">{c.name}</h3>
                    <DataStateBadge state="ILLUSTRATIVE" />
                  </div>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Avg price / sqft</dt>
                      <dd className="num font-semibold">
                        {c.avgPricePerSqft
                          ? formatMoney(BigInt(c.avgPricePerSqft.minor), { currency: c.avgPricePerSqft.currency })
                          : <UnavailableValue />}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Lifestyle</dt>
                      <dd className="max-w-40 truncate text-right text-xs text-foreground/80">
                        {(c.lifestyleTags ?? []).slice(0, 2).join(" · ") || <UnavailableValue />}
                      </dd>
                    </div>
                  </dl>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-strong">
                    Community intelligence <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Tools + advisor handoff */}
      <section className="border-t border-border/70 bg-sand/40 py-12">
        <div className="container-page">
          <SectionHeading kicker="Deterministic tools" title="Calculators with nothing hidden" description="Every input, assumption and output is labeled. The same engine powers property pages, AI tools and the scenario studio above." />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="group rounded-xl border border-border/70 bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.12)]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-strong transition-colors duration-200 group-hover:bg-brand group-hover:text-primary-foreground" aria-hidden>
                  <t.icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 font-display text-lg font-semibold group-hover:text-brand-strong">{t.title}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{t.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-strong">
                  Open
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
                </span>
              </Link>
            ))}
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-3">
            <div className="rounded-xl border border-border/70 bg-card p-6">
              <TrendingUp className="h-5 w-5 text-brand" aria-hidden />
              <h2 className="mt-3 font-display text-lg font-semibold">Market intelligence</h2>
              <p className="mt-2 text-sm text-muted-foreground">Community price, rent and yield data — every figure carries source and methodology.</p>
              <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/market">Explore data</Link></Button>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-6">
              <BookOpen className="h-5 w-5 text-brand" aria-hidden />
              <h2 className="mt-3 font-display text-lg font-semibold">Investor education</h2>
              <p className="mt-2 text-sm text-muted-foreground">Buying, off-plan and international guides with verified fee and procedure references.</p>
              <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/guides">Read guides</Link></Button>
            </div>
            <div className="relative overflow-hidden rounded-xl bg-ink p-6 text-background shadow-md">
              <Phone className="h-5 w-5 text-brand-soft" aria-hidden />
              <h2 className="mt-3 font-display text-lg font-semibold">Talk to the investment desk</h2>
              <p className="mt-2 text-sm text-background/70">
                Your shortlist{shortlisted.length > 0 ? ` (${shortlisted.length})` : ""} and saved scenarios travel into the conversation — no repeating yourself.
              </p>
              <Button asChild size="sm" variant="secondary" className="mt-4 rounded-full"><Link to="/consultation?context=invest">Book a consultation</Link></Button>
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand/25 blur-2xl" aria-hidden />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
