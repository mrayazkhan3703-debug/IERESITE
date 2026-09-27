"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, GridSkeleton, EmptyState } from "@/components/common";
import { PropertyCard } from "@/components/property/property-card";
import type { SearchResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Link, navigate } from "@/lib/router";

/** Investment opportunities: high-yield communities + featured inventory (deterministic selection) */
export default function OpportunitiesView() {
  const [data, setData] = React.useState<SearchResponse | null>(null);

  usePageMeta({
    title: "Investment Opportunities in Dubai — Yield-Led Selection",
    description:
      "Curated Dubai investment opportunities selected on yield logic: entry price, rent context and payment-plan structures — with transparent criteria.",
  });

  React.useEffect(() => {
    // deterministic opportunity set: featured + JVC-style value bands
    api.get<SearchResponse>("/api/search?featured=1&limit=9").then(setData).catch(() => setData(null));
  }, []);

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Invest", to: "/invest" }, { label: "Opportunities" }]} />
      <div className="mt-4">
        <SectionHeading as="h1"
          kicker="Curated selection"
          title="Opportunities, selected on the numbers"
          description="Entry price, rent context, payment structure and exit logic — the criteria our investment desk actually uses. Selection is deterministic (featured + value bands), never promotional ranking."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/calculators/roi">Test one in the ROI calculator</Link>
            </Button>
          }
        />
      </div>
      {data === null ? (
        <GridSkeleton />
      ) : data.results.length === 0 ? (
        <EmptyState title="No opportunities right now" description="The desk refreshes this selection as inventory changes." actionLabel="Browse all properties" onAction={() => navigate("/properties")} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.results.map((l) => (
            <PropertyCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
