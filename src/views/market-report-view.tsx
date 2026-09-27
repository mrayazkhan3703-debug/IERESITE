"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, LoadingState, ErrorState, ProvenanceBadge } from "@/components/common";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { formatDate } from "@/lib/money";
import { events } from "@/lib/analytics-tracker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ReactMarkdown from "react-markdown";
import { ShieldCheck, Download } from "lucide-react";

interface ReportDetail {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  periodLabel: string | null;
  methodology: string | null;
  dataSourceName: string | null;
  dataSourceUrl: string | null;
  retrievedAt: string | null;
  body: string;
  gated: boolean;
  isIllustrative: boolean;
  downloadUrl: string | null;
  publishedAt?: string | null;
  fileAvailable: boolean;
}

export default function MarketReportView({ slug }: { slug: string }) {
  const [report, setReport] = React.useState<ReportDetail | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [gate, setGate] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [consentContact, setConsentContact] = React.useState(false);
  const [consentMarketing, setConsentMarketing] = React.useState(false);
  const [downloaded, setDownloaded] = React.useState(false);
  const [requestedDownloadUrl, setRequestedDownloadUrl] = React.useState<string | null>(null);
  const lastReportedSlug = React.useRef<string | null>(null);
  const leadForm = useLeadForm();

  React.useEffect(() => {
    setNotFound(false);
    setReport(null);
    setDownloaded(false);
    setRequestedDownloadUrl(null);
    setEmail("");
    setName("");
    api.get<ReportDetail>(`/api/market/reports/${slug}`).then((loaded) => {
      setReport(loaded);
      if (lastReportedSlug.current !== slug) {
        lastReportedSlug.current = slug;
        events.reportViewed(slug);
      }
    }).catch(() => setNotFound(true));
  }, [slug]);

  usePageMeta(
    report
      ? {
          title: report.title,
          description: report.summary ?? undefined,
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "Report",
            name: report.title,
            datePublished: report.publishedAt,
          },
        }
      : {},
    [report?.id]
  );

  if (notFound) {
    return (
      <div className="container-page py-20">
        <ErrorState message="Report not found" />
        <div className="mt-6 text-center"><Button asChild variant="outline"><a href="/market">All reports</a></Button></div>
      </div>
    );
  }
  if (!report) return <div className="container-page py-12"><LoadingState rows={3} /></div>;

  const requestDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentContact) return;
    try {
      const res = await api.post<{ reference: string; downloadUrl: string | null }>("/api/market/reports/" + slug, {
        email,
        name,
        reportSlug: slug,
        consentContact: true,
        consentMarketing,
      });
      setDownloaded(true);
      setRequestedDownloadUrl(res.downloadUrl);
    } catch {
      leadForm.open({ formId: `report_${slug}`, intent: "INVEST", entityType: "MARKET_REPORT", entitySlug: slug, entityId: report.id, entityTitle: report.title });
    }
  };

  return (
    <div className="container-page py-8 pb-16">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Market Intelligence", to: "/market" }, { label: report.title }]} />

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_340px]">
        <article className="min-w-0">
          <p className="kicker">{report.periodLabel}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{report.title}</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">{report.summary}</p>

          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info/5 p-4 text-sm">
            <ShieldCheck className="h-4 w-4 shrink-0 text-info" aria-hidden />
            <span className="text-muted-foreground">
              Source entered in Admin: <strong className="text-foreground">{report.dataSourceName || "Not supplied"}</strong>
              {report.retrievedAt && <> · retrieved {formatDate(report.retrievedAt)}</>}
              {report.dataSourceUrl && (
                <>
                  {" · "}
                  <a href={report.dataSourceUrl} target="_blank" rel="noopener noreferrer" className="text-info underline underline-offset-2">source link</a>
                </>
              )}
            </span>
            <ProvenanceBadge chip={report.isIllustrative ? { sourceType: "MANUAL", isIllustrative: true } : { sourceType: "MANUAL", sourceName: report.dataSourceName ?? undefined }} />
            <span className="text-xs text-muted-foreground">Source details are editorially provided and have not been independently verified.</span>
          </div>

          {report.methodology && (
            <details className="mt-5 rounded-lg border border-border/70 bg-card p-4">
              <summary className="cursor-pointer text-sm font-semibold">Methodology</summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{report.methodology}</p>
            </details>
          )}

          <div className="report-body mt-8 prose prose-neutral max-w-none text-[15px] leading-relaxed">
            <ReactMarkdown>{report.body}</ReactMarkdown>
          </div>
        </article>

        {/* Download sidebar */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border/70 bg-card p-6">
            {downloaded ? (
              <div className="text-center">
                <p className="font-display text-lg font-semibold">Request submitted</p>
                <p className="mt-2 text-sm text-muted-foreground">Your report request was recorded. An advisor may follow up according to the contact consent you provided.</p>
                {requestedDownloadUrl && <Button asChild className="mt-4 w-full gap-2"><a href={requestedDownloadUrl} onClick={() => events.reportDownloadRequested(slug)}><Download className="h-4 w-4" aria-hidden />Download attached file</a></Button>}
              </div>
            ) : report.gated && report.fileAvailable ? (
              <>
                <p className="kicker">Download the report</p>
                <p className="mt-2 text-sm text-muted-foreground">Register your details to download. The research desk may contact you about this request if you agree below.</p>
                <form onSubmit={requestDownload} className="mt-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rep-name">Full name</Label>
                    <Input id="rep-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rep-email">Email</Label>
                    <Input id="rep-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <label className="flex items-start gap-2.5 text-sm">
                    <input type="checkbox" checked={consentContact} onChange={(e) => setConsentContact(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" required />
                    <span>I agree to be contacted about this report request. *</span>
                  </label>
                  <label className="flex items-start gap-2.5 text-sm">
                    <input type="checkbox" checked={consentMarketing} onChange={(e) => setConsentMarketing(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
                    <span>Send me market updates by email (optional).</span>
                  </label>
                  <Button type="submit" className="w-full gap-2">
                    <Download className="h-4 w-4" aria-hidden /> Download report
                  </Button>
                  <p className="text-center text-[11px] text-muted-foreground">
                    We store your enquiry with attribution context. See the privacy notice.
                  </p>
                </form>
              </>
            ) : (
              <>
                {report.downloadUrl ? <><p className="kicker">Download</p><Button asChild className="mt-3 w-full gap-2"><a href={report.downloadUrl} onClick={() => events.reportDownloadRequested(slug)}><Download className="h-4 w-4" aria-hidden /> Download report</a></Button></> : <><p className="kicker">Print report content</p><p className="mt-2 text-sm text-muted-foreground">No public document is attached; you can print the report content shown on this page.</p><Button className="mt-3 w-full gap-2" onClick={() => window.print()}><Download className="h-4 w-4" aria-hidden /> Print this page</Button></>}
              </>
            )}
          </div>
        </aside>
      </div>

      <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />
    </div>
  );
}
