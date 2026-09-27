"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Phone, MessageCircle, CalendarClock } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { memberWhatsappHref, WHATSAPP_MESSAGES } from "@/lib/config";
import { events } from "@/lib/analytics-tracker";
import { AgentAvatar } from "@/components/entity/agent-avatar";
import type { AgentDTO } from "@/lib/types";
import type { LeadFormContext } from "@/components/leads/lead-form";

/**
 * Advisor strip V3 (V3 §11.11/§13): real advisor cards — photo, name,
 * designation, call/WhatsApp on the member's supplied number. Matching by
 * community/language was removed (unverified attributes, V3-B03) and returns
 * when CRM data exists. Book-consultation goes through the shared lead form.
 */
export function AdvisorMatching({
  locale,
  agents,
  leadForm,
}: {
  locale: Locale;
  agents: AgentDTO[] | null;
  leadForm: { open: (context: LeadFormContext) => void };
}) {
  const shown = agents?.slice(0, 4) ?? null;

  return (
    <section className="section-plain section" aria-labelledby="advisors-heading">
      <div className="container-page">
        <div className="mb-6 max-w-2xl">
          <p className="kicker mb-2">{t("home.advisors.kicker", locale)}</p>
          <h2 id="advisors-heading" className="type-h2">
            {t("home.advisors.title", locale)}
          </h2>
          <p className="mt-2 text-balance text-muted-foreground">{t("home.advisors.subtitle", locale)}</p>
        </div>

        {shown === null ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-xl bg-card/60" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-sand/30 px-6 py-10 text-center text-sm text-muted-foreground">
            {t("home.advisors.empty", locale)}{" "}
            <Link to="/agents" className="font-medium text-brand-strong underline-offset-2 hover:underline">
              {t("home.advisors.emptyLink", locale)}
            </Link>
            .
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {shown.map((a) => (
              <article
                key={a.id}
                className="flex flex-col rounded-xl border border-border/70 bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-ui hover:border-brand/40"
              >
                <div className="flex items-center gap-3.5">
                  <AgentAvatar
                    name={a.name}
                    photoUrl={a.photoUrl}
                    photo={a.photo}
                    alt={a.jobTitle ? `${a.name}, ${a.jobTitle}` : a.name}
                    className="h-14 w-14"
                  />
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold text-ink">
                      <Link to={`/agents/${a.slug}`} className="transition-ui hover:text-brand-strong">
                        {a.name}
                      </Link>
                    </h3>
                    {a.jobTitle && <p className="text-xs text-muted-foreground">{a.jobTitle}</p>}
                  </div>
                </div>

                <div className="mt-3 flex-1" />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border/60 pt-4">
                  <Button
                    size="sm"
                    className="rounded-full"
                    onClick={() =>
                      leadForm.open({
                        formId: "home_agent_consult",
                        intent: "CONSULT",
                        entityType: "AGENT",
                        entitySlug: a.slug,
                        agentSlug: a.slug,
                        agentName: a.name,
                        title: t("home.advisors.book", locale),
                        description: t("home.advisors.bookDescription", locale),
                      })
                    }
                  >
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {t("home.advisors.book", locale)}
                  </Button>
                  <div className="flex items-center gap-1.5">
                    {a.phoneE164 && (
                      <Button asChild variant="ghost" size="sm" className="h-9 w-9 p-0" aria-label={t("teamV3.action.call", locale)}>
                        <a href={`tel:${a.phoneE164}`} onClick={() => events.callClick(`home:${a.slug}`)}>
                          <Phone className="h-4 w-4" aria-hidden />
                        </a>
                      </Button>
                    )}
                    {a.whatsappE164 && (
                      <Button asChild variant="ghost" size="sm" className="h-9 w-9 p-0" aria-label="WhatsApp">
                        <a
                          href={memberWhatsappHref(a.whatsappE164, WHATSAPP_MESSAGES.member(a.name))}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => events.whatsappClick(`home:${a.slug}`)}
                        >
                          <MessageCircle className="h-4 w-4" aria-hidden />
                        </a>
                      </Button>
                    )}
                    <Link
                      to={`/agents/${a.slug}`}
                      className="text-xs font-medium text-brand-strong underline-offset-2 transition-ui hover:underline"
                    >
                      {t("home.advisors.profile", locale)} →
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          <Link to="/agents" className="font-medium text-brand-strong underline-offset-2 hover:underline">
            {t("home.advisors.allAdvisors", locale)} →
          </Link>
        </p>
      </div>
    </section>
  );
}
