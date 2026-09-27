"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading } from "@/components/common";
import { events, getAttribution } from "@/lib/analytics-tracker";
import { useRoute } from "@/lib/router";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, AlertCircle, CalendarDays, Clock, Video, Phone, MapPin, Building2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { organizationRef } from "@/lib/seo-schema";
import { intlLocale, localeOf } from "@/lib/i18n";
import { journeyCopy } from "@/lib/journey-copy";

/** Consultation request: preferred-time picker with explicit pending-confirmation state. */
export default function ConsultationView() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const copy = journeyCopy(locale).consultation;
  const [date, setDate] = React.useState<string>("");
  const [slot, setSlot] = React.useState<string>("");
  const [channel, setChannel] = React.useState<"OFFICE" | "VIDEO" | "PHONE" | "WHATSAPP">("VIDEO");
  const [form, setForm] = React.useState({ name: "", email: "", phone: "", topic: "" });
  const [consentContact, setConsentContact] = React.useState(false);
  const [consentMarketing, setConsentMarketing] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{
    reference: string;
    duplicate: boolean;
    booking?: { reference: string; status: string; scheduledAt: string; created: boolean };
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  usePageMeta({
    title: copy.title,
    description: copy.metaDescription,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Service",
      name: copy.service,
      /* V3-19: provider updated with verified company data (name/telephone/
       * full postal address — no email exists, none invented). */
      provider: organizationRef(),
      areaServed: "Dubai",
    },
  });

  React.useEffect(() => {
    events.formStart("consultation");
  }, []);

  // The date picker offers request preferences, not verified availability.
  const days = React.useMemo(() => {
    const out: { iso: string; label: string; weekday: string }[] = [];
    const dateParts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Dubai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: string) => dateParts.find((value) => value.type === type)?.value ?? "";
    const dubaiToday = `${part("year")}-${part("month")}-${part("day")}`;
    const d = new Date(`${dubaiToday}T00:00:00.000Z`);
    while (out.length < 10) {
      d.setUTCDate(d.getUTCDate() + 1);
      const iso = d.toISOString().slice(0, 10);
      const dubaiDate = new Date(`${iso}T12:00:00.000Z`);
      out.push({
        iso,
        label: dubaiDate.toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short", timeZone: "Asia/Dubai" }),
        weekday: dubaiDate.toLocaleDateString(intlLocale(locale), { weekday: "short", timeZone: "Asia/Dubai" }),
      });
    }
    return out;
  }, [locale]);

  const slots = ["09:30", "10:30", "11:30", "13:00", "14:00", "15:00", "16:00", "17:00"];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !slot) {
      setError(copy.missingTime);
      return;
    }
    if (!consentContact) {
      setError(copy.missingConsent);
      return;
    }
    setSubmitting(true);
    setError(null);
    const attr = getAttribution();
    // Dubai is UTC+4. This is a preferred time only; no live calendar is checked.
    const scheduledAt = new Date(`${date}T${slot}:00+04:00`).toISOString();
    try {
      const res = await api.post<{ reference: string; duplicate: boolean; booking?: { reference: string; status: string; scheduledAt: string; created: boolean } }>("/api/consultations", {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        scheduledAt,
        bookingType: "CONSULTATION",
        channel,
        topic: form.topic || loc.query.property || loc.query.agent || undefined,
        message: form.topic || undefined,
        consentContact: true,
        consentMarketing,
        preferredLocale: locale,
        entityType: "PAGE",
        entitySlug: "consultation",
        landingUrl: attr.landingPath,
        referrer: attr.referrer,
        utmSource: attr.utm?.utm_source,
        utmMedium: attr.utm?.utm_medium,
        utmCampaign: attr.utm?.utm_campaign,
      });
      if (!res.booking) throw new Error("Missing consultation booking");
      setResult(res);
      if (res.booking.created) events.consultationRequestSubmitted();
      events.formComplete("consultation");
    } catch {
      setError(copy.failed);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const booking = result.booking!;
    const confirmed = booking.status === "CONFIRMED";
    return (
      <div className="container-page py-20 text-center" role="status">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-success" aria-hidden />
        <h1 className="font-display text-2xl font-semibold">{confirmed ? copy.confirmed : booking.created ? copy.received : copy.existing}</h1>
        <p className="mt-3 text-muted-foreground">
          {copy.reference} <strong className="num text-foreground"><bdi dir="ltr">{booking.reference}</bdi></strong>.{" "}
          {confirmed
            ? copy.confirmedNote
            : booking.status === "REQUESTED"
              ? copy.requestNote
              : <>{copy.statusNote}: <bdi dir="ltr">{booking.status}</bdi>. {copy.statusHelp}</>}
        </p>
        <p className="num mt-2 text-sm text-muted-foreground">
          {copy.preferred}: {new Date(booking.scheduledAt).toLocaleString(intlLocale(locale), { timeZone: "Asia/Dubai", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })} <bdi dir="ltr">(GST)</bdi>
        </p>
        <Button asChild className="mt-6"><Link to="/">{copy.back}</Link></Button>
      </div>
    );
  }

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: copy.home, to: "/" }, { label: copy.name }]} />
      <div className="mx-auto mt-4 max-w-3xl">
        <SectionHeading as="h1"
          kicker={copy.kicker}
          title={copy.title}
          description={copy.description}
        />

        <form onSubmit={submit} className="mt-8 space-y-8">
          {/* Slot picker */}
          <fieldset className="min-w-0 rounded-xl border border-border/70 bg-card p-5 sm:p-6">
            <legend className="kicker px-1">{copy.select}</legend>
            <div className="mt-3 flex gap-2 overflow-x-auto scroll-elegant pb-2" role="radiogroup" aria-label={copy.date}>
              {days.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  role="radio"
                  aria-checked={date === d.iso}
                  onClick={() => { setDate(d.iso); setSlot(""); }}
                  className={cn(
                    "flex min-w-[72px] shrink-0 flex-col items-center rounded-lg border px-3 py-2.5 transition-ui",
                    date === d.iso
                      ? "border-brand bg-brand text-primary-foreground shadow-[0_6px_16px_-6px_rgba(139,90,43,0.55)]"
                      : "border-border text-muted-foreground hover:border-foreground/30 hover:bg-sand/40"
                  )}
                >
                  <span className="text-[11px] font-medium uppercase">{d.weekday}</span>
                  <span className="num text-sm font-semibold">{d.label}</span>
                </button>
              ))}
            </div>
            {date && (
              <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label={copy.time}>
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={slot === s}
                    onClick={() => setSlot(s)}
                    className={cn(
                      "num rounded-lg border px-3.5 py-2 text-sm font-medium transition-ui",
                      slot === s
                        ? "border-brand bg-brand text-primary-foreground shadow-[0_6px_16px_-6px_rgba(139,90,43,0.55)]"
                        : "border-border text-muted-foreground hover:border-foreground/30 hover:bg-sand/40"
                    )}
                  >
                    <bdi dir="ltr">{s}</bdi>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span>{copy.timeNote}</span>
            </p>
          </fieldset>

          {/* Channel */}
          <fieldset className="min-w-0 rounded-xl border border-border/70 bg-card p-5 sm:p-6">
            <legend className="kicker px-1">{copy.format}</legend>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { key: "VIDEO", label: copy.VIDEO, icon: Video },
                { key: "OFFICE", label: copy.OFFICE, icon: Building2 },
                { key: "PHONE", label: copy.PHONE, icon: Phone },
                { key: "WHATSAPP", label: copy.WHATSAPP, icon: MessageCircle },
              ].map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={channel === c.key}
                  onClick={() => setChannel(c.key as typeof channel)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3.5 text-sm font-medium transition-ui",
                    channel === c.key ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:border-foreground/30"
                  )}
                >
                  <c.icon className="h-5 w-5" aria-hidden />
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Details */}
          <fieldset className="min-w-0 rounded-xl border border-border/70 bg-card p-5 sm:p-6">
            <legend className="kicker px-1">{copy.details}</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="c-name">{copy.fullName}</Label>
                <Input id="c-name" required minLength={2} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoComplete="name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-phone">{copy.phone}</Label>
                <Input id="c-phone" dir="ltr" type="tel" required value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} autoComplete="tel" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="c-email">{copy.email}</Label>
                <Input id="c-email" dir="ltr" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} autoComplete="email" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="c-topic">{copy.topic}</Label>
                <Textarea id="c-topic" rows={3} maxLength={2000} placeholder={copy.topicHint} value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} />
              </div>
            </div>
            <fieldset className="min-w-0 mt-4 space-y-2.5 rounded-lg border border-border bg-sand/40 p-3">
              <legend className="sr-only">{copy.consent}</legend>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={consentContact} onChange={(e) => setConsentContact(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" required />
                <span>{copy.contact}</span>
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={consentMarketing} onChange={(e) => setConsentMarketing(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
                <span>{copy.marketing}</span>
              </label>
            </fieldset>
          </fieldset>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarDays className="h-4 w-4" aria-hidden />}
            {copy.submit}
          </Button>
        </form>
      </div>
    </div>
  );
}
