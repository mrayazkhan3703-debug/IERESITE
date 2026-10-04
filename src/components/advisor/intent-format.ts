"use client";

/**
 * Intent-chip formatting for the AI Advisor V2 (§22.2).
 *
 * One formatter shared by BOTH surfaces that show structured criteria:
 *  1. the editable filter chips under a user message (from POST /api/search/nl);
 *  2. the "criteria used" summary under an assistant answer that ran a search
 *     (from the captured search_properties args).
 *
 * Deterministic client-side label construction — no extra LLM calls, no locale
 * drift. Arabic labels come from i18n templates; entity names pass through.
 */
import { t, type Locale } from "@/lib/i18n";
import { formatAEDPrecise } from "@/lib/format-precise";

export interface IntentFilterSet {
  q?: string;
  listingType?: "SALE" | "RENT" | "SHORT_TERM";
  communities?: string[];
  propertyTypes?: string[];
  priceMin?: number;
  priceMax?: number;
  bedroomsMin?: number;
  bathroomsMin?: number;
  offPlan?: boolean;
  seaView?: boolean;
  yieldMinPct?: number;
  yieldMin?: number;
  handoverBeforeQuarter?: string;
  handoverBy?: string;
}

export interface IntentChip {
  /** Stable key for the chip (used for removal/toggle bookkeeping). */
  key: string;
  /** Human label rendered inside the chip. */
  label: string;
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  APARTMENT: "Apartment",
  VILLA: "Villa",
  TOWNHOUSE: "Townhouse",
  PENTHOUSE: "Penthouse",
  DUPLEX: "Duplex",
  STUDIO: "Studio",
  OFFICE: "Office",
};

/** Filters → display chips (order is deterministic). */
export function filtersToChips(filters: IntentFilterSet, locale: Locale = "en"): IntentChip[] {
  const chips: IntentChip[] = [];
  if (filters.listingType) {
    chips.push({
      key: "listingType",
      label: t(filters.listingType === "SHORT_TERM" ? "advisorV2.chip.shortTerm" : filters.listingType === "RENT" ? "advisorV2.chip.forRent" : "advisorV2.chip.forSale", locale),
    });
  }
  for (const c of filters.communities ?? []) {
    chips.push({ key: `community:${c}`, label: c });
  }
  for (const p of filters.propertyTypes ?? []) {
    chips.push({ key: `type:${p}`, label: PROPERTY_TYPE_LABELS[p.toUpperCase()] ?? p });
  }
  if (filters.bedroomsMin != null) {
    chips.push({ key: "bedroomsMin", label: t("advisorV2.chip.beds", locale).replace("{n}", String(filters.bedroomsMin)) });
  }
  if (filters.bathroomsMin != null) {
    chips.push({ key: "bathroomsMin", label: t("advisorV2.chip.baths", locale).replace("{n}", String(filters.bathroomsMin)) });
  }
  if (filters.priceMin != null && filters.priceMin > 0) {
    chips.push({ key: "priceMin", label: t("advisorV2.chip.fromPrice", locale).replace("{p}", formatAEDPrecise(filters.priceMin)) });
  }
  if (filters.priceMax != null && filters.priceMax > 0) {
    chips.push({ key: "priceMax", label: t("advisorV2.chip.toPrice", locale).replace("{p}", formatAEDPrecise(filters.priceMax)) });
  }
  if (filters.offPlan) chips.push({ key: "offPlan", label: t("advisorV2.chip.offPlan", locale) });
  if (filters.seaView) chips.push({ key: "seaView", label: t("advisorV2.chip.seaView", locale) });
  const yieldMin = filters.yieldMinPct ?? filters.yieldMin;
  if (yieldMin != null) {
    chips.push({ key: "yieldMin", label: t("advisorV2.chip.yield", locale).replace("{p}", yieldMin.toFixed(1)) });
  }
  const handover = filters.handoverBeforeQuarter ?? filters.handoverBy;
  if (handover) {
    chips.push({ key: "handoverBy", label: t("advisorV2.chip.handover", locale).replace("{q}", handover) });
  }
  if (filters.q) chips.push({ key: "q", label: `“${filters.q}”` });
  return chips;
}

/**
 * Active (non-removed) filters → one deterministic natural-language refine
 * message. Sent to the advisor as a NEW user turn when the user edits the
 * interpreted chips — the advisor re-runs its tools with the refined criteria,
 * so guardrails (tools-only facts) stay intact.
 */
export function filtersToRefineQuery(filters: IntentFilterSet): string {
  const parts: string[] = [];
  if (filters.listingType) parts.push(filters.listingType === "SHORT_TERM" ? "short-term rentals" : filters.listingType === "RENT" ? "rentals" : "properties for sale");
  if (filters.propertyTypes?.length) parts.push(filters.propertyTypes.map((p) => PROPERTY_TYPE_LABELS[p.toUpperCase()] ?? p).join(" or "));
  if (filters.communities?.length) parts.push(`in ${filters.communities.join(" or ")}`);
  if (filters.bedroomsMin != null) parts.push(`${filters.bedroomsMin}+ bedrooms`);
  if (filters.bathroomsMin != null) parts.push(`${filters.bathroomsMin}+ bathrooms`);
  if (filters.priceMin != null && filters.priceMin > 0) parts.push(`from AED ${filters.priceMin.toLocaleString("en-US")}`);
  if (filters.priceMax != null && filters.priceMax > 0) parts.push(`up to AED ${filters.priceMax.toLocaleString("en-US")}`);
  if (filters.offPlan) parts.push("off-plan");
  if (filters.seaView) parts.push("with sea view");
  const yieldMin = filters.yieldMinPct ?? filters.yieldMin;
  if (yieldMin != null) parts.push(`modeled gross yield above ${yieldMin}%`);
  const handover = filters.handoverBeforeQuarter ?? filters.handoverBy;
  if (handover) parts.push(`handover before ${handover}`);
  if (filters.q) parts.push(`matching “${filters.q}”`);
  if (!parts.length) return "";
  return `Search again with the edited criteria: ${parts.join(", ")}. These filters replace the earlier interpretation — ignore criteria not listed here.`;
}
