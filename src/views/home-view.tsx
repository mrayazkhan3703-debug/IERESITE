"use client";

/**
 * Homepage V2 (U03) — assembly only. Each §11 section lives in
 * src/components/home/* and consumes data from useHomeData().
 */

import * as React from "react";
import { useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { localeOf } from "@/lib/i18n";
import { organizationJsonLd, absoluteUrl } from "@/lib/seo-schema";
import { useHomeData } from "@/components/home/use-home-data";
import { Reveal } from "@/components/common/reveal";
import { Hero } from "@/components/home/hero";
import { MarketPulse } from "@/components/home/market-pulse";
import { OpportunityRadar } from "@/components/home/opportunity-radar";
import { AtlasPreview } from "@/components/home/atlas-preview";
import { CuratedProperties } from "@/components/home/curated-properties";
import { RecentlyViewedSection } from "@/components/common/recently-viewed";
import { OffPlanRadar } from "@/components/home/off-plan-radar";
import { CommunityIntelligence } from "@/components/home/community-intelligence";
import { AiDemo } from "@/components/home/ai-demo";
import { ScenarioLab } from "@/components/home/scenario-lab";
import { EvidenceMethodology } from "@/components/home/evidence-methodology";
import { AdvisorMatching } from "@/components/home/advisor-matching";
import { InternationalEntry } from "@/components/home/international-entry";
import { TrustProof } from "@/components/home/trust-proof";
import { FinalCta } from "@/components/home/final-cta";

export default function HomeView() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const data = useHomeData();
  const leadForm = useLeadForm();

  usePageMeta({
    title: undefined,
    description:
      "Search curated Dubai property inventory with investment evidence, market intelligence, investor calculators and advisor-led guidance. Apartments, villas and off-plan projects across Dubai's prime communities.",
    jsonLd: [
      /* V3-19: the ONE authoritative Organization schema — verified company
       * facts only (name/url/logo/telephone/postal address/sameAs maps link;
       * no email exists — V3-B01 — and none is invented). Advisor profiles
       * carry their own RealEstateAgent/Person schemas on /agents/*. */
      organizationJsonLd(),
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": absoluteUrl("/#website"),
        name: "Investment Experts",
        url: absoluteUrl("/"),
        publisher: { "@id": absoluteUrl("/#organization") },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: absoluteUrl("/properties?q={search_term_string}") },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  });

  return (
    <div>
      {/* §11.1 — no reveal wrapper: hero is the LCP element (§17) */}
      <Hero locale={locale} communities={data.communities} communityMetrics={data.communityMetrics} projects={data.projects} />

      {/* §11.2 — warm-sand strip doubles as the hero's bottom edge partition */}
      <Reveal>
        <MarketPulse locale={locale} pulse={data.pulse} />
      </Reveal>

      {/* §11.3 */}
      <Reveal>
        <OpportunityRadar
          locale={locale}
          pool={data.radarPool}
          communityMetrics={data.communityMetrics}
          contextFor={data.contextFor}
        />
      </Reveal>

      {/* §11.4 */}
      <Reveal>
        <AtlasPreview locale={locale} communities={data.communities} communityMetrics={data.communityMetrics} projects={data.projects} />
      </Reveal>

      {/* §11.5 */}
      <Reveal>
        <CuratedProperties locale={locale} featured={data.featured} contextFor={data.contextFor} />
      </Reveal>

      {/* DEV-C — personalization strip (renders nothing without local/server history) */}
      <RecentlyViewedSection locale={locale} />

      {/* §11.6 */}
      <Reveal>
        <OffPlanRadar locale={locale} projects={data.projects} />
      </Reveal>

      {/* §11.7 */}
      <Reveal>
        <CommunityIntelligence
          locale={locale}
          communities={data.communities}
          communityMetrics={data.communityMetrics}
          projects={data.projects}
        />
      </Reveal>

      {/* §11.8 */}
      <Reveal>
        <AiDemo locale={locale} communities={data.communities} communityMetrics={data.communityMetrics} />
      </Reveal>

      {/* §11.9 — local scenario engine, no API */}
      <Reveal>
        <ScenarioLab locale={locale} />
      </Reveal>

      {/* §11.10 */}
      <Reveal>
        <EvidenceMethodology locale={locale} communityMetrics={data.communityMetrics} pulse={data.pulse} />
      </Reveal>

      {/* §11.11 */}
      <Reveal>
        <AdvisorMatching locale={locale} agents={data.agents} leadForm={leadForm} />
      </Reveal>

      {/* §11.12 */}
      <Reveal>
        <InternationalEntry locale={locale} />
      </Reveal>

      {/* §11.13 */}
      <Reveal>
        <TrustProof
          locale={locale}
          advisorCount={data.agents ? data.agents.length : null}
          researchCount={data.research ? data.research.guides + data.research.insights : null}
        />
      </Reveal>

      {/* §11.14 */}
      <Reveal>
        <FinalCta locale={locale} />
      </Reveal>

      <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />
    </div>
  );
}
