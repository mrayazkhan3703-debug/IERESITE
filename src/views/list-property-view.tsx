"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading } from "@/components/common";
import { ListingFunnel } from "@/components/sell/listing-funnel";

export default function ListPropertyView() {
  usePageMeta({
    title: "List Your Property — Guided Funnel with Live Market Context",
    description:
      "A guided five-step listing flow: location with comparable market context, property facts, status, owner details and consent. Your details and the market evidence travel with the request.",
  });

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Sell", to: "/sell" }, { label: "List with us" }]} />
      <div className="mt-4">
        <SectionHeading as="h1"
          kicker="Listing request"
          title="List your property with us"
          description="Five short steps. As soon as you tell us the community, we surface honest market context — area averages and recent comparable transactions, clearly labeled. A specialist takes it from there."
        />
      </div>
      <ListingFunnel />
      <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-muted-foreground">
        Prefer a formal price analysis first?{" "}
        <Link to="/sell/valuation" className="font-semibold text-brand-strong underline underline-offset-2">Request a professional valuation</Link>{" "}
        — anchored in comparable transactions, never an automated guess.
      </p>
    </div>
  );
}
