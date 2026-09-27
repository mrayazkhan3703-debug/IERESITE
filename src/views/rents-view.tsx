"use client";

import { usePageMeta } from "@/components/layout/app-shell";
import { MarketTabs } from "@/components/market/market-tabs";
import { MarketExplorer } from "@/components/market/market-explorer";

/** Rental trends V2 (§19.5) — shared explorer, rents variant. */
export default function RentsView() {
  usePageMeta({
    title: "Dubai Rental Trends Explorer — Source-Backed Data",
    description:
      "Explore Dubai rental contracts by area and bedrooms — medians, distributions, compare-areas and trends with source and freshness labels.",
  });
  return (
    <div className="pb-16">
      <MarketTabs />
      <div className="container-page py-8">
        <MarketExplorer variant="rents" />
      </div>
    </div>
  );
}
