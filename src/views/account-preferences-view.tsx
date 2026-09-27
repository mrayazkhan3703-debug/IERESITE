"use client";

import * as React from "react";
import { navigate, setLocale } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { useAuth } from "@/components/providers/auth-provider";
import { Breadcrumbs, SectionHeading, LoadingState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Globe, LockKeyhole, MonitorSmartphone } from "lucide-react";
import { localeOf } from "@/lib/i18n";
import { api } from "@/lib/api-client";

/** Account preferences (A47): locale + privacy quick links */
export default function AccountPreferencesView() {
  const { user, loading } = useAuth();
  const [locale, setLocaleState] = React.useState(localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en"));
  const [currency, setCurrency] = React.useState("AED");
  const [marketingOptIn, setMarketingOptIn] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const [sessions, setSessions] = React.useState<Array<{ id: string; userAgent: string | null; createdAt: string; current: boolean }>>([]);

  usePageMeta({ title: "Preferences", noindex: true });

  React.useEffect(() => {
    if (!user) return;
    void Promise.all([
      api.get<{ locale: "en" | "ar"; currency: string; marketingOptIn: boolean }>("/api/account/preferences"),
      api.get<{ sessions: Array<{ id: string; userAgent: string | null; createdAt: string; current: boolean }> }>("/api/auth/sessions"),
    ]).then(([preferences, sessionResult]) => {
      setLocaleState(preferences.locale);
      setCurrency(preferences.currency);
      setMarketingOptIn(preferences.marketingOptIn);
      setSessions(sessionResult.sessions);
    }).catch(() => {});
  }, [user]);

  if (loading) return <div className="container-page py-12"><LoadingState /></div>;

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Account", to: "/account" }, { label: "Preferences" }]} />
      <div className="mx-auto mt-4 max-w-2xl">
        <SectionHeading as="h1" kicker="Your settings" title="Preferences" />

        <div className="mt-8 space-y-6">
          <section className="rounded-xl border border-border/70 bg-card p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Globe className="h-4 w-4 text-brand" aria-hidden /> Language</h2>
            <p className="mt-1 text-sm text-muted-foreground">Interface language and RTL layout. Arabic is a foundation translation — content entities localize progressively.</p>
            <div className="mt-4 flex gap-2">
              {[
                { code: "en", label: "English" },
                { code: "ar", label: "العربية" },
              ].map((l) => (
                <button
                  key={l.code}
                  type="button"
                  aria-pressed={locale === l.code}
                  onClick={() => {
                    setLocaleState(l.code as "en" | "ar");
                    setLocale(l.code);
                    if (user) void api.patch("/api/account/preferences", { locale: l.code }).catch(() => {});
                  }}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-ui ${locale === l.code ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            {user && (
              <div className="mt-5 grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="account-currency">Display currency</Label>
                  <Input id="account-currency" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
                </div>
                <label className="flex items-center gap-3 self-end rounded-lg border border-border/70 px-3 py-2 text-sm">
                  <input type="checkbox" checked={marketingOptIn} onChange={(event) => setMarketingOptIn(event.target.checked)} />
                  Marketing updates
                </label>
                <Button className="sm:col-span-2" variant="outline" onClick={async () => {
                  await api.patch("/api/account/preferences", { locale, currency, marketingOptIn });
                  setMessage("Preferences saved.");
                }}>Save account preferences</Button>
              </div>
            )}
          </section>

          {user && (
            <section className="rounded-xl border border-border/70 bg-card p-5">
              <h2 className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4 text-brand" aria-hidden /> Account security</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
                <Button variant="outline" className="self-end" onClick={async () => {
                  await api.post("/api/auth/change-password", { currentPassword, newPassword });
                  setCurrentPassword(""); setNewPassword(""); setMessage("Password changed and other sessions revoked.");
                }}>Change password</Button>
                <div className="space-y-1.5"><Label htmlFor="new-email">New email</Label><Input id="new-email" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></div>
                <Button variant="outline" className="self-end" onClick={async () => {
                  await api.post("/api/auth/change-email", { currentPassword, newEmail });
                  setNewEmail(""); setMessage("A confirmation link was sent to the new email address.");
                }}>Request email change</Button>
              </div>
              {message && <p className="mt-4 text-sm" role="status">{message}</p>}
            </section>
          )}

          {user && sessions.length > 0 && (
            <section className="rounded-xl border border-border/70 bg-card p-5">
              <h2 className="flex items-center gap-2 font-semibold"><MonitorSmartphone className="h-4 w-4 text-brand" aria-hidden /> Active sessions</h2>
              <ul className="mt-4 divide-y divide-border/60">
                {sessions.map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div><p className="font-medium">{session.current ? "This session" : "Signed-in device"}</p><p className="max-w-sm truncate text-xs text-muted-foreground">{session.userAgent ?? "Unknown browser"}</p></div>
                    {!session.current && <Button size="sm" variant="ghost" onClick={async () => {
                      await api.delete("/api/auth/sessions", { sessionId: session.id });
                      setSessions((current) => current.filter((item) => item.id !== session.id));
                    }}>Revoke</Button>}
                  </li>
                ))}
              </ul>
              {sessions.length > 1 && <Button size="sm" variant="outline" onClick={async () => {
                await api.delete("/api/auth/sessions", { allOther: true });
                setSessions((current) => current.filter((session) => session.current));
              }}>Revoke all other sessions</Button>}
            </section>
          )}

          <section className="rounded-xl border border-border/70 bg-card p-5">
            <h2 className="font-semibold">Privacy</h2>
            <p className="mt-1 text-sm text-muted-foreground">Consent choices, data export and deletion requests.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm"><a href="/cookie-settings">Cookie settings</a></Button>
              <Button asChild variant="outline" size="sm"><a href="/privacy">Privacy center</a></Button>
            </div>
          </section>

          {user && (
            <section className="rounded-xl border border-border/70 bg-card p-5">
              <h2 className="font-semibold">Data-subject requests</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Export or delete the personal data in your account. Requests are logged and handled with an audit trail.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const res = await fetch("/api/account/export", { method: "POST", headers: { "x-requested-with": "fetch" } });
                    if (res.ok) {
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "investment-experts-data-export.json";
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                  }}
                >
                  Export my data
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={async () => {
                    if (!confirm("Request deletion of your account data? This is logged and processed per policy.")) return;
                    await fetch("/api/account/delete-request", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ note: "Requested from preferences" }) });
                    alert("Deletion request logged. You'll receive confirmation per the privacy notice.");
                  }}
                >
                  Request deletion
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
