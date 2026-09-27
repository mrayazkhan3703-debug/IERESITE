"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Globe2, FileCheck2, Landmark, Plane, GraduationCap, Building2, FolderCheck, MessageCircle, Phone } from "lucide-react";
import { AgentAvatar } from "@/components/entity/agent-avatar";
import { SITE_CONTACT, WHATSAPP_MESSAGES, companyWhatsappHref } from "@/lib/config";
import { events } from "@/lib/analytics-tracker";

const GUIDES = [
  { to: "/international/buying-remotely", title: "Remote Purchase Workflow", desc: "Buy from abroad: verification, POA, transfer and handover — step by step." },
  { to: "/international/financing-for-expats", title: "Financing for International Buyers", desc: "Mortgage options, documentation and loan-to-value for non-residents." },
  { to: "/international/ownership-and-regulation", title: "Ownership & Regulation", desc: "Freehold zones, escrow protections and title registration for foreign buyers." },
];

interface AgentDTO {
  slug: string; name: string; jobTitle: string;
  photoUrl: string | null;
  phoneE164: string | null;
  phoneDisplay: string | null;
  whatsappE164: string | null;
}

const FAQS = [
  { q: "Can I buy Dubai property without visiting the UAE?", a: "Yes — remote purchase is routine. Digital identity verification, power of attorney (POA) where needed, and trustee-office processes allow completion from abroad. Our remote purchase guide walks through the full workflow with source-dated steps." },
  { q: "What taxes do I pay as a foreign owner?", a: "Dubai currently levies no annual property tax or capital-gains tax on private individuals. The main transaction costs are the 4% DLD transfer fee, agent commission (~2%) and mortgage registration where applicable — verified figures are listed in our fees guide." },
  { q: "Can non-residents get a mortgage?", a: "Yes, several UAE lenders offer mortgages to non-residents, typically at lower maximum loan-to-value than residents (our financing guide covers indicative ranges with sources). Final underwriting is always a lender decision." },
  { q: "How do I manage a tenanted property from overseas?", a: "Owners typically appoint a licensed management company for leasing, Ejari registration, maintenance and rent collection. Our property management section below outlines the standard scope." },
  { q: "Does buying property give me residency?", a: "Property purchase can support Golden Visa eligibility under specific value criteria set by authorities — see our Golden Visa guide for the sourced, dated summary. Rules are set by regulators and subject to change; we date every claim." },
  { q: "What documents should I keep after purchase?", a: "Title deed (or Oqood for off-plan), sale and purchase agreement, mortgage documents, service-charge statements and tenancy contracts. Our documents checklist below itemizes the full set." },
];

