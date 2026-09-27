"use client";

/**
 * Unit inventory (U07 — V2 §15.2).
 *
 * Project unit table upgraded to a decision tool:
 *  - filters: tower (parsed from unit numbers when present), floor, unit type,
 *    bedrooms, view (aspect), availability — every filter derives from real
 *    fields; a dimension with no data in the payload is omitted (honest);
 *  - sortable columns: unit, type, size, price, floor;
 *  - URL sync: active filters ride the query (?floor=&beds=&tower=…&view=&type=&status=)
 *    via SPA navigation so filtered views are shareable;
 *  - row CTA: "View unit" links to the unit's live listing when one is
 *    attached (propertySlug); otherwise (or additionally) "Enquire" scrolls to
 *    the enquiry form;
 *  - availability counts row + UnavailableValue for missing size/price;
 *  - 375px-safe: filter chips wrap, table scrolls horizontally with sticky
 *    first column.
 */

import * as React from "react";
import { Link, navigate, useRoute } from "@/lib/router";
import { formatAEDPrecise, fullValueTooltip } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";
import { StatusBadge, UnavailableValue } from "@/components/common";
import { t, type Locale } from "@/lib/i18n";
import { towerOfUnitNumber, humanizeTitle } from "@/components/entity/entity-shared";
import { ArrowUpDown, ChevronDown, ChevronUp, ExternalLink, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UnitInventoryRow {
  id: string;
  unitNumber: string | null;
  unitType: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  priceMinor: string | null;
  currency: string;
  availabilityStatus: string;
  floor: number | null;
  aspect: string | null;
  propertySlug: string | null;
}

type SortKey = "unit" | "type" | "beds" | "size" | "price" | "floor";

/** Valid URL-synced query params for this section. */
const QUERY_KEYS = ["tower", "floor", "type", "beds", "view", "status"] as const;

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-ui",
        active ? "border-brand bg-brand-soft text-brand-strong" : "border-border/70 bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function UnitInventory({
  slug,
  units,
  currency = "AED",
  locale = "en",
  onEnquire,
}: {
  slug: string;
  units: UnitInventoryRow[];
  currency?: string;
  locale?: Locale;
  onEnquire: () => void;
}) {
  const loc = useRoute();

  /* Filter state ← URL query (single source of truth) */
  const filters = {
    tower: (loc.query.tower as string) || null,
    floor: (loc.query.floor as string) || null,
    type: (loc.query.type as string) || null,
    beds: (loc.query.beds as string) || null,
    view: (loc.query.view as string) || null,
    status: (loc.query.status as string) || null,
  };

  const setParam = (patch: Record<string, string | null>) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...filters, ...patch })) {
      if (v) next[k] = v;
    }
    navigate(`/projects/${slug}`, next);
  };

  const clearFilters = () => navigate(`/projects/${slug}`, {});

  /* Filter option derivation — only dimensions with data */
  const towers = React.useMemo(() => {
    const set = new Set<string>();
    units.forEach((u) => {
      const tw = towerOfUnitNumber(u.unitNumber);
      if (tw) set.add(tw);
    });
    return [...set].sort();
  }, [units]);
  const floors = React.useMemo(() => {
    const set = new Set<number>();
    units.forEach((u) => {
      if (u.floor !== null) set.add(u.floor);
    });
    return [...set].sort((a, b) => a - b);
  }, [units]);
  const types = React.useMemo(() => {
    const set = new Set<string>();
    units.forEach((u) => set.add(u.unitType));
    return [...set].sort();
  }, [units]);
  const bedOptions = React.useMemo(() => {
    const set = new Set<number>();
    units.forEach((u) => set.add(u.bedrooms));
    return [...set].sort((a, b) => a - b);
  }, [units]);
  const views = React.useMemo(() => {
    const set = new Set<string>();
    units.forEach((u) => {
      if (u.aspect) set.add(u.aspect);
    });
    return [...set].sort();
  }, [units]);
  const statuses = React.useMemo(() => {
    const set = new Set<string>();
    units.forEach((u) => set.add(u.availabilityStatus));
    return [...set].sort();
  }, [units]);

  /* Applied filtering */
  const filtered = React.useMemo(
    () =>
      units.filter(
        (u) =>
          (!filters.tower || towerOfUnitNumber(u.unitNumber) === filters.tower) &&
          (!filters.floor || String(u.floor ?? "") === filters.floor) &&
          (!filters.type || u.unitType === filters.type) &&
          (!filters.beds || String(u.bedrooms) === filters.beds) &&
          (!filters.view || u.aspect === filters.view) &&
          (!filters.status || u.availabilityStatus === filters.status)
      ),
    [units, filters.tower, filters.floor, filters.type, filters.beds, filters.view, filters.status]
  );

  /* Sorting */
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "price", dir: "asc" });
  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };
  const sorted = React.useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "unit":
          return ((a.unitNumber ?? "") > (b.unitNumber ?? "") ? 1 : -1) * dir;
        case "type":
          return (a.unitType > b.unitType ? 1 : -1) * dir;
        case "beds":
          return (a.bedrooms - b.bedrooms) * dir;
        case "size":
          return ((a.areaSqft ?? Infinity) - (b.areaSqft ?? Infinity)) * dir;
        case "floor":
          return ((a.floor ?? Infinity) - (b.floor ?? Infinity)) * dir;
        case "price":
        default:
          return ((Number(a.priceMinor ?? Infinity) - Number(b.priceMinor ?? Infinity)) * dir);
      }
    });
  }, [filtered, sort]);

  const availableCount = units.filter((u) => u.availabilityStatus === "AVAILABLE").length;
  const anyFilter = QUERY_KEYS.some((k) => filters[k]);
  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      aria-label={t("project.units.sortAria", locale).replace("{col}", label)}
      className="inline-flex items-center gap-1 font-medium transition-ui hover:text-foreground"
    >
      {label}
      {sort.key === key ? (
        sort.dir === "asc" ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
      )}
    </button>
  );

  return (
    <section aria-labelledby="units-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="units-heading" className="font-display text-xl font-semibold">{t("project.units.title", locale)}</h2>
        <p className="num text-sm text-muted-foreground">
          {t("project.units.countLine", locale)
            .replace("{shown}", formatNumber(sorted.length))
            .replace("{total}", formatNumber(units.length))
            .replace("{available}", formatNumber(availableCount))}
        </p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("project.units.sub", locale)}</p>

      {/* Filters — only dimensions with data render */}
      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={t("project.units.filterGroup", locale)}>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("project.units.filters", locale)}</span>
        {towers.length > 1 && (
          <>
            <FilterChip active={!filters.tower} onClick={() => setParam({ tower: null })}>
              {t("project.units.allTowers", locale)}
            </FilterChip>
            {towers.map((tw) => (
              <FilterChip key={tw} active={filters.tower === tw} onClick={() => setParam({ tower: filters.tower === tw ? null : tw })}>
                {t("project.units.tower", locale).replace("{t}", tw)}
              </FilterChip>
            ))}
          </>
        )}
        {bedOptions.length > 1 && (
          <>
            <span className="mx-1 text-border" aria-hidden>|</span>
            <FilterChip active={!filters.beds} onClick={() => setParam({ beds: null })}>
              {t("project.units.allBeds", locale)}
            </FilterChip>
            {bedOptions.map((b) => (
              <FilterChip key={b} active={filters.beds === String(b)} onClick={() => setParam({ beds: filters.beds === String(b) ? null : String(b) })}>
                {b === 0 ? t("project.units.studio", locale) : `${formatNumber(b)} ${t("common.bedrooms", locale)}`}
              </FilterChip>
            ))}
          </>
        )}
        {types.length > 1 && (
          <>
            <span className="mx-1 text-border" aria-hidden>|</span>
            <FilterChip active={!filters.type} onClick={() => setParam({ type: null })}>
              {t("project.units.allTypes", locale)}
            </FilterChip>
            {types.map((ty) => (
              <FilterChip key={ty} active={filters.type === ty} onClick={() => setParam({ type: filters.type === ty ? null : ty })}>
                {humanizeTitle(ty)}
              </FilterChip>
            ))}
          </>
        )}
        {views.length > 1 && (
          <>
            <span className="mx-1 text-border" aria-hidden>|</span>
            <FilterChip active={!filters.view} onClick={() => setParam({ view: null })}>
              {t("project.units.allViews", locale)}
            </FilterChip>
            {views.map((v) => (
              <FilterChip key={v} active={filters.view === v} onClick={() => setParam({ view: filters.view === v ? null : v })}>
                {humanizeTitle(v)}
              </FilterChip>
            ))}
          </>
        )}
        {statuses.length > 1 && (
          <>
            <span className="mx-1 text-border" aria-hidden>|</span>
            <FilterChip active={!filters.status} onClick={() => setParam({ status: null })}>
              {t("project.units.anyStatus", locale)}
            </FilterChip>
            {statuses.map((s) => (
              <FilterChip key={s} active={filters.status === s} onClick={() => setParam({ status: filters.status === s ? null : s })}>
                {humanizeTitle(s)}
              </FilterChip>
            ))}
          </>
        )}
        {floors.length > 1 && (
          <>
            <span className="mx-1 text-border" aria-hidden>|</span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="sr-only">{t("project.units.floorFilter", locale)}</span>
              <select
                value={filters.floor ?? ""}
                onChange={(e) => setParam({ floor: e.target.value || null })}
                className="min-h-11 rounded-full border border-border/70 bg-card px-3 text-xs font-medium text-muted-foreground transition-ui hover:border-brand/40 focus:border-brand focus:outline-none"
              >
                <option value="">{t("project.units.allFloors", locale)}</option>
                {floors.map((f) => (
                  <option key={f} value={String(f)}>
                    {t("project.units.floorOption", locale).replace("{n}", String(f))}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {anyFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-1 inline-flex min-h-9 items-center rounded-full px-3 py-1.5 text-xs font-medium text-brand-strong underline underline-offset-2 transition-ui hover:text-brand"
          >
            {t("common.clearFilters", locale)}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="mt-4 max-h-[32rem] overflow-x-safe overflow-y-auto rounded-xl border border-border/70">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">{t("project.units.tableCaption", locale)}</caption>
          <thead className="sticky top-0 z-10 bg-sand/95 backdrop-blur">
            <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="p-3">{sortBtn("unit", t("project.units.colUnit", locale))}</th>
              <th scope="col" className="p-3">{sortBtn("type", t("common.type", locale))}</th>
              <th scope="col" className="p-3">{sortBtn("beds", t("common.bedrooms", locale))}</th>
              <th scope="col" className="p-3">{sortBtn("size", t("common.area", locale))}</th>
              <th scope="col" className="p-3">{sortBtn("price", t("common.price", locale))}</th>
              <th scope="col" className="p-3">{sortBtn("floor", t("project.units.colFloor", locale))}</th>
              <th scope="col" className="p-3">{t("project.units.colView", locale)}</th>
              <th scope="col" className="p-3">{t("project.units.colStatus", locale)}</th>
              <th scope="col" className="p-3 text-right">{t("project.units.colActions", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-sm text-muted-foreground">
                  {t("project.units.noMatch", locale)}
                </td>
              </tr>
            )}
            {sorted.map((u) => {
              const priceMajor = u.priceMinor ? Number(u.priceMinor) / 100 : null;
              return (
                <tr key={u.id} className="border-b border-border/40 transition-colors last:border-0 hover:bg-sand/30">
                  <td className="num p-3 font-semibold">{u.unitNumber ?? <UnavailableValue />}</td>
                  <td className="p-3">{humanizeTitle(u.unitType)}</td>
                  <td className="num p-3">{u.bedrooms === 0 ? t("project.units.studio", locale) : formatNumber(u.bedrooms)}</td>
                  <td className="num p-3">{u.areaSqft ? `${formatNumber(u.areaSqft)} sqft` : <UnavailableValue />}</td>
                  <td className="num p-3 font-medium">
                    {priceMajor !== null ? (
                      <span title={fullValueTooltip(priceMajor)}>{formatAEDPrecise(priceMajor)}</span>
                    ) : (
                      <UnavailableValue />
                    )}
                  </td>
                  <td className="num p-3">{u.floor !== null ? formatNumber(u.floor) : <UnavailableValue />}</td>
                  <td className="p-3 text-muted-foreground">{u.aspect ? humanizeTitle(u.aspect) : <UnavailableValue />}</td>
                  <td className="p-3"><StatusBadge status={u.availabilityStatus} /></td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1.5">
                      {u.propertySlug && (
                        <Link
                          to={`/properties/${u.propertySlug}`}
                          className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border/70 px-2.5 py-1.5 text-xs font-medium transition-ui hover:border-brand/40 hover:text-brand-strong"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only sm:hidden">{t("project.units.viewUnitSr", locale)}</span>
                          <span className="hidden sm:inline">{t("project.units.viewUnit", locale)}</span>
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={onEnquire}
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border/70 px-2.5 py-1.5 text-xs font-medium transition-ui hover:border-brand/40 hover:text-brand-strong"
                      >
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only sm:hidden">{t("cta.enquire", locale)}</span>
                        <span className="hidden sm:inline">{t("cta.enquire", locale)}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("project.units.footnote", locale)}</p>
    </section>
  );
}
