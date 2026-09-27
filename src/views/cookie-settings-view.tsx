"use client";

import * as React from "react";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { applyConsentStatusFromServer, clearConsentForCurrentBrowserSession, getConsent, setConsent, type ConsentState } from "@/lib/analytics-tracker";
import { toast } from "sonner";

/** Cookie/consent management center (A52) */
export default function CookieSettingsView() {
  const [consent, setLocal] = React.useState(() => getConsent());
  const [saved, setSaved] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  usePageMeta({ title: "Cookie Settings", noindex: true });

  React.useEffect(() => {
    fetch("/api/analytics/consent")
      .then(async (response) => {
        if (!response.ok) throw new Error("Consent status unavailable");
        return response.json() as Promise<{ decided: boolean; analytics: boolean; marketing: boolean; personalization: boolean }>;
      })
      .then((current) => {
        applyConsentStatusFromServer(current);
        if (!current.decided) {
          clearConsentForCurrentBrowserSession();
          setLocal({ essential: true, analytics: false, marketing: false, personalization: false });
          return;
        }
        setLocal({ essential: true, analytics: current.analytics, marketing: current.marketing, personalization: current.personalization });
      })
      .catch(() => {
        clearConsentForCurrentBrowserSession();
        setLocal({ essential: true, analytics: false, marketing: false, personalization: false });
      })
      .finally(() => setLoading(false));
  }, []);

  const update = (key: keyof typeof consent) => (v: boolean) => {
    setLocal((c) => ({ ...c, [key]: v }));
    setSaved(false);
  };

  const save = async () => {
    setLoading(true);
    const recorded = await setConsent({ analytics: consent.analytics, marketing: consent.marketing, personalization: consent.personalization }, "ACCOUNT_SETTINGS");
    setLoading(false);
    setSaved(recorded);
    if (recorded) toast.success("Your privacy choices have been saved.");
    else {
      clearConsentForCurrentBrowserSession();
      setLocal({ essential: true, analytics: false, marketing: false, personalization: false });
      toast.error("Choices could not be saved; non-essential analytics remain disabled.");
    }
  };

  const purposes = [
    { key: "essential" as const, title: "Essential", desc: "Session, security and core platform operation. Always on — the site cannot function without these.", disabled: true },
    { key: "analytics" as const, title: "Analytics & performance", desc: "Understand how the platform is used (pages, searches, tools) with IP minimization, to improve it." },
    { key: "personalization" as const, title: "Personalized recommendations", desc: "Use your views, favorites and searches to tailor 'similar properties' and recommendations." },
    { key: "marketing" as const, title: "Marketing communications", desc: "Send relevant opportunities and market updates. Withdraw anytime — affects future sends only." },
  ];

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Cookie settings" }]} />
      <div className="mx-auto mt-4 max-w-2xl">
        <SectionHeading as="h1"
          kicker="Privacy center"
          title="Your privacy choices"
          description="Control what we may use beyond essentials. Choices apply immediately and can be changed anytime."
        />

        <div className="mt-8 space-y-4">
          {purposes.map((p) => (
            <div key={p.key} className="flex items-start justify-between gap-6 rounded-xl border border-border/70 bg-card p-5">
              <div>
                <h2 className="font-semibold">{p.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
              </div>
              <Switch
                aria-label={`${p.title} ${p.disabled ? "(always on)" : ""}`}
                checked={p.key === "essential" ? true : consent[p.key]}
                disabled={p.disabled || loading}
                onCheckedChange={p.key === "essential" ? undefined : update(p.key)}
              />
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" onClick={save} disabled={loading}>{loading ? "Loading…" : "Save choices"}</Button>
          <Button
            size="lg"
            variant="outline"
            disabled={loading}
            onClick={async () => {
              const denied: ConsentState = { essential: true, analytics: false, marketing: false, personalization: false };
              setLocal(denied);
              setLoading(true);
              const recorded = await setConsent({ analytics: false, marketing: false, personalization: false }, "ACCOUNT_SETTINGS");
              setLoading(false);
              setSaved(recorded);
              if (recorded) toast.success("All non-essential cookies rejected.");
              else {
                clearConsentForCurrentBrowserSession();
                toast.error("Choices could not be saved; non-essential analytics remain disabled.");
              }
            }}
          >
            Reject all non-essential
          </Button>
        </div>
        {saved && <p role="status" className="mt-3 text-sm text-success">Saved.</p>}

        <p className="mt-8 rounded-lg border border-border/70 bg-sand/50 p-4 text-xs leading-relaxed text-muted-foreground">
          Consent records (including this change) are stored with timestamps as privacy evidence. See the{" "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">privacy notice</a> for data
          categories, retention and your data-subject rights. Marketing withdrawal affects future communications and
          doesn't cancel enquiries already in progress.
        </p>
      </div>
    </div>
  );
}
