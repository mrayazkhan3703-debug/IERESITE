"use client";

import * as React from "react";
import { Link, useRoute } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, LoadingState } from "@/components/common";
import { AgentAvatar } from "@/components/entity/agent-avatar";
import { events } from "@/lib/analytics-tracker";
import { memberWhatsappHref, WHATSAPP_MESSAGES } from "@/lib/config";
import { personJsonLd } from "@/lib/seo-schema";
import { localeOf, t } from "@/lib/i18n";
import type { AgentDTO } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Phone, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Team page V3 (V3 §12): the 25 verified members, grouped by department
 * with All/Leadership/Sales/Marketing/HR/Administration filter chips.
 * Cards show ONLY user-supplied facts — photo, name, designation, call and
 * WhatsApp actions. No years, languages, specialties, capacity, listing
 * counts or bios (none verified). Members without a supplied designation
 * omit the line; members without a phone omit call/WhatsApp actions.
 */

const DEPARTMENT_ORDER: { key: string; labelKey: string }[] = [
  { key: "leadership", labelKey: "teamV3.dept.leadership" },
  { key: "sales", labelKey: "teamV3.dept.sales" },
  { key: "marketing", labelKey: "teamV3.dept.marketing" },
  { key: "hr", labelKey: "teamV3.dept.hr" },
  { key: "admin", labelKey: "teamV3.dept.admin" },
  { key: "other", labelKey: "teamV3.dept.other" },
];

const FILTERS: { key: string | null; labelKey: string }[] = [
  { key: null, labelKey: "teamV3.filter.all" },
  { key: "leadership", labelKey: "teamV3.dept.leadership" },
  { key: "sales", labelKey: "teamV3.dept.sales" },
  { key: "marketing", labelKey: "teamV3.dept.marketing" },
  { key: "hr", labelKey: "teamV3.dept.hr" },
  { key: "admin", labelKey: "teamV3.dept.admin" },
];

export default function TeamView() {
  const [agents, setAgents] = React.useState<AgentDTO[] | null>(null);
  const [filter, setFilter] = React.useState<string | null>(null);
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  React.useEffect(() => {
    api.get<{ agents: AgentDTO[] }>("/api/agents").then((r) => setAgents(r.agents)).catch(() => setAgents([]));
  }, []);

  /* Verified roster only (exclude the advisory-desk fallback record) */
  const members = React.useMemo(
    () => (agents ?? []).filter((a) => a.slug !== "advisory-desk"),
    [agents]
  );

  usePageMeta({
    title: t("teamV3.meta.title", locale),
    description: t("teamV3.meta.description", locale),
    /* V3-19: Person schema per verified member — name + jobTitle when
     * supplied (omitted for the two members without one) + telephone when
     * supplied; factual fields only, no invented attributes. */
    jsonLd: members.map((m) => personJsonLd(m)),
  }, [agents]);

  const grouped = React.useMemo(() => {
    return DEPARTMENT_ORDER.map(({ key, labelKey }) => ({
      key,
      labelKey,
      members: members.filter((m) => (m.department ?? "other") === key),
    })).filter((g) => g.members.length > 0);
  }, [members]);

  const applyFilter = (key: string | null) => {
    setFilter(key);
    events.teamFilter(key ?? "all");
  };

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm font-medium transition-ui ${
      active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: t("teamV3.breadcrumb.home", locale), to: "/" }, { label: t("teamV3.breadcrumb.team", locale) }]} />
      <div className="mt-4">
        <SectionHeading
          kicker={t("teamV3.kicker", locale)}
          title={t("teamV3.title", locale)}
          as="h1"
          description={t("teamV3.intro", locale)}
        />
      </div>

      {/* Department filters */}
      <div className="mb-8 flex flex-wrap items-center gap-2" role="group" aria-label={t("teamV3.filter.aria", locale)}>
        {FILTERS.map((f) => (
          <button
            key={f.key ?? "all"}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => applyFilter(f.key)}
            className={cn(chip(filter === f.key), "min-h-11 sm:min-h-9")}
          >
            {t(f.labelKey, locale)}
          </button>
        ))}
      </div>

      {agents === null ? (
        <LoadingState rows={4} />
      ) : (
        <div className="space-y-10">
          {grouped
            .filter((g) => !filter || g.key === filter)
            .map((group) => (
              <section key={group.key} aria-labelledby={`team-${group.key}`}>
                <h2 id={`team-${group.key}`} className="kicker mb-4">
                  {t(group.labelKey, locale)} · <span className="num">{group.members.length}</span>
                </h2>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.members.map((m) => (
                    <article
                      key={m.id}
                      className="flex flex-col rounded-xl border border-border/70 bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-ui hover:border-brand/40"
                    >
                      <div className="flex items-center gap-4">
                        <AgentAvatar
                          name={m.name}
                          photoUrl={m.photoUrl}
                          photo={m.photo}
                          alt={m.jobTitle ? `${m.name}, ${m.jobTitle}` : m.name}
                          className="h-16 w-16"
                        />
                        <div className="min-w-0">
                          <h3 className="font-display text-base font-semibold tracking-tight">
                            <Link to={`/agents/${m.slug}`} className="transition-ui hover:text-brand-strong">
                              {m.name}
                            </Link>
                          </h3>
                          {m.jobTitle && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{m.jobTitle}</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 flex-1" />

                      {/* Verified contact actions — direct buttons only when a
                       * member phone was supplied; otherwise a clearly-labeled
                       * CENTRAL company enquiry route (never fabricated direct
                       * contact). */}
                      {(m.phoneE164 || m.whatsappE164) && (
                        <div className="grid grid-cols-2 gap-2">
                          {m.phoneE164 ? (
                            <Button asChild variant="outline" size="sm" className="h-11 gap-1.5">
                              <a
                                href={`tel:${m.phoneE164}`}
                                className="num"
                                onClick={() => events.teamMemberCall(m.slug)}
                              >
                                <Phone className="h-3.5 w-3.5" aria-hidden />
                                <span className="truncate">{t("teamV3.action.call", locale)}</span>
                              </a>
                            </Button>
                          ) : (
                            <span aria-hidden />
                          )}
                          {m.whatsappE164 ? (
                            <Button asChild variant="outline" size="sm" className="h-11 gap-1.5">
                              <a
                                href={memberWhatsappHref(m.whatsappE164, WHATSAPP_MESSAGES.member(m.name))}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => events.teamMemberWhatsapp(m.slug)}
                              >
                                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                                <span className="truncate">WhatsApp</span>
                              </a>
                            </Button>
                          ) : (
                            <span aria-hidden />
                          )}
                        </div>
                      )}
                      {(!m.phoneE164 || !m.whatsappE164) && (
                        <p className="text-xs text-muted-foreground">
                          <Link to="/contact" className="font-medium text-brand-strong underline-offset-2 transition-ui hover:underline">
                            {t("teamV3.action.centralEnquiry", locale)}
                          </Link>
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          {members.length === 0 && (
            <p className="py-12 text-center text-muted-foreground">{t("common.noResults", locale)}</p>
          )}
        </div>
      )}

      <div className="mt-10 text-center">
        <Button asChild>
          <Link to="/agents">{t("teamV3.advisorsCta", locale)} →</Link>
        </Button>
      </div>
    </div>
  );
}
