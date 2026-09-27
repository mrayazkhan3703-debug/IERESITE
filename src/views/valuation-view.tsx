"use client";

import * as React from "react";
import { api, ApiError } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading } from "@/components/common";
import { events, getAttribution } from "@/lib/analytics-tracker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useRoute } from "@/lib/router";

/** Shared seller-side form: valuation request (A36) & listing request (A35) */
export function SellerFormView({ variant }: { variant: "valuation" | "list" }) {
  const loc = useRoute();
  const isValuation = variant === "valuation";
  const [form, setForm] = React.useState({ name: "", email: "", phone: "", community: "", propertyType: "APARTMENT", bedrooms: "", areaSqft: "", message: "" });
  const [consentContact, setConsentContact] = React.useState(false);
  const [consentMarketing, setConsentMarketing] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ reference: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  usePageMeta({
    title: isValuation ? "Free Property Valuation in Dubai — Evidence-Based Pricing" : "List Your Property with Investment Experts",
    description: isValuation
      ? "Request a professional Dubai property valuation anchored in comparable transactions — community medians with unit-level adjustments."
      : "List your Dubai property with curated marketing, provenance-standard listing facts and a qualified buyer flow.",
  });

  React.useEffect(() => {
    events.formStart(isValuation ? "valuation" : "listing");
     
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentContact) {
      setError("Please agree to be contacted so we can respond with your valuation.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const attr = getAttribution();
    try {
      const res = await api.post<{ reference: string }>("/api/valuations", {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        propertyType: form.propertyType,
        community: form.community || undefined,
        bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
        areaSqft: form.areaSqft ? Number(form.areaSqft) : undefined,
        message: form.message || undefined,
        consentContact: true,
        consentMarketing,
        preferredLocale: loc.locale === "ar" ? "ar" : "en",
        utmSource: attr.utm?.utm_source,
        utmMedium: attr.utm?.utm_medium,
        utmCampaign: attr.utm?.utm_campaign,
      });
      setResult(res);
      events.formComplete(isValuation ? "valuation" : "listing");
      events.leadGenerated(isValuation ? "VALUATION" : "SELL");
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
        <h1 className="font-display text-2xl font-semibold">
          {isValuation ? "Valuation request received" : "Listing request received"}
        </h1>
        <p className="mt-3 text-muted-foreground">
          Reference <strong className="num text-foreground">{result.reference}</strong>. A specialist will contact you
          {isValuation ? " with a comparable-transaction analysis of your property." : " to start the listing process."}
        </p>
        <Button asChild className="mt-6"><a href="/sell">Back to Sell</a></Button>
      </div>
    );
  }

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Sell", to: "/sell" }, { label: isValuation ? "Valuation" : "List with us" }]} />
      <div className="mx-auto mt-4 max-w-2xl">
        <SectionHeading as="h1"
          kicker={isValuation ? "Valuation request" : "Listing request"}
          title={isValuation ? "What's your property worth?" : "List your property with us"}
          description={
            isValuation
              ? "We'll anchor your valuation in comparable transactions for your community, adjusted for floor, view, condition and parking — not a flattering guess."
              : "Curated marketing, provenance-standard facts and a qualified buyer flow. Tell us about the property and we'll take it from there."
          }
        />

        <form onSubmit={submit} className="mt-8 space-y-5 rounded-xl border border-border/70 bg-card p-6 sm:p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sf-name">Full name *</Label>
              <Input id="sf-name" required minLength={2} value={form.name} onChange={set("name")} autoComplete="name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sf-phone">Phone *</Label>
              <Input id="sf-phone" type="tel" required value={form.phone} onChange={set("phone")} placeholder="+971 50 000 0000" autoComplete="tel" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-email">Email</Label>
            <Input id="sf-email" type="email" value={form.email} onChange={set("email")} autoComplete="email" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sf-community">Community</Label>
              <Input id="sf-community" placeholder="e.g. Dubai Marina" value={form.community} onChange={set("community")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sf-type">Property type</Label>
              <select
                id="sf-type"
                value={form.propertyType}
                onChange={set("propertyType")}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition-ui focus:border-brand/60"
              >
                {["APARTMENT", "VILLA", "TOWNHOUSE", "PENTHOUSE", "DUPLEX", "STUDIO", "OFFICE"].map((t) => (
                  <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sf-beds">Bedrooms</Label>
              <Input id="sf-beds" type="number" min={0} max={20} value={form.bedrooms} onChange={set("bedrooms")} className="num" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-area">Built-up area (sqft)</Label>
            <Input id="sf-area" type="number" min={0} value={form.areaSqft} onChange={set("areaSqft")} className="num" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-msg">Anything else? (tenanted, mortgage, timeline…)</Label>
            <Textarea id="sf-msg" rows={3} maxLength={2000} value={form.message} onChange={set("message")} />
          </div>
          <fieldset className="space-y-2.5 rounded-lg border border-border bg-sand/40 p-3">
            <legend className="sr-only">Consent</legend>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={consentContact} onChange={(e) => setConsentContact(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" required />
              <span>I agree to be contacted about my {isValuation ? "valuation" : "listing"} request. *</span>
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
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {isValuation ? "Request my valuation" : "Start my listing"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function ValuationView() {
  return <SellerFormView variant="valuation" />;
}
