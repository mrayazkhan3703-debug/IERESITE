"use client";

import * as React from "react";
import { api, ApiError } from "@/lib/api-client";
import { events, getAttribution } from "@/lib/analytics-tracker";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, AlertCircle, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { useRoute } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * Seller listing funnel (V2 §26) — quality multi-step flow:
 * Location → Property → Status → Owner → Contact/consent, with per-step
 * validation, a progress rail, and comparable market context (community
 * median AED/sqft + recent transactions) surfaced as soon as a community is
 * chosen. Auto-estimates are never presented as formal valuations (§26 red
 * line) — the funnel closes with "Request professional valuation".
 */

interface CommunityMetric {
  avgPricePerSqft?: { minor: string; currency: string } | null;
  listingCount?: number | null;
  name?: string;
}

interface TxRow {
  community?: string; amountMinor?: string; currency?: string;
  date?: string; propertyType?: string; bedrooms?: number; sizeSqft?: number | null;
}

const STEPS = [
  { key: "location", title: "Location", hint: "Where is the property?" },
  { key: "property", title: "Property", hint: "Type, size and layout" },
  { key: "status", title: "Status", hint: "Tenancy and timeline" },
  { key: "owner", title: "Owner", hint: "Your details" },
  { key: "contact", title: "Contact", hint: "How we reach you" },
] as const;

