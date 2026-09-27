"use client";

import { usePageMeta } from "@/components/layout/app-shell";
import { MarketTabs } from "@/components/market/market-tabs";
import { MarketExplorer } from "@/components/market/market-explorer";

/** Transactions explorer V2 (§19.4) — shared explorer, transactions variant. */
export default function TransactionsView() {
  usePageMeta({
    title: "Dubai Property Transactions Explorer — Source-Backed Data",
    description:
      "Explore Dubai sale transactions by area, property type and period — medians, distributions and volumes with source and freshness labels.",
  });
  return (
    <div className="pb-16">
      <MarketTabs />
      <div className="container-page py-8">
        <MarketExplorer variant="transactions" />
      </div>
    </div>
  );
}
