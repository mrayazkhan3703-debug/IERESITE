"use client";

import * as React from "react";
import { Link, navigate, useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, Price, EmptyState, PrintHeader, LoadingState, ErrorState } from "@/components/common";
import { UnavailableValue } from "@/components/common/data-state";
import { useSavedStore } from "@/components/providers/saved-provider";
import { formatMoney, formatNumber, pricePerSqftMinor } from "@/lib/money";
import { events } from "@/lib/analytics-tracker";
import { Button } from "@/components/ui/button";
import { BedDouble, Bath, Ruler, MapPin, Building2, Layers, Minus, Scale, Award, Printer, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Comparison Lab (V2 §23) — compare 2–4 properties, projects, or communities.
 * Properties come from the saved compare store; projects & communities join
 * via URL (?project=slug / ?community=slug, plural forms accepted).
 * Cross-type comparison is allowed; missing cells render honest
 * "Not provided" markers — never fabricated values.
 */

type CompareKind = "property" | "project" | "community";

interface ProjectDTO {
  slug: string; name: string; status: string; handoverDate: string | null;
  startingPriceMinor: string; currency: string; totalUnits: number | null;
  completionPercent: number | null;
  developer: { name: string; slug: string } | null;
  community: { name: string; slug: string } | null;
  media?: { url: string; altText?: string | null }[];
}

interface CommunityDTO {
  slug: string; name: string; summary: string | null;
  avgPricePerSqftMinor: string | null; currency: string;
  lifestyleTags: string[]; areaType: string;
  image?: { url: string; altText?: string | null } | null;
}

interface Row {
  kind: CompareKind;
  slug: string;
  title: string;
  image?: { url: string; altText?: string | null } | null;
  href: string;
}

export default function CompareView() {
  const compare = useSavedStore((s) => s.compare);
  const toggleCompare = useSavedStore((s) => s.toggleCompare);
  const clearCompare = useSavedStore((s) => s.clearCompare);
  const loc = useRoute();

  const [projects, setProjects] = React.useState<ProjectDTO[]>([]);
  const [communities, setCommunities] = React.useState<CommunityDTO[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  usePageMeta({ title: "Comparison Lab", noindex: true });

  // Parse project/community slugs from URL (supports comma lists)
  const projectSlugs = React.useMemo(() => parseList(loc.query.project ?? loc.query.projects), [loc.query.project, loc.query.projects]);
  const communityList = React.useMemo(() => parseList(loc.query.community ?? loc.query.communities), [loc.query.community, loc.query.communities]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError(false);
      try {
        const [pArr, cArr] = await Promise.all([
          Promise.all(projectSlugs.map((s) => fetch(`/api/projects/${encodeURIComponent(s)}`).then((r) => (r.ok ? r.json() : null)))),
          Promise.all(communityList.map((s) => fetch(`/api/communities/${encodeURIComponent(s)}`).then((r) => (r.ok ? r.json() : null)))),
        ]);
        if (cancelled) return;
        setProjects(pArr.filter(Boolean));
        setCommunities(cArr.filter(Boolean));
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (projectSlugs.length || communityList.length) load();
    else { setProjects([]); setCommunities([]); }
    return () => { cancelled = true; };
  }, [projectSlugs.join(","), communityList.join(",")]);

  const propertyRows: Row[] = compare.map((c) => ({
    kind: "property" as const,
    slug: c.slug,
    title: c.title,
    image: c.cover ?? undefined,
    href: `/properties/${c.slug}`,
  }));
  const projectRows: Row[] = projects.map((p) => ({
    kind: "project" as const,
    slug: p.slug,
    title: p.name,
    image: p.media?.[0] ?? undefined,
    href: `/projects/${p.slug}`,
  }));
  const communityRows: Row[] = communities.map((c) => ({
    kind: "community" as const,
    slug: c.slug,
    title: c.name,
    image: c.image ?? undefined,
    href: `/communities/${c.slug}`,
  }));

  const allRows = [...propertyRows, ...projectRows, ...communityRows];
  const overLimit = allRows.length > 4;

  const removeRow = (row: Row) => {
    if (row.kind === "property") {
      const item = compare.find((c) => c.slug === row.slug);
      if (item) toggleCompare(item);
    } else if (row.kind === "project") {
      const next = projectSlugs.filter((s) => s !== row.slug);
      navigate("/compare", next.length || communityList.length ? { project: next.join(",") || undefined, community: communityList.join(",") || undefined } : undefined, { replace: true });
    } else {
      const next = communityList.filter((s) => s !== row.slug);
      navigate("/compare", next.length || projectSlugs.length ? { project: projectSlugs.join(",") || undefined, community: next.join(",") || undefined } : undefined, { replace: true });
    }
  };

  const askAiHref = allRows.length >= 2
    ? `/advisor?q=${encodeURIComponent(`Compare ${allRows.map((r) => r.title).join(", ")} — explain the trade-offs (price, yield, location, handover) without making the choice for me.`)}`
    : null;

  if (allRows.length === 0 && !loading) {
    return (
      <div className="container-page py-8">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Compare" }]} />
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Comparison lab</h1>
        <div className="mt-6">
          <EmptyState
            icon={<Scale className="h-10 w-10" aria-hidden />}
            title="Nothing to compare yet"
            description="Compare 2–4 properties, projects or communities side by side — normalized facts, explicit missing-data markers, and AI trade-off explanations without the AI choosing for you."
            actionLabel="Browse properties"
            onAction={() => navigate("/properties")}
          />
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-muted-foreground">Try starting from:</span>
            {[
              { label: "Dubai Marina apartments", to: "/properties", q: { community: "dubai-marina", propertyType: "apartment" } },
              { label: "Palm Jumeirah villas", to: "/properties", q: { community: "palm-jumeirah", propertyType: "villa,townhouse" } },
              { label: "Off-plan projects", to: "/off-plan" },
              { label: "Compare 2 communities", to: "/compare", q: { communities: "dubai-marina,business-bay" } },
              { label: "Compare 2 projects", to: "/compare", q: { projects: "verdant-hills-collection,meridian-downtown-towers" } },
            ].map((chip) => (
              <Link
                key={chip.label}
                to={chip.to}
                query={chip.q}
                className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground/80 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md hover:text-brand-strong"
              >
                {chip.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* Metric rows — per-kind extractors. Values must come from the loaded data;
   * anything absent renders the honest unavailable marker. */
  const metrics: { label: string; render: (row: Row) => React.ReactNode; metricOf?: (row: Row) => number | null; best?: "min" | "max" }[] = [
    {
      label: "Price",
      render: (row) => row.kind === "property"
        ? <Price price={compare.find((c) => c.slug === row.slug)!.price} />
        : row.kind === "project"
          ? <span className="num"><span className="mr-1 text-xs text-muted-foreground">From</span>{formatMoney(BigInt(projects.find((p) => p.slug === row.slug)!.startingPriceMinor), { currency: projects.find((p) => p.slug === row.slug)!.currency })}</span>
          : <UnavailableValue label="n/a for areas" />,
      metricOf: (row) => row.kind === "property" ? Number(compare.find((c) => c.slug === row.slug)!.price.minor)
        : row.kind === "project" ? Number(projects.find((p) => p.slug === row.slug)!.startingPriceMinor) : null,
      best: "min",
    },
    {
      label: "Community",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-brand" aria-hidden />
          {row.kind === "property" ? compare.find((c) => c.slug === row.slug)!.community.name
            : row.kind === "project" ? (projects.find((p) => p.slug === row.slug)!.community?.name ?? <UnavailableValue />)
            : communities.find((c) => c.slug === row.slug)!.name}
        </span>
      ),
    },
    {
      label: "Bedrooms",
      render: (row) => row.kind === "property"
        ? <span className="num flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-brand" aria-hidden />{compare.find((c) => c.slug === row.slug)!.bedrooms === 0 ? "Studio" : formatNumber(compare.find((c) => c.slug === row.slug)!.bedrooms)}</span>
        : <UnavailableValue label={row.kind === "community" ? "n/a for areas" : undefined} />,
    },
    {
      label: "Bathrooms",
      render: (row) => row.kind === "property"
        ? <span className="num flex items-center gap-1.5"><Bath className="h-4 w-4 text-brand" aria-hidden />{formatNumber(compare.find((c) => c.slug === row.slug)!.bathrooms)}</span>
        : <UnavailableValue label={row.kind === "community" ? "n/a for areas" : undefined} />,
    },
    {
      label: "Built-up area",
      render: (row) => {
        if (row.kind !== "property") return <UnavailableValue label="n/a" />;
        const c = compare.find((x) => x.slug === row.slug)!;
        return c.areaSqft ? <span className="num">{formatNumber(c.areaSqft)} sqft</span> : <UnavailableValue />;
      },
      metricOf: (row) => row.kind === "property" ? (compare.find((c) => c.slug === row.slug)!.areaSqft ?? null) : null,
      best: "max",
    },
    {
      label: "Price / sqft",
      render: (row) => {
        if (row.kind === "property") {
          const c = compare.find((x) => x.slug === row.slug)!;
          return c.areaSqft ? <span className="num">{formatMoney(pricePerSqftMinor(BigInt(c.price.minor), c.areaSqft) ?? 0n, { currency: c.price.currency })}</span> : <UnavailableValue />;
        }
        if (row.kind === "community") {
          const c = communities.find((x) => x.slug === row.slug)!;
          return c.avgPricePerSqftMinor
            ? <span className="num">{formatMoney(BigInt(c.avgPricePerSqftMinor), { currency: c.currency })}<span className="ml-1 text-xs text-muted-foreground">area avg</span></span>
            : <UnavailableValue />;
        }
        return <UnavailableValue />;
      },
      metricOf: (row) => {
        if (row.kind === "property") {
          const c = compare.find((x) => x.slug === row.slug)!;
          if (!c.areaSqft) return null;
          const v = pricePerSqftMinor(BigInt(c.price.minor), c.areaSqft);
          return v === null ? null : Number(v);
        }
        if (row.kind === "community") {
          const c = communities.find((x) => x.slug === row.slug)!;
          return c.avgPricePerSqftMinor ? Number(c.avgPricePerSqftMinor) : null;
        }
        return null;
      },
      best: "min",
    },
    {
      label: "Type / segment",
      render: (row) => row.kind === "property"
        ? <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-brand" aria-hidden />{capitalize(compare.find((c) => c.slug === row.slug)!.propertyType)}</span>
        : row.kind === "project"
          ? <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-brand" aria-hidden />{capitalize(projects.find((p) => p.slug === row.slug)!.status)}</span>
          : <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-brand" aria-hidden />{capitalize(communities.find((c) => c.slug === row.slug)!.areaType)} area</span>,
    },
    {
      label: "Developer",
      render: (row) => row.kind === "property"
        ? (compare.find((c) => c.slug === row.slug)!.developer?.name ?? <UnavailableValue />)
        : row.kind === "project"
          ? (projects.find((p) => p.slug === row.slug)!.developer?.name ?? <UnavailableValue />)
          : <UnavailableValue label="n/a for areas" />,
    },
    {
      label: "Handover",
      render: (row) => {
        if (row.kind === "property") return compare.find((c) => c.slug === row.slug)!.handoverQuarter ?? <UnavailableValue />;
        if (row.kind === "project") {
          const p = projects.find((x) => x.slug === row.slug)!;
          return p.handoverDate ? <span className="num">{new Date(p.handoverDate).toLocaleDateString("en-AE", { month: "short", year: "numeric" })}</span> : <UnavailableValue />;
        }
        return <UnavailableValue label="n/a for areas" />;
      },
    },
    {
      label: "Construction / availability",
      render: (row) => {
        if (row.kind === "project") {
          const p = projects.find((x) => x.slug === row.slug)!;
          return p.completionPercent != null ? <span className="num">{p.completionPercent}% complete</span> : <UnavailableValue />;
        }
        if (row.kind === "property") return capitalize(compare.find((c) => c.slug === row.slug)!.availabilityStatus);
        return <UnavailableValue />;
      },
    },
    {
      label: "Total units",
      render: (row) => row.kind === "project"
        ? (projects.find((p) => p.slug === row.slug)!.totalUnits ? <span className="num">{formatNumber(projects.find((p) => p.slug === row.slug)!.totalUnits!)}</span> : <UnavailableValue />)
        : <UnavailableValue />,
    },
    {
      label: "Lifestyle",
      render: (row) => row.kind === "community"
        ? (communities.find((c) => c.slug === row.slug)!.lifestyleTags.slice(0, 3).join(" · ") || <UnavailableValue />)
        : row.kind === "property"
          ? (compare.find((c) => c.slug === row.slug)!.view ? capitalize(compare.find((c) => c.slug === row.slug)!.view!) : <UnavailableValue />)
          : <UnavailableValue />,
    },
  ];

  const bestByMetric = new Map<string, Set<string>>();
  for (const m of metrics) {
    if (!m.metricOf || !m.best || allRows.length < 2) continue;
    const values = allRows.map((r) => ({ slug: r.slug, v: m.metricOf!(r) }));
    if (values.some((x) => x.v === null)) continue;
    const nums = values.map((x) => x.v as number);
    const target = m.best === "min" ? Math.min(...nums) : Math.max(...nums);
    if (nums.filter((n) => n === target).length !== 1) continue;
    bestByMetric.set(m.label, new Set(values.filter((x) => x.v === target).map((x) => x.slug)));
  }

  return (
    <div className="container-page py-8">
      <PrintHeader title="Comparison lab" url="/compare" note="Best printed in landscape orientation." />
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Compare" }]} />
      <div className="mt-4">
        <SectionHeading as="h1"
          kicker="Comparison lab"
          title="Compare the evidence, not the adjectives"
          description="Up to 4 properties, projects or communities. Normalized facts, explicit missing-data markers, and AI that explains trade-offs — never picks for you."
          action={
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              {askAiHref && (
                <Button asChild size="sm" className="gap-1.5">
                  <Link to={askAiHref}>
                    <Sparkles className="h-4 w-4" aria-hidden /> Ask AI to explain trade-offs
                  </Link>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => { events.share("compare", "print"); window.print(); }}
              >
                <Printer className="h-4 w-4" aria-hidden /> Print / PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => { clearCompare(); if (projectSlugs.length || communityList.length) navigate("/compare", undefined, { replace: true }); }}>
                Clear comparison
              </Button>
            </div>
          }
        />
      </div>

      {overLimit && (
        <p className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          Comparison lab supports up to 4 items — the table below shows the first four.
        </p>
      )}
      {error && (
        <div className="mt-4"><ErrorState message="Some comparison items could not be loaded. Check the links or try again." /></div>
      )}

      {loading && allRows.length === 0 ? (
        <div className="mt-6"><LoadingState rows={4} /></div>
      ) : (
        <div className="mt-6 overflow-x-auto scroll-elegant print:overflow-visible">
          <table className="w-full min-w-[680px] border-separate border-spacing-0">
            <caption className="sr-only">Comparison table: properties, projects and communities with best-value highlights</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 w-36 bg-background p-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground print:static print:bg-white">
                  Item
                </th>
                {allRows.slice(0, 4).map((row) => (
                  <th key={`${row.kind}:${row.slug}`} scope="col" className="min-w-52 border-b border-border/70 p-3 align-bottom">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => removeRow(row)}
                        aria-label={`Remove ${row.title} from comparison`}
                        className="absolute right-0 top-0 z-10 rounded-full bg-background/90 p-1 text-muted-foreground backdrop-blur hover:text-destructive print:hidden"
                      >
                        <Minus className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <Link to={row.href} className="group block">
                        <div className="mb-2 aspect-[4/3] overflow-hidden rounded-lg bg-sand">
                          {row.image?.url ? (
                            <img src={row.image.url} alt={row.image.altText ?? row.title} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground/40">
                              {row.kind === "community" ? <MapPin className="h-8 w-8" aria-hidden /> : <Layers className="h-8 w-8" aria-hidden />}
                            </div>
                          )}
                        </div>
                        <p className="text-left text-[11px] font-semibold uppercase tracking-wide text-brand-strong">{row.kind}</p>
                        <p className="line-clamp-2 text-left font-display text-sm font-semibold leading-snug group-hover:text-brand-strong">{row.title}</p>
                      </Link>
                    </div>
                  </th>
                ))}
                {allRows.length < 4 && (
                  <th scope="col" className="min-w-40 border-b border-border/70 p-3 align-bottom print:hidden">
                    <Button asChild variant="outline" size="sm"><Link to="/properties">+ Add item</Link></Button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const winners = bestByMetric.get(m.label);
                return (
                  <tr key={m.label} className="group/row">
                    <th scope="row" className="sticky left-0 z-10 border-b border-border/40 bg-background p-3 text-left text-xs font-medium text-muted-foreground transition-colors group-hover/row:bg-sand/40 print:static print:bg-white">
                      {m.label}
                    </th>
                    {allRows.slice(0, 4).map((row) => {
                      const isBest = winners?.has(row.slug);
                      return (
                        <td key={`${row.kind}:${row.slug}`} className={cn("border-b border-border/40 p-3 text-sm transition-colors group-hover/row:bg-sand/25", isBest && "bg-brand-faint/60")}>
                          <span className={cn("inline-flex flex-wrap items-center gap-1.5", isBest && "font-semibold")}>
                            {m.render(row)}
                            {isBest && (
                              <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-strong">best</span>
                            )}
                          </span>
                        </td>
                      );
                    })}
                    {allRows.length < 4 && <td className="border-b border-border/40 p-3 print:hidden" />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {bestByMetric.size > 0 && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Award className="h-3.5 w-3.5 text-brand" aria-hidden />
          <span>
            <span className="font-semibold text-foreground">best</span> marks the single lowest price / price-per-sqft or largest area in this
            comparison — computed from the same normalized facts, never inferred. Ties are not highlighted. Area price/sqft compares community averages, not individual listings.
          </span>
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Share this comparison: the URL carries your selection. AI trade-off explanations describe pros and cons — the choice stays yours.
      </p>
    </div>
  );
}

function parseList(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
}

function capitalize(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}
