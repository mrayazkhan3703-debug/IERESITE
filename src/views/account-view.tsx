"use client";

import { mediaPreviewUrl } from "@/lib/media-preview";
import * as React from "react";
import { Link, navigate } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { useAuth } from "@/components/providers/auth-provider";
import { useSavedStore } from "@/components/providers/saved-provider";
import { Breadcrumbs, LoadingState, SectionHeading, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Heart,
  Search,
  Bell,
  Settings,
  LogOut,
  ArrowRight,
  Briefcase,
  Calculator,
  Sparkles,
  Scale,
  Trash2,
  Upload,
  MessageSquare,
  Clock,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import { formatDate } from "@/lib/money";
import { t, localeOf } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

/** Saved scenario shape (localStorage ie_saved_scenarios_v2 — U12 studio contract). */
interface SavedScenario {
  id: string;
  timestamp: string;
  inputs: { purchasePrice: number; annualRent: number; sizeSqft: number; serviceChargePerSqft: number; horizonYears: number; financing: "cash" | "mortgage"; downPaymentPct: number };
  outputs: { grossYieldPct: number; netYieldPct: number; irrPct: number | null; breakEvenYear: number | null; totalReturnPct: number; cashOnCashPct: number };
}

interface ConversationSummary {
  id: string;
  status: string;
  topicSummary: string | null;
  firstMessage: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

const SCENARIO_KEY = "ie_saved_scenarios_v2";

function loadScenarios(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(SCENARIO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedScenario[];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function persistScenarios(list: SavedScenario[]) {
  try {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    /* storage full/blocked — deletion just fails silently */
  }
}

interface AccountSummary {
  savedSearches: number;
  alertSubscriptions: number;
  conversations: number;
  holdings: number;
  documents: number;
}

/** Account dashboard (A44–A47 hub) — V2 §24: full saved-state surface */
export default function AccountView() {
  const { user, loading, logout } = useAuth();
  const favorites = useSavedStore((s) => s.favorites);
  const compare = useSavedStore((s) => s.compare);
  const clearCompare = useSavedStore((s) => s.clearCompare);
  const recentlyViewed = useSavedStore((s) => s.recentlyViewed);
  const firstName = user?.name?.split(" ")[0] ?? "";
  const loc = typeof window === "undefined" ? { locale: "en" } : { locale: document.documentElement.lang || "en" };
  const locale = localeOf(loc.locale);
  const t_ = (key: string, vars?: Record<string, string>) => {
    let s = t(key, locale);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
  const { toast } = useToast();

  const [summary, setSummary] = React.useState<AccountSummary | null>(null);
  const [scenarios, setScenarios] = React.useState<SavedScenario[]>([]);
  const [conversations, setConversations] = React.useState<ConversationSummary[] | null>(null);

  usePageMeta({ title: "Your Account", noindex: true });

  React.useEffect(() => {
    setScenarios(loadScenarios());
  }, []);

  React.useEffect(() => {
    if (!user) return;
    api
      .get<AccountSummary>("/api/account/summary")
      .then(setSummary)
      .catch(() => setSummary(null));
    api
      .get<{ conversations: ConversationSummary[] }>("/api/ai/conversations")
      .then((r) => setConversations(r.conversations))
      .catch(() => setConversations([]));
  }, [user]);

  const deleteScenario = (id: string) => {
    const next = scenarios.filter((s) => s.id !== id);
    setScenarios(next);
    persistScenarios(next);
    toast({ title: t_("account.savedScenarios.deleted") });
  };

  if (loading) return <div className="container-page py-12"><LoadingState /></div>;

  if (!user) {
    return (
      <div className="container-page py-8">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Account" }]} />
        <div className="mt-8">
          <EmptyState
            title="Sign in to your account"
            description="Access saved properties, searches, alerts and your portfolio across devices. Browsing never requires an account."
            actionLabel="Sign in"
            onAction={() => navigate("/account/login")}
          />
        </div>
      </div>
    );
  }

  const cards = [
    { to: "/account/favorites", icon: Heart, title: t_("account.nav.favorites"), count: favorites.length, desc: "Your shortlist, synced to your account." },
    { to: "/account/saved-searches", icon: Search, title: t_("account.nav.savedSearches"), count: summary?.savedSearches ?? 0, desc: "Re-run your criteria in one click." },
    { to: "/account/alerts", icon: Bell, title: t_("account.nav.alerts"), count: summary?.alertSubscriptions ?? 0, desc: "New matches and price changes, on your schedule." },
    { to: "/account/preferences", icon: Settings, title: t_("account.nav.preferences"), count: null, desc: "Locale, currency and privacy choices." },
    { to: "/account/portfolio", icon: Briefcase, title: t_("account.nav.portfolio"), count: summary?.holdings ?? 0, desc: t_("account.portfolio.desc"), countLabel: t_("account.portfolio.holdings", { n: String(summary?.holdings ?? 0) }) },
    { to: "/account/portfolio#scenarios", icon: Calculator, title: t_("account.nav.scenarios"), count: scenarios.length, desc: t_("account.scenarios.desc") },
    { to: "/account/portfolio#conversations", icon: Sparkles, title: t_("account.nav.conversations"), count: summary?.conversations ?? 0, desc: t_("account.conversations.desc") },
    { to: "/compare", icon: Scale, title: t_("account.nav.comparisons"), count: compare.length, desc: t_("account.comparisons.desc") },
  ];

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Account" }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Your account</p>
          <h1 className="mt-2 font-display text-2xl font-semibold sm:text-3xl">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => { await logout(); navigate("/"); }}>
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </Button>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.to + c.title} to={c.to} className="group rounded-xl border border-border/70 bg-card p-6 transition-ui hover:border-brand/40 hover:shadow-md">
            <c.icon className="h-5 w-5 text-brand" aria-hidden />
            <h2 className="mt-3 font-display text-lg font-semibold group-hover:text-brand-strong">{c.title}</h2>
            {c.count !== null && (
              <p className="num mt-0.5 text-sm text-muted-foreground">
                {c.countLabel ?? `${c.count} saved`}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">{c.desc}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-strong">
              Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          </Link>
        ))}
      </div>

      {/* U14 §24: saved calculations — localStorage list with load/delete */}
      <section className="mt-10" aria-labelledby="scenarios-heading" id="scenarios">
        <SectionHeading
          id="scenarios-heading"
          kicker="Saved state"
          title={t_("account.savedScenarios.title")}
          description={t_("account.savedScenarios.sub")}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/invest">{t_("account.savedScenarios.openStudio")}</Link>
            </Button>
          }
        />
        {scenarios.length === 0 ? (
          <EmptyState
            title={t_("account.savedScenarios.empty")}
            actionLabel={t_("account.savedScenarios.openStudio")}
            onAction={() => navigate("/invest")}
            icon={<Calculator className="h-8 w-8" aria-hidden />}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {scenarios.map((s) => (
              <li key={s.id} className="rounded-xl border border-border/70 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num text-sm font-semibold">
                      {t_("account.savedScenarios.inputs", { price: formatAEDPrecise(s.inputs.purchasePrice), rent: formatAEDPrecise(s.inputs.annualRent) })}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <Clock className="mr-1 inline h-3 w-3" aria-hidden />
                      {t_("account.savedScenarios.savedAt", { date: formatDate(s.timestamp) })} ·{" "}
                      {s.inputs.financing === "mortgage" ? `${s.inputs.downPaymentPct}% down` : "cash"} · {s.inputs.horizonYears}y
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 px-2.5 text-xs"
                      onClick={() => navigate("/calculators/roi", { preset: s.id })}
                      aria-label={`${t_("account.savedScenarios.load")} ${formatDate(s.timestamp)}`}
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden /> {t_("account.savedScenarios.load")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2.5 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => deleteScenario(s.id)}
                      aria-label={`${t_("account.savedScenarios.delete")} ${formatDate(s.timestamp)}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t_("account.savedScenarios.delete")}
                    </Button>
                  </div>
                </div>
                <dl className="num mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">{t_("account.savedScenarios.netYield")}</dt>
                    <dd className="mt-0.5 font-semibold">{formatPctPrecise(s.outputs.netYieldPct)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t_("account.savedScenarios.irr")}</dt>
                    <dd className="mt-0.5 font-semibold">{s.outputs.irrPct !== null ? formatPctPrecise(s.outputs.irrPct) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Total return</dt>
                    <dd className="mt-0.5 font-semibold">{formatPctPrecise(s.outputs.totalReturnPct)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* U14 §24: AI conversations — newest first, resume with full context */}
      <section className="mt-10" aria-labelledby="conversations-heading" id="conversations">
        <SectionHeading
          id="conversations-heading"
          kicker="Advisor"
          title={t_("account.conversations.section.title")}
          description={t_("account.conversations.section.sub")}
          action={
            <Button asChild size="sm">
              <Link to="/advisor">{t_("account.conversations.start")}</Link>
            </Button>
          }
        />
        {conversations === null ? (
          <LoadingState rows={2} />
        ) : conversations.length === 0 ? (
          <EmptyState
            title={t_("account.conversations.empty")}
            actionLabel={t_("account.conversations.start")}
            onAction={() => navigate("/advisor")}
            icon={<MessageSquare className="h-8 w-8" aria-hidden />}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {conversations.slice(0, 6).map((c) => (
              <li key={c.id} className="rounded-xl border border-border/70 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {c.topicSummary || c.firstMessage || "Advisor conversation"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t_("account.conversations.messages", { n: String(c.messageCount) })} ·{" "}
                      {t_("account.conversations.updated", { date: formatDate(c.updatedAt) })}
                      {c.status === "HANDED_OFF" && " · handed off"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1 px-2.5 text-xs"
                    onClick={() => {
                      // Advisor restores the conversation id it finds in this key on mount.
                      try {
                        localStorage.setItem("ie_advisor_conversation", c.id);
                      } catch { /* private mode */ }
                      navigate("/advisor");
                    }}
                  >
                    {t_("account.conversations.open")} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* U14 §24: comparisons — compare tray + shareable URL semantics */}
      <section className="mt-10" aria-labelledby="comparisons-heading">
        <SectionHeading
          id="comparisons-heading"
          kicker="Saved state"
          title={t_("account.comparisons.section.title")}
          description={t_("account.comparisons.section.sub")}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/compare">{t_("account.comparisons.openLab")}</Link>
            </Button>
          }
        />
        {compare.length === 0 ? (
          <EmptyState
            title={t_("account.comparisons.empty")}
            actionLabel="Browse properties"
            onAction={() => navigate("/properties")}
            icon={<Scale className="h-8 w-8" aria-hidden />}
          />
        ) : (
          <div className="rounded-xl border border-border/70 bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t_("account.comparisons.tray")} ({compare.length}/4)
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {compare.map((c) => (
                <li key={c.slug}>
                  <Link
                    to={`/properties/${c.slug}`}
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2 transition-ui hover:border-brand/40"
                  >
                    <div className="h-10 w-14 shrink-0 overflow-hidden rounded-md bg-sand">
                      {c.cover && mediaPreviewUrl(c.cover) && <img src={mediaPreviewUrl(c.cover) ?? undefined} alt="" className="h-full w-full object-cover" loading="lazy" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.community.name}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/compare">{t_("account.comparisons.openLab")}</Link>
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={clearCompare}>
                {t_("account.comparisons.clear")}
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Comparisons persist by URL — <span className="num">/compare?project=&#123;slug&#125;</span> and{" "}
              <span className="num">?community=&#123;slug&#125;</span> links are shareable and restore the exact comparison.
            </p>
          </div>
        )}
      </section>

      {recentlyViewed.length > 0 && (
        <section className="mt-10" aria-labelledby="recent-heading">
          <SectionHeading id="recent-heading" kicker="Pick up where you left off" title="Recently viewed" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recentlyViewed.slice(0, 6).map((r) => (
              <Link key={r.slug} to={`/properties/${r.slug}`} className="flex items-center gap-3 rounded-lg border border-border/70 bg-card p-3 transition-ui hover:border-brand/40">
                <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-sand">
                  {r.cover && mediaPreviewUrl(r.cover) && (
                    <img src={mediaPreviewUrl(r.cover) ?? undefined} alt="" className="h-full w-full object-cover" loading="lazy" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.community.name}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
