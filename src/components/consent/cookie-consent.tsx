"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Cookie } from "lucide-react";
import { applyConsentStatusFromServer, clearConsentForCurrentBrowserSession, setConsent } from "@/lib/analytics-tracker";
import { Link, useRoute } from "@/lib/router";
import { localeOf } from "@/lib/i18n";
import { journeyCopy } from "@/lib/journey-copy";

/** Consent banner (blueprint privacy/consent flows). Non-essential storage stays off until decided. */
export function CookieConsent() {
  const copy = journeyCopy(localeOf(useRoute().locale)).consent;
  // Conservative first paint: show the choices without granting any purpose.
  // A returning visitor may briefly see this until their server record is verified.
  // Delaying the fixed banner until hydration made its text the late mobile LCP.
  const [visible, setVisible] = React.useState(true);
  const [details, setDetails] = React.useState(false);
  const [analytics, setAnalytics] = React.useState(false);
  const [marketing, setMarketing] = React.useState(false);
  const [personalization, setPersonalization] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState(false);
  const statusGeneration = React.useRef(0);

  React.useEffect(() => {
    let active = true;
    const generation = statusGeneration.current;
      fetch("/api/analytics/consent")
        .then(async (response) => {
          if (!response.ok) throw new Error("Consent status unavailable");
          return response.json() as Promise<{ decided: boolean; analytics: boolean; marketing: boolean; personalization: boolean }>;
        })
        .then((current) => {
          if (!active || generation !== statusGeneration.current) return;
          applyConsentStatusFromServer(current);
          if (!current.decided) {
            clearConsentForCurrentBrowserSession();
            setAnalytics(false);
            setMarketing(false);
            setPersonalization(false);
            setVisible(true);
            return;
          }
          setAnalytics(current.analytics);
          setMarketing(current.marketing);
          setPersonalization(current.personalization);
          setVisible(false);
        })
        .catch(() => {
          if (!active || generation !== statusGeneration.current) return;
          clearConsentForCurrentBrowserSession();
          setAnalytics(false);
          setMarketing(false);
          setPersonalization(false);
          setVisible(true);
        });
    return () => { active = false; };
  }, []);

  if (!visible) return null;

  const saveChoices = async (choices: { analytics: boolean; marketing: boolean; personalization: boolean }) => {
    // A slow initial GET must never restore older grants after a newer choice.
    statusGeneration.current++;
    setSaving(true);
    setSaveError(false);
    const recorded = await setConsent(choices);
    setSaving(false);
    if (recorded) setVisible(false);
    else {
      clearConsentForCurrentBrowserSession();
      setSaveError(true);
      setVisible(true);
    }
  };
  const acceptAll = () => saveChoices({ analytics: true, marketing: true, personalization: true });
  const rejectNonEssential = () => saveChoices({ analytics: false, marketing: false, personalization: false });

  return (
    <div
      role="region"
      aria-label={copy.region}
      data-consent-banner
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-background/98 shadow-lg backdrop-blur print:hidden"
    >
      <div className="container-page flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <Cookie className="mt-1 h-5 w-5 shrink-0 text-brand" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">{copy.title}</p>
            <p className="mt-0.5 min-h-[100px] text-muted-foreground sm:min-h-0">
              {copy.description}{" "}
              <Link to="/privacy" className="underline decoration-border underline-offset-2 hover:text-foreground">
                {copy.privacy}
              </Link>
              {" · "}
              <Link to="/cookie-settings" className="underline decoration-border underline-offset-2 hover:text-foreground">
                {copy.manage}
              </Link>
            </p>
            {details && (
              <fieldset className="mt-3 space-y-2">
                <legend className="sr-only">{copy.purposes}</legend>
                {[
                  { id: "essential", label: copy.essential, checked: true, disabled: true, set: () => {} },
                  { id: "analytics", label: copy.analytics, checked: analytics, set: setAnalytics },
                  { id: "personalization", label: copy.personalization, checked: personalization, set: setPersonalization },
                  { id: "marketing", label: copy.marketing, checked: marketing, set: setMarketing },
                ].map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={c.checked}
                      disabled={c.disabled || saving}
                      onChange={(e) => c.set(e.target.checked)}
                      className="h-4 w-4 accent-[var(--brand)]"
                    />
                    {c.label}
                  </label>
                ))}
              </fieldset>
            )}
            {!details && (
              <button
                onClick={() => setDetails(true)}
                className="mt-1 text-xs font-medium text-brand-strong underline underline-offset-2"
              >
                {copy.customize}
              </button>
            )}
            {saveError && <p role="alert" className="mt-2 text-xs text-destructive">{copy.failed}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col lg:flex-row">
          <Button size="sm" onClick={acceptAll} disabled={saving}>{saving ? copy.saving : copy.accept}</Button>
          <Button size="sm" variant="outline" onClick={rejectNonEssential} disabled={saving}>{saving ? copy.saving : copy.reject}</Button>
          {details && (
            <Button size="sm" variant="secondary" onClick={() => saveChoices({ analytics, marketing, personalization })} disabled={saving}>{copy.save}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
