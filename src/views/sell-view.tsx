"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Tag, Home, TrendingUp, ShieldCheck } from "lucide-react";

export default function SellView() {
  usePageMeta({
    title: "Sell Your Dubai Property — Valuation, Marketing & Transfer",
    description:
      "Sell with Investment Experts: professional valuation, curated marketing with source-aware listing standards, qualified buyer flow and full transfer support.",
  });

  return (
    <div className="pb-16">
      <section className="border-b border-border/70 bg-sand/50 py-12 sm:py-16">
        <div className="container-page">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Sell" }]} />
          <p className="kicker mt-4">Sell / list</p>
          <h1 className="mt-3 max-w-3xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Sell your Dubai property with the evidence standard
          </h1>
          <p className="mt-4 max-w-2xl text-balance text-muted-foreground">
            A professional valuation anchored in comparable transactions. Listing standards with provenance on every fact.
            Qualified buyers, not tyre-kickers — and full support through transfer day.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/sell/valuation"><Tag className="h-4 w-4" aria-hidden /> Request a valuation</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full">
              <Link to="/sell/list">List with us</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="container-page py-12">
        <SectionHeading kicker="How it works" title="Four steps to sold" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: "01", title: "Valuation", text: "Comparable-transaction analysis with a unit-level adjustment — priced to sell, not to flatter." },
            { n: "02", title: "Preparation", text: "Documentation, staging guidance, professional photography and floor plans." },
            { n: "03", title: "Qualified marketing", text: "Your listing reaches filtered, high-intent buyers with full provenance on every fact." },
            { n: "04", title: "Transfer", text: "NOC, mortgage settlement and trustee-office completion — handled end to end." },
          ].map((s) => (
            <div key={s.n} className="rounded-xl border border-border/70 bg-card p-6">
              <p className="num font-display text-2xl font-semibold text-brand/40">{s.n}</p>
              <h3 className="mt-3 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container-page pb-12">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-card p-6">
            <TrendingUp className="h-5 w-5 text-brand" aria-hidden />
            <h3 className="mt-3 font-display text-lg font-semibold">What's your property worth?</h3>
            <p className="mt-2 text-sm text-muted-foreground">Median-based community pricing with unit adjustments — see where you'd sit in the market.</p>
            <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/sell/valuation">Get a valuation</Link></Button>
          </div>
          <div className="rounded-xl border border-border/70 bg-card p-6">
            <Home className="h-5 w-5 text-brand" aria-hidden />
            <h3 className="mt-3 font-display text-lg font-semibold">Listing standards</h3>
            <p className="mt-2 text-sm text-muted-foreground">Photography, floor plans and structured facts — the same provenance discipline buyers see across our platform.</p>
            <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/sell/list">Start a listing</Link></Button>
          </div>
          <div className="rounded-xl border border-border/70 bg-card p-6">
            <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
            <h3 className="mt-3 font-display text-lg font-semibold">Read the seller guide</h3>
            <p className="mt-2 text-sm text-muted-foreground">Costs, process and timelines with verified fee references.</p>
            <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/guides/selling-in-dubai">Seller guide</Link></Button>
          </div>
        </div>
      </section>
    </div>
  );
}
