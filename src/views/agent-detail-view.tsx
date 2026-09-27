"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { useRoute } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, ErrorState, LoadingState } from "@/components/common";
import { PropertyCard } from "@/components/property/property-card";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { events } from "@/lib/analytics-tracker";
import {
  SITE_CONTACT,
  SITE_LOGO,
  WHATSAPP_MESSAGES,
  companyWhatsappHref,
  memberWhatsappHref,
} from "@/lib/config";
import { personJsonLd, realEstateAgentJsonLd } from "@/lib/seo-schema";
import { localeOf, t } from "@/lib/i18n";
import { humanizeTitle } from "@/components/entity/entity-shared";
import { EntityResearch } from "@/components/entity/entity-faqs";
import { AgentAvatar } from "@/components/entity/agent-avatar";
import type { AgentDTO, ListingCardDTO } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Phone, MessageCircle, MapPin, Navigation, CalendarClock, Users } from "lucide-react";

type AgentDetail = AgentDTO & { listings: ListingCardDTO[] };

/**
 * Advisor profile V3 (V3 §13/§54): minimal verified data only — photo, name,
 * designation, phone + WhatsApp on the member's supplied number (contextual
 * prefilled message), book-consultation CTA, back-to-team link. Unverified
 * attributes (languages, specialties, communities, capacity, years) are
 * hidden while empty — never fabricated. The Advisory Desk slug renders as
 * the central company contact card (phone / WhatsApp / address / directions).
 */