export function ListingFunnel() {
  const loc = useRoute();
  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState({
    community: "", building: "", propertyType: "APARTMENT", bedrooms: "",
    areaSqft: "", furnishing: "any", tenanted: "no", timeline: "flexible",
    name: "", phone: "", email: "", message: "",
  });
  const [consentContact, setConsentContact] = React.useState(false);
  const [consentMarketing, setConsentMarketing] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ reference: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [comparable, setComparable] = React.useState<{ metrics: CommunityMetric | null; txs: TxRow[] } | null>(null);
  const [comparableLoading, setComparableLoading] = React.useState(false);

  React.useEffect(() => { events.formStart("listing-funnel"); }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  /* Comparable market context — loaded once a community name is typed */
  React.useEffect(() => {
    const community = form.community.trim().toLowerCase().replace(/\s+/g, "-");
    if (community.length < 4 || step !== 0) return;
    let cancelled = false;
    setComparableLoading(true);
    (async () => {
      try {
        const [mRes, tRes] = await Promise.all([
          fetch(`/api/communities/${encodeURIComponent(community)}`).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/market/transactions?community=${encodeURIComponent(community)}&pageSize=3`).then((r) => (r.ok ? r.json() : null)),
        ]);
        if (cancelled) return;
        setComparable({
          metrics: mRes ?? null,
          txs: Array.isArray(tRes?.rows) ? tRes.rows.slice(0, 3) : Array.isArray(tRes?.transactions) ? tRes.transactions.slice(0, 3) : [],
        });
      } catch {
        if (!cancelled) setComparable(null);
      } finally {
        if (!cancelled) setComparableLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [form.community, step]);

  const stepValid = (): boolean => {
    switch (STEPS[step].key) {
      case "location": return form.community.trim().length >= 3;
      case "property": return !!form.propertyType && (!form.areaSqft || Number(form.areaSqft) > 0);
      case "status": return true;
      case "owner": return form.name.trim().length >= 2 && form.phone.trim().length >= 6;
      case "contact": return consentContact;
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const attr = getAttribution();
    const detailLines = [
      `Building/project: ${form.building || "not specified"}`,
      `Furnishing: ${form.furnishing}`,
      `Tenanted: ${form.tenanted}`,
      `Timeline: ${form.timeline}`,
      form.message ? `Notes: ${form.message}` : "",
    ].filter(Boolean).join(" · ");
    try {
      const res = await api.post<{ reference: string }>("/api/valuations", {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone,
        propertyType: form.propertyType,
        community: form.community,
        bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
        areaSqft: form.areaSqft ? Number(form.areaSqft) : undefined,
        message: detailLines,
        consentContact: true,
        consentMarketing,
        preferredLocale: loc.locale === "ar" ? "ar" : "en",
        utmSource: attr.utm?.utm_source,
        utmMedium: attr.utm?.utm_medium,
        utmCampaign: attr.utm?.utm_campaign,
      });
      setResult(res);
      events.formComplete("listing-funnel");
      events.leadGenerated("SELL");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submission failed — please try again or call us.");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="container-page py-20 text-center" role="status">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-success" aria-hidden />
        <h1 className="font-display text-2xl font-semibold">Listing request received</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Reference <strong className="num text-foreground">{result.reference}</strong>. A specialist will contact you to
          start the listing process — your property details and the market context you saw here travel with the request.
        </p>
        <div className="mx-auto mt-6 max-w-xl rounded-xl border border-brand/30 bg-brand-faint/40 p-4 text-left">
          <p className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-brand" aria-hidden /> Request a professional valuation too?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We anchor valuations in comparable transactions for your community — a formal analysis, not an automated guess.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3"><a href="/sell/valuation">Request valuation</a></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress rail */}
      <ol className="mt-8 flex items-center gap-1" aria-label="Listing funnel progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors sm:h-7 sm:w-7",
                i < step ? "bg-brand text-primary-foreground" : i === step ? "border-2 border-brand text-brand-strong" : "border border-border text-muted-foreground",
                i < step && "cursor-pointer"
              )}
            >
              {i < step ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : i + 1}
            </button>
            <span className={cn("hidden truncate text-xs font-medium sm:block", i === step ? "text-foreground" : "text-muted-foreground")}>{s.title}</span>
            {i < STEPS.length - 1 && <span aria-hidden className={cn("h-0.5 flex-1 rounded", i < step ? "bg-brand" : "bg-border")} />}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">Step {step + 1} of {STEPS.length} — {STEPS[step].hint}</p>

      <div className="mt-6 rounded-xl border border-border/70 bg-card p-6 sm:p-8">
        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="lf-community">Community *</Label>
              <Input id="lf-community" required minLength={3} value={form.community} onChange={set("community")} placeholder="e.g. Dubai Marina" aria-describedby="lf-community-help" className="h-11 sm:h-9" />
              <p id="lf-community-help" className="text-xs text-muted-foreground">Start typing — we surface live market context for the community.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lf-building">Building / project</Label>
              <Input id="lf-building" value={form.building} onChange={set("building")} placeholder="e.g. Marina Gate Tower 2" className="h-11 sm:h-9" />
            </div>

            {/* Comparable market context (§26) */}
            {(comparableLoading || comparable) && (
              <div className="rounded-lg border border-border bg-sand/40 p-4" aria-live="polite">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Market context — {form.community}</p>
                  <DataStateBadge state="ILLUSTRATIVE" />
                </div>
                {comparableLoading && <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading comparable data…</p>}
                {comparable && (
                  <>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground">Area average asking price / sqft</dt>
                        <dd className="num font-semibold">
                          {comparable.metrics?.avgPricePerSqft?.minor
                            ? formatMoney(BigInt(comparable.metrics.avgPricePerSqft.minor), { currency: comparable.metrics.avgPricePerSqft.currency })
                            : <UnavailableValue />}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground">Listings on platform</dt>
                        <dd className="num font-semibold">{comparable.metrics?.listingCount ?? <UnavailableValue />}</dd>
                      </div>
                    </dl>
                    {comparable.txs.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent comparable transactions</p>
                        <ul className="mt-1.5 space-y-1">
                          {comparable.txs.map((tx, i) => (
                            <li key={i} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                {tx.date ? new Date(tx.date).toLocaleDateString("en-AE", { month: "short", year: "numeric" }) : "—"}
                                {tx.bedrooms != null ? ` · ${tx.bedrooms === 0 ? "Studio" : tx.bedrooms + "BR"}` : ""}
                                {tx.sizeSqft ? ` · ${tx.sizeSqft.toLocaleString()} sqft` : ""}
                              </span>
                              <span className="num font-semibold">
                                {tx.amountMinor ? formatMoney(BigInt(tx.amountMinor), { currency: tx.currency ?? "AED" }) : <UnavailableValue />}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      Context only — your property's market value depends on floor, view, condition and parking. A specialist valuation adjusts for all of them.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="lf-type">Property type</Label>
                <select id="lf-type" value={form.propertyType} onChange={set("propertyType")} className="h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none transition-ui focus:border-brand/60 sm:h-9 sm:text-sm">
                  {["APARTMENT", "VILLA", "TOWNHOUSE", "PENTHOUSE", "DUPLEX", "STUDIO", "OFFICE"].map((t) => (
                    <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lf-beds">Bedrooms</Label>
                <Input id="lf-beds" type="number" min={0} max={20} value={form.bedrooms} onChange={set("bedrooms")} className="num h-11 sm:h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lf-area">Built-up area (sqft)</Label>
                <Input id="lf-area" type="number" min={0} value={form.areaSqft} onChange={set("areaSqft")} className="num h-11 sm:h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lf-furnish">Furnishing</Label>
              <select id="lf-furnish" value={form.furnishing} onChange={set("furnishing")} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition-ui focus:border-brand/60 sm:w-1/2">
                <option value="any">Any / not sure</option>
                <option value="furnished">Furnished</option>
                <option value="unfurnished">Unfurnished</option>
              </select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lf-tenanted">Currently tenanted?</Label>
                <select id="lf-tenanted" value={form.tenanted} onChange={set("tenanted")} className="h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none transition-ui focus:border-brand/60 sm:h-9 sm:text-sm">
                  <option value="no">No — vacant</option>
                  <option value="yes">Yes — tenanted</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lf-timeline">Your timeline</Label>
                <select id="lf-timeline" value={form.timeline} onChange={set("timeline")} className="h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none transition-ui focus:border-brand/60 sm:h-9 sm:text-sm">
                  <option value="flexible">Flexible</option>
                  <option value="1-3">Within 1–3 months</option>
                  <option value="asap">As soon as possible</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lf-msg">Anything else? (mortgage, upgrades, parking…)</Label>
              <Textarea id="lf-msg" rows={3} maxLength={2000} value={form.message} onChange={set("message")} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lf-name">Full name *</Label>
                <Input id="lf-name" required minLength={2} value={form.name} onChange={set("name")} autoComplete="name" className="h-11 sm:h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lf-phone">Phone *</Label>
                <Input id="lf-phone" type="tel" required value={form.phone} onChange={set("phone")} placeholder="+971 50 000 0000" autoComplete="tel" className="h-11 sm:h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lf-email">Email</Label>
              <Input id="lf-email" type="email" value={form.email} onChange={set("email")} autoComplete="email" className="h-11 sm:h-9" />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <dl className="rounded-lg border border-border bg-sand/40 p-4 text-sm">
              <p className="font-semibold">Review your listing request</p>
              <div className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {[
                  ["Community", form.community],
                  ["Building", form.building || "—"],
                  ["Type", form.propertyType],
                  ["Bedrooms", form.bedrooms || "—"],
                  ["Area", form.areaSqft ? `${Number(form.areaSqft).toLocaleString()} sqft` : "—"],
                  ["Tenanted", form.tenanted === "yes" ? "Yes" : "No"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
                ))}
              </div>
            </dl>
            <fieldset className="space-y-2.5 rounded-lg border border-border bg-sand/40 p-3">
              <legend className="sr-only">Consent</legend>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={consentContact} onChange={(e) => setConsentContact(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" required />
                <span>I agree to be contacted about my listing request. *</span>
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={consentMarketing} onChange={(e) => setConsentMarketing(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
                <span>Send me relevant market updates for my property.</span>
              </label>
            </fieldset>
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
              </p>
            )}
          </div>
        )}

        {/* Step navigation */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" className="h-11 sm:h-9" onClick={() => stepValid() && setStep((s) => s + 1)} disabled={!stepValid()}>
              Continue <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button type="button" size="lg" onClick={submit} disabled={submitting || !stepValid()}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Start my listing
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
