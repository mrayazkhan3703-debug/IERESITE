"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { events, getAttribution } from "@/lib/analytics-tracker";
import { useRoute } from "@/lib/router";
import { localeOf, t } from "@/lib/i18n";
import { toast } from "sonner";

export interface LeadFormContext {
  intent?: string;
  entityType?: string;
  entityId?: string;
  entitySlug?: string;
  entityTitle?: string;
  agentSlug?: string;
  agentName?: string;
  formId: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  /** V3-G §17 — render the intent selector in the form (contact page). */
  showIntent?: boolean;
}

export function useLeadForm() {
  const [ctx, setCtx] = React.useState<LeadFormContext | null>(null);
  const open = (context: LeadFormContext) => {
    events.formStart(context.formId);
    setCtx(context);
  };
  return { ctx, open, close: () => setCtx(null), isOpen: !!ctx };
}

export function LeadFormDialog({
  context,
  onClose,
}: {
  context: LeadFormContext | null;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [intent, setIntent] = React.useState("GENERAL");
  const [consentContact, setConsentContact] = React.useState(false);
  const [consentMarketing, setConsentMarketing] = React.useState(false);
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ reference: string; duplicate: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  React.useEffect(() => {
    if (context) {
      setResult(null);
      setError(null);
      setPhoneError(null);
      setIntent(context.intent ?? "GENERAL");
      // Lead marketing permission is a separate affirmative choice; do not
      // pre-check it from a stale browser-wide site preference.
      setConsentMarketing(false);
    }
  }, [context]);

  if (!context) return null;

  /* V3-G §17 — client-side phone validation: 7–20 digits, optional leading +.
   * Empty is allowed (email OR phone contract, unchanged). */
  const validatePhone = (): boolean => {
    if (!phone.trim()) return true;
    const digits = phone.replace(/[\s()\-.]/g, "");
    if (!/^\+?\d{7,20}$/.test(digits)) {
      setPhoneError(t("lead.phone.invalid", locale));
      return false;
    }
    setPhoneError(null);
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentContact) {
      setError("Please agree to be contacted so an advisor can respond.");
      return;
    }
    if (!validatePhone()) return;
    setSubmitting(true);
    setError(null);
    const attr = getAttribution();
    const clientSubmissionId = `${context.formId}:${Date.now().toString(36)}`;
    try {
      const res = await api.post<{ reference: string; duplicate: boolean }>(
        context.intent === "VALUATION" ? "/api/valuations" : "/api/leads",
        {
          intent: context.showIntent ? intent : (context.intent ?? "BUY"),
          name,
          email: email || undefined,
          phone: phone || undefined,
          message: message || undefined,
          entityType: context.entityType,
          entitySlug: context.entitySlug,
          entityTitle: context.entityTitle,
          agentSlug: context.agentSlug,
          consentContact: true,
          consentMarketing,
          preferredLocale: loc.locale === "ar" ? "ar" : "en",
          sourceChannel: "WEBSITE",
          landingUrl: attr.landingPath,
          referrer: attr.referrer,
          utmSource: attr.utm?.utm_source,
          utmMedium: attr.utm?.utm_medium,
          utmCampaign: attr.utm?.utm_campaign,
          utmContent: attr.utm?.utm_content,
          utmTerm: attr.utm?.utm_term,
          pagePath: loc.path,
          searchState: loc.path === "/properties" ? Object.fromEntries(new URLSearchParams(Object.entries(loc.query))) : undefined,
          clientSubmissionId,
        }
      );
      setResult(res);
      events.formComplete(context.formId);
      events.leadGenerated(context.intent ?? "BUY", context.entityType);
      if (context.entitySlug && context.entityType === "PROPERTY") {
        // persist recently viewed server-side too
        api.post("/api/recently-viewed", { propertySlug: context.entitySlug }).catch(() => {});
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(err.message);
      } else if (err instanceof ApiError && err.code === "VALIDATION") {
        setError(err.message);
      } else {
        setError("We couldn't submit your enquiry right now. Your details were not lost — please try again or call us.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!context} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        {result ? (
          <div className="py-4 text-center" role="status">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-success" aria-hidden />
            <h3 className="font-display text-xl font-semibold">Enquiry received</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Reference <strong className="num text-foreground">{result.reference}</strong>. An advisor will contact you
              {context.agentName ? ` (${context.agentName})` : ""} shortly.
            </p>
            {result.duplicate && (
              <p className="mt-2 text-xs text-muted-foreground">
                We noticed you recently enquired about this — no duplicate was created.
              </p>
            )}
            <Button className="mt-6" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{context.title ?? "Register your interest"}</DialogTitle>
              <DialogDescription>
                {context.description ??
                  (context.entityTitle
                    ? `Regarding: ${context.entityTitle}`
                    : "An advisor will respond with relevant options and next steps.")}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4" noValidate>
              {context.showIntent && (
                <div className="space-y-2">
                  <Label htmlFor="lead-intent">{t("lead.intent.label", locale)}</Label>
                  <select
                    id="lead-intent"
                    value={intent}
                    onChange={(e) => setIntent(e.target.value)}
                    className="h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none transition-ui focus:border-brand/60 sm:h-9 sm:text-sm"
                  >
                    {["BUY", "RENT", "SELL", "VALUATION", "GENERAL"].map((k) => (
                      <option key={k} value={k}>
                        {t(`lead.intent.${k}`, locale)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="lead-name">Full name *</Label>
                <Input
                  id="lead-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="lead-email">Email</Label>
                  <Input
                    id="lead-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lead-phone">Phone (with country code)</Label>
                  <Input
                    id="lead-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      if (phoneError) setPhoneError(null);
                    }}
                    onBlur={validatePhone}
                    placeholder="+971 50 000 0000"
                    autoComplete="tel"
                    aria-invalid={!!phoneError || undefined}
                    aria-describedby={phoneError ? "lead-phone-error" : undefined}
                    className="h-11 sm:h-9"
                  />
                  {phoneError && (
                    <p id="lead-phone-error" role="alert" className="text-xs leading-relaxed text-destructive">
                      {phoneError}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Email or phone — at least one is required.</p>
              <div className="space-y-2">
                <Label htmlFor="lead-message">Message (optional)</Label>
                <Textarea
                  id="lead-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Budget, timeline, preferences…"
                />
              </div>
              <fieldset className="space-y-2.5 rounded-lg border border-border bg-sand/40 p-3">
                <legend className="sr-only">Consent</legend>
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={consentContact}
                    onChange={(e) => setConsentContact(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
                    required
                  />
                  <span>I agree to be contacted about this enquiry. *</span>
                </label>
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={consentMarketing}
                    onChange={(e) => setConsentMarketing(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
                  />
                  <span>Send me relevant investment opportunities and market updates.</span>
                </label>
              </fieldset>
              {error && (
                <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {context.submitLabel ?? "Submit enquiry"}
              </Button>
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                Submitted securely. We keep your enquiry context (page, search and referral) so you don't have to repeat it.
                See our privacy notice.
              </p>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Inline (non-dialog) lead form for dedicated pages */
export function LeadFormInline({ context, className }: { context: LeadFormContext; className?: string }) {
  const [state, setState] = React.useState<{ open: boolean; result: { reference: string; duplicate: boolean } | null }>({ open: true, result: null });
  const mock = useLeadForm();
  return state.open ? (
    <div className={className}>
      <LeadFormDialog
        context={state.result ? null : context}
        onClose={() => setState({ open: false, result: null })}
      />
    </div>
  ) : null;
}