export default function AgentDetailView({ slug }: { slug: string }) {
  const [data, setData] = React.useState<AgentDetail | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const leadForm = useLeadForm();
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  React.useEffect(() => {
    setNotFound(false);
    setData(null);
    api.get<AgentDetail>(`/api/agents/${slug}`).then(setData).catch(() => setNotFound(true));
  }, [slug]);

  const isDesk = data?.slug === "advisory-desk";

  usePageMeta(
    data
      ? {
          title: data.jobTitle ? `${data.name} — ${data.jobTitle}` : `${data.name} — Investment Experts`,
          description: isDesk
            ? t("advisorV3.desk.metaDescription", locale)
            : t("advisorV3.profile.metaDescription", locale)
                .replace("{n}", data.name)
                .replace("{t}", data.jobTitle || t("advisorV3.profile.teamMember", locale)),
          /* V3-19 structured data — verified fields only:
           * - RealEstateAgent: name + telephone where a real member number
           *   exists (advisory desk carries the company phone + address);
           * - Person: name + jobTitle when supplied + telephone when supplied.
           * No email, no ratings/reviews (none supplied — never fabricated). */
          jsonLd: [realEstateAgentJsonLd(data), personJsonLd(data)],
        }
      : {},
    [data?.id, locale, isDesk]
  );

  /* Property-type focus derived from live listings (honest derivation,
   * labeled) — hoisted above early returns so hook order is stable. */
  const listings = data?.listings;
  const propertyFocus = React.useMemo(() => {
    if (!listings) return [];
    const counts = new Map<string, number>();
    for (const l of listings) counts.set(l.propertyType, (counts.get(l.propertyType) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => ({ type, n }));
  }, [listings]);

  if (notFound) {
    return (
      <div className="container-page py-20">
        <ErrorState message={t("advisorV2.profile.notFound", locale)} />
        <div className="mt-6 text-center">
          <Button asChild variant="outline">
            <Link to="/agents">{t("advisorV2.profile.backToAdvisors", locale)}</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="container-page py-12"><LoadingState rows={3} /></div>;

  const memberWhatsapp = data.whatsappE164
    ? memberWhatsappHref(data.whatsappE164, WHATSAPP_MESSAGES.member(data.name))
    : null;

  const openMessage = () =>
    leadForm.open({
      formId: `agent_${slug}`,
      intent: "CONSULT",
      entityType: "AGENT",
      entitySlug: slug,
      entityId: data.id,
      entityTitle: `Advisor: ${data.name}`,
      agentSlug: slug,
      agentName: data.name,
      title: t("advisorV2.profile.messageTitle", locale).replace("{n}", data.name.split(" ")[0]),
      description: data.jobTitle || t("advisorV3.profile.teamMember", locale),
    });

  return (
    <div className="container-page py-8 pb-16">
      <Breadcrumbs
        items={[
          { label: t("advisorV3.breadcrumb.advisors", locale), to: "/agents" },
          { label: data.name },
        ]}
      />

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-10">
          {/* Profile header — verified data only */}
          <section aria-labelledby="agent-heading">
            <div className="flex flex-wrap items-start gap-6">
              {isDesk ? (
                /* Central desk: official logo mark (ink variant on light card) */
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-card p-2">
                  { }
                  <img src={SITE_LOGO.light} alt="Investment Experts" width={56} height={18} className="h-[18px] w-auto" decoding="async" />
                </div>
              ) : (
                <AgentAvatar
                  name={data.name}
                  photoUrl={data.photoUrl}
                  photo={data.photo}
                  alt={data.jobTitle ? `${data.name}, ${data.jobTitle}` : data.name}
                  rounded="rounded-2xl"
                  className="h-20 w-20 shadow-md"
                />
              )}
              <div className="min-w-0 flex-1">
                <h1 id="agent-heading" className="font-display text-3xl font-semibold tracking-tight">{data.name}</h1>
                {data.jobTitle && <p className="mt-1 text-muted-foreground">{data.jobTitle}</p>}
                {isDesk && (
                  <p className="mt-1 text-sm text-muted-foreground">{t("advisorV3.desk.tagline", locale)}</p>
                )}
              </div>
            </div>

            {/* Bio — only when verified content exists (none currently) */}
            {data.bio && <p className="mt-6 max-w-2xl leading-relaxed text-foreground/85">{data.bio}</p>}
          </section>

          {/* Expertise — record-backed sections render only with real data */}
          {(data.specialties.length > 0 || data.communities.length > 0 || data.languages.length > 0) && (
            <section aria-labelledby="expertise-heading">
              <h2 id="expertise-heading" className="font-display text-xl font-semibold">{t("advisorV2.profile.expertise", locale)}</h2>
              <div className="mt-4 space-y-5">
                {data.specialties.length > 0 && (
                  <div>
                    <p className="kicker mb-2">{t("advisorV2.profile.specialties", locale)}</p>
                    <div className="flex flex-wrap gap-2">
                      {data.specialties.map((s) => (
                        <span key={s} className="rounded-full border border-border bg-sand px-3.5 py-1.5 text-sm">
                          {s.charAt(0) + s.slice(1).toLowerCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {data.communities.length > 0 && (
                  <div>
                    <p className="kicker mb-2">{t("advisorV2.profile.communityExpertise", locale)}</p>
                    <div className="flex flex-wrap gap-2">
                      {data.communities.map((c) => (
                        <Link
                          key={c.slug}
                          to={`/communities/${c.slug}`}
                          className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm transition-ui hover:border-brand/50"
                        >
                          <MapPin className="h-3.5 w-3.5 text-brand" aria-hidden /> {c.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Property-type focus — DERIVED from live listings, labeled */}
          {propertyFocus.length > 0 && (
            <section aria-labelledby="focus-heading">
              <h2 id="focus-heading" className="font-display text-xl font-semibold">{t("advisorV3.profile.coverage", locale)}</h2>
              <div className="mt-4">
                <div className="flex flex-wrap gap-2">
                  {propertyFocus.map((f) => (
                    <span key={f.type} className="num rounded-full border border-border bg-card px-3.5 py-1.5 text-sm">
                      {humanizeTitle(f.type)} · {f.n}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{t("advisorV2.profile.propertyFocusNote", locale)}</p>
              </div>
            </section>
          )}

          {/* Active listings */}
          {data.listings.length > 0 && (
            <section aria-labelledby="listings-heading">
              <SectionHeading
                kicker={t("advisorV2.profile.portfolio", locale)}
                title={t("advisorV2.profile.listingsTitle", locale).replace("{n}", data.name.split(" ")[0])}
              />
              <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {data.listings.slice(0, 9).map((l) => (
                  <PropertyCard key={l.id} listing={l} />
                ))}
              </div>
            </section>
          )}

          {/* Related content / reports */}
          <EntityResearch
            title={t("advisorV2.profile.research", locale)}
            reportFilter={() => true}
            guideSlugs={["buying-in-dubai", "off-plan-vs-secondary", "mortgage-financing-guide"]}
            locale={locale}
          />
        </div>

        {/* Contact sidebar */}
        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label={t("advisorV2.profile.contactAria", locale)}>
          <div className="rounded-xl border border-border/70 bg-card p-6">
            <p className="kicker">
              {isDesk
                ? t("advisorV3.desk.contactKicker", locale)
                : t("advisorV2.profile.talkTo", locale).replace("{n}", data.name.split(" ")[0])}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {isDesk
                ? t("advisorV3.desk.contactNote", locale)
                : t("advisorV2.profile.attribution", locale).replace("{n}", data.name)}
            </p>

            {isDesk && (
              /* Central desk: verified office address with directions */
              <address className="mt-4 space-y-1 text-sm not-italic text-muted-foreground">
                <p>{SITE_CONTACT.addressLine1}</p>
                <p>{SITE_CONTACT.addressLine2}</p>
                <a
                  href={SITE_CONTACT.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => events.directionsClick("agent_desk")}
                  className="inline-flex items-center gap-1.5 pt-1 text-xs font-medium text-brand-strong underline-offset-2 transition-ui hover:underline"
                >
                  <Navigation className="h-3 w-3" aria-hidden /> {t("advisorV3.desk.directions", locale)}
                </a>
              </address>
            )}

            <div className="mt-5 space-y-2.5">
              <Button className="w-full" onClick={openMessage}>
                {t("advisorV2.profile.sendMessage", locale)}
              </Button>

              {/* WhatsApp — member's own number (contextual message); the desk
               * uses the company line with a generic prefilled message. */}
              {(isDesk ? companyWhatsappHref(WHATSAPP_MESSAGES.generic) : memberWhatsapp) && (
                <Button asChild variant="outline" className="w-full gap-2" onClick={() => events.whatsappClick(`agent:${slug}`)}>
                  <a
                    href={isDesk ? companyWhatsappHref(WHATSAPP_MESSAGES.generic) : memberWhatsapp ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden /> {t("cta.whatsapp", locale)}
                  </a>
                </Button>
              )}

              {/* Call — member's own number; the desk uses the company line. */}
              {(data.phoneE164 || isDesk) && (
                <Button
                  asChild
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => events.callClick(`agent:${slug}`)}
                >
                  <a href={isDesk ? SITE_CONTACT.phoneHref : `tel:${data.phoneE164}`} className="num">
                    <Phone className="h-4 w-4" aria-hidden />{" "}
                    {isDesk ? SITE_CONTACT.phone : (data.phoneDisplay ?? data.phoneE164)}
                  </a>
                </Button>
              )}

              {!data.phoneE164 && !isDesk && (
                <p className="text-xs text-muted-foreground">
                  <Link to="/contact" className="font-medium text-brand-strong underline-offset-2 transition-ui hover:underline">
                    {t("teamV3.action.centralEnquiry", locale)}
                  </Link>
                </p>
              )}

              {/* Calendar / consultation booking (§18) */}
              <Button asChild className="w-full gap-2">
                <Link to="/consultation" query={{ agent: slug }}>
                  <CalendarClock className="h-4 w-4" aria-hidden /> {t("advisorV2.profile.bookConsultation", locale)}
                </Link>
              </Button>
              <Button asChild variant="ghost" className="w-full gap-2">
                <Link to="/about/team">
                  <Users className="h-4 w-4" aria-hidden /> {t("advisorV3.profile.backToTeam", locale)}
                </Link>
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link to="/agents">{t("advisorV2.profile.allAdvisors", locale)} →</Link>
              </Button>
            </div>
          </div>
        </aside>
      </div>

      <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />
    </div>
  );
}
