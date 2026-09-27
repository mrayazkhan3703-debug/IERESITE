"use client";

import * as React from "react";
import { Link, useRoute } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, LoadingState } from "@/components/common";
import { AgentAvatar } from "@/components/entity/agent-avatar";
import { events } from "@/lib/analytics-tracker";
import { memberWhatsappHref, WHATSAPP_MESSAGES } from "@/lib/config";
import { realEstateAgentJsonLd } from "@/lib/seo-schema";
import { localeOf, t } from "@/lib/i18n";
import type { AgentDTO } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Phone, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Advisors directory V3 (V3 §13): PUBLIC ADVISORS ONLY (publicAdvisor=true).
 * Safe default filters — All advisors / Sales Managers / Leadership — until
 * CRM-verified language/area/specialty data exists (V3-B03). Cards carry
 * only verified facts: photo, name, designation, call/WhatsApp on the
 * member's own supplied number. No capacity, years, languages or
 * specialties (unverified), no fabricated direct contact for members
 * without a phone (central company enquiry instead).
 */

const FILTERS: { key: "all" | "sales" | "leadership"; labelKey: string }[] = [
  { key: "all", labelKey: "advisorV3.filter.all" },
  { key: "sales", labelKey: "advisorV3.filter.sales" },
  { key: "leadership", labelKey: "advisorV3.filter.leadership" },
];

export default function AgentsView() {
  const [agents, setAgents] = React.useState<AgentDTO[] | null>(null);
  const [filter, setFilter] = React.useState<"all" | "sales" | "leadership">("all");
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  React.useEffect(() => {
    api
      .get<{ agents: AgentDTO[] }>("/api/agents?public=1")
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
  }, []);

  usePageMeta(
    {
      title: t("advisorV3.meta.title", locale),
      description: t("advisorV3.meta.description", locale),
      /* V3-19: directory aggregate — ItemList over the PUBLIC advisors the
       * page actually shows (verified fields only: name/jobTitle/telephone
       * where supplied; no ratings, no invented attributes). */
      jsonLd: agents?.length
        ? {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "Investment Experts — advisory team",
            itemListElement: agents.map((a, i) => ({
              "@type": "ListItem",
              position: i + 1,
              item: realEstateAgentJsonLd(a),
            })),
          }
        : undefined,
    },
    [agents]
  );

  const filtered = React.useMemo(() => {
    if (!agents) return null;
    if (filter === "all") return agents;
    return agents.filter((a) => (a.department ?? "other") === filter);
  }, [agents, filter]);

  const applyFilter = (key: "all" | "sales" | "leadership") => {
    setFilter(key);
    events.teamFilter(`advisors:${key}`);
  };

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm font-medium transition-ui ${
      active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: t("teamV3.breadcrumb.home", locale), to: "/" }, { label: t("advisorV3.breadcrumb.advisors", locale) }]} />
      <div className="mt-4">
        <SectionHeading
          kicker={t("advisorV3.kicker", locale)}
          title={t("advisorV3.title", locale)}
          as="h1"
          description={t("advisorV3.description", locale)}
        />
      </div>

      {/* Safe default filters (V3 §13) — richer filters return with CRM data */}
      <div className="mb-8 flex flex-wrap items-center gap-2" role="group" aria-label={t("advisorV3.filter.aria", locale)}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => applyFilter(f.key)}
            className={cn(chip(filter === f.key), "min-h-11 sm:min-h-9")}
          >
            {t(f.labelKey, locale)}
          </button>
        ))}
      </div>

      {filtered === null || agents === null ? (
        <LoadingState rows={4} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => (
            <article
              key={a.id}
              className="flex flex-col rounded-xl border border-border/70 bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.12)]"
            >
              <div className="flex items-center gap-4">
                <AgentAvatar
                  name={a.name}
                  photoUrl={a.photoUrl}
                  photo={a.photo}
                  alt={a.jobTitle ? `${a.name}, ${a.jobTitle}` : a.name}
                  className="h-16 w-16"
                />
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold tracking-tight">
                    <Link to={`/agents/${a.slug}`} className="transition-ui hover:text-brand-strong">
                      {a.name}
                    </Link>
                  </h2>
                  {a.jobTitle && <p className="mt-0.5 text-xs text-muted-foreground">{a.jobTitle}</p>}
                </div>
              </div>

              <div className="mt-4 flex-1" />

              {a.phoneE164 && (
                <p className="num mb-3 text-sm font-medium text-foreground/85">{a.phoneDisplay ?? a.phoneE164}</p>
              )}

              {/* Verified contact actions on the advisor's own supplied number;
               * central company enquiry when none was supplied. */}
              <div className="grid grid-cols-2 gap-2">
                {a.phoneE164 ? (
                  <Button asChild variant="outline" size="sm" className="h-11 gap-1.5">
                    <a href={`tel:${a.phoneE164}`} className="num" onClick={() => events.callClick(`agent:${a.slug}`)}>
                      <Phone className="h-3.5 w-3.5" aria-hidden />
                      <span className="truncate">{t("teamV3.action.call", locale)}</span>
                    </a>
                  </Button>
                ) : (
                  <span aria-hidden />
                )}
                {a.whatsappE164 ? (
                  <Button asChild variant="outline" size="sm" className="h-11 gap-1.5">
                    <a
                      href={memberWhatsappHref(a.whatsappE164, WHATSAPP_MESSAGES.member(a.name))}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => events.whatsappClick(`agent:${a.slug}`)}
                    >
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                      <span className="truncate">WhatsApp</span>
                    </a>
                  </Button>
                ) : (
                  <span aria-hidden />
                )}
              </div>
              {(!a.phoneE164 || !a.whatsappE164) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <Link to="/contact" className="font-medium text-brand-strong underline-offset-2 transition-ui hover:underline">
                    {t("teamV3.action.centralEnquiry", locale)}
                  </Link>
                </p>
              )}

              <Button asChild variant="ghost" size="sm" className="mt-2 justify-start px-0 text-xs text-muted-foreground hover:text-brand-strong">
                <Link to={`/agents/${a.slug}`}>{t("advisorV3.card.profile", locale)} →</Link>
              </Button>
            </article>
          ))}
        </div>
      )}
      {agents !== null && (filtered ?? []).length === 0 && (
        <p className="py-12 text-center text-muted-foreground">{t("common.noResults", locale)}</p>
      )}
    </div>
  );
}
