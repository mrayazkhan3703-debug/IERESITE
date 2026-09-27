"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading } from "@/components/common";
import { Button } from "@/components/ui/button";

/** Legal document view — content is TEMPLATE marked for legal review (BLOCKED_LEGAL_PRIVACY_REVIEW) */
export function LegalView({ page }: { page: "privacy" | "terms" }) {
  const isPrivacy = page === "privacy";
  usePageMeta({
    title: isPrivacy ? "Privacy Notice" : "Terms of Use",
    description: isPrivacy
      ? "How Investment Experts collects, uses and protects personal data — including your consent choices and data-subject rights."
      : "Terms governing use of the Investment Experts platform and services.",
  });

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: isPrivacy ? "Privacy" : "Terms" }]} />
      <div className="mx-auto mt-4 max-w-3xl">
        <SectionHeading as="h1"
          kicker={isPrivacy ? "Privacy" : "Legal"}
          title={isPrivacy ? "Privacy Notice" : "Terms of Use"}
        />
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <strong>Template content — pending legal review.</strong> This notice is a structured placeholder prepared for
          qualified counsel review (UAE PDPL and applicable free-zone regimes). It must not be treated as the operative
          legal text until approved. <span className="text-xs">(docs/BLOCKERS.md → BLOCKED_LEGAL_PRIVACY_REVIEW)</span>
        </div>

        <div className="legal-body mt-8 space-y-8 text-[15px] leading-relaxed text-foreground/85">
          {isPrivacy ? (
            <>
              <section>
                <h2 className="font-display text-xl font-semibold">What we collect</h2>
                <ul className="mt-3 list-disc space-y-1.5 pl-5">
                  <li><strong>Essential:</strong> session identifiers needed to run the platform (always on).</li>
                  <li><strong>Analytics (consent-based):</strong> page views, search and filter usage, entity views — with IP minimization and payload allowlists.</li>
                  <li><strong>Personalization (consent-based):</strong> recently viewed and favorite signals used to tailor recommendations.</li>
                  <li><strong>Enquiry data:</strong> name, contact details, message and the page/search context attached to your enquiry.</li>
                </ul>
              </section>
              <section>
                <h2 className="font-display text-xl font-semibold">Your choices</h2>
                <p className="mt-3">
                  Manage analytics, marketing and personalization consent at any time in{" "}
                  <Link to="/cookie-settings" className="text-brand-strong underline underline-offset-2">Cookie settings</Link>.
                  Withdraw marketing consent without affecting essential services.
                </p>
              </section>
              <section>
                <h2 className="font-display text-xl font-semibold">Your rights</h2>
                <p className="mt-3">
                  You may request access, correction, deletion or restriction of your personal data through the{" "}
                  <Link to="/privacy" className="text-brand-strong underline underline-offset-2">Privacy Center</Link> (data-subject
                  request workflow). We respond within statutory timelines and keep an auditable trail.
                </p>
              </section>
              <section>
                <h2 className="font-display text-xl font-semibold">Retention & sharing</h2>
                <p className="mt-3">
                  Enquiry records are retained for legitimate business purposes; analytics events are minimized and
                  expire per policy. We share enquiry context with the assigned advisor and (in production) our CRM
                  provider strictly to service your enquiry. We never sell personal data.
                </p>
              </section>
            </>
          ) : (
            <>
              <section>
                <h2 className="font-display text-xl font-semibold">Use of the platform</h2>
                <p className="mt-3">
                  The platform provides property information, tools and advisory contact. Content is general information,
                  not investment, legal or tax advice. Calculators produce scenarios with stated assumptions — never
                  guaranteed outcomes.
                </p>
              </section>
              <section>
                <h2 className="font-display text-xl font-semibold">Data provenance</h2>
                <p className="mt-3">
                  Listing, market and project data carry source and freshness labels. Where figures are illustrative or
                  unverified, they are labeled as such. Inventory in this development deployment is clearly-marked demo
                  fixture data.
                </p>
              </section>
              <section>
                <h2 className="font-display text-xl font-semibold">AI features</h2>
                <p className="mt-3">
                  The AI Property Advisor searches real inventory through deterministic tools and cites approved sources.
                  It does not provide legal advice or guarantee availability; confirm material facts with your advisor.
                </p>
              </section>
            </>
          )}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          {isPrivacy ? (
            <Button asChild><Link to="/cookie-settings">Manage cookie settings</Link></Button>
          ) : (
            <Button asChild><Link to="/privacy">Privacy notice</Link></Button>
          )}
          <Button asChild variant="outline"><Link to="/contact">Contact us</Link></Button>
        </div>
      </div>
    </div>
  );
}

export default function PrivacyView() {
  return <LegalView page="privacy" />;
}
