"use client";

import * as React from "react";
import { Link, navigate } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { useAuth } from "@/components/providers/auth-provider";
import { Breadcrumbs, SectionHeading, EmptyState, LoadingState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { formatMoney, formatDate } from "@/lib/money";
import { t, localeOf } from "@/lib/i18n";
import { Bell, Mail, Search, Layers, Building2, TrendingUp, Clock, Globe } from "lucide-react";

interface DigestEntry {
  searchId: string;
  name: string;
  frequency: string;
  total: number;
  lastMatchCount: number;
  lastMatchedAt: string | null;
  preview: {
    slug: string;
    title: string;
    price: { minor: string; currency: string };
    bedrooms: number;
    community: string;
    coverUrl: string | null;
    isDemoData: boolean;
  }[];
}

interface SubscriptionRow {
  channel: string;
  purpose: string;
  consentGrantedAt: string | null;
}

/** Alert-type capability matrix — honest, matcher-driven (U14 §24).
 *  Only event types the saved-search matcher actually evaluates are LIVE;
 *  the rest render a disabled "coming soon" state instead of pretending. */
type AlertCapability = "live" | "coming-soon";

interface AlertGroupDef {
  key: string;
  icon: typeof Bell;
  titleKey: string;
  descKey: string;
  capability: AlertCapability;
}

const ALERT_GROUPS: AlertGroupDef[] = [
  {
    key: "SAVED_SEARCH_MATCH",
    icon: Search,
    titleKey: "account.alerts.group.match.title",
    descKey: "account.alerts.group.match.desc",
    capability: "live",
  },
  {
    key: "PRICE_CHANGE",
    icon: TrendingUp,
    titleKey: "account.alerts.group.price.title",
    descKey: "account.alerts.group.price.desc",
    capability: "coming-soon",
  },
  {
    key: "NEW_LAUNCHES",
    icon: Building2,
    titleKey: "account.alerts.group.project.title",
    descKey: "account.alerts.group.project.desc",
    capability: "coming-soon",
  },
  {
    key: "MARKET_THRESHOLD",
    icon: Bell,
    titleKey: "account.alerts.group.market.title",
    descKey: "account.alerts.group.market.desc",
    capability: "coming-soon",
  },
];

/** Channels exposed per live alert purpose (consent rows — U14 §24). */
const CHANNELS: { channel: "EMAIL" | "BROWSER"; labelKey: string }[] = [
  { channel: "EMAIL", labelKey: "account.alerts.channel.email" },
  { channel: "BROWSER", labelKey: "account.alerts.channel.browser" },
];

/** Alerts management (A46 → V2 §24): grouped types + channel consent */
export default function AccountAlertsView() {
  const { user, loading } = useAuth();
  const loc0 = typeof window === "undefined" ? { locale: "en" } : { locale: document.documentElement.lang || "en" };
  const locale = localeOf(loc0.locale);
  const t_ = (key: string, vars?: Record<string, string>) => {
    let s = t(key, locale);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };

  const [subs, setSubs] = React.useState<Record<string, boolean> | null>(null);
  const [digest, setDigest] = React.useState<DigestEntry[] | null>(null);
  const [digestAt, setDigestAt] = React.useState<string | null>(null);

  usePageMeta({ title: "Alert Settings", noindex: true });

  React.useEffect(() => {
    if (!user) return;
    api
      .get<{ subscriptions: SubscriptionRow[] }>("/api/account/notifications")
      .then((r) => {
        // key = purpose:channel — a row exists iff consent is granted
        const map: Record<string, boolean> = {};
        for (const s of r.subscriptions) map[`${s.purpose}:${s.channel}`] = true;
        setSubs(map);
      })
      .catch(() => setSubs({}));
    api
      .get<{ generatedAt: string; entries: DigestEntry[] }>("/api/account/digest-preview")
      .then((r) => {
        setDigest(r.entries);
        setDigestAt(r.generatedAt);
      })
      .catch(() => setDigest([]));
  }, [user]);

  const setChannelConsent = (purpose: string, channel: string, enabled: boolean) => {
    setSubs((s) => ({ ...(s ?? {}), [`${purpose}:${channel}`]: enabled }));
    api
      .post("/api/account/notifications", { purpose, channel, enabled })
      .catch(() => {
        // revert on failure
        setSubs((s) => ({ ...(s ?? {}), [`${purpose}:${channel}`]: !enabled }));
      });
  };

  if (loading) return <div className="container-page py-12"><LoadingState /></div>;

  if (!user) {
    return (
      <div className="container-page py-8">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Account", to: "/account" }, { label: "Alerts" }]} />
        <div className="mt-8">
          <EmptyState
            title="Sign in to manage alerts"
            description="Choose what triggers a notification — new matches first, price changes when the matcher supports them — and how you're reached."
            actionLabel="Sign in"
            onAction={() => navigate("/account/login")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Account", to: "/account" }, { label: "Alerts" }]} />
      <div className="mx-auto mt-4 max-w-2xl">
        <SectionHeading as="h1"
          kicker="Notifications"
          title="Alert settings"
          description="Every alert type is separate, consent-based and revocable. Only matcher-supported event types can be enabled — the rest are honestly marked coming soon."
        />

        {/* Grouped alert types (U14 §24) */}
        <section aria-labelledby="alert-groups-heading" className="mt-8">
          <h2 id="alert-groups-heading" className="font-display text-lg font-semibold">{t_("account.alerts.groups.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t_("account.alerts.groups.sub")}</p>

          <div className="mt-5 space-y-4">
            {ALERT_GROUPS.map((g) => {
              const live = g.capability === "live";
              return (
                <div
                  key={g.key}
                  className={`rounded-xl border bg-card p-5 ${live ? "border-border/70" : "border-dashed border-border/70 bg-card/60 opacity-90"}`}
                  aria-describedby={`${g.key}-desc`}
                >
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                        <g.icon className="h-4 w-4 text-brand" aria-hidden />
                        {t_(g.titleKey)}
                        {live ? (
                          <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                            {t_("account.alerts.live")}
                          </span>
                        ) : (
                          <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                            {t_("account.alerts.comingSoon")}
                          </span>
                        )}
                      </h3>
                      <p id={`${g.key}-desc`} className="mt-1 text-sm text-muted-foreground">{t_(g.descKey)}</p>
                      {!live && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground/70">
                          <Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                          {t_("account.alerts.comingSoon.note")}
                        </p>
                      )}
                    </div>
                    {/* The whole enable switch is only meaningful when the matcher runs */}
                    <Switch
                      aria-label={t_(g.titleKey)}
                      checked={live ? CHANNELS.some((c) => subs?.[`${g.key}:${c.channel}`]) : false}
                      disabled={!live}
                      onCheckedChange={(v) => {
                        if (!live) return;
                        // Toggling the master switch grants/withdraws all channel consent for the purpose
                        for (const c of CHANNELS) setChannelConsent(g.key, c.channel, v);
                      }}
                    />
                  </div>

                  {/* Channel consent rows (email / web) — only for live types */}
                  {live && (
                    <div className="mt-4 border-t border-border/60 pt-3.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t_("account.alerts.channels")}</p>
                      <div className="mt-2 space-y-2">
                        {CHANNELS.map((c) => {
                          const on = !!subs?.[`${g.key}:${c.channel}`];
                          return (
                            <div key={c.channel} className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-background/60 px-3.5 py-2.5">
                              <span className="flex items-center gap-2 text-sm">
                                {c.channel === "EMAIL" ? <Mail className="h-4 w-4 text-muted-foreground" aria-hidden /> : <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />}
                                {t_(c.labelKey)}
                              </span>
                              <Switch
                                aria-label={`${t_(g.titleKey)} — ${t_(c.labelKey)}`}
                                checked={on}
                                onCheckedChange={(v) => setChannelConsent(g.key, c.channel, v)}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">{t_("account.alerts.channel.note")}</p>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Marketing consent — consent purpose, not an event matcher */}
            <div className="flex items-start justify-between gap-6 rounded-xl border border-border/70 bg-card p-5">
              <div>
                <h3 className="flex items-center gap-2 font-semibold">
                  <Mail className="h-4 w-4 text-brand" aria-hidden />
                  {t_("account.alerts.marketing.title")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{t_("account.alerts.marketing.desc")}</p>
              </div>
              <Switch
                aria-label={t_("account.alerts.marketing.title")}
                checked={!!subs?.["marketing:EMAIL"]}
                onCheckedChange={(v) => setChannelConsent("marketing", "EMAIL", v)}
              />
            </div>
          </div>
        </section>

        {/* Saved-search digest preview — what the live alert email would contain */}
        <div className="mt-10">
          <SectionHeading
            kicker="Preview"
            title="Your saved-search digest"
            description="Exactly what we'd email when your live alerts run — same normalized results, nothing inferred."
          />

          <div className="mt-5 overflow-hidden rounded-xl border border-border/70 bg-card">
            {/* Email-style header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-sand/50 px-5 py-3.5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="h-4 w-4 text-brand" aria-hidden />
                Investment Experts · Property alerts
              </p>
              {digestAt && (
                <p className="num text-xs text-muted-foreground">generated {formatDate(digestAt)}</p>
              )}
            </div>

            {digest === null && (
              <div className="p-5"><LoadingState rows={2} /></div>
            )}

            {digest !== null && digest.length === 0 && (
              <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft">
                  <Search className="h-5 w-5 text-brand-strong" aria-hidden />
                </div>
                <div>
                  <p className="font-medium">No alert-enabled searches yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Save a search with alerts on and its digest will appear here — and in your inbox once delivery activates.
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/account/saved-searches">Manage saved searches</Link>
                </Button>
              </div>
            )}

            {digest !== null && digest.length > 0 && (
              <div className="divide-y divide-border/60">
                {digest.map((e) => (
                  <div key={e.searchId} className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Search className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                        {e.name}
                      </h3>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded-full bg-success/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-success">
                          {e.frequency.toLowerCase()}
                        </span>
                        <span className="num text-muted-foreground">
                          {e.total} match{e.total === 1 ? "" : "es"}
                          {e.total > e.preview.length ? ` · showing ${e.preview.length}` : ""}
                        </span>
                      </div>
                    </div>

                    {e.preview.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No current matches for these criteria — you'll be alerted when one appears.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {e.preview.map((p) => (
                          <li key={p.slug}>
                            <Link
                              to={`/properties/${p.slug}`}
                              className="flex items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
                            >
                              <span className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sand">
                                {p.coverUrl ? (
                                  <img src={p.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                                ) : (
                                  <Layers className="h-4 w-4 text-muted-foreground/40" aria-hidden />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{p.title}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {p.bedrooms === 0 ? "Studio" : `${p.bedrooms} bed`} · {p.community}
                                  {p.isDemoData && " · demo data"}
                                </span>
                              </span>
                              <span className="num shrink-0 text-sm font-semibold">
                                {formatMoney(p.price.minor, { currency: p.price.currency })}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="border-t border-border/70 bg-sand/30 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
              Delivery is queued until the production email provider is activated (docs/BLOCKERS.md) — this preview
              shows exactly what would be sent, generated fresh from live search results.
            </p>
          </div>
        </div>

        <p className="mt-6 rounded-lg border border-info/30 bg-info/5 p-4 text-xs leading-relaxed text-muted-foreground">
          Alert matching runs on the platform's saved-search engine (per-search frequency). Price-change, new-project
          and market-threshold matching are on the roadmap — they stay disabled here until the matcher actually
          evaluates those events. Email delivery requires the production email provider credential
          (docs/BLOCKERS.md); in this environment notifications are generated and visible in your account, with
          delivery queued.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild variant="outline"><Link to="/account/saved-searches">Manage saved searches</Link></Button>
          <Button asChild variant="ghost"><Link to="/cookie-settings">Marketing consent</Link></Button>
        </div>
      </div>
    </div>
  );
}