export default function IntlView() {
  const [agents, setAgents] = React.useState<AgentDTO[] | null>(null);

  React.useEffect(() => {
    /* V3-02 (§13): public advisors — real people, verified contact routes;
     * language filters return when CRM-verified data exists. */
    fetch("/api/agents?public=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAgents((d?.agents ?? d?.results ?? []).slice(0, 3)))
      .catch(() => setAgents([]));
  }, []);

  usePageMeta({
    title: "International Buyers Hub — Buying Dubai Property from Abroad",
    description:
      "Everything international buyers need: remote purchase workflows, financing for non-residents, ownership rules, costs, Golden Visa guidance and relocation — with source-dated, reviewed content.",
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: "International Buyers Hub" },
  });

  return (
    <div className="pb-16">
      <section className="border-b border-border/70 bg-sand/50 py-12 sm:py-16">
        <div className="container-page">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "International Buyers" }]} />
          <p className="kicker mt-4">International buyers hub</p>
          <h1 className="mt-3 max-w-3xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Buying Dubai property from abroad — without the guesswork
          </h1>
          <p className="mt-4 max-w-2xl text-balance text-muted-foreground">
            Regulation-aware guidance with sources and freshness dates. Remote purchase workflows, financing options,
            Golden Visa rules and relocation basics — reviewed on a schedule, never presented as legal advice.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/international/golden-visa"><GraduationCap className="h-4 w-4" aria-hidden /> Golden Visa guide</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full">
              <Link to="/guides/buying-in-dubai">Buying guide</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="container-page py-12">
        <SectionHeading kicker="Essentials" title="Start here" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Globe2, title: "Who can buy", text: "Foreign nationals hold freehold title in designated zones — which covers nearly every community on this platform." },
            { icon: FileCheck2, title: "Escrow protection", text: "Off-plan payments go into project-specific escrow accounts, withdrawn against certified construction progress." },
            { icon: Landmark, title: "Costs & fees", text: "DLD transfer fee (4%), commission (~2%) and mortgage registration — the complete cost stack, verified." },
            { icon: Plane, title: "Remote completion", text: "Digital identity verification and trustee processes make purchase-without-travel routine." },
          ].map((x) => (
            <div key={x.title} className="rounded-xl border border-border/70 bg-card p-6">
              <x.icon className="h-5 w-5 text-brand" aria-hidden />
              <h3 className="mt-3 font-display text-lg font-semibold">{x.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{x.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container-page pb-12" aria-labelledby="guides-heading">
        <SectionHeading id="guides-heading" kicker="Guides" title="International buyer guides" />
        <div className="grid gap-5 sm:grid-cols-3">
          {GUIDES.map((g) => (
            <Link key={g.to} to={g.to} className="group rounded-xl border border-border/70 bg-card p-6 transition-ui hover:border-brand/40 hover:shadow-md">
              <h3 className="font-display text-lg font-semibold group-hover:text-brand-strong">{g.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{g.desc}</p>
              <span className="mt-4 inline-block text-sm font-medium text-brand-strong">Read guide →</span>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Regulatory content carries source links, verification dates and scheduled reviews. It is general information —
          engage licensed counsel for transaction-specific advice.
        </p>
      </section>

      {/* §27: property management + documents modules */}
      <section className="border-t border-border/70 bg-sand/40 py-12" aria-labelledby="pm-heading">
        <div className="container-page">
          <SectionHeading id="pm-heading" kicker="After the purchase" title="Own it from anywhere" description="Two things international owners ask about first — management and paperwork." />
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-card p-6">
              <Building2 className="h-5 w-5 text-brand" aria-hidden />
              <h3 className="mt-3 font-display text-lg font-semibold">Property management</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                A licensed management company typically handles leasing and tenant care, Ejari registration, rent
                collection, maintenance oversight and handover inspections. Owner reporting is usually monthly.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {[
                  "Tenant sourcing and screening to your criteria",
                  "Ejari registration and renewals",
                  "Rent collection and remittance to your account",
                  "Preventive maintenance and approved contractor network",
                  "Unit condition reports at check-in and check-out",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-2 text-foreground/85">
                    <FolderCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden /> {x}
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/guides/rental-income-dubai-landlords">Landlord &amp; rental income guide</Link></Button>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-6">
              <FileCheck2 className="h-5 w-5 text-brand" aria-hidden />
              <h3 className="mt-3 font-display text-lg font-semibold">Document checklist</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Keep a verified set of originals and scans — local and cross-border transactions both run smoother with these at hand.
              </p>
              <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                {[
                  "Passport (notarized copy if remote)",
                  "Title deed / Oqood registration",
                  "Sale & purchase agreement (SPA/FP form)",
                  "Mortgage offer &amp; schedule",
                  "Service charge statements",
                  "POA, if transacting via attorney",
                  "Insurance certificates",
                  "Tenancy contracts &amp; Ejari",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-2 rounded-lg border border-border bg-sand/40 p-2.5 text-foreground/85">
                    <FolderCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                    <span dangerouslySetInnerHTML={{ __html: x.replace("&amp;", "&") }} />
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">General checklist — your counsel confirms jurisdiction-specific requirements.</p>
            </div>
          </div>
        </div>
      </section>

      {/* §27/§49: advisory entry — real advisors with verified contact routes */}
      <section className="container-page py-12" aria-labelledby="intl-advisors">
        <SectionHeading id="intl-advisors" kicker="Advisory" title="Talk to an advisor about buying from abroad" description="A short consultation covers your residency status, financing route and timeline — with a real advisor, not a script." />
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <a
              href={companyWhatsappHref(WHATSAPP_MESSAGES.international)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => events.whatsappClick("international_hub")}
            >
              <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp the advisory desk
            </a>
          </Button>
          {/* V3-G §17 — explicit contact path: Call / WhatsApp / Book */}
          <Button asChild size="lg" variant="outline">
            <a href={SITE_CONTACT.phoneHref} onClick={() => events.callClick("international_hub")}>
              <Phone className="h-4 w-4" aria-hidden /> Call the office
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/consultation">Book a consultation</Link>
          </Button>
        </div>
        {agents && agents.length > 0 && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <Link key={a.slug} to={`/agents/${a.slug}`} className="group rounded-xl border border-border/70 bg-card p-5 transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-md">
                <div className="flex items-center gap-3.5">
                  <AgentAvatar name={a.name} photoUrl={a.photoUrl} alt={a.name} className="h-14 w-14" />
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold group-hover:text-brand-strong">{a.name}</h3>
                    {a.jobTitle && <p className="mt-0.5 text-xs text-muted-foreground">{a.jobTitle}</p>}
                    {a.phoneDisplay && <p className="num mt-1 text-xs text-muted-foreground">{a.phoneDisplay}</p>}
                  </div>
                </div>
              </Link>
            ))}
            <Link to="/agents" className="self-center text-sm font-medium text-brand-strong underline-offset-2 hover:underline">
              Meet all advisors →
            </Link>
          </div>
        )}
      </section>

      {/* §27: FAQs */}
      <section className="container-page pb-12" aria-labelledby="intl-faq">
        <SectionHeading id="intl-faq" kicker="FAQs" title="International buyer questions" description="General answers with pointers to the sourced guides — not legal advice." />
        <div className="mx-auto mt-6 max-w-3xl">
          <Accordion type="single" collapsible className="rounded-xl border border-border/70 bg-card px-4">
            {FAQS.map((f, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border-border/60">
                <AccordionTrigger className="text-left text-sm font-semibold hover:text-brand-strong hover:no-underline">{f.q}</AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <p className="mt-4 text-xs text-muted-foreground">
            Answers summarize our source-dated guides. Regulations are set by UAE authorities and change —
            always confirm current rules with licensed counsel or the relevant authority.
          </p>
        </div>
      </section>
    </div>
  );
}
