"use client";

import * as React from "react";
import { Link, useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, ProvenanceBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { ShieldCheck, TrendingUp, Users, Globe2 } from "lucide-react";
import { organizationJsonLd } from "@/lib/seo-schema";
import { useSiteSettings } from "@/components/providers/site-settings-provider";
import { publicPageCopy } from "@/lib/site-settings";

/** Shared company page shell */
export function CompanyView({
  page,
  title,
  kicker,
  intro,
  children,
}: {
  page: string;
  title: string;
  kicker: string;
  intro: string;
  children?: React.ReactNode;
}) {
  const settings = useSiteSettings();
  const locale = useRoute().locale === "ar" ? "ar" : "en";
  const prefix = page === "About" ? "about" : page === "Careers" ? "careers" : null;
  const heading = prefix ? publicPageCopy(settings, `${prefix}Title`, locale, title) : title;
  const eyebrow = prefix ? publicPageCopy(settings, `${prefix}Kicker`, locale, kicker) : kicker;
  const description = prefix ? publicPageCopy(settings, `${prefix}Intro`, locale, intro) : intro;
  usePageMeta({
    title: heading,
    description: description.slice(0, 155),
    /* V3-19: verified Organization schema (same authoritative facts as home —
     * name/url/logo/telephone/full postal address/sameAs; no email). */
    jsonLd: organizationJsonLd(settings.contact),
  });

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: page }]} />
      <div className="mx-auto mt-4 max-w-3xl">
        <SectionHeading as="h1" kicker={eyebrow} title={heading} description={description} />
        {children}
      </div>
    </div>
  );
}

export default function AboutView() {
  return (
    <CompanyView
      page="About"
      kicker="Who we are"
      title="A decision platform with advisors behind it"
      intro="Investment Experts is a Dubai real-estate advisory built around evidence: sourced market data, transparent criteria and specialists who answer for the numbers."
    >
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-foreground/85">
        <p>
          Most property search stops at the photograph. We built this platform around a different question:{" "}
          <strong className="text-foreground">what would an investor need to see to trust a decision?</strong>{" "}
          Every listing carries provenance. Every calculator separates facts from assumptions. Every market figure shows
          its source and freshness date.
        </p>
        <p>
          Behind the product is a 25-member advisory team — leadership, sales managers and marketing — handling
          off-plan and secondary purchases, relocation and international buyer support. Enquiries arrive with your
          search context attached, so conversations start where the website left off.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { icon: ShieldCheck, title: "Evidence standard", text: "Source, date and methodology on material numbers. No guaranteed-return language — ever." },
            { icon: TrendingUp, title: "Investment discipline", text: "Yield logic, payment-plan stress-testing and exit thinking — not just square footage." },
            { icon: Users, title: "Advisory continuity", text: "One accountable specialist per client journey, CRM-assisted follow-up and viewings that respect your time." },
            { icon: Globe2, title: "International desk", text: "Remote purchase, financing and Golden-Visa guidance for international buyers." },
          ].map((x) => (
            <div key={x.title} className="rounded-xl border border-border/70 bg-card p-5">
              <x.icon className="h-5 w-5 text-brand" aria-hidden />
              <h3 className="mt-3 font-display text-base font-semibold">{x.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{x.text}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border/70 bg-sand/50 p-4 text-xs text-muted-foreground">
          <ProvenanceBadge chip={{ sourceType: "DEMO" }} />
          <span className="ml-2">Market figures on this development deployment are illustrative demo data pending the production feed; team and contact details are user-verified. We do not publish unverified awards, testimonials or transaction statistics.</span>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild><Link to="/about/team">Meet the team</Link></Button>
        <Button asChild variant="outline"><Link to="/contact">Contact us</Link></Button>
        <Button asChild variant="outline"><Link to="/careers">Careers</Link></Button>
      </div>
    </CompanyView>
  );
}
