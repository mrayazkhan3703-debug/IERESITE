"use client";
import { csvCell } from "@/lib/csv-cell";

import * as React from "react";
import Image from "next/image";
import { Link, navigate, useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { useAuth, hasRole } from "@/components/providers/auth-provider";
import { api } from "@/lib/api-client";
import { clientRequestId } from "@/lib/client-request-id";
import { LoadingState, ErrorState, EmptyState, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ContentBody } from "@/components/common/content-body";
import { parseContentBlocks, type ContentBlock } from "@/lib/content-blocks";
import { FaqsSection } from "@/views/admin/faqs-section";
import { MarketReportsSection } from "@/views/admin/market-reports-section";
import { MarketDataSection } from "@/views/admin/market-data-section";
import { SearchOperationsSection } from "@/views/admin/search-operations-section";
import { KnowledgeBaseSection } from "@/views/admin/knowledge-base-section";
import { TestimonialsSection } from "@/views/admin/testimonials-section";
import { RedirectsSection } from "@/views/admin/redirects-section";
import { SeoMetadataSection } from "@/views/admin/seo-metadata-section";
import { CareersSection } from "@/views/admin/careers-section";
import { SiteSettingsSection } from "@/views/admin/site-settings-section";
import { formatMoney, formatNumber, formatDate, toMinor } from "@/lib/money";
import {
  Users, Building2, Download, RefreshCcw, BarChart3, ScrollText, Flag,
  AlertTriangle, Database, Activity, CheckCircle2, XCircle, Clock, Loader2, ShieldCheck,
  Boxes, FileSearch, BookOpenCheck, Gauge, FolderKanban, MapPin, Landmark, BriefcaseBusiness, Newspaper, Images, MessageSquareQuote, Link2, Globe2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MetricState } from "@/lib/data-state";
import { ADMIN_SECTIONS, adminSectionFromLocation, canViewAdminSection, type AdminSection } from "@/features/admin/admin-sections";
import { OverviewSection } from "@/features/admin/overview-section";
import { MediaForm, MediaUploader, MediaPreview } from "@/features/admin/shared/media-field";
import { PublicMediaPicker } from "@/features/admin/shared/public-media-picker";
import { confirmDiscardChanges, useUnsavedChanges } from "@/features/admin/shared/admin-primitives";
import { MapLocationPicker } from "@/features/admin/shared/map-location-picker";
import { EntityMediaEditor, emptyMediaDraft, readMediaDraft, mediaDraftPayload } from "@/features/admin/shared/entity-media-editor";
import { withGalleryCover } from "@/lib/media-contract";
import { ProjectPaymentPlanEditor } from "@/features/admin/shared/project-payment-plan-editor";
import { UnitEditorDialog, UnitImportDialog, type UnitRow, type UnitProject, type UnitProperty } from "@/features/admin/shared/unit-studio-actions";
import { AdminShell } from "@/features/admin/admin-shell";

function isPublicMediaUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("/uploads/") || value.startsWith("/api/media/"));
}

function datetimeLocalValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function AdminView() {
  const loc = useRoute();
  const { user, loading, logout } = useAuth();
  const section = adminSectionFromLocation(loc.path, loc.query.section);

  usePageMeta({ title: "Admin Console", noindex: true });

  if (loading) return <div className="container-page py-12"><LoadingState /></div>;

  if (!user || !hasRole(user, ["OWNER", "ADMIN", "MANAGER", "CONTENT_EDITOR", "AGENT", "ANALYST"])) {
    return (
      <div className="container-page py-20">
        <ErrorState message="Admin access requires sign-in with an authorized role." />
        <div className="mt-6 text-center">
          <Button asChild variant="outline"><Link to="/account/login" query={{ next: "/admin" }}>Sign in</Link></Button>
        </div>
      </div>
    );
  }

  const can = (section: AdminSection) => canViewAdminSection(section, user.roles);

  return (
    <AdminShell user={user} activeSection={section} onSignOut={logout}>
        {section === "overview" && <OverviewSection />}
        {section === "leads" && <LeadsSection />}
        {section === "properties" && <PropertiesSection canCreate={hasRole(user, ["OWNER"]) || (hasRole(user, ["ADMIN"]) && Boolean(user.organizationId))} canReindex={hasRole(user, ["OWNER", "ADMIN"])} />}
        {section === "projects" && <ProjectsSection canEdit={hasRole(user, ["OWNER"]) || (hasRole(user, ["ADMIN"]) && Boolean(user.organizationId))} />}
        {section === "communities" && <CommunitiesSection canEdit={hasRole(user, ["OWNER"]) || (hasRole(user, ["ADMIN"]) && Boolean(user.organizationId))} />}
        {section === "developers" && <DevelopersSection canEdit={hasRole(user, ["OWNER"]) || (hasRole(user, ["ADMIN"]) && Boolean(user.organizationId))} />}
        {section === "agents" && <AgentsSection canEdit={hasRole(user, ["OWNER", "ADMIN", "MANAGER"])} />}
        {section === "users" && <UsersSection isOwner={hasRole(user, ["OWNER"])} canManage={hasRole(user, ["OWNER", "ADMIN"])} />}
        {section === "content" && <ContentSection canEdit={hasRole(user, ["OWNER", "ADMIN", "CONTENT_EDITOR"])} canReview={hasRole(user, ["OWNER", "ADMIN"])} />}
        {section === "careers" && <CareersSection actorId={user.id} canEdit={hasRole(user, ["OWNER", "ADMIN", "CONTENT_EDITOR"])} canReview={hasRole(user, ["OWNER", "ADMIN"])} />}
        {section === "site-settings" && <SiteSettingsSection />}
        {section === "faqs" && <FaqsSection canEdit={hasRole(user, ["OWNER", "ADMIN", "CONTENT_EDITOR"])} />}
        {section === "market-reports" && <MarketReportsSection canEdit={hasRole(user, ["OWNER", "ADMIN", "CONTENT_EDITOR"])} canReview={hasRole(user, ["OWNER", "ADMIN"])} />}
        {section === "knowledge-base" && <KnowledgeBaseSection canEdit={hasRole(user, ["OWNER", "ADMIN", "CONTENT_EDITOR"])} canReview={hasRole(user, ["OWNER", "ADMIN"])} />}
        {section === "testimonials" && <TestimonialsSection canEdit={hasRole(user, ["OWNER", "ADMIN", "CONTENT_EDITOR"])} canReview={hasRole(user, ["OWNER", "ADMIN"])} />}
        {section === "redirects" && <RedirectsSection canEdit={hasRole(user, ["OWNER", "ADMIN", "CONTENT_EDITOR"])} />}
        {section === "seo-metadata" && <SeoMetadataSection canEdit={hasRole(user, ["OWNER", "ADMIN", "CONTENT_EDITOR"])} />}
        {section === "media" && <MediaSection canEdit={hasRole(user, ["OWNER", "ADMIN", "CONTENT_EDITOR"])} />}
        {section === "units" && <UnitsSection canEdit={hasRole(user, ["OWNER", "ADMIN"])} />}
        {section === "imports" && <><MarketDataSection canManage={hasRole(user, ["OWNER", "ADMIN"])} /><div className="mt-10 border-t pt-8"><ImportsSection /></div></>}
        {section === "evidence" && <EvidenceSection />}
        {section === "search" && <SearchOperationsSection />}
        {section === "data-quality" && <DataQualitySection />}
        {section === "crm" && <CrmSection canManage={hasRole(user, ["OWNER", "ADMIN"])} />}
        {section === "jobs" && <JobsSection />}
        {section === "analytics" && <AnalyticsSection />}
        {section === "audit" && <AuditSection />}
        {section === "flags" && <FlagsSection canEdit={hasRole(user, ["OWNER", "ADMIN"])} />}
    </AdminShell>
  );
}

function UsersSection({ isOwner, canManage }: { isOwner: boolean; canManage: boolean }) {
  const route = useRoute();
  const [data, setData] = React.useState<{ users: Record<string, unknown>[]; invitations: Record<string, unknown>[]; organizations: Record<string, unknown>[]; roleOptions: string[] } | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [roleKey, setRoleKey] = React.useState("");
  const [organizationId, setOrganizationId] = React.useState("");
  const promptedRole = React.useRef(false);

  const load = React.useCallback(() => {
    api.get<typeof data>("/api/admin/users").then(setData).catch(() => setData(null));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if (!data) return;
    if (!roleKey && data.roleOptions[0]) setRoleKey(data.roleOptions[0]);
    if (!organizationId && data.organizations[0]) setOrganizationId(String(data.organizations[0].id));
  }, [data, organizationId, roleKey]);
  React.useEffect(() => {
    if (!promptedRole.current && canManage && route.query.inviteRole === "AGENT" && data?.roleOptions.includes("AGENT")) {
      promptedRole.current = true;
      setRoleKey("AGENT");
      setDialogOpen(true);
    }
  }, [canManage, data, route.query.inviteRole]);

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!organizationId || !roleKey) return;
    setSaving(true);
    try {
      const result = await api.post<{ emailDelivery: string }>("/api/admin/users", { email, organizationId, roleKey });
      toast.success(result.emailDelivery === "accepted" ? "Invitation email sent" : "Invitation created; email delivery is not confirmed");
      setDialogOpen(false);
      setEmail("");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invitation failed");
    } finally {
      setSaving(false);
    }
  };

  const updateUser = async (user: Record<string, unknown>, changes: Record<string, unknown>) => {
    try {
      await api.patch("/api/admin/users", { action: "update-user", userId: user.id, expectedUpdatedAt: user.updatedAt, ...changes });
      toast.success("User access updated");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "User update failed");
      load();
    }
  };

  const revoke = async (invitation: Record<string, unknown>) => {
    try {
      await api.patch("/api/admin/users", { action: "revoke-invitation", invitationId: invitation.id });
      toast.success("Invitation revoked");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invitation revoke failed");
    }
  };

  const staffRoles = new Set(["ADMIN", "MANAGER", "CONTENT_EDITOR", "AGENT", "ANALYST"]);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold">Users & access</h1><p className="mt-1 text-sm text-muted-foreground">Invite staff with organization-scoped roles. Owners may grant Admin; organization Admins cannot grant or change another Admin.</p></div>
        {canManage && <Button onClick={() => setDialogOpen(true)}>Invite staff</Button>}
      </header>
      {!data ? <LoadingState rows={4} /> : <>
        <section className="space-y-3">
          <h2 className="font-semibold">Accounts</h2>
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">User</th><th className="p-3">Organization</th><th className="p-3">Role</th><th className="p-3">Email</th><th className="p-3">Access</th></tr></thead>
              <tbody>{data.users.map((user) => {
                const roles = (user.roles as { role: { key: string } }[]).map((entry) => entry.role.key);
                const currentRole = roles.find((role) => staffRoles.has(role));
                const canManageRow = canManage && Boolean(currentRole) && !roles.includes("OWNER") && (isOwner || !roles.includes("ADMIN"));
                return <tr key={String(user.id)} className="border-b border-border/40 last:border-0">
                  <td className="p-3"><p className="font-medium">{String(user.name ?? "Unnamed user")}</p><p className="text-xs text-muted-foreground">{String(user.email)}</p></td>
                  <td className="p-3 text-muted-foreground">{String((user.organization as Record<string, unknown> | null)?.name ?? "—")}</td>
                  <td className="p-3">{canManageRow && data.roleOptions.includes(currentRole ?? "") ? <Select value={currentRole} onValueChange={(value) => updateUser(user, { roleKey: value })}><SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger><SelectContent>{data.roleOptions.map((role) => <SelectItem key={role} value={role}>{role.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select> : <span>{roles.join(", ") || "No role"}</span>}</td>
                  <td className="p-3">{Boolean(user.emailVerified) ? <Badge variant="secondary">Verified</Badge> : <Badge variant="outline">Unverified</Badge>}</td>
                  <td className="p-3">{canManageRow ? <Select value={user.isActive ? "active" : "inactive"} onValueChange={(value) => updateUser(user, { isActive: value === "active" })}><SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Suspended</SelectItem></SelectContent></Select> : <Badge variant={user.isActive ? "secondary" : "outline"}>{user.isActive ? "Active" : "Suspended"}</Badge>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Showing up to 100 accounts in your authorized scope. Suspending an account revokes its existing sessions.</p>
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold">Invitations</h2>
          {data.invitations.length === 0 ? <EmptyState title="No invitations" description="New staff invitations will appear here." /> : <div className="overflow-x-auto rounded-xl border border-border/70"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Email</th><th className="p-3">Organization</th><th className="p-3">Role</th><th className="p-3">Status</th>{canManage && <th className="p-3">Action</th>}</tr></thead><tbody>{data.invitations.map((invitation) => <tr key={String(invitation.id)} className="border-b border-border/40 last:border-0"><td className="p-3">{String(invitation.email)}</td><td className="p-3">{String((invitation.organization as Record<string, unknown> | null)?.name ?? "—")}</td><td className="p-3">{String(invitation.roleKey)}</td><td className="p-3"><Badge variant={invitation.status === "PENDING" ? "secondary" : "outline"}>{String(invitation.status)}</Badge></td>{canManage && <td className="p-3">{(invitation.status === "PENDING" || invitation.status === "EXPIRED") && <Button size="sm" variant="outline" onClick={() => revoke(invitation)}>{invitation.status === "EXPIRED" ? "Clear expired" : "Revoke"}</Button>}</td>}</tr>)}</tbody></table></div>}
        </section>
      </>}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite staff</DialogTitle><DialogDescription>Invitation links are single-use, expire after seven days, and never grant Owner. Mail delivery status is reported after the invite is committed.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={submitInvite}>
            <label className="block space-y-1.5 text-sm font-medium">Email<Input type="email" required maxLength={200} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Organization<Select value={organizationId || undefined} onValueChange={setOrganizationId}><SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger><SelectContent>{data?.organizations.map((organization) => <SelectItem key={String(organization.id)} value={String(organization.id)}>{String(organization.name)}</SelectItem>)}</SelectContent></Select></label>
            <label className="block space-y-1.5 text-sm font-medium">Role<Select value={roleKey || undefined} onValueChange={setRoleKey}><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger><SelectContent>{data?.roleOptions.map((role) => <SelectItem key={role} value={role}>{role.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
            {data?.organizations.length === 0 && <p className="text-sm text-destructive">Create an organization before inviting staff.</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || !organizationId || !roleKey}>{saving ? "Sending…" : "Create invitation"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------ Leads ----------------------------------- */
/* ------------------------------ Leads ----------------------------------- */

function LeadsSection() {
  const [data, setData] = React.useState<{ leads: Record<string, unknown>[]; total: number } | null>(null);
  const [status, setStatus] = React.useState<string>("all");
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [bookingDraft, setBookingDraft] = React.useState<{ id: string; updatedAt: string; reference: string } | null>(null);
  const [confirmationSource, setConfirmationSource] = React.useState("CUSTOMER_CONFIRMATION");
  const [confirmationNote, setConfirmationNote] = React.useState("");
  const [confirmingBooking, setConfirmingBooking] = React.useState(false);

  const load = React.useCallback(() => {
    api.get<{ leads: Record<string, unknown>[]; total: number }>(`/api/admin/leads${status !== "all" ? `?status=${status}` : ""}`)
      .then(setData)
      .catch(() => setData({ leads: [], total: 0 }));
  }, [status]);

  React.useEffect(() => { load(); }, [load]);

  const updateStatus = async (leadId: string, expectedUpdatedAt: string, next: string) => {
    try {
      await api.patch("/api/admin/leads", { leadId, expectedUpdatedAt, status: next });
      toast.success(`Lead status → ${next}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const confirmBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bookingDraft) return;
    setConfirmingBooking(true);
    try {
      await api.post("/api/admin/bookings/confirm", {
        bookingId: bookingDraft.id,
        expectedUpdatedAt: bookingDraft.updatedAt,
        evidenceSource: confirmationSource,
        evidenceNote: confirmationNote,
      });
      toast.success("Human confirmation recorded in IERE. No calendar or GHL booking was created or updated.");
      setBookingDraft(null);
      setConfirmationNote("");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record this confirmation.");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setConfirmingBooking(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Leads queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">Full context: score, attribution, CRM state and event history per lead.</p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all", "NEW", "ATTEMPTED", "CONTACTED", "QUALIFIED", "NURTURE", "WON", "LOST", "SPAM"].map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {data === null ? (
        <LoadingState rows={4} />
      ) : data.leads.length === 0 ? (
        <EmptyState title="No leads in this filter" description="Submit an enquiry on the public site to see the pipeline." />
      ) : (
        <div className="space-y-3">
          {data.leads.map((l) => {
            const id = String(l.id);
            const score = l.score as { score: number; band: string } | null;
            const context = l.context as Record<string, string> | null;
            const events = (l.events as { type: string; at: string }[]) ?? [];
            const isExpanded = expanded === id;
            return (
              <div key={id} className="rounded-xl border border-border/70 bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-xs font-bold text-brand-strong">{String(l.reference)}</span>
                      <StatusBadge status={String(l.status)} />
                      <Badge variant="outline">{String(l.intent)}</Badge>
                      {score && (
                        <span className={cn("num rounded-full px-2 py-0.5 text-[10px] font-bold", score.band === "HIGH" ? "bg-success/10 text-success" : score.band === "MEDIUM" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>
                          {score.score} · {score.band}
                        </span>
                      )}
                      {l.crmStatus ? (
                        <span className={cn("text-[10px] font-semibold uppercase", String(l.crmStatus) === "DELIVERED" ? "text-success" : "text-warning")}>
                          CRM: {String(l.crmStatus)}{l.crmAttempts ? ` (${String(l.crmAttempts)})` : ""}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium">{String((l.contact as Record<string, string>).name)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {(l.contact as Record<string, string>).email ?? (l.contact as Record<string, string>).phone} · {formatDate(String(l.createdAt), undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setExpanded(isExpanded ? null : id)} aria-expanded={isExpanded}>
                      {isExpanded ? "Hide" : "Context"}
                    </Button>
                    <Select value={String(l.status)} onValueChange={(v) => updateStatus(id, String(l.updatedAt), v)}>
                      <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["NEW", "ATTEMPTED", "CONTACTED", "QUALIFIED", "NURTURE", "WON", "LOST", "SPAM"].map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {isExpanded && (
                  <div className="grid gap-4 border-t border-border/60 p-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <p className="kicker mb-1.5">Attribution</p>
                      <dl className="space-y-1 text-muted-foreground">
                        <div className="flex gap-2"><dt className="w-20 shrink-0">Landing</dt><dd className="truncate">{context?.landingUrl ?? "—"}</dd></div>
                        <div className="flex gap-2"><dt className="w-20 shrink-0">Referrer</dt><dd className="truncate">{context?.referrer ?? "direct"}</dd></div>
                        <div className="flex gap-2"><dt className="w-20 shrink-0">UTM</dt><dd className="truncate">{[context?.utmSource, context?.utmCampaign].filter(Boolean).join(" / ") || "—"}</dd></div>
                        <div className="flex gap-2"><dt className="w-20 shrink-0">Device</dt><dd>{context?.deviceClass ?? "—"} · {context?.locale}</dd></div>
                      </dl>
                    </div>
                    <div>
                      <p className="kicker mb-1.5">Entity & booking</p>
                      <p className="text-muted-foreground">{String((l.entity as Record<string, string> | null)?.slug ?? "—")}</p>
                      {l.message ? <p className="mt-1.5 line-clamp-3 text-muted-foreground">{String(l.message)}</p> : null}
                      {l.booking ? (
                        <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-background p-3">
                          <p className="text-brand-strong">
                            {String((l.booking as Record<string, string>).reference)} · {formatDate(String((l.booking as Record<string, string>).scheduledAt))} · {String((l.booking as Record<string, string>).status)}
                          </p>
                          {String((l.booking as Record<string, string>).status) === "REQUESTED" ? <>
                            <p className="text-muted-foreground">Preferred time only; awaiting human confirmation. This does not reflect live calendar availability.</p>
                            <Button type="button" size="sm" variant="outline" onClick={() => {
                              const booking = l.booking as Record<string, string>;
                              setConfirmationSource("CUSTOMER_CONFIRMATION");
                              setConfirmationNote("");
                              setBookingDraft({ id: booking.id, updatedAt: booking.updatedAt, reference: booking.reference });
                            }}>Record confirmation evidence</Button>
                          </> : String((l.booking as Record<string, string>).status) === "CONFIRMED" ? (
                            <p className="text-muted-foreground">Confirmed by an IERE operator from recorded evidence; this status does not indicate a calendar or GHL sync.</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <p className="kicker mb-1.5">Events</p>
                      <ol className="space-y-1 text-muted-foreground">
                        {events.slice(0, 6).map((e, i) => (
                          <li key={i}>{formatDate(e.at, undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {e.type}</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={bookingDraft !== null} onOpenChange={(open) => { if (!open && !confirmingBooking) setBookingDraft(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record appointment confirmation</DialogTitle>
            <DialogDescription>
              {bookingDraft ? `Request ${bookingDraft.reference}: use only after confirmation evidence is available. This records an operator assertion in IERE; it does not check calendar availability or update GHL.` : ""}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={confirmBooking}>
            <label className="block space-y-1.5 text-sm font-medium">Evidence source
              <Select value={confirmationSource} onValueChange={setConfirmationSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CUSTOMER_CONFIRMATION">Customer confirmed directly</SelectItem>
                  <SelectItem value="AGENT_CONFIRMATION">Assigned agent confirmed</SelectItem>
                  <SelectItem value="PROVIDER_RECORD_REVIEWED">Operator reviewed a provider record</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">Evidence note
              <Textarea required minLength={10} maxLength={1000} rows={4} value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} placeholder="Briefly note who/what confirmed and when; avoid adding sensitive contact details." />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBookingDraft(null)} disabled={confirmingBooking}>Cancel</Button>
              <Button type="submit" disabled={confirmingBooking || confirmationNote.trim().length < 10}>
                {confirmingBooking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                Record human confirmation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------ Properties ------------------------------- */

const emptyPropertyForm = () => ({
  title: "", slug: "", description: "", shortDescription: "", type: "APARTMENT", subType: "", bedrooms: "0", bathrooms: "0",
  builtUpAreaSqft: "", plotAreaSqft: "", furnishing: "", view: "", floor: "", totalFloors: "", handoverQuarter: "",
  addressLine: "", reraPermit: "", titleDeedRef: "", highlights: "", priceAed: "", priceQualifier: "", tenure: "",
  serviceChargePerSqft: "", expiresAt: "", offPlan: false, exclusive: false, availability: "AVAILABLE", status: "DRAFT", featured: false,
  coverMediaId: "", communityId: "", projectId: "", developerId: "", agentId: "", amenityIds: [] as string[],
  lat: "", lng: "", locationPrecision: "BUILDING", listingType: "", rentFrequency: "",
});

function PropertiesSection({ canCreate, canReindex }: { canCreate: boolean; canReindex: boolean }) {
  type SourceField = "title" | "description" | "propertyType" | "bedrooms" | "bathrooms" | "priceAed" | "availabilityStatus";
  const [data, setData] = React.useState<{ properties: Record<string, unknown>[]; total: number } | null>(null);
  const [communities, setCommunities] = React.useState<Record<string, unknown>[]>([]);
  const [propertyOptions, setPropertyOptions] = React.useState<{ projects: Record<string, unknown>[]; developers: Record<string, unknown>[]; agents: Record<string, unknown>[]; amenities: Record<string, unknown>[] }>({ projects: [], developers: [], agents: [], amenities: [] });
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [mediaDraft, setMediaDraft] = React.useState(emptyMediaDraft);
  const [reindexing, setReindexing] = React.useState(false);
  const [resetSourceFields, setResetSourceFields] = React.useState<SourceField[]>([]);
  const [form, setForm] = React.useState(emptyPropertyForm);

  const load = React.useCallback(() => {
    api.get<{ properties: Record<string, unknown>[]; total: number }>(`/api/admin/properties${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then(setData)
      .catch(() => setData({ properties: [], total: 0 }));
  }, [q]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!canCreate) return;
    let active = true;
    Promise.all([
      api.get<{ communities: Record<string, unknown>[] }>("/api/admin/communities"),
      api.get<typeof propertyOptions>("/api/admin/properties/options"),
    ])
      .then(([result, options]) => { if (active) { setCommunities(result.communities); setPropertyOptions(options); } })
      .catch(() => { if (active) setCommunities([]); });
    return () => { active = false; };
  }, [canCreate]);

  const openCreate = () => {
    setSaveError(null);
    setEditing(null);
    setMediaDraft(emptyMediaDraft());
    setCreating(true);
    setResetSourceFields([]);
    setForm({ ...emptyPropertyForm(), availability: "" });
  };

  const patch = async (property: Record<string, unknown>, patchBody: Record<string, unknown>) => {
    try {
      await api.patch("/api/admin/properties", { propertyId: property.id, expectedUpdatedAt: property.updatedAt, ...patchBody });
      toast.success("Property updated — search index sync queued");
      load();
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Update failed";
      setSaveError(message);
      toast.error(message);
      if (e instanceof Error && e.message.toLowerCase().includes("changed since")) load();
      return false;
    }
  };

  const openEditor = (property: Record<string, unknown>) => {
    setSaveError(null);
    setCreating(false);
    setEditing(property);
    setMediaDraft(readMediaDraft(property));
    setResetSourceFields([]);
    setForm({ ...emptyPropertyForm(),
      title: String(property.title ?? ""),
      slug: String(property.slug ?? ""),
      description: String(property.description ?? ""),
      shortDescription: String(property.shortDescription ?? ""),
      type: String(property.type ?? "APARTMENT"),
      subType: String(property.subType ?? ""),
      bedrooms: String(property.bedrooms ?? 0),
      bathrooms: String(property.bathrooms ?? 0),
      builtUpAreaSqft: String(property.builtUpAreaSqft ?? ""),
      plotAreaSqft: String(property.plotAreaSqft ?? ""),
      furnishing: String(property.furnishing ?? ""), view: String(property.view ?? ""),
      floor: String(property.floor ?? ""), totalFloors: String(property.totalFloors ?? ""),
      handoverQuarter: String(property.handoverQuarter ?? ""), addressLine: String(property.addressLine ?? ""),
      reraPermit: String(property.reraPermit ?? ""), titleDeedRef: String(property.titleDeedRef ?? ""),
      highlights: Array.isArray(property.highlights) ? property.highlights.join("\n") : "",
      priceAed: property.priceMinor ? String(Number(property.priceMinor) / 100) : "",
      priceQualifier: String(property.priceQualifier ?? ""), tenure: String(property.tenure ?? ""),
      serviceChargePerSqft: String(property.serviceChargePerSqft ?? ""), offPlan: Boolean(property.offPlan), exclusive: Boolean(property.isExclusive),
      expiresAt: property.expiresAt ? datetimeLocalValue(String(property.expiresAt)) : "",
      availability: String(property.availability ?? "AVAILABLE"), listingType: String(property.listingType ?? "SALE"), rentFrequency: String(property.rentFrequency ?? ""),
      status: String(property.publicationStatus ?? "DRAFT"),
      featured: Boolean(property.isFeaturedNow),
      coverMediaId: String(property.coverMediaId ?? ""),
      communityId: String(property.communityId ?? ""), projectId: String(property.projectId ?? ""), developerId: String(property.developerId ?? ""), agentId: String(property.agentId ?? ""),
      amenityIds: Array.isArray(property.amenityIds) ? property.amenityIds.map(String) : [],
      lat: String(property.lat ?? ""), lng: String(property.lng ?? ""), locationPrecision: String(property.locationPrecision ?? "BUILDING"),
    });
  };

  const sourceFacts = editing?.sourceFacts && typeof editing.sourceFacts === "object" ? editing.sourceFacts as Record<string, unknown> : {};
  const editorOverrides = editing?.editorOverrides && typeof editing.editorOverrides === "object" ? editing.editorOverrides as Record<string, unknown> : {};
  const showSourceFacts = editing?.sourceType === "IMPORT";
  const sourceValue = (field: SourceField) => sourceFacts[field];
  const applySourceValue = (field: SourceField) => {
    const value = sourceValue(field);
    if (value === undefined && field !== "description") return;
    const text = value === null || value === undefined ? "" : String(value);
    setForm((current) => ({
      ...current,
      ...(field === "title" ? { title: text } : {}),
      ...(field === "description" ? { description: text } : {}),
      ...(field === "propertyType" ? { type: text } : {}),
      ...(field === "bedrooms" ? { bedrooms: text } : {}),
      ...(field === "bathrooms" ? { bathrooms: text } : {}),
      ...(field === "priceAed" ? { priceAed: text } : {}),
      ...(field === "availabilityStatus" ? { availability: text } : {}),
    }));
    setResetSourceFields((current) => current.includes(field) ? current : [...current, field]);
  };
  const sourceControl = (field: SourceField) => {
    if (!showSourceFacts) return null;
    const value = sourceValue(field);
    const hasOverride = Object.prototype.hasOwnProperty.call(editorOverrides, field);
    const canRestore = hasOverride && (value !== undefined || field === "description");
    return <div className="flex min-h-6 items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>Current source value: {value === undefined || value === null || value === "" ? "Not supplied" : String(value)}</span>
      {canRestore && <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => applySourceValue(field)}>
        {resetSourceFields.includes(field) ? "Using source value" : "Use source value"}
      </Button>}
    </div>;
  };

  const linkedCommunity = communities.find((community) => String(community.id) === form.communityId);
  const linkedProject = propertyOptions.projects.find((project) => String(project.id) === form.projectId);
  const linkedProjectCommunity = linkedProject?.community as { publicationStatus?: string } | undefined;
  const propertyReadiness = [
    { label: "Title and property type are present", ready: Boolean(form.title.trim() && form.type.trim()) },
    { label: "Latitude and longitude are valid", ready: Number.isFinite(Number(form.lat)) && Number(form.lat) >= -90 && Number(form.lat) <= 90 && Number.isFinite(Number(form.lng)) && Number(form.lng) >= -180 && Number(form.lng) <= 180 && Boolean(form.lat.trim() && form.lng.trim()) },
    { label: "A published community is linked", ready: linkedCommunity?.publicationStatus === "PUBLISHED" },
    { label: "The linked project is public when selected", ready: !form.projectId || (linkedProject?.publicationStatus === "PUBLISHED" && linkedProjectCommunity?.publicationStatus === "PUBLISHED") },
    { label: "A positive price and public listing status are set", ready: Number(form.priceAed) > 0 && form.availability !== "WITHDRAWN" },
    { label: "Rental frequency is set when applicable", ready: form.listingType !== "RENT" || Boolean(form.rentFrequency) },
    { label: "Listing expiry is still in the future", ready: !form.expiresAt || new Date(form.expiresAt).getTime() > Date.now() },
  ];
  const sourceAgeDays = editing?.retrievedAt ? Math.floor((Date.now() - new Date(String(editing.retrievedAt)).getTime()) / 86_400_000) : null;

  const saveEditor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing && !creating) return;
    if (!form.lat.trim() || !form.lng.trim()) { toast.error("Enter or pick both latitude and longitude before saving."); return; }
    if (!form.listingType || !form.availability) { toast.error("Choose a listing type and availability before saving."); return; }
    setSaveError(null);
    setSaving(true);
    try {
      if (creating) {
        await api.post("/api/admin/properties", {
          communityId: form.communityId, title: form.title, slug: form.slug,
          description: form.description || null, propertyType: form.type,
          bedrooms: Number(form.bedrooms), bathrooms: Number(form.bathrooms),
          lat: Number(form.lat), lng: Number(form.lng), locationPrecision: form.locationPrecision,
          listingType: form.listingType, rentFrequency: form.rentFrequency || null,
          priceAed: Number(form.priceAed), availabilityStatus: form.availability,
          coverMediaId: form.coverMediaId || null,
          ...mediaDraftPayload(mediaDraft),
          projectId: form.projectId || null, developerId: form.developerId || null,
          subType: form.subType || null, builtUpAreaSqft: form.builtUpAreaSqft ? Number(form.builtUpAreaSqft) : null,
          plotAreaSqft: form.plotAreaSqft ? Number(form.plotAreaSqft) : null, furnishing: form.furnishing || null, view: form.view || null,
          floor: form.floor !== "" ? Number(form.floor) : null, totalFloors: form.totalFloors ? Number(form.totalFloors) : null,
          handoverQuarter: form.handoverQuarter || null, addressLine: form.addressLine || null, shortDescription: form.shortDescription || null,
          reraPermit: form.reraPermit || null, titleDeedRef: form.titleDeedRef || null,
          highlights: form.highlights.split("\n").map((line) => line.trim()).filter(Boolean),
          tenure: form.tenure || null, priceQualifier: form.priceQualifier || null,
          serviceChargePerSqft: form.serviceChargePerSqft ? Number(form.serviceChargePerSqft) : null,
          offPlan: form.offPlan, isExclusive: form.exclusive, agentId: form.agentId || null, amenityIds: form.amenityIds,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        });
        toast.success("Property created as a draft");
        setCreating(false);
        load();
      } else if (editing) {
        const saved = await patch(editing, {
          title: form.title,
          description: form.description || null,
          propertyType: form.type,
          bedrooms: Number(form.bedrooms),
          bathrooms: Number(form.bathrooms),
          publicationStatus: form.status,
          ...(form.priceAed.trim() ? { priceAed: Number(form.priceAed) } : {}),
          availabilityStatus: form.availability,
          isFeatured: form.featured,
          coverMediaId: form.coverMediaId || null,
          ...mediaDraftPayload(mediaDraft),
          subType: form.subType || null, builtUpAreaSqft: form.builtUpAreaSqft ? Number(form.builtUpAreaSqft) : null,
          plotAreaSqft: form.plotAreaSqft ? Number(form.plotAreaSqft) : null, furnishing: form.furnishing || null, view: form.view || null,
          floor: form.floor !== "" ? Number(form.floor) : null, totalFloors: form.totalFloors ? Number(form.totalFloors) : null,
          handoverQuarter: form.handoverQuarter || null, addressLine: form.addressLine || null, shortDescription: form.shortDescription || null,
          reraPermit: form.reraPermit || null, titleDeedRef: form.titleDeedRef || null,
          highlights: form.highlights.split("\n").map((line) => line.trim()).filter(Boolean),
          projectId: form.projectId || null, developerId: form.developerId || null,
          tenure: form.tenure || null, priceQualifier: form.priceQualifier || null,
          serviceChargePerSqft: form.serviceChargePerSqft ? Number(form.serviceChargePerSqft) : null,
          offPlan: form.offPlan, isExclusive: form.exclusive, agentId: form.agentId || null, amenityIds: form.amenityIds,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
          communityId: form.communityId, lat: Number(form.lat), lng: Number(form.lng), locationPrecision: form.locationPrecision,
          listingType: form.listingType, rentFrequency: form.rentFrequency || null,
          ...(resetSourceFields.length ? { resetSourceFields } : {}),
        });
        if (saved) { setEditing(null); setResetSourceFields([]); }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Property create failed";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Properties</h1>
          <p className="mt-1 text-sm text-muted-foreground">Publish, price and feature listings — every change emits an index event and audit entry.</p>
        </div>
        <div className="flex flex-wrap gap-2"><div className="w-64">
          <Input placeholder="Search titles…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search properties" />
        </div>{canCreate && <Button onClick={openCreate}>Create property</Button>}</div>
      </header>

      {data === null ? (
        <LoadingState rows={4} />
      ) : (
        <div className="overflow-x-safe rounded-xl border border-border/70">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Property management</caption>
            <thead>
              <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-3 font-medium">Title</th>
                <th scope="col" className="p-3 font-medium">Community</th>
                <th scope="col" className="p-3 font-medium">Price</th>
                <th scope="col" className="p-3 font-medium">Status</th>
                <th scope="col" className="p-3 font-medium">Agent</th>
                <th scope="col" className="p-3 font-medium">Quality</th>
                <th scope="col" className="p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.properties.map((p) => (
                <tr key={String(p.id)} className="border-b border-border/40 last:border-0">
                  <td className="max-w-64 p-3">
                    <Link to={`/properties/${String(p.slug)}`} className="font-medium hover:text-brand-strong">{String(p.title)}</Link>
                    <p className="text-xs text-muted-foreground">{String(p.type)} · {String(p.bedrooms)} bd {p.isDemoData ? "· demo" : ""}</p>
                  </td>
                  <td className="p-3 text-muted-foreground">{String(p.community)}</td>
                  <td className="num p-3">{p.priceMinor ? formatMoney(String(p.priceMinor), { currency: String(p.currency) }) : "—"}</td>
                  <td className="p-3">
                    <Select value={String(p.publicationStatus)} onValueChange={(v) => patch(p, { publicationStatus: v })}>
                      <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{String(p.agent ?? "—")}</td>
                  <td className="p-3">
                    {Number(p.openIssues) > 0 ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-warning"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{String(p.openIssues)}</span>
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1.5">
                      {Boolean(p.canManage) && <Button size="sm" variant="outline" onClick={() => openEditor(p)}>Edit</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canReindex && <Button variant="outline" size="sm" className="gap-2" disabled={reindexing} onClick={async () => {
        setReindexing(true);
        try {
          const result = await api.post<{ status: string; count: number }>("/api/admin/search/reindex", { mode: "direct" });
          toast.success(`Search rebuilt: ${result.count} listings`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not rebuild search");
        } finally {
          setReindexing(false);
        }
      }}>
        {reindexing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Database className="h-4 w-4" aria-hidden />}
        {reindexing ? "Rebuilding…" : "Rebuild search index"}
      </Button>}
      <Dialog open={editing !== null || creating} onOpenChange={(open) => { if (!open) { setEditing(null); setCreating(false); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{creating ? "Create property" : "Edit property"}</DialogTitle>
            <DialogDescription>{creating ? "New properties are internal drafts. Enter known listing and location facts only; coordinates are attributed to manual Admin input and are not externally verified." : "Changes are version checked and recorded with an audit entry. Publishing validates the linked public listing, community and project."}</DialogDescription>
          </DialogHeader>
          <MediaForm className="space-y-4" onSubmit={saveEditor}>
              {saveError && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{saveError} Your form and uploaded media are retained. Review the error and try saving again.</p>}
            {!creating && editing && <section className="space-y-2 rounded-lg border border-border/70 bg-secondary/20 p-3" aria-label="Property publish readiness">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Publish readiness</h3><p className="text-xs text-muted-foreground">The API rechecks these requirements when you save. A blocked publish leaves the property unchanged.</p></div><div className="flex flex-wrap gap-2"><a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary" href={`/admin/properties/${encodeURIComponent(String(editing.slug))}/preview`} target="_blank" rel="noopener noreferrer">Preview saved record</a>{editing.publicationStatus === "PUBLISHED" && <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary" href={`/properties/${encodeURIComponent(String(editing.slug))}`} target="_blank" rel="noopener noreferrer">Open public page</a>}<a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary" href={`/admin/seo-metadata?q=${encodeURIComponent(`properties/${String(editing.slug)}`)}`}>SEO metadata</a></div></div>
              <ul className="grid gap-1 text-xs sm:grid-cols-2">{propertyReadiness.map((item) => <li key={item.label} className={item.ready ? "text-success" : "text-muted-foreground"}>{item.ready ? "✓" : "○"} {item.label}</li>)}</ul>
              {editing.sourceType === "IMPORT" && sourceAgeDays !== null && Number.isFinite(sourceAgeDays) && sourceAgeDays > 90 && <p className="text-xs font-medium text-warning">Imported source is {sourceAgeDays} days old. Verify current listing facts before publishing.</p>}
            </section>}
            <div className="space-y-1.5"><label className="block text-sm font-medium">Title<Input value={form.title} maxLength={200} required onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>{sourceControl("title")}</div>
            {creating && <label className="block space-y-1.5 text-sm font-medium">URL slug<Input value={form.slug} maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" required onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>}
            <div className="space-y-1.5"><label className="block text-sm font-medium">Description<Textarea value={form.description} maxLength={10000} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>{sourceControl("description")}</div>
            <label className="block space-y-1.5 text-sm font-medium">Short description<Textarea value={form.shortDescription} maxLength={2000} rows={2} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              {creating ? <label className="block space-y-1.5 text-sm font-medium">Property type<Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["APARTMENT", "VILLA", "TOWNHOUSE", "PENTHOUSE", "DUPLEX", "STUDIO", "OFFICE", "RETAIL", "PLOT"].map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></label> : <div className="space-y-1.5"><label className="block text-sm font-medium">Property type<Input value={form.type} maxLength={60} required onChange={(e) => setForm({ ...form, type: e.target.value })} /></label>{sourceControl("propertyType")}</div>}
              <div className="space-y-1.5"><label className="block text-sm font-medium">Bedrooms<Input type="number" min="0" max="30" step="0.5" value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} /></label>{sourceControl("bedrooms")}</div>
              <div className="space-y-1.5"><label className="block text-sm font-medium">Bathrooms<Input type="number" min="0" max="30" step="0.5" value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} /></label>{sourceControl("bathrooms")}</div>
              <label className="block space-y-1.5 text-sm font-medium">Subtype<Input maxLength={80} value={form.subType} onChange={(e) => setForm({ ...form, subType: e.target.value })} placeholder="e.g. Corner unit" /></label>
              <label className="block space-y-1.5 text-sm font-medium">Built-up area (sq ft)<Input type="number" min="0" max="100000000" step="0.1" value={form.builtUpAreaSqft} onChange={(e) => setForm({ ...form, builtUpAreaSqft: e.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Plot area (sq ft)<Input type="number" min="0" max="100000000" step="0.1" value={form.plotAreaSqft} onChange={(e) => setForm({ ...form, plotAreaSqft: e.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Furnishing<Select value={form.furnishing || "none"} onValueChange={(value) => setForm({ ...form, furnishing: value === "none" ? "" : value })}><SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger><SelectContent><SelectItem value="none">Not specified</SelectItem>{["FURNISHED", "SEMI_FURNISHED", "UNFURNISHED"].map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">View<Select value={form.view || "none"} onValueChange={(value) => setForm({ ...form, view: value === "none" ? "" : value })}><SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger><SelectContent><SelectItem value="none">Not specified</SelectItem>{["SEA", "MARINA", "SKYLINE", "GOLF", "PARK", "COMMUNITY"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Floor<Input type="number" min="-10" max="300" step="1" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Total floors<Input type="number" min="1" max="300" step="1" value={form.totalFloors} onChange={(e) => setForm({ ...form, totalFloors: e.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Handover quarter<Input maxLength={40} value={form.handoverQuarter} onChange={(e) => setForm({ ...form, handoverQuarter: e.target.value })} placeholder="e.g. Q4 2027" /></label>
              <label className="block space-y-1.5 text-sm font-medium">Address<Input maxLength={500} value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">RERA permit<Input maxLength={120} value={form.reraPermit} onChange={(e) => setForm({ ...form, reraPermit: e.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Title deed reference<Input maxLength={160} value={form.titleDeedRef} onChange={(e) => setForm({ ...form, titleDeedRef: e.target.value })} /></label>
              <div className="space-y-1.5"><label className="block text-sm font-medium">Price (AED){creating && <span className="ml-1 text-xs text-muted-foreground">manual asking price</span>}<Input type="number" min="0.01" max="1000000000" step="0.01" required={creating} value={form.priceAed} onChange={(e) => setForm({ ...form, priceAed: e.target.value })} /></label>{sourceControl("priceAed")}</div>
              <label className="block space-y-1.5 text-sm font-medium">Price qualifier<Input maxLength={80} value={form.priceQualifier} onChange={(e) => setForm({ ...form, priceQualifier: e.target.value })} placeholder="e.g. From" /></label>
              <label className="block space-y-1.5 text-sm font-medium">Tenure<Select value={form.tenure || "none"} onValueChange={(value) => setForm({ ...form, tenure: value === "none" ? "" : value })}><SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger><SelectContent><SelectItem value="none">Not specified</SelectItem><SelectItem value="FREEHOLD">Freehold</SelectItem><SelectItem value="LEASEHOLD">Leasehold</SelectItem></SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Service charge (AED/sq ft)<Input type="number" min="0" max="100000000" step="0.01" value={form.serviceChargePerSqft} onChange={(e) => setForm({ ...form, serviceChargePerSqft: e.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Listing expiry<Input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Listing type<Select value={form.listingType || undefined} onValueChange={(listingType) => setForm({ ...form, listingType, rentFrequency: listingType === "RENT" ? form.rentFrequency : "" })}><SelectTrigger><SelectValue placeholder="Select listing type" /></SelectTrigger><SelectContent>{["SALE", "RENT", "SHORT_TERM"].map((type) => <SelectItem key={type} value={type}>{type.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
              {form.listingType === "RENT" && <label className="block space-y-1.5 text-sm font-medium">Rent frequency<Select value={form.rentFrequency || undefined} onValueChange={(rentFrequency) => setForm({ ...form, rentFrequency })}><SelectTrigger><SelectValue placeholder="Select rent frequency" /></SelectTrigger><SelectContent>{["YEARLY", "MONTHLY", "WEEKLY", "DAILY"].map((frequency) => <SelectItem key={frequency} value={frequency}>{frequency}</SelectItem>)}</SelectContent></Select></label>}
              {!creating && <label className="block space-y-1.5 text-sm font-medium">Publication status<Select value={form.status} onValueChange={(status) => setForm({ ...form, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"].map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></label>}
              <div className="space-y-1.5"><label className="block text-sm font-medium">Listing availability<Select value={form.availability || undefined} onValueChange={(availability) => setForm({ ...form, availability })}><SelectTrigger><SelectValue placeholder="Select availability" /></SelectTrigger><SelectContent>{["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN"].map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></label>{sourceControl("availabilityStatus")}</div>
              <label className="block space-y-1.5 text-sm font-medium">Community<Select value={form.communityId || undefined} onValueChange={(communityId) => setForm({ ...form, communityId, projectId: "" })}><SelectTrigger><SelectValue placeholder="Select a community" /></SelectTrigger><SelectContent>{communities.map((community) => <SelectItem key={String(community.id)} value={String(community.id)}>{String(community.name)} ({String(community.publicationStatus)})</SelectItem>)}</SelectContent></Select></label>
              <MapLocationPicker lat={form.lat} lng={form.lng} onLatitudeChange={(lat) => setForm({ ...form, lat })} onLongitudeChange={(lng) => setForm({ ...form, lng })} />
              <label className="block space-y-1.5 text-sm font-medium">Location precision<Select value={form.locationPrecision} onValueChange={(locationPrecision) => setForm({ ...form, locationPrecision })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["BUILDING", "PROJECT", "COMMUNITY_CENTROID", "APPROXIMATE", "EXACT"].map((precision) => <SelectItem key={precision} value={precision}>{precision.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Project<Select value={form.projectId || "none"} onValueChange={(projectId) => { const project = propertyOptions.projects.find((item) => item.id === projectId); setForm({ ...form, projectId: projectId === "none" ? "" : projectId, ...(project?.developerId ? { developerId: String(project.developerId) } : {}) }); }}><SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger><SelectContent><SelectItem value="none">No project</SelectItem>{propertyOptions.projects.filter((project) => !form.communityId || project.communityId === form.communityId).map((project) => <SelectItem key={String(project.id)} value={String(project.id)}>{String(project.name)}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Developer<Select value={form.developerId || "none"} onValueChange={(developerId) => setForm({ ...form, developerId: developerId === "none" ? "" : developerId })}><SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger><SelectContent><SelectItem value="none">Not specified</SelectItem>{propertyOptions.developers.map((developer) => <SelectItem key={String(developer.id)} value={String(developer.id)}>{String(developer.name)}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Listing advisor<Select value={form.agentId || "none"} onValueChange={(agentId) => setForm({ ...form, agentId: agentId === "none" ? "" : agentId })}><SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{propertyOptions.agents.map((agent) => <SelectItem key={String(agent.id)} value={String(agent.id)}>{String(agent.name)}</SelectItem>)}</SelectContent></Select></label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">Highlights<Textarea value={form.highlights} maxLength={7500} rows={4} onChange={(e) => setForm({ ...form, highlights: e.target.value })} placeholder="One highlight per line" /></label>
            <fieldset className="space-y-2 rounded-lg border border-border/70 p-3"><legend className="px-1 text-sm font-medium">Amenities</legend><div className="grid gap-2 sm:grid-cols-2">{propertyOptions.amenities.map((amenity) => <label key={String(amenity.id)} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.amenityIds.includes(String(amenity.id))} onChange={(event) => setForm({ ...form, amenityIds: event.target.checked ? [...form.amenityIds, String(amenity.id)] : form.amenityIds.filter((id) => id !== amenity.id) })} />{String(amenity.name)}</label>)}</div></fieldset>
            <EntityMediaEditor value={mediaDraft} onChange={(draft) => { setMediaDraft(draft); setForm({ ...form, coverMediaId: draft.gallery.find((row) => row.isCover)?.mediaId ?? "" }); }} />
            <PublicMediaPicker label="Cover image" value={form.coverMediaId} onChange={(coverMediaId) => { setForm({ ...form, coverMediaId }); setMediaDraft((draft) => ({ ...draft, gallery: withGalleryCover(draft.gallery, coverMediaId) })); }} />
            {!creating && editing && <section className="space-y-2 rounded-lg border border-border/70 p-3"><h3 className="text-sm font-semibold">Source and editorial history</h3><p className="text-xs text-muted-foreground">Source: {String(editing.sourceType ?? "INTERNAL")} · last source update: {editing.sourceUpdatedAt ? formatDate(String(editing.sourceUpdatedAt)) : "not supplied"} · retrieved: {editing.retrievedAt ? formatDate(String(editing.retrievedAt)) : "not supplied"}</p><div className="grid gap-3 sm:grid-cols-2"><div><p className="mb-1 text-xs font-medium">Price history</p>{Array.isArray(editing.priceHistory) && editing.priceHistory.length ? <ul className="space-y-1 text-xs">{(editing.priceHistory as { priceMinor: string; currency: string; sourceType: string; recordedAt: string }[]).map((item, index) => <li key={`${item.recordedAt}-${index}`}>{formatMoney(item.priceMinor, { currency: item.currency })} · {formatDate(item.recordedAt)} · {item.sourceType}</li>)}</ul> : <p className="text-xs text-muted-foreground">No history recorded.</p>}</div><div><p className="mb-1 text-xs font-medium">Availability history</p>{Array.isArray(editing.statusHistory) && editing.statusHistory.length ? <ul className="space-y-1 text-xs">{(editing.statusHistory as { fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string }[]).map((item, index) => <li key={`${item.createdAt}-${index}`}>{item.fromStatus ?? "Created"} → {item.toStatus} · {formatDate(item.createdAt)}{item.reason ? ` · ${item.reason}` : ""}</li>)}</ul> : <p className="text-xs text-muted-foreground">No status changes recorded.</p>}</div></div></section>}
            <div className="grid gap-3 sm:grid-cols-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.offPlan} onChange={(e) => setForm({ ...form, offPlan: e.target.checked })} /> Off-plan listing</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.exclusive} onChange={(e) => setForm({ ...form, exclusive: e.target.checked })} /> Exclusive listing</label></div>
            {!creating && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured listing</label>}
            {creating && communities.length === 0 && <p className="text-sm text-muted-foreground">Create a community before creating a property.</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setEditing(null); setCreating(false); }}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : creating ? "Create draft property" : "Save changes"}</Button>
            </DialogFooter>
          </MediaForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectsSection({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = React.useState<{ projects: Record<string, unknown>[]; total: number } | null>(null);
  const [relations, setRelations] = React.useState<{ developers: Record<string, unknown>[]; communities: Record<string, unknown>[]; amenities: Record<string, unknown>[] }>({ developers: [], communities: [], amenities: [] });
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [mediaDraft, setMediaDraft] = React.useState(emptyMediaDraft);
  const [form, setForm] = React.useState({
    name: "", slug: "", tagline: "", summary: "", description: "",
    developerId: "", communityId: "", lat: "", lng: "", locationPrecision: "PROJECT",
    projectType: "RESIDENTIAL", status: "OFF_PLAN", publicationStatus: "DRAFT", brochureMediaId: "",
    launchDate: "", handoverDate: "", completionPercent: "", constructionStatus: "", constructionSourceUrl: "", constructionSourceVerifiedAt: "",
    totalUnits: "", startingPrice: "", currency: "AED", highlightsText: "", keyAmenitiesText: "", amenityIds: [] as string[],
  });

  const load = React.useCallback(() => {
    api.get<{ projects: Record<string, unknown>[]; total: number }>(`/api/admin/projects${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then(setData)
      .catch(() => setData({ projects: [], total: 0 }));
  }, [q]);
  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!canEdit) return;
    let active = true;
    Promise.all([
      api.get<{ developers: Record<string, unknown>[] }>("/api/admin/developers"),
      api.get<{ communities: Record<string, unknown>[] }>("/api/admin/communities"),
      api.get<{ amenities: Record<string, unknown>[] }>("/api/admin/properties/options"),
    ]).then(([developers, communities, options]) => {
      if (active) setRelations({ developers: developers.developers, communities: communities.communities, amenities: options.amenities });
    }).catch(() => {
      if (active) setRelations({ developers: [], communities: [], amenities: [] });
    });
    return () => { active = false; };
  }, [canEdit]);

  const openCreate = () => {
    setSaveError(null);
    setEditing(null);
    setMediaDraft(emptyMediaDraft());
    setCreating(true);
    setForm({
      name: "", slug: "", tagline: "", summary: "", description: "", developerId: "", communityId: "",
      lat: "", lng: "", locationPrecision: "PROJECT", projectType: "RESIDENTIAL", status: "OFF_PLAN",
      publicationStatus: "DRAFT", brochureMediaId: "", launchDate: "", handoverDate: "", completionPercent: "",
      constructionStatus: "", constructionSourceUrl: "", constructionSourceVerifiedAt: "", totalUnits: "", startingPrice: "", currency: "AED",
      highlightsText: "", keyAmenitiesText: "", amenityIds: [],
    });
  };

  const openEditor = (project: Record<string, unknown>) => {
    setSaveError(null);
    setCreating(false);
    setEditing(project);
    setMediaDraft(readMediaDraft(project));
    setForm({
      name: String(project.name ?? ""),
      slug: String(project.slug ?? ""),
      tagline: String(project.tagline ?? ""),
      summary: String(project.summary ?? ""),
      description: String(project.description ?? ""),
      developerId: String(project.developerId ?? ""), communityId: String(project.communityId ?? ""), lat: String(project.lat ?? ""), lng: String(project.lng ?? ""), locationPrecision: String(project.locationPrecision ?? "PROJECT"),
      projectType: String(project.projectType ?? "RESIDENTIAL"),
      status: String(project.status ?? "OFF_PLAN"),
      publicationStatus: String(project.publicationStatus ?? "DRAFT"),
      brochureMediaId: String(project.brochureMediaId ?? ""),
      launchDate: String(project.launchDate ?? ""), handoverDate: String(project.handoverDate ?? ""),
      completionPercent: project.completionPercent == null ? "" : String(project.completionPercent),
      constructionStatus: String(project.constructionStatus ?? ""), constructionSourceUrl: String(project.constructionSourceUrl ?? ""),
      constructionSourceVerifiedAt: project.constructionSourceVerifiedAt ? datetimeLocalValue(String(project.constructionSourceVerifiedAt)) : "",
      totalUnits: project.totalUnits == null ? "" : String(project.totalUnits), startingPrice: project.startingPriceMinor == null ? "" : String(Number(project.startingPriceMinor) / 100), currency: String(project.currency ?? "AED"),
      highlightsText: Array.isArray(project.highlights) ? (project.highlights as string[]).join("\n") : "",
      keyAmenitiesText: Array.isArray(project.keyAmenities) ? (project.keyAmenities as string[]).join("\n") : "",
      amenityIds: Array.isArray(project.amenities) ? (project.amenities as { id: string }[]).map((item) => String(item.id)) : [],
    });
  };

  const saveEditor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing && !creating) return;
    setSaveError(null);
    setSaving(true);
    try {
      const { startingPrice, highlightsText, keyAmenitiesText, ...projectFields } = form;
      const fields = {
        ...mediaDraftPayload(mediaDraft, true),
        ...projectFields,
        tagline: form.tagline || null,
        summary: form.summary || null,
        description: form.description || null,
        lat: Number(form.lat),
        lng: Number(form.lng),
        brochureMediaId: form.brochureMediaId || null,
        launchDate: form.launchDate || null,
        handoverDate: form.handoverDate || null,
        completionPercent: form.completionPercent === "" ? null : Number(form.completionPercent),
        constructionStatus: form.constructionStatus || null,
        constructionSourceUrl: form.constructionSourceUrl || null,
        constructionSourceVerifiedAt: form.constructionSourceVerifiedAt ? new Date(form.constructionSourceVerifiedAt).toISOString() : null,
        totalUnits: form.totalUnits === "" ? null : Number(form.totalUnits),
        startingPriceMinor: startingPrice ? toMinor(startingPrice).toString() : null,
        currency: form.currency.toUpperCase(),
        highlights: highlightsText.split("\n").map((item) => item.trim()).filter(Boolean),
        keyAmenities: keyAmenitiesText.split("\n").map((item) => item.trim()).filter(Boolean),
      };
      if (creating) {
        const createFields = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "publicationStatus"));
        await api.post("/api/admin/projects", createFields);
      } else if (editing) {
        const editableFields = Object.fromEntries(Object.entries(fields));
        await api.patch("/api/admin/projects", {
          projectId: editing.id, expectedUpdatedAt: editing.updatedAt, ...editableFields,
        });
      }
      toast.success(creating ? "Project created as draft" : "Project updated — redirects and status history recorded");
      setEditing(null);
      setCreating(false);
      load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project update failed";
      setSaveError(message);
      toast.error(message);
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Edit project content and publication state. Slug changes preserve the old public URL.</p>
        </div>
        <div className="flex flex-wrap gap-2"><div className="w-64"><Input placeholder="Search projects…" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search projects" /></div>{canEdit && <Button onClick={openCreate}>Create project</Button>}</div>
      </header>
      {data === null ? <LoadingState rows={4} /> : data.projects.length === 0 ? <EmptyState title="No projects found" description="Try another project name or slug." /> : (
        <div className="overflow-x-safe rounded-xl border border-border/70">
          <table className="w-full min-w-[800px] text-sm">
            <thead><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-3">Project</th><th className="p-3">Developer</th><th className="p-3">Community</th><th className="p-3">Type</th><th className="p-3">Status</th>{canEdit && <th className="p-3">Action</th>}
            </tr></thead>
            <tbody>{data.projects.map((project) => <tr key={String(project.id)} className="border-b border-border/50">
              <td className="p-3"><p className="font-medium">{String(project.name)}</p><p className="text-xs text-muted-foreground">/{String(project.slug)}</p></td>
              <td className="p-3 text-muted-foreground">{String(project.developer)}</td>
              <td className="p-3 text-muted-foreground">{String(project.community)}</td>
              <td className="p-3">{String(project.projectType)}</td>
              <td className="p-3"><div className="flex flex-col items-start gap-1"><StatusBadge status={String(project.status)} /><Badge variant="outline">{String(project.publicationStatus)}</Badge></div></td>
              {canEdit && <td className="p-3">{Boolean(project.canManage) && <Button size="sm" variant="outline" onClick={() => openEditor(project)}>Edit</Button>}</td>}
            </tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing {String(data?.projects.length ?? 0)} of {String(data?.total ?? 0)} projects (maximum 50).</p>
      {canEdit && <Dialog open={editing !== null || creating} onOpenChange={(open) => { if (!open) { setEditing(null); setCreating(false); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{creating ? "Create project" : "Edit project"}</DialogTitle><DialogDescription>{creating ? "New projects are saved as internal drafts. Enter known facts and source evidence; location is attributed to manual Admin input." : "Updates are version checked and audited. Public plans require verification; URL changes create a permanent redirect."}</DialogDescription></DialogHeader>
          <MediaForm className="space-y-4" onSubmit={saveEditor}>
              {saveError && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{saveError} Your form and uploaded media are retained. Review the error and try saving again.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium">Name<Input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">URL slug<Input required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Developer<Select required value={form.developerId || undefined} onValueChange={(developerId) => setForm({ ...form, developerId })}><SelectTrigger><SelectValue placeholder="Select a developer" /></SelectTrigger><SelectContent>{relations.developers.map((developer) => <SelectItem key={String(developer.id)} value={String(developer.id)}>{String(developer.name)}{developer.verificationStatus === "UNVERIFIED" ? " (unverified)" : ""}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Community<Select required value={form.communityId || undefined} onValueChange={(communityId) => setForm({ ...form, communityId })}><SelectTrigger><SelectValue placeholder="Select a community" /></SelectTrigger><SelectContent>{relations.communities.map((community) => <SelectItem key={String(community.id)} value={String(community.id)}>{String(community.name)} ({String(community.publicationStatus)})</SelectItem>)}</SelectContent></Select></label>
              <MapLocationPicker lat={form.lat} lng={form.lng} onLatitudeChange={(lat) => setForm({ ...form, lat })} onLongitudeChange={(lng) => setForm({ ...form, lng })} />
              <label className="block space-y-1.5 text-sm font-medium">Location precision<Select value={form.locationPrecision} onValueChange={(locationPrecision) => setForm({ ...form, locationPrecision })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["PROJECT", "COMMUNITY_CENTROID", "APPROXIMATE", "BUILDING", "EXACT"].map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Project type<Select value={form.projectType} onValueChange={(projectType) => setForm({ ...form, projectType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["RESIDENTIAL", "MIXED_USE", "HOSPITALITY", "COMMERCIAL"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Construction status<Select value={form.status} onValueChange={(status) => setForm({ ...form, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["OFF_PLAN", "UNDER_CONSTRUCTION", "READY", "COMPLETED", "CANCELLED", "ON_HOLD"].map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
              {!creating && <label className="block space-y-1.5 text-sm font-medium">Publication<Select value={form.publicationStatus} onValueChange={(publicationStatus) => setForm({ ...form, publicationStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["DRAFT", "PUBLISHED", "ARCHIVED"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>}
              <label className="block space-y-1.5 text-sm font-medium">Tagline<Input maxLength={300} value={form.tagline} onChange={(event) => setForm({ ...form, tagline: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Launch date<Input type="date" value={form.launchDate} onChange={(event) => setForm({ ...form, launchDate: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Handover date<Input type="date" value={form.handoverDate} onChange={(event) => setForm({ ...form, handoverDate: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Completion (%)<Input type="number" min="0" max="100" step="0.1" value={form.completionPercent} onChange={(event) => setForm({ ...form, completionPercent: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Construction status<Input maxLength={200} value={form.constructionStatus} onChange={(event) => setForm({ ...form, constructionStatus: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Total units<Input type="number" min="0" max="100000" step="1" value={form.totalUnits} onChange={(event) => setForm({ ...form, totalUnits: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Starting price<Input type="number" min="0" step="0.01" value={form.startingPrice} onChange={(event) => setForm({ ...form, startingPrice: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Currency<Input maxLength={3} pattern="[A-Za-z]{3}" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Construction source URL<Input type="url" maxLength={2048} value={form.constructionSourceUrl} onChange={(event) => setForm({ ...form, constructionSourceUrl: event.target.value })} placeholder="https://" /></label>
              <label className="block space-y-1.5 text-sm font-medium">Source checked at<Input type="datetime-local" value={form.constructionSourceVerifiedAt} onChange={(event) => setForm({ ...form, constructionSourceVerifiedAt: event.target.value })} /></label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">Summary<Textarea maxLength={2000} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Description<Textarea maxLength={10000} rows={8} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Project highlights<Textarea maxLength={9000} rows={4} value={form.highlightsText} onChange={(event) => setForm({ ...form, highlightsText: event.target.value })} placeholder="One known highlight per line" /></label>
            <label className="block space-y-1.5 text-sm font-medium">Key amenities<Textarea maxLength={3600} rows={3} value={form.keyAmenitiesText} onChange={(event) => setForm({ ...form, keyAmenitiesText: event.target.value })} placeholder="One amenity per line" /></label>
            <fieldset className="space-y-2 rounded-lg border border-border/70 p-3"><legend className="px-1 text-sm font-medium">Amenity catalogue</legend>{relations.amenities.length ? <div className="grid gap-2 sm:grid-cols-2">{relations.amenities.map((amenity) => <label key={String(amenity.id)} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.amenityIds.includes(String(amenity.id))} onChange={(event) => setForm({ ...form, amenityIds: event.target.checked ? [...form.amenityIds, String(amenity.id)] : form.amenityIds.filter((id) => id !== String(amenity.id)) })} />{String(amenity.name)}</label>)}</div> : <p className="text-xs text-muted-foreground">No amenities are available in the catalogue yet.</p>}</fieldset>
            <EntityMediaEditor project value={mediaDraft} onChange={setMediaDraft} />
            <PublicMediaPicker label="Public project brochure or image" value={form.brochureMediaId} allowedKinds={["IMAGE", "DOCUMENT"]} onChange={(brochureMediaId) => setForm({ ...form, brochureMediaId })} />
            {!creating && editing && <ProjectPaymentPlanEditor projectId={String(editing.id)} initialCount={Number(editing.paymentPlanCount ?? 0)} onChanged={load} />}
            {creating && relations.developers.length === 0 && relations.communities.length === 0 && <p className="text-sm text-muted-foreground">Create a developer and community before creating a project.</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => { setEditing(null); setCreating(false); }}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : creating ? "Create draft project" : "Save changes"}</Button></DialogFooter>
          </MediaForm>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

function CommunitiesSection({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = React.useState<{ communities: Record<string, unknown>[]; total: number; locations?: { id: string; name: string; slug: string; level: string }[] } | null>(null);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", slug: "", summary: "", description: "", areaType: "RESIDENTIAL", lat: "", lng: "", locationPrecision: "COMMUNITY_CENTROID", publicationStatus: "DRAFT", imageMediaId: "", parentLocationId: "", avgPricePerSqft: "", currency: "AED", boundaryText: "", radiusMeters: "2500", lifestyleTagsText: "", transportText: "[]", schoolsText: "[]", healthcareText: "[]", retailText: "[]", sourceType: "INTERNAL", sourceUpdatedAt: "", locationSourceType: "MANUAL_ADMIN", locationSourceId: "" });

  const load = React.useCallback(() => {
    api.get<{ communities: Record<string, unknown>[]; total: number }>(`/api/admin/communities${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then(setData)
      .catch(() => setData({ communities: [], total: 0 }));
  }, [q]);
  React.useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm({ name: "", slug: "", summary: "", description: "", areaType: "RESIDENTIAL", lat: "", lng: "", locationPrecision: "COMMUNITY_CENTROID", publicationStatus: "DRAFT", imageMediaId: "", parentLocationId: "", avgPricePerSqft: "", currency: "AED", boundaryText: "", radiusMeters: "2500", lifestyleTagsText: "", transportText: "[]", schoolsText: "[]", healthcareText: "[]", retailText: "[]", sourceType: "INTERNAL", sourceUpdatedAt: "", locationSourceType: "MANUAL_ADMIN", locationSourceId: "" });
  };

  const openEditor = (community: Record<string, unknown>) => {
    setCreating(false);
    setEditing(community);
    setForm({
      name: String(community.name ?? ""), slug: String(community.slug ?? ""),
      parentLocationId: String(community.parentLocationId ?? ""),
      avgPricePerSqft: community.avgPricePerSqftMinor == null ? "" : String(Number(community.avgPricePerSqftMinor) / 100), currency: String(community.currency ?? "AED"),
      summary: String(community.summary ?? ""), description: String(community.description ?? ""),
      areaType: String(community.areaType ?? "RESIDENTIAL"), lat: String(community.lat ?? ""), lng: String(community.lng ?? ""),
      locationPrecision: String(community.locationPrecision ?? "COMMUNITY_CENTROID"),
      publicationStatus: String(community.publicationStatus ?? "DRAFT"),
      imageMediaId: String(community.imageMediaId ?? ""),
      boundaryText: String(community.boundaryJson ?? ""), radiusMeters: String(community.radiusMeters ?? 2500),
      lifestyleTagsText: Array.isArray(community.lifestyleTags) ? (community.lifestyleTags as string[]).join("\n") : "",
      transportText: JSON.stringify(community.transport ?? [], null, 2), schoolsText: JSON.stringify(community.schools ?? [], null, 2),
      healthcareText: JSON.stringify(community.healthcare ?? [], null, 2), retailText: JSON.stringify(community.retail ?? [], null, 2),
      sourceType: String(community.sourceType ?? "INTERNAL"), sourceUpdatedAt: community.sourceUpdatedAt ? datetimeLocalValue(String(community.sourceUpdatedAt)) : "",
      locationSourceType: String(community.locationSourceType ?? "MANUAL_ADMIN"), locationSourceId: String(community.locationSourceId ?? ""),
    });
  };

  const saveEditor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing && !creating) return;
    setSaving(true);
    try {
      const parseRows = (raw: string, label: string) => {
        let parsed: unknown;
        try { parsed = JSON.parse(raw || "[]"); } catch { throw new Error(`${label} must be valid JSON array data.`); }
        if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
        return parsed;
      };
      const fields = {
        name: form.name, slug: form.slug, areaType: form.areaType,
        locationPrecision: form.locationPrecision, publicationStatus: form.publicationStatus,
        sourceType: form.sourceType, locationSourceType: form.locationSourceType,
        summary: form.summary || null, description: form.description || null,
        lat: Number(form.lat), lng: Number(form.lng), imageMediaId: form.imageMediaId || null,
        parentLocationId: form.parentLocationId || null,
        avgPricePerSqftMinor: form.avgPricePerSqft ? toMinor(form.avgPricePerSqft).toString() : null,
        currency: form.currency.toUpperCase(),
        boundaryJson: form.boundaryText || null, radiusMeters: Number(form.radiusMeters),
        lifestyleTags: form.lifestyleTagsText.split("\n").map((item) => item.trim()).filter(Boolean),
        transport: parseRows(form.transportText, "Transport"), schools: parseRows(form.schoolsText, "Schools"),
        healthcare: parseRows(form.healthcareText, "Healthcare"), retail: parseRows(form.retailText, "Retail"),
        sourceUpdatedAt: form.sourceUpdatedAt ? new Date(form.sourceUpdatedAt).toISOString() : null,
        locationSourceId: form.locationSourceId || null,
      };
      if (creating) {
        const createFields = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "publicationStatus"));
        await api.post("/api/admin/communities", createFields);
      } else if (editing) {
        const editableFields = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "locationPrecision"));
        await api.patch("/api/admin/communities", {
          communityId: editing.id, expectedUpdatedAt: editing.updatedAt, ...editableFields,
        });
      }
      toast.success(creating ? "Community created as draft" : "Community updated — public indexes will refresh");
      setEditing(null);
      setCreating(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Community update failed");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold">Communities</h1><p className="mt-1 text-sm text-muted-foreground">Maintain community profiles, locations, and publication state with redirect and dependent-project safeguards.</p></div>
        <div className="flex flex-wrap gap-2"><div className="w-64"><Input placeholder="Search communities…" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search communities" /></div>{canEdit && <Button onClick={openCreate}>Create community</Button>}</div>
      </header>
      {data === null ? <LoadingState rows={4} /> : data.communities.length === 0 ? <EmptyState title="No communities found" description="Try another community name or slug." /> : (
        <div className="overflow-x-safe rounded-xl border border-border/70">
          <table className="w-full min-w-[800px] text-sm">
            <thead><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Community</th><th className="p-3">Area type</th><th className="p-3">Avg price / sqft</th><th className="p-3">Public projects / properties</th><th className="p-3">Publication</th>{canEdit && <th className="p-3">Action</th>}</tr></thead>
            <tbody>{data.communities.map((community) => <tr key={String(community.id)} className="border-b border-border/50">
              <td className="p-3"><p className="font-medium">{String(community.name)}</p><p className="text-xs text-muted-foreground">/{String(community.slug)}</p></td>
              <td className="p-3">{String(community.areaType)}</td><td className="p-3">{community.avgPricePerSqftMinor ? formatMoney(String(community.avgPricePerSqftMinor), { currency: String(community.currency ?? "AED") }) : "—"}</td><td className="p-3">{String(community.publishedProjectCount)} / {String(community.publishedPropertyCount)}</td>
              <td className="p-3"><Badge variant="outline">{String(community.publicationStatus)}</Badge></td>
              {canEdit && <td className="p-3">{Boolean(community.canManage) && <Button size="sm" variant="outline" onClick={() => openEditor(community)}>Edit</Button>}</td>}
            </tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing {String(data?.communities.length ?? 0)} of {String(data?.total ?? 0)} communities (maximum 50).</p>
      {canEdit && <Dialog open={editing !== null || creating} onOpenChange={(open) => { if (!open) { setEditing(null); setCreating(false); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{creating ? "Create community" : "Edit community"}</DialogTitle><DialogDescription>{creating ? "New communities are saved as internal drafts. Coordinates are recorded as manually entered and are not externally verified; review the location precision before saving." : "Slug changes preserve the previous URL. A community with published projects cannot be unpublished until those projects are also taken offline."}</DialogDescription></DialogHeader>
          <MediaForm className="space-y-4" onSubmit={saveEditor}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium">Name<Input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">URL slug<Input required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Area type<Select value={form.areaType} onValueChange={(areaType) => setForm({ ...form, areaType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["RESIDENTIAL", "BUSINESS", "WATERFRONT", "ISLAND", "SUBURBAN", "INDUSTRIAL"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Parent location<Select value={form.parentLocationId || "none"} onValueChange={(parentLocationId) => setForm({ ...form, parentLocationId: parentLocationId === "none" ? "" : parentLocationId })}><SelectTrigger><SelectValue placeholder="No parent location" /></SelectTrigger><SelectContent><SelectItem value="none">No parent</SelectItem>{data?.locations?.map((location) => <SelectItem key={location.id} value={location.id}>{location.name} · {location.level}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Location precision<Select value={form.locationPrecision} onValueChange={(locationPrecision) => setForm({ ...form, locationPrecision })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["COMMUNITY_CENTROID", "APPROXIMATE", "EXACT", "UNAVAILABLE"].map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
              {!creating && <label className="block space-y-1.5 text-sm font-medium">Publication<Select value={form.publicationStatus} onValueChange={(publicationStatus) => setForm({ ...form, publicationStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["DRAFT", "PUBLISHED", "ARCHIVED", "UNPUBLISHED"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>}
              <label className="block space-y-1.5 text-sm font-medium">Radius (metres)<Input type="number" min="0" max="100000" step="1" value={form.radiusMeters} onChange={(event) => setForm({ ...form, radiusMeters: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Average price per sqft<Input type="number" min="0" step="0.01" value={form.avgPricePerSqft} onChange={(event) => setForm({ ...form, avgPricePerSqft: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Currency<Input maxLength={3} pattern="[A-Za-z]{3}" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label>
              <MapLocationPicker lat={form.lat} lng={form.lng} onLatitudeChange={(lat) => setForm({ ...form, lat })} onLongitudeChange={(lng) => setForm({ ...form, lng })} />
            </div>
            <PublicMediaPicker label="Public community cover image" value={form.imageMediaId} onChange={(imageMediaId) => setForm({ ...form, imageMediaId })} />
            <label className="block space-y-1.5 text-sm font-medium">Summary<Textarea maxLength={2000} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Description<Textarea maxLength={10000} rows={8} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Boundary GeoJSON<Textarea maxLength={200000} rows={5} value={form.boundaryText} onChange={(event) => setForm({ ...form, boundaryText: event.target.value })} placeholder='{"type":"Polygon","coordinates":[...]}' /></label>
            <label className="block space-y-1.5 text-sm font-medium">Lifestyle tags<Textarea maxLength={4000} rows={3} value={form.lifestyleTagsText} onChange={(event) => setForm({ ...form, lifestyleTagsText: event.target.value })} placeholder="One known tag per line" /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium">Transport JSON array<Textarea maxLength={20000} rows={4} value={form.transportText} onChange={(event) => setForm({ ...form, transportText: event.target.value })} placeholder='[{"name":"...","type":"...","distance":"..."}]' /></label>
              <label className="block space-y-1.5 text-sm font-medium">Schools JSON array<Textarea maxLength={20000} rows={4} value={form.schoolsText} onChange={(event) => setForm({ ...form, schoolsText: event.target.value })} placeholder='[{"name":"..."}]' /></label>
              <label className="block space-y-1.5 text-sm font-medium">Healthcare JSON array<Textarea maxLength={20000} rows={4} value={form.healthcareText} onChange={(event) => setForm({ ...form, healthcareText: event.target.value })} placeholder='[{"name":"..."}]' /></label>
              <label className="block space-y-1.5 text-sm font-medium">Retail JSON array<Textarea maxLength={20000} rows={4} value={form.retailText} onChange={(event) => setForm({ ...form, retailText: event.target.value })} placeholder='[{"name":"..."}]' /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium">Source type<Input maxLength={60} value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Source last updated<Input type="datetime-local" value={form.sourceUpdatedAt} onChange={(event) => setForm({ ...form, sourceUpdatedAt: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Location source type<Input maxLength={80} value={form.locationSourceType} onChange={(event) => setForm({ ...form, locationSourceType: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Location source ID or URL<Input maxLength={2048} value={form.locationSourceId} onChange={(event) => setForm({ ...form, locationSourceId: event.target.value })} /></label>
            </div>
            <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">To publish: add a summary, description and public cover; set valid coordinates and a usable location precision. Do not publish unverified amenity claims. Source: {form.sourceType}{editing?.sourceUpdatedAt ? ` · updated ${formatDate(String(editing.sourceUpdatedAt))}` : " · freshness date not supplied"}</p>
            <DialogFooter><Button type="button" variant="outline" onClick={() => { setEditing(null); setCreating(false); }}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : creating ? "Create draft community" : "Save changes"}</Button></DialogFooter>
          </MediaForm>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

function DevelopersSection({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = React.useState<{ developers: Record<string, unknown>[]; total: number } | null>(null);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", slug: "", summary: "", description: "", websiteUrl: "", headquarters: "", foundedYear: "", logoMediaId: "", verificationStatus: "UNVERIFIED", verificationEvidenceUrl: "", sourceType: "INTERNAL", sourceUpdatedAt: "" });

  const load = React.useCallback(() => {
    api.get<{ developers: Record<string, unknown>[]; total: number }>(`/api/admin/developers${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then(setData)
      .catch(() => setData({ developers: [], total: 0 }));
  }, [q]);
  React.useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm({ name: "", slug: "", summary: "", description: "", websiteUrl: "", headquarters: "", foundedYear: "", logoMediaId: "", verificationStatus: "UNVERIFIED", verificationEvidenceUrl: "", sourceType: "INTERNAL", sourceUpdatedAt: "" });
  };

  const openEditor = (developer: Record<string, unknown>) => {
    setCreating(false);
    setEditing(developer);
    setForm({
      name: String(developer.name ?? ""), slug: String(developer.slug ?? ""),
      summary: String(developer.summary ?? ""), description: String(developer.description ?? ""),
      websiteUrl: String(developer.websiteUrl ?? ""), headquarters: String(developer.headquarters ?? ""),
      foundedYear: developer.foundedYear == null ? "" : String(developer.foundedYear),
      logoMediaId: String(developer.logoMediaId ?? ""),
      verificationStatus: String(developer.verificationStatus ?? "UNVERIFIED"),
      verificationEvidenceUrl: String(developer.verificationEvidenceUrl ?? ""),
      sourceType: String(developer.sourceType ?? "INTERNAL"),
      sourceUpdatedAt: developer.sourceUpdatedAt ? datetimeLocalValue(String(developer.sourceUpdatedAt)) : "",
    });
  };

  const saveEditor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing && !creating) return;
    setSaving(true);
    try {
      const fields = {
        ...form,
        summary: form.summary || null, description: form.description || null,
        websiteUrl: form.websiteUrl || null, headquarters: form.headquarters || null,
        foundedYear: form.foundedYear ? Number(form.foundedYear) : null,
        logoMediaId: form.logoMediaId || null,
        sourceUpdatedAt: form.sourceUpdatedAt ? new Date(form.sourceUpdatedAt).toISOString() : null,
        verificationEvidenceUrl: form.verificationEvidenceUrl || null,
      };
      if (creating) {
        const createFields = Object.fromEntries(Object.entries(fields).filter(([key]) => !["verificationStatus", "verificationEvidenceUrl"].includes(key)));
        await api.post("/api/admin/developers", createFields);
      }
      else if (editing) await api.patch("/api/admin/developers", { developerId: editing.id, expectedUpdatedAt: editing.updatedAt, ...fields });
      toast.success(creating ? "Developer created as unverified" : "Developer profile updated");
      setEditing(null);
      setCreating(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Developer update failed");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold">Developers</h1><p className="mt-1 text-sm text-muted-foreground">Manage directory facts and record source-backed verification. Verified statuses require evidence and an audit timestamp.</p></div>
        <div className="flex flex-wrap gap-2"><div className="w-64"><Input placeholder="Search developers…" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search developers" /></div>{canEdit && <Button onClick={openCreate}>Create developer</Button>}</div>
      </header>
      {data === null ? <LoadingState rows={4} /> : data.developers.length === 0 ? <EmptyState title="No developers found" description="Try another name or slug." /> : (
        <div className="overflow-x-safe rounded-xl border border-border/70">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Developer</th><th className="p-3">Headquarters</th><th className="p-3">Founded</th><th className="p-3">Published projects</th><th className="p-3">Published properties</th><th className="p-3">Recorded verification</th>{canEdit && <th className="p-3">Action</th>}</tr></thead>
            <tbody>{data.developers.map((developer) => <tr key={String(developer.id)} className="border-b border-border/50">
              <td className="p-3"><p className="font-medium">{String(developer.name)}</p><p className="text-xs text-muted-foreground">/{String(developer.slug)}</p></td>
              <td className="p-3 text-muted-foreground">{String(developer.headquarters || "—")}</td>
              <td className="p-3">{String(developer.foundedYear ?? "—")}</td>
              <td className="p-3">{String(developer.publishedProjectCount)}</td>
              <td className="p-3">{String(developer.publishedPropertyCount)}</td>
              <td className="p-3"><div><StatusBadge status={String(developer.verificationStatus)} />{Boolean(developer.lastVerifiedAt) && <p className="mt-1 text-xs text-muted-foreground">{formatDate(String(developer.lastVerifiedAt))}</p>}{Boolean(developer.verificationEvidenceUrl) && <a className="mt-1 block text-xs underline" href={String(developer.verificationEvidenceUrl)} target="_blank" rel="noopener noreferrer">Evidence</a>}</div></td>
              {canEdit && <td className="p-3">{Boolean(developer.canManage) && <Button size="sm" variant="outline" onClick={() => openEditor(developer)}>Edit</Button>}</td>}
            </tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing {String(data?.developers.length ?? 0)} of {String(data?.total ?? 0)} developers (maximum 50).</p>
      {canEdit && <Dialog open={editing !== null || creating} onOpenChange={(open) => { if (!open) { setEditing(null); setCreating(false); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{creating ? "Create developer" : "Edit developer"}</DialogTitle><DialogDescription>{creating ? "New records start UNVERIFIED and stay out of public developer results until linked to a published project. Enter only known facts." : "Updates are version checked and audited. A verification claim must have an HTTP or HTTPS source."}</DialogDescription></DialogHeader>
          <MediaForm className="space-y-4" onSubmit={saveEditor}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium">Name<Input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">URL slug<Input required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Website URL<Input type="url" placeholder="https://example.com" maxLength={2048} value={form.websiteUrl} onChange={(event) => setForm({ ...form, websiteUrl: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Headquarters<Input maxLength={200} value={form.headquarters} onChange={(event) => setForm({ ...form, headquarters: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Founded year<Input type="number" min="1000" max={new Date().getFullYear()} step="1" value={form.foundedYear} onChange={(event) => setForm({ ...form, foundedYear: event.target.value })} /></label>
            </div>
            <PublicMediaPicker label="Public developer logo" value={form.logoMediaId} onChange={(logoMediaId) => setForm({ ...form, logoMediaId })} />
            <label className="block space-y-1.5 text-sm font-medium">Summary<Textarea maxLength={2000} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Description<Textarea maxLength={10000} rows={8} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium">Source type<Input maxLength={60} value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Source last updated<Input type="datetime-local" value={form.sourceUpdatedAt} onChange={(event) => setForm({ ...form, sourceUpdatedAt: event.target.value })} /></label>
              {!creating && <label className="block space-y-1.5 text-sm font-medium">Verification status<Select value={form.verificationStatus} onValueChange={(verificationStatus) => setForm({ ...form, verificationStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["UNVERIFIED", "PUBLIC_RECORDS", "VERIFIED"].map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>}
              {!creating && <label className="block space-y-1.5 text-sm font-medium">Verification evidence URL<Input type="url" maxLength={2048} value={form.verificationEvidenceUrl} onChange={(event) => setForm({ ...form, verificationEvidenceUrl: event.target.value })} placeholder="https://official-source.example" /></label>}
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => { setEditing(null); setCreating(false); }}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : creating ? "Create unverified developer" : "Save changes"}</Button></DialogFooter>
          </MediaForm>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

function AgentsSection({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = React.useState<{ agents: Record<string, unknown>[]; total: number; communities?: { id: string; name: string; slug: string }[] } | null>(null);
  const [linkableUsers, setLinkableUsers] = React.useState<{ id: string; name: string | null; email: string }[]>([]);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [selectedUserId, setSelectedUserId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", slug: "", jobTitle: "", bio: "", department: "other", yearsExperience: "0", active: false, publicAdvisor: false, photoMediaId: "", email: "", phoneE164: "", whatsappE164: "", languagesText: "", specialties: [] as string[], communityIds: [] as string[] });

  const load = React.useCallback(() => {
    api.get<{ agents: Record<string, unknown>[]; total: number; communities?: { id: string; name: string; slug: string }[]; linkableUsers?: { id: string; name: string | null; email: string }[] }>(`/api/admin/agents${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then((result) => { setData(result); setLinkableUsers(result.linkableUsers ?? []); })
      .catch(() => { setData({ agents: [], total: 0, communities: [] }); setLinkableUsers([]); });
  }, [q]);
  React.useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setSelectedUserId(linkableUsers[0]?.id ?? "");
    setForm({ name: "", slug: "", jobTitle: "", bio: "", department: "other", yearsExperience: "0", active: false, publicAdvisor: false, photoMediaId: "", email: "", phoneE164: "", whatsappE164: "", languagesText: "", specialties: [], communityIds: [] });
    setCreating(true);
  };

  const openEditor = (agent: Record<string, unknown>) => {
    setEditing(agent);
    setForm({
      name: String(agent.name ?? ""), slug: String(agent.slug ?? ""), jobTitle: String(agent.jobTitle ?? ""),
      bio: String(agent.bio ?? ""), department: String(agent.department ?? "other"),
      yearsExperience: String(agent.yearsExperience ?? 0), active: Boolean(agent.active), publicAdvisor: Boolean(agent.publicAdvisor),
      photoMediaId: String(agent.photoMediaId ?? ""),
      email: String(agent.email ?? ""), phoneE164: String(agent.phoneE164 ?? ""), whatsappE164: String(agent.whatsappE164 ?? ""),
      languagesText: Array.isArray(agent.languages) ? (agent.languages as { code: string; name: string; fluency: string }[]).map((language) => `${language.code}|${language.name}|${language.fluency}`).join("\n") : "",
      specialties: Array.isArray(agent.specialties) ? (agent.specialties as string[]) : [],
      communityIds: Array.isArray(agent.communities) ? (agent.communities as { id: string }[]).map((community) => String(community.id)) : [],
    });
  };

  const saveEditor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing && !creating) return;
    setSaving(true);
    try {
      const values = {
        ...form,
        yearsExperience: Number(form.yearsExperience), department: form.department || null, photoMediaId: form.photoMediaId || null,
        email: form.email || null, phoneE164: form.phoneE164 || null, whatsappE164: form.whatsappE164 || null,
        languages: form.languagesText.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
          const [code, name, fluency = "FLUENT"] = line.split("|").map((item) => item.trim());
          if (!code || !name) throw new Error("Enter languages as code|name|fluency, one per line.");
          return { code, name, fluency };
        }),
      };
      if (creating) {
        await api.post("/api/admin/agents", {
          userId: selectedUserId, name: values.name, slug: values.slug, jobTitle: values.jobTitle,
          bio: values.bio, department: values.department, yearsExperience: values.yearsExperience, photoMediaId: values.photoMediaId,
          email: values.email, phoneE164: values.phoneE164, whatsappE164: values.whatsappE164,
          languages: values.languages, specialties: values.specialties, communityIds: values.communityIds,
        });
        toast.success("Inactive team profile created; review it before making it public");
      } else if (editing) {
        const { languagesText: _languagesText, ...patchValues } = values;
        await api.patch("/api/admin/agents", { agentId: editing.id, expectedUpdatedAt: editing.updatedAt, ...patchValues });
        toast.success("Team profile updated; public directory and sitemap will refresh");
      }
      setEditing(null);
      setCreating(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Team profile update failed");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold">Team profiles</h1><p className="mt-1 text-sm text-muted-foreground">Invite a person as AGENT, wait for account activation and email verification, then create their private profile. Public advisors require a verified linked account, bio, and active status.</p></div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto"><div className="w-full sm:w-64"><Input placeholder="Search team profiles…" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search team profiles" /></div>{canEdit && <><Link className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm" to="/admin/users" query={{ inviteRole: "AGENT" }}>Invite AGENT</Link><Button onClick={openCreate}>New team profile</Button></>}</div>
      </header>
      {data === null ? <LoadingState rows={4} /> : data.agents.length === 0 ? <EmptyState title="No team profiles found" description="No profiles are visible in this account’s permitted scope." /> : (
        <div className="overflow-x-safe rounded-xl border border-border/70">
          <table className="w-full min-w-[800px] text-sm">
            <thead><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Team member</th><th className="p-3">Department</th><th className="p-3">Experience</th><th className="p-3">Account status</th><th className="p-3">Public advisor</th>{canEdit && <th className="p-3">Action</th>}</tr></thead>
            <tbody>{data.agents.map((agent) => <tr key={String(agent.id)} className="border-b border-border/50">
              <td className="p-3"><p className="font-medium">{String(agent.name)}</p><p className="text-xs text-muted-foreground">{String(agent.jobTitle)} · /{String(agent.slug)}</p><p className="text-xs text-muted-foreground">{String(agent.linkedAccountEmail ?? "No linked account")}{agent.linkedAccountVerified ? " · verified" : " · not verified"}</p></td>
              <td className="p-3">{String(agent.department ?? "—")}</td><td className="p-3">{String(agent.yearsExperience)} years</td>
              <td className="p-3"><Badge variant={agent.active ? "default" : "outline"}>{agent.active ? "Active" : "Inactive"}</Badge></td>
              <td className="p-3">{agent.publicAdvisor ? "Public" : "Internal"}</td>
              {canEdit && <td className="p-3"><Button size="sm" variant="outline" onClick={() => openEditor(agent)}>Edit</Button></td>}
            </tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing {String(data?.agents.length ?? 0)} of {String(data?.total ?? 0)} visible profiles (maximum 50).</p>
      {canEdit && <Dialog open={editing !== null || creating} onOpenChange={(open) => { if (!open) { setEditing(null); setCreating(false); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{creating ? "Create advisor profile" : "Edit advisor profile"}</DialogTitle><DialogDescription>{creating ? "Link an active, email-verified AGENT account. New profiles start inactive and private; no account, role, or real profile facts are invented." : "Changes are audited and scoped by linked account organization. Related projects below are derived from assigned listings."}</DialogDescription></DialogHeader>
          <MediaForm className="space-y-4" onSubmit={saveEditor}>
            {creating && <label className="block space-y-1.5 text-sm font-medium">Active, verified AGENT account<Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={linkableUsers.length === 0}><SelectTrigger><SelectValue placeholder="Choose an account" /></SelectTrigger><SelectContent>{linkableUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name ? `${user.name} — ${user.email}` : user.email}</SelectItem>)}</SelectContent></Select>{linkableUsers.length === 0 && <span className="text-xs text-muted-foreground">No eligible account is available. <Link className="underline" to="/admin/users">Open Users &amp; Access to invite an AGENT account</Link>. The invitee must accept and verify their email first.</span>}</label>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium">Name<Input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">URL slug<Input required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Job title<Input required maxLength={120} value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Department<Select value={form.department} onValueChange={(department) => setForm({ ...form, department })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["leadership", "sales", "marketing", "hr", "admin", "other"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
              <label className="block space-y-1.5 text-sm font-medium">Years’ experience<Input type="number" min="0" max="80" step="1" value={form.yearsExperience} onChange={(event) => setForm({ ...form, yearsExperience: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Public contact email<Input type="email" maxLength={200} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">Phone (E.164)<Input type="tel" placeholder="+971501234567" maxLength={16} value={form.phoneE164} onChange={(event) => setForm({ ...form, phoneE164: event.target.value })} /></label>
              <label className="block space-y-1.5 text-sm font-medium">WhatsApp (E.164)<Input type="tel" placeholder="+971501234567" maxLength={16} value={form.whatsappE164} onChange={(event) => setForm({ ...form, whatsappE164: event.target.value })} /></label>
            </div>
            <PublicMediaPicker label="Public team profile photo" value={form.photoMediaId} onChange={(photoMediaId) => setForm({ ...form, photoMediaId })} />
            <label className="block space-y-1.5 text-sm font-medium">Profile bio<Textarea maxLength={5000} rows={7} value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Languages<Textarea maxLength={5000} rows={3} value={form.languagesText} onChange={(event) => setForm({ ...form, languagesText: event.target.value })} placeholder="en|English|NATIVE\nar|Arabic|FLUENT" /><span className="text-xs font-normal text-muted-foreground">Format: ISO code|language name|BASIC, CONVERSATIONAL, FLUENT, or NATIVE. One language per line.</span></label>
            <fieldset className="space-y-2 rounded-lg border border-border/70 p-3"><legend className="px-1 text-sm font-medium">Specialties</legend><div className="grid gap-2 sm:grid-cols-2">{["OFF_PLAN", "LUXURY", "INVESTMENT", "SECONDARY", "COMMERCIAL", "RELOCATION", "RESIDENTIAL", "RENTALS", "PROPERTY_MANAGEMENT"].map((specialty) => <label key={specialty} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.specialties.includes(specialty)} onChange={(event) => setForm({ ...form, specialties: event.target.checked ? [...form.specialties, specialty] : form.specialties.filter((item) => item !== specialty) })} />{specialty.replaceAll("_", " ")}</label>)}</div></fieldset>
            <fieldset className="space-y-2 rounded-lg border border-border/70 p-3"><legend className="px-1 text-sm font-medium">Communities served</legend><div className="grid gap-2 sm:grid-cols-2">{(data?.communities ?? []).map((community) => <label key={community.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.communityIds.includes(community.id)} onChange={(event) => setForm({ ...form, communityIds: event.target.checked ? [...form.communityIds, community.id] : form.communityIds.filter((id) => id !== community.id) })} />{community.name}</label>)}{(data?.communities ?? []).length === 0 && <p className="text-xs text-muted-foreground">No manageable communities are available.</p>}</div></fieldset>
            {!creating && Array.isArray(editing?.assignedProjects) && <section className="space-y-1 rounded-lg border border-border/70 p-3"><h3 className="text-sm font-semibold">Projects linked through assigned listings</h3>{(editing.assignedProjects as { id: string; name: string; slug: string }[]).length ? (editing.assignedProjects as { id: string; name: string; slug: string }[]).map((project) => <p key={project.id} className="text-xs">{project.name} · /projects/{project.slug}</p>) : <p className="text-xs text-muted-foreground">No assigned listing currently links this advisor to a project.</p>}</section>}
            {!creating && <div className="space-y-3 rounded-lg border border-border/70 p-3">
              <label className="flex items-center justify-between gap-4 text-sm"><span><span className="block font-medium">Active team profile</span><span className="text-xs text-muted-foreground">Inactive profiles are excluded from public advisor listings.</span></span><Switch checked={form.active} onCheckedChange={(active) => setForm({ ...form, active, publicAdvisor: active ? form.publicAdvisor : false })} /></label>
              <label className="flex items-center justify-between gap-4 text-sm"><span><span className="block font-medium">Public advisor directory</span><span className="text-xs text-muted-foreground">A bio and active status are required.</span></span><Switch checked={form.publicAdvisor} disabled={!form.active} onCheckedChange={(publicAdvisor) => setForm({ ...form, publicAdvisor })} /></label>
            </div>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => { setEditing(null); setCreating(false); }}>Cancel</Button><Button type="submit" disabled={saving || (creating && !selectedUserId)}>{saving ? "Saving…" : creating ? "Create inactive profile" : "Save changes"}</Button></DialogFooter>
          </MediaForm>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

function ContentSection({ canEdit, canReview }: { canEdit: boolean; canReview: boolean }) {
  const [entries, setEntries] = React.useState<Record<string, unknown>[] | null>(null);
  const [mediaAssets, setMediaAssets] = React.useState<Record<string, unknown>[]>([]);
  const [q, setQ] = React.useState("");
  const [localeFilter, setLocaleFilter] = React.useState("all");
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyEntry, setHistoryEntry] = React.useState<Record<string, unknown> | null>(null);
  const [revisions, setRevisions] = React.useState<Record<string, unknown>[]>([]);
  const [selectedRevision, setSelectedRevision] = React.useState<Record<string, unknown> | null>(null);
  const [reviewEntry, setReviewEntry] = React.useState<Record<string, unknown> | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewNote, setReviewNote] = React.useState("");
  const [reviewSaving, setReviewSaving] = React.useState(false);
  const [retireEntry, setRetireEntry] = React.useState<Record<string, unknown> | null>(null);
  const [retireSaving, setRetireSaving] = React.useState(false);
  const [translationEntry, setTranslationEntry] = React.useState<Record<string, unknown> | null>(null);
  const [translationCandidates, setTranslationCandidates] = React.useState<Record<string, unknown>[] | null>(null);
  const [translationCandidateId, setTranslationCandidateId] = React.useState("");
  const [translationSaving, setTranslationSaving] = React.useState(false);
  const [form, setForm] = React.useState({ contentType: "GUIDE", locale: "en", slug: "", title: "", excerpt: "", category: "", body: "", bodyMode: "MARKDOWN" as "MARKDOWN" | "BLOCKS", blocks: [] as ContentBlock[], coverMediaId: "", sourceName: "", sourceUrl: "", sourceVerifiedAt: "", freshnessReviewDueAt: "", submitForReview: false });
  const pristine = React.useRef(JSON.stringify({ contentType: "GUIDE", locale: "en", slug: "", title: "", excerpt: "", category: "", body: "", bodyMode: "MARKDOWN", blocks: [], coverMediaId: "", sourceName: "", sourceUrl: "", sourceVerifiedAt: "", freshnessReviewDueAt: "", submitForReview: false }));
  const dirty = (creating || editing !== null) && JSON.stringify(form) !== pristine.current;
  useUnsavedChanges(dirty);

  const load = React.useCallback(() => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (localeFilter !== "all") query.set("locale", localeFilter);
    const serialized = query.toString();
    api.get<{ entries: Record<string, unknown>[] }>(`/api/admin/content${serialized ? `?${serialized}` : ""}`)
      .then((result) => setEntries(result.entries))
      .catch(() => setEntries([]));
  }, [q, localeFilter]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if (!canEdit) return;
    api.get<{ media: Record<string, unknown>[] }>("/api/media?take=100")
      .then((result) => setMediaAssets(result.media.filter((asset) => asset.kind === "IMAGE" && asset.isPrivate === false)))
      .catch(() => setMediaAssets([]));
  }, [canEdit]);

  const openCreate = () => {
    const blank = { contentType: "GUIDE", locale: "en", slug: "", title: "", excerpt: "", category: "", body: "", bodyMode: "MARKDOWN" as const, blocks: [] as ContentBlock[], coverMediaId: "", sourceName: "", sourceUrl: "", sourceVerifiedAt: "", freshnessReviewDueAt: "", submitForReview: false };
    setEditing(null);
    setCreating(true);
    setPreview(false);
    pristine.current = JSON.stringify(blank);
    setForm(blank);
  };
  const openEditor = (entry: Record<string, unknown>) => {
    setEditing(entry);
    setCreating(false);
    setPreview(false);
    const blocks = parseContentBlocks(entry.blocks) ?? [];
    const nextForm = {
      contentType: String(entry.contentType ?? "GUIDE"), locale: String(entry.locale ?? "en"),
      slug: String(entry.slug ?? ""), title: String(entry.title ?? ""), excerpt: String(entry.excerpt ?? ""),
      category: String(entry.category ?? ""), body: String(entry.body ?? ""), bodyMode: blocks.length ? "BLOCKS" as const : "MARKDOWN" as const, blocks, submitForReview: false,
      coverMediaId: String(entry.coverMediaId ?? ""),
      sourceName: String(entry.sourceName ?? ""), sourceUrl: String(entry.sourceUrl ?? ""),
      sourceVerifiedAt: typeof entry.sourceVerifiedAt === "string" ? String(entry.sourceVerifiedAt).slice(0, 10) : "",
      freshnessReviewDueAt: typeof entry.freshnessReviewDueAt === "string" ? String(entry.freshnessReviewDueAt).slice(0, 10) : "",
    };
    pristine.current = JSON.stringify(nextForm);
    setForm(nextForm);
  };

  const addBlock = (type: ContentBlock["type"]) => {
    const block: ContentBlock = type === "paragraph" ? { type, text: "" }
      : type === "heading" ? { type, level: 2, text: "" }
      : type === "quote" ? { type, text: "" }
      : type === "list" ? { type, ordered: false, items: [""] }
      : type === "link" ? { type, label: "", href: "https://" }
      : type === "image" ? { type, mediaId: "", altText: "" }
      : type === "entity" ? { type, entity: "property", slug: "", label: "" }
      : { type, id: "property-search" };
    setForm((current) => ({ ...current, bodyMode: "BLOCKS", blocks: [...current.blocks, block] }));
  };

  const updateBlock = (index: number, patch: Partial<ContentBlock>) => {
    setForm((current) => ({ ...current, blocks: current.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } as ContentBlock : block) }));
  };

  const moveBlock = (index: number, delta: -1 | 1) => {
    setForm((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.blocks.length) return current;
      const blocks = [...current.blocks];
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return { ...current, blocks };
    });
  };

  const removeBlock = (index: number) => setForm((current) => ({ ...current, blocks: current.blocks.filter((_, blockIndex) => blockIndex !== index) }));

  const openHistory = async (entry: Record<string, unknown>) => {
    try {
      const result = await api.get<{ revisions: Record<string, unknown>[] }>(`/api/admin/content/${entry.id}/revisions`);
      setRevisions(result.revisions);
      setSelectedRevision(result.revisions[0] ?? null);
      setHistoryEntry(entry);
      setHistoryOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load revision history");
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (creating) {
        await api.post("/api/admin/content", {
          contentType: form.contentType, locale: form.locale, slug: form.slug, title: form.title,
          excerpt: form.excerpt || null, category: form.category || null, body: form.bodyMode === "MARKDOWN" ? form.body : "",
          blocks: form.bodyMode === "BLOCKS" ? form.blocks : null,
          coverMediaId: form.coverMediaId || null,
          ...(form.contentType === "INTERNATIONAL_GUIDE" ? { sourceName: form.sourceName || null, sourceUrl: form.sourceUrl || null,
            sourceVerifiedAt: form.sourceVerifiedAt ? new Date(`${form.sourceVerifiedAt}T00:00:00.000Z`).toISOString() : null,
            freshnessReviewDueAt: form.freshnessReviewDueAt ? new Date(`${form.freshnessReviewDueAt}T23:59:59.999Z`).toISOString() : null } : {}),
        });
        toast.success("Draft created with revision 1");
      } else if (editing) {
        const result = await api.patch<{ status: string }>("/api/admin/content", {
          contentEntryId: editing.id, expectedUpdatedAt: editing.updatedAt,
          slug: form.slug, title: form.title, excerpt: form.excerpt || null,
          category: form.category || null, body: form.bodyMode === "MARKDOWN" ? form.body : "",
          blocks: form.bodyMode === "BLOCKS" ? form.blocks : null, coverMediaId: form.coverMediaId || null, submitForReview: form.submitForReview,
          ...(form.contentType === "INTERNATIONAL_GUIDE" ? { sourceName: form.sourceName || null, sourceUrl: form.sourceUrl || null,
            sourceVerifiedAt: form.sourceVerifiedAt ? new Date(`${form.sourceVerifiedAt}T00:00:00.000Z`).toISOString() : null,
            freshnessReviewDueAt: form.freshnessReviewDueAt ? new Date(`${form.freshnessReviewDueAt}T23:59:59.999Z`).toISOString() : null } : {}),
        });
        toast.success(result.status === "IN_REVIEW" ? "Saved and queued for editorial review" : "Draft saved with a new revision");
      }
      setCreating(false);
      setEditing(null);
      pristine.current = JSON.stringify(form);
      setPreview(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Content save failed");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setSaving(false);
    }
  };

  const rollback = async () => {
    if (!historyEntry || !selectedRevision) return;
    setSaving(true);
    try {
      await api.post(`/api/admin/content/${historyEntry.id}/revisions`, {
        revisionId: selectedRevision.id, expectedUpdatedAt: historyEntry.updatedAt,
      });
      toast.success("Revision restored as a new draft revision");
      setHistoryOpen(false);
      setHistoryEntry(null);
      setSelectedRevision(null);
      setEditing(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revision restore failed");
    } finally {
      setSaving(false);
    }
  };

  const changeRetirement = async (retire: boolean) => {
    if (!retireEntry) return;
    setRetireSaving(true);
    try {
      await api.post("/api/admin/content/retire", {
        contentEntryId: retireEntry.id,
        expectedUpdatedAt: retireEntry.updatedAt,
        retire,
      });
      toast.success(retire ? "Content retired from public use; its history is preserved" : "Content restored as a draft");
      setRetireEntry(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change content archive state");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setRetireSaving(false);
    }
  };

  const openReview = (entry: Record<string, unknown>) => {
    setReviewEntry(entry);
    setReviewNote("");
    setReviewOpen(true);
  };

  const decideReview = async (decision: "APPROVE" | "CHANGES_REQUESTED" | "PUBLISH") => {
    if (!reviewEntry) return;
    setReviewSaving(true);
    try {
      await api.post("/api/admin/content/review", {
        contentEntryId: reviewEntry.id, expectedUpdatedAt: reviewEntry.updatedAt, decision, note: reviewNote,
      });
      toast.success(decision === "APPROVE" ? "Revision approved; publication is a separate action" : decision === "PUBLISH" ? "Approved content published" : "Changes requested; entry returned to draft");
      setReviewOpen(false);
      setReviewEntry(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Review action failed");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setReviewSaving(false);
    }
  };

  const openTranslations = async (entry: Record<string, unknown>) => {
    setTranslationEntry(entry);
    setTranslationCandidateId("");
    setTranslationCandidates(null);
    if (!entry.translationPeer) {
      try {
        const result = await api.get<{ candidates: Record<string, unknown>[] }>(`/api/admin/content/translations?contentEntryId=${encodeURIComponent(String(entry.id))}`);
        setTranslationCandidates(result.candidates);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load translation candidates");
        setTranslationEntry(null);
        return;
      }
    }
  };

  const saveTranslationPair = async () => {
    if (!translationEntry) return;
    const candidate = translationCandidates?.find((item) => item.id === translationCandidateId);
    if (!candidate) return;
    const english = translationEntry.locale === "en" ? translationEntry : candidate;
    const arabic = translationEntry.locale === "ar" ? translationEntry : candidate;
    setTranslationSaving(true);
    try {
      await api.post("/api/admin/content/translations", {
        englishContentEntryId: english.id, englishExpectedUpdatedAt: english.updatedAt,
        arabicContentEntryId: arabic.id, arabicExpectedUpdatedAt: arabic.updatedAt,
      });
      toast.success("English and Arabic entries linked; their copy remains independently editable");
      setTranslationEntry(null);
      setTranslationCandidates(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not link translations");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setTranslationSaving(false);
    }
  };

  const removeTranslationPair = async () => {
    if (!translationEntry || !translationEntry.translationPeer) return;
    const peer = translationEntry.translationPeer as Record<string, unknown>;
    setTranslationSaving(true);
    try {
      await api.delete("/api/admin/content/translations", {
        contentEntryId: translationEntry.id, expectedUpdatedAt: translationEntry.updatedAt,
        peerExpectedUpdatedAt: peer.updatedAt,
      });
      toast.success("Translation links removed; neither content entry was changed");
      setTranslationEntry(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unlink translations");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setTranslationSaving(false);
    }
  };

  const currentByField: Record<string, string> = historyEntry ? {
    title: String(historyEntry.title ?? ""), slug: String(historyEntry.slug ?? ""), excerpt: String(historyEntry.excerpt ?? ""),
    category: String(historyEntry.category ?? ""), body: String(historyEntry.body ?? ""), bodyJson: historyEntry.blocks ? JSON.stringify(historyEntry.blocks, null, 2) : "", coverMediaId: String(historyEntry.coverMediaId ?? ""),
  } : { title: form.title, slug: form.slug, excerpt: form.excerpt, category: form.category, body: form.body, bodyJson: form.bodyMode === "BLOCKS" ? JSON.stringify(form.blocks, null, 2) : "", coverMediaId: form.coverMediaId };
  const selectedCover = mediaAssets.find((asset) => asset.id === form.coverMediaId);
  const previousSnapshot = selectedRevision?.snapshot && typeof selectedRevision.snapshot === "object" ? selectedRevision.snapshot as Record<string, unknown> : null;
  const translationPeer = translationEntry?.translationPeer && typeof translationEntry.translationPeer === "object"
    ? translationEntry.translationPeer as Record<string, unknown>
    : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold">Editorial content</h1><p className="mt-1 text-sm text-muted-foreground">English and Arabic drafts use revision snapshots. Markdown preview does not enable raw HTML.</p></div>
        <div className="flex flex-wrap gap-2"><div className="w-60"><Input placeholder="Search title or slug…" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search content" /></div><Select value={localeFilter} onValueChange={setLocaleFilter}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All locales</SelectItem><SelectItem value="en">English</SelectItem><SelectItem value="ar">Arabic</SelectItem></SelectContent></Select></div>
      </header>
      {canEdit && <Button onClick={openCreate}>Create draft</Button>}
      {entries === null ? <LoadingState rows={4} /> : entries.length === 0 ? <EmptyState title="No content entries found" description="Change the search or create a draft." /> : (
        <div className="overflow-x-safe rounded-xl border border-border/70">
          <table className="w-full min-w-[920px] text-sm">
            <thead><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Title</th><th className="p-3">Type / locale</th><th className="p-3">Translation</th><th className="p-3">Publication</th><th className="p-3">Source record</th><th className="p-3">Revisions</th>{canEdit && <th className="p-3">Actions</th>}</tr></thead>
            <tbody>{entries.map((entry) => <tr key={String(entry.id)} className="border-b border-border/50">
              <td className="p-3"><p className="font-medium">{String(entry.title)}</p><p className="text-xs text-muted-foreground">{String(entry.contentType) === "PAGE" ? "/pages/" : String(entry.contentType) === "INTERNATIONAL_GUIDE" ? "/international/" : String(entry.contentType) === "ARTICLE" ? "/insights/" : "/guides/"}{String(entry.slug)}</p></td>
              <td className="p-3">{String(entry.contentType)} · {String(entry.locale).toUpperCase()}</td>
              <td className="p-3 text-xs">{entry.translationPeer && typeof entry.translationPeer === "object" ? <><Badge variant="outline">Linked {String((entry.translationPeer as Record<string, unknown>).locale).toUpperCase()}</Badge><span className="mt-1 block text-muted-foreground">{String((entry.translationPeer as Record<string, unknown>).title)}</span></> : <span className="text-muted-foreground">Not linked</span>}</td>
              <td className="p-3"><div className="flex flex-col items-start gap-1"><Badge variant="outline">{String(entry.status)}</Badge>{entry.reviewWorkflowState !== "NONE" && <span className="text-xs text-muted-foreground">{String(entry.reviewWorkflowState)}</span>}</div></td>
              <td className="p-3 text-xs text-muted-foreground">{String(entry.sourceName ?? "No source recorded")}{Boolean(entry.sourceVerifiedAt) && <span className="block">Verified {formatDate(String(entry.sourceVerifiedAt))}</span>}{Boolean(entry.freshnessReviewDueAt) && <span className="block">Review due {formatDate(String(entry.freshnessReviewDueAt))}</span>}</td>
              <td className="p-3">{String(entry.revisionCount)}</td>
              {(canEdit || canReview) && <td className="p-3"><div className="flex gap-1.5">{canEdit && <><Button size="sm" variant="outline" onClick={() => openEditor(entry)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => openHistory(entry)}>History</Button><Button size="sm" variant="ghost" onClick={() => openTranslations(entry)}>Translations</Button>{entry.status === "RETIRED" ? <Button size="sm" variant="outline" onClick={() => setRetireEntry(entry)}>Restore</Button> : <Button size="sm" variant="ghost" onClick={() => setRetireEntry(entry)}>Retire</Button>}</>}{canReview && entry.status === "IN_REVIEW" && entry.reviewWorkflowState === "PENDING_REVIEW" && <Button size="sm" onClick={() => openReview(entry)}>Review</Button>}{canReview && entry.status === "IN_REVIEW" && entry.reviewWorkflowState === "APPROVED" && <Button size="sm" onClick={() => openReview(entry)}>Publish</Button>}</div></td>}
            </tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing {String(entries?.length ?? 0)} entries (maximum 50).</p>

      {canEdit && <Dialog open={creating || editing !== null} onOpenChange={(open) => { if (!open && confirmDiscardChanges(dirty)) { setCreating(false); setEditing(null); setPreview(false); } }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle>{creating ? "Create content draft" : "Edit content draft"}</DialogTitle><DialogDescription>Every save creates an immutable revision. Editing published copy immediately removes it from public status and places it into review; this editor cannot approve or publish content.</DialogDescription></DialogHeader>
          {preview ? (
            <div className="space-y-4 rounded-lg border border-border/70 p-5" dir={form.locale === "ar" ? "rtl" : "ltr"} lang={form.locale}>
              <div className="flex items-center justify-between gap-2"><Badge variant="outline">{form.locale.toUpperCase()} preview</Badge><Button type="button" size="sm" variant="outline" onClick={() => setPreview(false)}>Back to editor</Button></div>
              <h2 className="font-display text-2xl font-semibold">{form.title || "Untitled draft"}</h2>
              {form.excerpt && <p className="text-muted-foreground">{form.excerpt}</p>}
              <div className="prose prose-sm max-w-none dark:prose-invert"><ContentBody body={form.bodyMode === "MARKDOWN" ? form.body : ""} blocks={form.bodyMode === "BLOCKS" ? form.blocks : null} locale={form.locale === "ar" ? "ar" : "en"} /></div>
            </div>
          ) : (
            <MediaForm className="space-y-4" onSubmit={save}>
              <div className="flex flex-wrap justify-between gap-2">{creating ? <div className="grid flex-1 gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-sm font-medium">Content type<Select value={form.contentType} onValueChange={(contentType) => setForm({ ...form, contentType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["GUIDE", "AREA_GUIDE", "ARTICLE", "PAGE", "INTERNATIONAL_GUIDE"].map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1.5 text-sm font-medium">Locale<Select value={form.locale} onValueChange={(locale) => setForm({ ...form, locale })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">Arabic</SelectItem></SelectContent></Select></label></div> : <div className="flex gap-2"><Badge variant="outline">{String(editing?.contentType)}</Badge><Badge variant="outline">{String(editing?.locale).toUpperCase()}</Badge></div>}<Button type="button" size="sm" variant="outline" onClick={() => setPreview(true)}>Preview</Button></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm font-medium">Title<Input required maxLength={300} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
                <label className="block space-y-1.5 text-sm font-medium">Slug<Input required maxLength={180} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label>
                <label className="block space-y-1.5 text-sm font-medium">Category<Input maxLength={100} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
                <PublicMediaPicker label="Cover image" value={form.coverMediaId} onChange={(coverMediaId) => setForm({ ...form, coverMediaId })} />
              </div>
              {selectedCover && isPublicMediaUrl(selectedCover.url) && <div className="max-w-xs overflow-hidden rounded-lg border border-border/70"><Image src={selectedCover.url} alt={String(selectedCover.altText ?? "")} width={640} height={360} unoptimized className="h-36 w-full object-cover" /></div>}
              <label className="block space-y-1.5 text-sm font-medium">Excerpt<Textarea maxLength={1000} rows={2} value={form.excerpt} onChange={(event) => setForm({ ...form, excerpt: event.target.value })} /></label>
              <section className="space-y-3 rounded-lg border border-border/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Content body</h3><p className="text-xs text-muted-foreground">Choose legacy Markdown or assemble validated visual blocks. Raw HTML is never rendered.</p></div><div className="flex gap-2"><Button type="button" size="sm" variant={form.bodyMode === "MARKDOWN" ? "secondary" : "outline"} onClick={() => setForm({ ...form, bodyMode: "MARKDOWN" })}>Markdown</Button><Button type="button" size="sm" variant={form.bodyMode === "BLOCKS" ? "secondary" : "outline"} onClick={() => setForm({ ...form, bodyMode: "BLOCKS" })}>Visual blocks</Button></div></div>
                {form.bodyMode === "MARKDOWN" ? <label className="block space-y-1.5 text-sm font-medium">Body (safe Markdown)<Textarea required maxLength={50000} rows={16} dir={form.locale === "ar" ? "rtl" : "ltr"} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></label> : <div className="space-y-3">
                  {form.blocks.map((block, index) => <section key={`${block.type}-${index}`} className="space-y-3 rounded-md bg-secondary/30 p-3">
                    <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wide">{block.type} {index + 1}</span><div className="flex gap-1"><Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => moveBlock(index, -1)}>Up</Button><Button type="button" size="sm" variant="ghost" disabled={index === form.blocks.length - 1} onClick={() => moveBlock(index, 1)}>Down</Button><Button type="button" size="sm" variant="ghost" onClick={() => removeBlock(index)}>Remove</Button></div></div>
                    {block.type === "paragraph" && <Textarea rows={4} maxLength={5000} dir={form.locale === "ar" ? "rtl" : "ltr"} value={block.text} onChange={(event) => updateBlock(index, { text: event.target.value })} aria-label={`Paragraph ${index + 1}`} />}
                    {block.type === "heading" && <div className="grid gap-2 sm:grid-cols-[120px_1fr]"><label className="space-y-1 text-xs">Heading level<select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={block.level} onChange={(event) => updateBlock(index, { level: Number(event.target.value) as 2 | 3 })}><option value={2}>Level 2</option><option value={3}>Level 3</option></select></label><label className="space-y-1 text-xs">Heading text<Input maxLength={200} value={block.text} onChange={(event) => updateBlock(index, { text: event.target.value })} /></label></div>}
                    {block.type === "quote" && <><Textarea rows={3} maxLength={3000} value={block.text} onChange={(event) => updateBlock(index, { text: event.target.value })} aria-label={`Quote ${index + 1}`} /><Input maxLength={160} placeholder="Attribution (optional)" value={block.attribution ?? ""} onChange={(event) => updateBlock(index, { attribution: event.target.value })} /></>}
                    {block.type === "list" && <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={block.ordered} onChange={(event) => updateBlock(index, { ordered: event.target.checked })} /> Numbered list</label><Textarea rows={Math.min(8, Math.max(3, block.items.length))} maxLength={15000} value={block.items.join("\n")} onChange={(event) => updateBlock(index, { items: event.target.value.split("\n").slice(0, 30) })} aria-label={`List items ${index + 1}`} /><p className="text-xs text-muted-foreground">One list item per line (maximum 30).</p></>}
                    {block.type === "link" && <div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1 text-xs">Link label<Input maxLength={200} value={block.label} onChange={(event) => updateBlock(index, { label: event.target.value })} /></label><label className="space-y-1 text-xs">Destination (HTTP(S), mailto, or same-site path)<Input maxLength={2000} value={block.href} onChange={(event) => updateBlock(index, { href: event.target.value })} /></label></div>}
                    {block.type === "image" && <div className="grid gap-2 sm:grid-cols-2"><PublicMediaPicker label="Content block image" value={block.mediaId} onChange={(mediaId) => updateBlock(index, { mediaId })} /><div className="space-y-2"><label className="block space-y-1 text-xs">Alternative text<Input maxLength={300} value={block.altText} onChange={(event) => updateBlock(index, { altText: event.target.value })} /></label><label className="block space-y-1 text-xs">Caption (optional)<Input maxLength={500} value={block.caption ?? ""} onChange={(event) => updateBlock(index, { caption: event.target.value })} /></label></div></div>}
                    {block.type === "module" && <label className="block space-y-1 text-xs">Prebuilt public module<select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={block.id} onChange={(event) => updateBlock(index, { id: event.target.value as Extract<ContentBlock, { type: "module" }>["id"] })}><option value="property-search">Property search</option><option value="calculator-hub">Calculator hub</option><option value="market-intelligence">Market intelligence</option><option value="property-map">Property map</option><option value="advisor-contact">Advisor contact</option><option value="featured-properties">Featured properties</option></select></label>}
                    {block.type === "entity" && <div className="grid gap-2 sm:grid-cols-3"><label className="space-y-1 text-xs">Reference type<select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={block.entity} onChange={(event) => updateBlock(index, { entity: event.target.value as Extract<ContentBlock, { type: "entity" }>["entity"] })}>{["property", "project", "community", "developer", "advisor"].map((entity) => <option key={entity} value={entity}>{entity}</option>)}</select></label><label className="space-y-1 text-xs">Published entity URL slug<Input maxLength={180} value={block.slug} onChange={(event) => updateBlock(index, { slug: event.target.value })} placeholder="Copy the last part of its public URL" /></label><label className="space-y-1 text-xs">Link label<Input maxLength={200} value={block.label} onChange={(event) => updateBlock(index, { label: event.target.value })} /></label></div>}
                  </section>)}
                  <div className="flex flex-wrap gap-2">{(["paragraph", "heading", "quote", "list", "link", "image", "module", "entity"] as const).map((type) => <Button key={type} type="button" size="sm" variant="outline" onClick={() => addBlock(type)}>Add {type}</Button>)}</div>
                  {form.blocks.length === 0 && <p className="text-sm text-muted-foreground">Add a block to start this page. Empty visual content cannot be saved or published.</p>}
                </div>}
              </section>
              {form.contentType === "INTERNATIONAL_GUIDE" && <section className="grid gap-3 rounded-lg border border-info/30 bg-info/5 p-4 sm:grid-cols-2"><div className="sm:col-span-2"><h3 className="text-sm font-semibold">Source and freshness review</h3><p className="mt-1 text-xs text-muted-foreground">A verified HTTPS source, verification date and future review date are required before this guide can enter review or be published.</p></div><label className="space-y-1.5 text-sm font-medium">Source organization<Input maxLength={200} value={form.sourceName} onChange={(event) => setForm({ ...form, sourceName: event.target.value })} /></label><label className="space-y-1.5 text-sm font-medium">Authoritative source URL<Input type="url" maxLength={2000} placeholder="https://…" value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} /></label><label className="space-y-1.5 text-sm font-medium">Verified date<Input type="date" value={form.sourceVerifiedAt} onChange={(event) => setForm({ ...form, sourceVerifiedAt: event.target.value })} /></label><label className="space-y-1.5 text-sm font-medium">Review due date<Input type="date" value={form.freshnessReviewDueAt} onChange={(event) => setForm({ ...form, freshnessReviewDueAt: event.target.value })} /></label></section>}
              {!creating && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.submitForReview} onChange={(event) => setForm({ ...form, submitForReview: event.target.checked })} /> Submit changes for review</label>}
              <DialogFooter><Button type="button" variant="outline" onClick={() => { if (confirmDiscardChanges(dirty)) { setCreating(false); setEditing(null); } }}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : creating ? "Create draft" : "Save revision"}</Button></DialogFooter>
            </MediaForm>
          )}
        </DialogContent>
      </Dialog>}

      <Dialog open={historyOpen} onOpenChange={(open) => !open && setHistoryOpen(false)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle>Revision history</DialogTitle><DialogDescription>Restoring a revision creates a new draft version; a past published state is never silently republished.</DialogDescription></DialogHeader>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="max-h-[55dvh] space-y-1 overflow-y-auto">{revisions.map((revision) => <Button key={String(revision.id)} type="button" variant={revision.id === selectedRevision?.id ? "secondary" : "ghost"} className="h-auto w-full justify-start py-2 text-left" onClick={() => setSelectedRevision(revision)}><span><span className="block">v{String(revision.version)} · {String(revision.changeNote ?? "Edit")}</span><span className="text-xs text-muted-foreground">{formatDate(String(revision.createdAt))}</span></span></Button>)}</div>
            <div className="space-y-3">{previousSnapshot ? ["title", "slug", "excerpt", "category", "body", "bodyJson", "coverMediaId"].map((field) => {
              const previous = String(previousSnapshot[field] ?? "");
              const current = currentByField[field] ?? "";
              return <section key={field} className="rounded-lg border border-border/70 p-3"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide">{field}{previous === current ? " · unchanged" : " · changed"}</h3><div className="grid gap-2 sm:grid-cols-2"><pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-secondary/60 p-2 text-xs">{previous || "(empty)"}</pre><pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-secondary/60 p-2 text-xs">{current || "(empty)"}</pre></div></section>;
            }) : <EmptyState title="No revision selected" description="Select a saved revision to compare it with the editor." />}</div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setHistoryOpen(false)}>Close</Button>{historyEntry && selectedRevision && canEdit && <Button variant="destructive" disabled={saving} onClick={rollback}>{saving ? "Restoring…" : "Restore as draft"}</Button>}</DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={(open) => !open && setReviewOpen(false)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>{reviewEntry?.reviewWorkflowState === "APPROVED" ? "Publish approved content" : "Review submitted content"}</DialogTitle><DialogDescription>Review the exact current copy and recorded source before taking an action. The author of the latest revision cannot approve it.</DialogDescription></DialogHeader>
          {reviewEntry && <div className="space-y-4">
            <div className="flex flex-wrap gap-2"><Badge variant="outline">{String(reviewEntry.contentType)}</Badge><Badge variant="outline">{String(reviewEntry.locale).toUpperCase()}</Badge><Badge variant="outline">{String(reviewEntry.status)}</Badge></div>
            <div className="rounded-lg border border-border/70 p-4" dir={String(reviewEntry.locale) === "ar" ? "rtl" : "ltr"} lang={String(reviewEntry.locale)}>
              <h2 className="font-display text-xl font-semibold">{String(reviewEntry.title)}</h2>
              {Boolean(reviewEntry.excerpt) && <p className="mt-2 text-sm text-muted-foreground">{String(reviewEntry.excerpt)}</p>}
              <div className="prose prose-sm mt-4 max-w-none dark:prose-invert"><ContentBody body={String(reviewEntry.body ?? "")} blocks={reviewEntry.blocks} locale={String(reviewEntry.locale) === "ar" ? "ar" : "en"} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Recorded source: {String(reviewEntry.sourceName ?? "not recorded")}{Boolean(reviewEntry.sourceUrl) && <> · <a href={String(reviewEntry.sourceUrl)} target="_blank" rel="noopener noreferrer" className="underline">Open source</a></>}{Boolean(reviewEntry.sourceVerifiedAt) && ` · verified ${formatDate(String(reviewEntry.sourceVerifiedAt))}`}{Boolean(reviewEntry.freshnessReviewDueAt) && ` · review due ${formatDate(String(reviewEntry.freshnessReviewDueAt))}`}</p>
            {reviewEntry.reviewWorkflowState === "PENDING_REVIEW" && <label className="block space-y-1.5 text-sm font-medium">Review note<Textarea maxLength={1000} rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Required when requesting changes" /></label>}
          </div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Close</Button>
            {reviewEntry?.reviewWorkflowState === "PENDING_REVIEW" && <><Button variant="outline" disabled={reviewSaving || !reviewNote.trim()} onClick={() => decideReview("CHANGES_REQUESTED")}>Request changes</Button><Button disabled={reviewSaving} onClick={() => decideReview("APPROVE")}>{reviewSaving ? "Saving…" : "Approve"}</Button></>}
            {reviewEntry?.reviewWorkflowState === "APPROVED" && <Button disabled={reviewSaving} onClick={() => decideReview("PUBLISH")}>{reviewSaving ? "Publishing…" : "Publish"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={retireEntry !== null} onOpenChange={(open) => { if (!open && !retireSaving) setRetireEntry(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{retireEntry?.status === "RETIRED" ? "Restore content as a draft?" : "Retire content from public use?"}</DialogTitle><DialogDescription>This reversible archive action changes publication state only. It does not delete the entry, revisions, translation link, or source record. Restored content returns as a draft and must be reviewed before publishing again.</DialogDescription></DialogHeader>
          {retireEntry && <p className="rounded-lg border border-border/70 p-3 text-sm font-medium">{String(retireEntry.title)} · {String(retireEntry.locale).toUpperCase()}</p>}
          <DialogFooter><Button variant="outline" disabled={retireSaving} onClick={() => setRetireEntry(null)}>Cancel</Button><Button disabled={retireSaving || !retireEntry} onClick={() => changeRetirement(retireEntry?.status !== "RETIRED")}>{retireSaving ? "Saving…" : retireEntry?.status === "RETIRED" ? "Restore as draft" : "Retire entry"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {canEdit && <Dialog open={translationEntry !== null} onOpenChange={(open) => { if (!open) { setTranslationEntry(null); setTranslationCandidates(null); } }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{translationEntry?.translationPeer ? "Unlink translations" : "Pair EN/AR content"}</DialogTitle><DialogDescription>This links existing English and Arabic records only. It does not copy, translate, or publish content; each locale keeps its own draft and review state.</DialogDescription></DialogHeader>
          {translationPeer ? (
            <div className="rounded-lg border border-border/70 p-4 text-sm">
              <p className="font-medium">{String(translationEntry?.title)} ({String(translationEntry?.locale).toUpperCase()})</p>
              <p className="my-2 text-muted-foreground">↕</p>
              <p className="font-medium">{String(translationPeer.title)} ({String(translationPeer.locale).toUpperCase()})</p>
              <p className="mt-2 text-xs text-muted-foreground">Unlinking changes only the relationship; content and publication status stay unchanged.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">Selected: {String(translationEntry?.title)} ({String(translationEntry?.locale).toUpperCase()})</p>
              {translationCandidates === null ? <LoadingState rows={2} /> : translationCandidates.length === 0 ? <EmptyState title="No compatible entries" description="Create an unpaired draft in the other locale with the same content type." /> : (
                <label className="block space-y-1.5 text-sm font-medium">Matching {translationEntry?.locale === "en" ? "Arabic" : "English"} record
                  <Select value={translationCandidateId || "none"} onValueChange={(value) => setTranslationCandidateId(value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="Choose a record" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">Choose a record</SelectItem>{translationCandidates.map((candidate) => <SelectItem key={String(candidate.id)} value={String(candidate.id)}>{String(candidate.title)} · {String(candidate.status)}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
              )}
            </div>
          )}
          <DialogFooter><Button variant="outline" disabled={translationSaving} onClick={() => setTranslationEntry(null)}>Cancel</Button>{translationEntry?.translationPeer ? <Button variant="destructive" disabled={translationSaving} onClick={removeTranslationPair}>{translationSaving ? "Unlinking…" : "Unlink pair"}</Button> : <Button disabled={translationSaving || !translationCandidateId || translationCandidates === null} onClick={saveTranslationPair}>{translationSaving ? "Linking…" : "Link records"}</Button>}</DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

function MediaSection({ canEdit }: { canEdit: boolean }) {
  const [assets, setAssets] = React.useState<Record<string, unknown>[] | null>(null);
  const [q, setQ] = React.useState("");
  const [kindFilter, setKindFilter] = React.useState("");
  const [usageFilter, setUsageFilter] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [minWidth, setMinWidth] = React.useState("");
  const [minHeight, setMinHeight] = React.useState("");
  const [uploader, setUploader] = React.useState("");
  const [listMode, setListMode] = React.useState(false);
  const [uploadKind, setUploadKind] = React.useState("AUTO");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [uploadAltText, setUploadAltText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null);
  const [altText, setAltText] = React.useState("");
  const [caption, setCaption] = React.useState("");
  const [bulkCaption, setBulkCaption] = React.useState("");

  const load = React.useCallback(() => {
    const params = new URLSearchParams({ take: "100" });
    if (q) params.set("q", q);
    if (kindFilter) params.set("kind", kindFilter);
    if (usageFilter) params.set("usage", usageFilter);
    if (dateFrom) params.set("createdAfter", new Date(`${dateFrom}T00:00:00`).toISOString());
    if (dateTo) params.set("createdBefore", new Date(`${dateTo}T23:59:59.999`).toISOString());
    if (minWidth) params.set("minWidth", minWidth);
    if (minHeight) params.set("minHeight", minHeight);
    if (uploader.trim()) params.set("uploader", uploader.trim());
    api.get<{ media: Record<string, unknown>[] }>(`/api/media?${params.toString()}`)
      .then((result) => setAssets(result.media))
      .catch(() => setAssets([]));
  }, [q, kindFilter, usageFilter, dateFrom, dateTo, minWidth, minHeight, uploader]);
  React.useEffect(() => { load(); }, [load]);
  const deleteSelected = async () => {
    if (!selected.length || !window.confirm(`Delete ${selected.length} selected asset(s) that have no tracked uses? Used assets will remain protected.`)) return;
    setBusy(true);
    try {
      const result = await api.delete<{ deleted: number; blocked: number; results: { id: string; error?: string; cleanupComplete?: boolean }[] }>("/api/media", { mediaAssetIds: selected });
      const failures = result.results.filter((item) => item.error);
      toast.success(`${result.deleted} asset(s) deleted${result.blocked ? `; ${result.blocked} still in use or protected` : ""}`);
      if (failures.length) toast.error(failures.slice(0, 3).map((item) => item.error).join(" "));
      const cleanupPending = result.results.filter((item) => item.cleanupComplete === false).length;
      if (cleanupPending) toast.warning(`${cleanupPending} database record(s) were removed, but object storage cleanup needs a retry.`);
      setSelected([]);
      load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Selected media could not be removed"); }
    finally { setBusy(false); }
  };

  const fillMissingMetadata = async () => {
    if (!selected.length || !bulkCaption.trim()) return;
    setBusy(true);
    let changed = 0;
    const failures: string[] = [];
    try {
      for (const id of selected) {
        const asset = assets?.find((item) => item.id === id);
        if (!asset || (asset.caption && String(asset.caption).trim())) continue;
        try {
          await api.patch(`/api/media/${id}`, { expectedUpdatedAt: asset.updatedAt, altText: asset.altText || null, caption: bulkCaption.trim() });
          changed += 1;
        } catch (error) { failures.push(error instanceof Error ? error.message : `Could not update ${id}.`); }
      }
      toast.success(`${changed} asset(s) received the caption; existing captions were kept.`);
      if (failures.length) toast.error(failures.slice(0, 3).join(" "));
      setBulkCaption(""); setSelected([]); load();
    } finally { setBusy(false); }
  };

  const openMetadata = (asset: Record<string, unknown>) => {
    setEditing(asset);
    setAltText(String(asset.altText ?? ""));
    setCaption(String(asset.caption ?? ""));
  };

  const saveMetadata = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await api.patch(`/api/media/${editing.id}`, {
        expectedUpdatedAt: editing.updatedAt, altText: altText || null, caption: caption || null,
      });
      toast.success("Media accessibility metadata saved");
      setEditing(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Media metadata save failed");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header><h1 className="font-display text-2xl font-semibold">Media library</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Bulk upload, find and reuse public assets. Private portfolio documents are excluded; assets referenced by a property, project, content entry or other catalog record cannot be deleted.</p></header>
      {canEdit && <section className="space-y-3 rounded-xl border p-4">
        <label className="block space-y-1.5 text-sm font-medium">Alt text for uploads<Input maxLength={300} value={uploadAltText} onChange={(event) => setUploadAltText(event.target.value)} /></label>
        <label className="block space-y-1.5 text-sm font-medium">Asset type<Select value={uploadKind} onValueChange={setUploadKind}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["AUTO", "IMAGE", "LOGO", "FLOOR_PLAN", "BROCHURE", "DOCUMENT", "VIDEO"].map((kind) => <SelectItem key={kind} value={kind}>{kind.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
        <MediaUploader mode="library" kind={uploadKind === "AUTO" ? undefined : uploadKind} altText={uploadAltText} multiple onUploaded={load} onBusyChange={setBusy} />
      </section>}
      <div className="flex flex-wrap items-center gap-2"><Input className="max-w-sm" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search filename, alt, caption or ID" aria-label="Search media" /><Select value={kindFilter || "all"} onValueChange={(value) => setKindFilter(value === "all" ? "" : value)}><SelectTrigger className="w-48" aria-label="Filter media type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All asset types</SelectItem>{["IMAGE", "LOGO", "FLOOR_PLAN", "BROCHURE", "DOCUMENT", "VIDEO"].map((kind) => <SelectItem key={kind} value={kind}>{kind.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select><Select value={usageFilter || "all"} onValueChange={(value) => setUsageFilter(value === "all" ? "" : value)}><SelectTrigger className="w-44" aria-label="Filter media usage"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any usage</SelectItem><SelectItem value="orphaned">Unreferenced assets</SelectItem><SelectItem value="used">Used assets</SelectItem></SelectContent></Select><Input className="w-40" type="date" aria-label="Uploaded after" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><Input className="w-40" type="date" aria-label="Uploaded before" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /><Input className="w-28" type="number" min="1" aria-label="Minimum image width" placeholder="Min width" value={minWidth} onChange={(event) => setMinWidth(event.target.value)} /><Input className="w-28" type="number" min="1" aria-label="Minimum image height" placeholder="Min height" value={minHeight} onChange={(event) => setMinHeight(event.target.value)} /><Input className="w-40" aria-label="Uploader ID" placeholder="Uploader ID" value={uploader} onChange={(event) => setUploader(event.target.value)} /><Button type="button" size="sm" variant="outline" onClick={() => setListMode((value) => !value)}>{listMode ? "Grid view" : "List view"}</Button>{canEdit && selected.length > 0 && <><span className="text-xs text-muted-foreground">{selected.length} selected</span><Input className="w-48" aria-label="Caption for assets without one" maxLength={1000} placeholder="Fill missing captions" value={bulkCaption} onChange={(event) => setBulkCaption(event.target.value)} /><Button type="button" size="sm" variant="outline" disabled={busy || !bulkCaption.trim()} onClick={() => void fillMissingMetadata()}>Fill missing captions</Button><Button type="button" size="sm" variant="destructive" disabled={busy} onClick={deleteSelected}>Delete unused selected</Button></>}</div>
      {assets === null ? <LoadingState rows={4} /> : assets.length === 0 ? <EmptyState title="No public media assets" description="Upload a validated image, video or PDF to start the library." /> : (
        <div className={listMode ? "space-y-2" : "grid gap-3 md:grid-cols-2 xl:grid-cols-3"}>
          {assets.map((asset) => <article key={String(asset.id)} className="space-y-3 rounded-xl border border-border/70 p-4">
            {canEdit && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.includes(String(asset.id))} onChange={(event) => setSelected((current) => event.target.checked ? [...current, String(asset.id)] : current.filter((id) => id !== asset.id))} />Select asset</label>}
            {!asset.isPrivate && isPublicMediaUrl(asset.url) && <MediaPreview asset={{ url: asset.url, mimeType: String(asset.mimeType), altText: asset.altText ? String(asset.altText) : null, posterUrl: asset.posterUrl ? String(asset.posterUrl) : null }} />}
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex gap-2"><Badge variant="outline">{String(asset.kind)}</Badge><Badge variant="secondary">{asset.isPrivate ? "PRIVATE" : "PUBLIC"}</Badge></div><span className="text-xs text-muted-foreground">{formatDate(String(asset.createdAt))}</span></div>
            <div><p className="break-all text-sm font-medium">{String(asset.mimeType)} · {formatNumber(Number(asset.sizeBytes) / 1024, "en-AE", { maximumFractionDigits: 0 })} KB</p><p className="break-all text-xs text-muted-foreground">File: {String(asset.originalFilename ?? "Original name unavailable")}</p><p className="text-xs text-muted-foreground">{asset.width && asset.height ? `${String(asset.width)} × ${String(asset.height)} · ` : ""}{String(asset.usageCount)} tracked uses{asset.checksum ? ` · SHA-256 ${String(asset.checksum).slice(0, 12)}` : ""}</p>{Boolean(asset.variants && Object.keys(asset.variants as object).length) && <p className="text-xs text-muted-foreground">Variants: {Object.keys(asset.variants as object).join(", ")}</p>}{Array.isArray(asset.usageGraph) && asset.usageGraph.length > 0 && <details className="mt-2 rounded-md border border-border/60 p-2"><summary className="cursor-pointer text-xs font-medium">Where used</summary><ul className="mt-2 space-y-1 text-xs">{(asset.usageGraph as { type: string; id: string; label: string; href: string | null }[]).slice(0, 20).map((use, index) => <li key={`${use.type}-${use.id}-${index}`}>{use.href ? <a className="underline underline-offset-2" href={use.href}>{use.label}</a> : use.label}<span className="ml-1 text-muted-foreground">· {use.type.replaceAll("_", " ")}</span></li>)}</ul>{Boolean(asset.usageGraphTruncated) && <p className="mt-2 text-xs text-muted-foreground">Some uses are not shown because they are outside your access scope or beyond the display limit.</p>}</details>}{assets.some((other) => other.id !== asset.id && other.checksum && other.checksum === asset.checksum) && <Badge variant="outline">Duplicate checksum</Badge>}</div>
            <div className="min-h-10 text-sm"><p>{String(asset.altText ?? "No alt text recorded")}</p>{Boolean(asset.caption) && <p className="mt-1 text-xs text-muted-foreground">{String(asset.caption)}</p>}</div>
            <div className="flex flex-wrap gap-2">{!asset.isPrivate && isPublicMediaUrl(asset.url) && <a className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary" href={asset.url} target="_blank" rel="noopener noreferrer">Open asset</a>}{canEdit && <Button size="sm" variant="outline" onClick={() => openMetadata(asset)}>Edit metadata</Button>}</div>
          </article>)}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing {String(assets?.length ?? 0)} matching public assets (maximum 100). Usage includes catalog, content, SEO, gallery, and document references.</p>

      {canEdit && <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit media metadata</DialogTitle><DialogDescription>Only alt text and caption are editable here. Asset privacy, file bytes, and existing uses are not changed.</DialogDescription></DialogHeader>
          {editing && <form id="media-metadata-form" onSubmit={saveMetadata} className="space-y-4">
            <div className="rounded-lg border border-border/70 p-3 text-sm"><p className="font-medium">{String(editing.mimeType)} · {String(editing.kind)}</p><p className="mt-1 text-xs text-muted-foreground">{String(editing.usageCount)} tracked uses</p></div>
            <label className="block space-y-1.5 text-sm font-medium">Alt text<Input maxLength={300} value={altText} onChange={(event) => setAltText(event.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Caption<Textarea maxLength={1000} rows={3} value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
          </form>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="media-metadata-form" disabled={busy}>{busy ? "Saving…" : "Save metadata"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

/* ------------------------------ Imports ---------------------------------- */

function ImportsSection() {
  const [data, setData] = React.useState<{ runs: Record<string, unknown>[]; qualityIssues: Record<string, unknown>[] } | null>(null);
  const [error, setError] = React.useState("");
  const [csv, setCsv] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const requestKey = React.useRef<{ fingerprint: string; key: string } | null>(null);
  const [details, setDetails] = React.useState<{ runId: string; records: Record<string, unknown>[]; loading: boolean; truncated: boolean } | null>(null);

  const load = React.useCallback(() => {
    api.get<{ runs: Record<string, unknown>[]; qualityIssues: Record<string, unknown>[] }>("/api/admin/imports").then((next) => { setData(next); setError(""); }).catch((e) => setError(e instanceof Error ? e.message : "Inventory import history is unavailable."));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if (!data?.runs.some((run) => ["QUEUED", "RUNNING"].includes(String(run.status)))) return;
    const timer = window.setTimeout(load, 2000);
    return () => window.clearTimeout(timer);
  }, [data, load]);

  const runImport = async (dryRun: boolean) => {
    if (!csv.trim()) { toast.error("Paste CSV records first"); return; }
    setBusy(true);
    try {
      const fingerprint = `${dryRun ? "dry" : "apply"}\u0000${csv}`;
      if (!requestKey.current || requestKey.current.fingerprint !== fingerprint) {
        requestKey.current = { fingerprint, key: clientRequestId() };
      }
      const res = await api.post<{ importRunId: string; status: string; duplicateRequest: boolean }>(
        "/api/admin/imports",
        { format: "csv", data: csv, dryRun },
        { headers: { "Idempotency-Key": requestKey.current.key } },
      );
      toast.info(`${dryRun ? "Validation" : "Import"} ${res.status.toLowerCase()}${res.duplicateRequest ? " (existing request)" : ""} · run ${res.importRunId}`);
      if (!dryRun) setCsv("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally { setBusy(false); }
  };

  const toggleRunDetails = async (runId: string) => {
    if (details?.runId === runId && !details.loading) { setDetails(null); return; }
    setDetails({ runId, records: [], loading: true, truncated: false });
    try {
      const response = await api.get<{ records: Record<string, unknown>[]; truncated: boolean }>(`/api/admin/imports/${encodeURIComponent(runId)}`);
      setDetails({ runId, records: response.records, loading: false, truncated: response.truncated });
    } catch (error) {
      setDetails(null);
      toast.error(error instanceof Error ? error.message : "Import run details could not be loaded");
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Imports & data quality</h1>
        <p className="mt-1 text-sm text-muted-foreground">CSV validation and ingestion run asynchronously in the dedicated worker. Imported inventory remains draft until an editor explicitly publishes it.</p>
      </header>
      {error && <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm"><p>{error}</p><Button size="sm" variant="outline" className="mt-2" onClick={load}>Retry inventory import history</Button></div>}

      <div className="rounded-xl border border-border/70 bg-card p-5">
        <h2 className="kicker mb-2">Run a CSV import</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Headers: externalId,title,community,project,developer,propertyType,listingType,bedrooms,bathrooms,areaSqft,priceAed,offPlan,availability,view,furnishing,handover,description,agentEmail,lat,lng
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={5}
          aria-label="CSV records"
          placeholder={"externalId,title,community,propertyType,listingType,bedrooms,bathrooms,priceAed,offPlan,availability,description,lat,lng\nPaste a verified source export using canonical headers; no sample property data is provided."}
          className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus:border-brand/60"
        />
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => runImport(true)} disabled={busy}>Validate only</Button>
          <Button size="sm" onClick={() => runImport(false)} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />} Import</Button>
        </div>
      </div>

      {data && (
        <>
          <div>
            <h2 className="kicker mb-3">Recent runs</h2>
            <div className="space-y-2">
              {data.runs.map((r) => (
                <React.Fragment key={String(r.id)}>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card p-3.5 text-sm">
                  <div>
                    <span className="font-medium">{String(r.source)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{formatDate(String(r.startedAt ?? r.createdAt), undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                  <div className="num flex items-center gap-3 text-xs">
                    <span className={cn("font-semibold", String(r.status) === "SUCCEEDED" ? "text-success" : String(r.status) === "PARTIAL" ? "text-warning" : ["QUEUED", "RUNNING", "DRY_RUN"].includes(String(r.status)) ? "text-info" : "text-destructive")}>{String(r.status)}</span>
                    <span>{String(r.recordsTotal)} total</span>
                    <span className="text-success">{String(r.recordsCreated)}+</span>
                    <span className="text-info">{String(r.recordsUpdated)}~</span>
                    <span className="text-muted-foreground">{String(r.recordsSkipped)} skip</span>
                    {Number(r.duplicatesDetected) > 0 && <span className="text-warning">{String(r.duplicatesDetected)} dup</span>}
                    {Number(r.recordsFailed) > 0 && <span className="text-destructive">{String(r.recordsFailed)} fail</span>}
                    <Button size="sm" variant="outline" onClick={() => toggleRunDetails(String(r.id))}>{details?.runId === String(r.id) && !details.loading ? "Hide rows" : "Rows"}</Button>
                  </div>
                </div>
                {details && details.runId === String(r.id) && <div className="mt-2 rounded-lg border border-border/70 bg-card p-3">
                  {details.loading ? <p className="text-xs text-muted-foreground">Loading bounded outcome details…</p> : details.records.length === 0 ? <p className="text-xs text-muted-foreground">No row outcomes are available for this run.</p> : <div className="space-y-2">
                    {details.records.map((record) => <div key={`${String(record.recordNumber)}-${String(record.action)}`} className="grid gap-1 border-b border-border/50 pb-2 text-xs last:border-0 last:pb-0 sm:grid-cols-[5rem_9rem_1fr]">
                      <span className="num text-muted-foreground">Row {String(record.recordNumber)}</span>
                      <span className={cn("font-semibold", record.action === "FAILED" || record.action === "SKIPPED_INVALID" ? "text-destructive" : record.action === "DRY_RUN" ? "text-info" : "text-foreground")}>{String(record.action)}</span>
                      <span className="space-y-1 text-muted-foreground">{((record.issues as { field: string | null; message: string }[] | undefined) ?? []).map((issue, index) => <span key={`${issue.field ?? "issue"}-${index}`} className="block">{issue.field ? `${issue.field}: ` : ""}{issue.message}</span>)}</span>
                    </div>)}
                    {details.truncated && <p className="text-xs text-muted-foreground">Only the first 500 row outcomes are shown.</p>}
                  </div>}
                </div>}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div>
            <h2 className="kicker mb-3">Open quality issues</h2>
            {data.qualityIssues.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open issues.</p>
            ) : (
              <div className="space-y-1.5">
                {data.qualityIssues.map((q) => (
                  <div key={String(q.id)} className="flex items-start gap-2 rounded-lg border border-border/70 bg-card p-3 text-xs">
                    <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", q.severity === "ERROR" ? "text-destructive" : "text-warning")} aria-hidden />
                    <div>
                      <p><strong>{String(q.ruleKey)}</strong> · {String(q.message)}</p>
                      {q.property ? <p className="mt-0.5 text-muted-foreground">{String((q.property as Record<string, string>).title)}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------ CRM -------------------------------------- */

function CrmSection({ canManage }: { canManage: boolean }) {
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [action, setAction] = React.useState<"connect" | "disconnect" | null>(null);
  const [agentMappings, setAgentMappings] = React.useState<Array<{
    id: string;
    name: string;
    mapping: { ghlUserId: string; providerName: string | null; verifiedAt: string } | null;
    mappingConflict: boolean;
  }> | null>(null);
  const [mappingInputs, setMappingInputs] = React.useState<Record<string, string>>({});
  const [mappingAction, setMappingAction] = React.useState<string | null>(null);
  const route = useRoute();
  const callbackResult = typeof route.query.ghl === "string" ? route.query.ghl : "";

  const load = React.useCallback(() => {
    api.get<Record<string, unknown> | null>("/api/admin/crm").then(setData).catch(() => setData(null));
  }, []);
  const loadAgentMappings = React.useCallback(() => {
    api.get<{ agents: NonNullable<typeof agentMappings> }>("/api/admin/integrations/ghl/agents")
      .then((result) => setAgentMappings(result.agents))
      .catch(() => setAgentMappings([]));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { loadAgentMappings(); }, [loadAgentMappings]);
  React.useEffect(() => {
    if (callbackResult === "connected") toast.success("GHL OAuth token stored. Provider metadata and live delivery remain unverified.");
    else if (callbackResult === "cancelled") toast.message("GHL authorization was cancelled. Existing local credentials, if any, were left unchanged.");
    else if (callbackResult === "failed") toast.error("GHL authorization could not be completed. The state may have expired; start again.");
  }, [callbackResult]);

  if (!data) return <LoadingState rows={3} />;

  const rec = data.reconciliation as Record<string, number | string>;
  const records = (data.records as Record<string, unknown>[]) ?? [];
  const ghl = data.ghl as Record<string, boolean | string | null>;
  const deferred = data.syncStatus === "DEFERRED";
  const startConnect = async () => {
    setAction("connect");
    try {
      const result = await api.post<{ authorizationUrl: string }>("/api/admin/integrations/ghl/oauth/start");
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start GHL authorization");
      setAction(null);
    }
  };
  const disconnect = async () => {
    if (!window.confirm("Remove the locally stored GHL OAuth token? This does not revoke the app authorization in HighLevel.")) return;
    setAction("disconnect");
    try {
      await api.delete("/api/admin/integrations/ghl");
      toast.success("Local GHL token removed. Revoke the app authorization in HighLevel separately if needed.");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove local GHL token");
    } finally {
      setAction(null);
    }
  };
  const verifyAgent = async (agentId: string) => {
    const ghlUserId = mappingInputs[agentId]?.trim();
    if (!ghlUserId) {
      toast.error("Enter a GHL user ID first.");
      return;
    }
    setMappingAction(agentId);
    try {
      const result = await api.post<{ mapping: { providerName: string | null } }>("/api/admin/integrations/ghl/agents", { agentId, ghlUserId });
      toast.success(result.mapping.providerName ? `Verified GHL user ${result.mapping.providerName}.` : "GHL user verified and mapped.");
      loadAgentMappings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not verify the GHL user mapping.");
    } finally {
      setMappingAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">CRM synchronization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Outbox-driven delivery with retries and DLQ. Provider: {String(rec.provider)} — live provider readiness remains unverified.
        </p>
      </header>

      {deferred && <p role="status" className="rounded-xl border p-4"><strong>CRM sync: Deferred.</strong> Local lead capture, consent, attribution and assignment remain available. Pending sync records are retained. <a className="underline" href="/admin/leads">Open local leads</a></p>}
      <section className="rounded-xl border border-border/70 bg-card p-5" aria-labelledby="ghl-connection-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 id="ghl-connection-title" className="font-display text-lg font-semibold">GoHighLevel authorization</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {ghl.connected
                ? "An encrypted OAuth token is stored locally. GHL pipeline, stage, user, calendar, and live round trips have not been verified."
                : "No GHL OAuth token is stored. Configure the Marketplace installation URL, app keys, callback URL, location ID, and encryption key in the server environment to enable connection."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {ghl.liveDeliveryEnabled ? "CRM live delivery is enabled by server configuration." : "CRM live delivery is disabled; connecting OAuth alone does not enable delivery."}
            </p>
          </div>
          {canManage ? <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={startConnect} disabled={deferred || !ghl.oauthReady || action !== null}>
              {action === "connect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {ghl.connected ? "Reconnect GHL" : "Connect GHL"}
            </Button>
            {ghl.connected ? <Button type="button" variant="outline" onClick={disconnect} disabled={action !== null}>
              {action === "disconnect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Remove local token
            </Button> : null}
          </div> : null}
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card p-5" aria-labelledby="ghl-agent-mapping-title">
        <h2 id="ghl-agent-mapping-title" className="font-display text-lg font-semibold">IERE agent ownership mappings</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Assigned leads can be sent to a GHL owner only after this mapping is verified against the configured GHL location. Verification makes a read-only GHL user lookup when you click the button; the connected app must have the <code>users.readonly</code> scope. IERE agent IDs are never sent as GHL user IDs.
        </p>
        {!ghl.connected ? <p className="mt-2 text-xs text-warning">Connect GHL before verifying or refreshing mappings. Any existing saved mapping remains bound to its verified location.</p> : null}
        <div className="mt-4 space-y-3">
          {(agentMappings ?? []).map((agent) => (
            <div key={agent.id} className="grid gap-3 rounded-lg border border-border/60 p-3 md:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{agent.name}</p>
                <p className="text-xs text-muted-foreground">
                  {agent.mappingConflict ? "Conflicting local mappings — needs admin reconciliation" : agent.mapping ? `Verified ${agent.mapping.providerName ?? agent.mapping.ghlUserId}` : "No verified GHL user mapping"}
                </p>
              </div>
              <Input
                aria-label={`GHL user ID for ${agent.name}`}
                placeholder="GHL user ID"
                value={mappingInputs[agent.id] ?? agent.mapping?.ghlUserId ?? ""}
                onChange={(event) => setMappingInputs((current) => ({ ...current, [agent.id]: event.target.value }))}
                disabled={deferred || !canManage || !ghl.connected || mappingAction !== null}
              />
              {canManage ? <Button type="button" variant="outline" onClick={() => verifyAgent(agent.id)} disabled={deferred || !ghl.connected || mappingAction !== null}>
                {mappingAction === agent.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />}
                Verify & save
              </Button> : null}
            </div>
          ))}
          {agentMappings?.length === 0 ? <p className="text-sm text-muted-foreground">No active IERE agents are available to map.</p> : null}
          {agentMappings === null ? <p className="text-sm text-muted-foreground">Loading agent mappings…</p> : null}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Total leads", rec.totalLeads],
          ["Delivered", rec.delivered],
          ["Pending", rec.pending],
          ["Dead", rec.dead],
          ["Unreconciled", rec.unreconciled],
          ["Sync records", rec.syncRecords],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border/70 bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{String(label)}</p>
            <p className="num mt-1 font-display text-xl font-semibold">{String(value)}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-safe rounded-xl border border-border/70">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">CRM sync records</caption>
          <thead>
            <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="p-3 font-medium">Lead</th>
              <th scope="col" className="p-3 font-medium">Status</th>
              <th scope="col" className="p-3 font-medium">Attempts</th>
              <th scope="col" className="p-3 font-medium">Last attempt</th>
              <th scope="col" className="p-3 font-medium">External ID</th>
              <th scope="col" className="p-3 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0">
                <td className="p-3">
                  <span className="num font-semibold text-brand-strong">{String(r.leadReference)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{String(r.contactName ?? "")}</span>
                </td>
                <td className="p-3">
                  <span className={cn("text-xs font-semibold", String(r.status) === "DELIVERED" ? "text-success" : String(r.status) === "DEAD" ? "text-destructive" : "text-warning")}>
                    {String(r.effectiveStatus ?? r.status)}
                  </span>
                </td>
                <td className="num p-3">{String(r.attempts)}</td>
                <td className="p-3 text-xs text-muted-foreground">{r.lastAttemptAt ? formatDate(String(r.lastAttemptAt), undefined, { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                <td className="num p-3 text-xs">{String(r.externalId ?? "—")}</td>
                <td className="max-w-48 truncate p-3 text-xs text-destructive">{String(r.lastError ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------ Jobs ------------------------------------- */

function JobsSection() {
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);

  React.useEffect(() => {
    api.get<Record<string, unknown> | null>("/api/admin/jobs").then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <LoadingState rows={3} />;

  const runs = (data.runs as Record<string, unknown>[]) ?? [];
  const deadLetters = (data.deadLetters as Record<string, unknown>[]) ?? [];
  const outbox = data.outbox as { pending: number; recent: Record<string, unknown>[] };

  const statusIcon = (status: string) =>
    status === "SUCCEEDED" ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> :
    status === "FAILED" || status === "DEAD" ? <XCircle className="h-4 w-4 text-destructive" aria-hidden /> :
    status === "RUNNING" ? <Loader2 className="h-4 w-4 animate-spin text-info" aria-hidden /> :
    <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Background jobs & dead letters</h1>
        <p className="mt-1 text-sm text-muted-foreground">Outbox draining, scheduled work, retries with exponential backoff and DLQ replay.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <h2 className="kicker mb-3">Job runs</h2>
          <div className="space-y-2">
            {runs.map((r) => (
              <div key={String(r.id)} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2 text-sm last:border-0">
                <div className="flex min-w-0 items-center gap-2">
                  {statusIcon(String(r.status))}
                  <span className="truncate font-mono text-xs">{String(r.jobKey)}</span>
                </div>
                <div className="num shrink-0 text-xs text-muted-foreground">
                  {r.durationMs ? `${String(r.durationMs)}ms · ` : ""}attempt {String(r.attempts)}/{String(r.maxAttempts)}
                </div>
              </div>
            ))}
            {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet — the scheduler ticks every 15s.</p>}
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <h2 className="kicker mb-3">Dead letters ({deadLetters.length})</h2>
          <div className="space-y-2">
            {deadLetters.map((d) => (
              <div key={String(d.id)} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{String(d.jobKey)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await api.post("/api/admin/dlq", { deadLetterId: String(d.id) });
                        toast.success("Replayed to queue");
                        api.get<Record<string, unknown> | null>("/api/admin/jobs").then((r) => setData(r)).catch(() => {});
                      } catch { toast.error("Replay failed"); }
                    }}
                  >
                    Replay
                  </Button>
                </div>
                <p className="mt-1 text-destructive">{String(d.error ?? "")}</p>
              </div>
            ))}
            {deadLetters.length === 0 && <p className="text-sm text-muted-foreground">No dead letters — all deliveries healthy.</p>}
          </div>
          <div className="mt-4 border-t border-border/60 pt-3">
            <p className="kicker mb-1.5">Outbox</p>
            <p className="num text-sm"><strong>{String(outbox.pending)}</strong> pending events</p>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              {outbox.recent.slice(0, 5).map((o) => (
                <p key={String(o.id)} className="truncate font-mono">{String(o.eventType)} → {String(o.publishedAt ?? "pending")}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Analytics --------------------------------- */

function AnalyticsSection() {
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);

  React.useEffect(() => {
    api.get<Record<string, unknown> | null>("/api/admin/analytics").then(setData).catch((error) => setError(error instanceof Error ? error.message : "Analytics are unavailable."));
  }, []);

  if (error) return <ErrorState message={error} onRetry={() => location.reload()} />;
  if (!data) return <LoadingState rows={3} />;

  const byName = (data.byName as { name: string; count: number }[]) ?? [];
  const max = Math.max(...byName.map((e) => e.count), 1);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">Recorded events, lead capture and searches for the same 30-day window (UTC).</p>
      </header>

      <section aria-label="Analytics measurement" className="rounded-xl border p-4 text-sm">
        <p><strong>{String(data.status)}</strong> · Measured {String(data.measuredAt)} · Latest event: {String(data.latestEventAt ?? "none recorded")}</p>
        <p className="mt-2 text-muted-foreground">{String(data.note)}</p>
        <p className="mt-2 text-muted-foreground">Events/searches cover the site; leads cover {String((data.scope as { leads?: string })?.leads)}.</p>
        {Object.values((data.truncated as Record<string, boolean>) ?? {}).some(Boolean) && <p role="status">Some breakdowns show only the first 100 groups. Totals remain complete.</p>}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <h2 className="kicker mb-4">Events by name</h2>
          <div className="space-y-2">
            {byName.map((e) => (
              <div key={e.name} className="flex items-center gap-3 text-xs">
                <span className="w-40 shrink-0 truncate font-mono text-muted-foreground">{e.name}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-sand">
                  <div className="h-full rounded bg-brand" style={{ width: `${(e.count / max) * 100}%` }} />
                </div>
                <span className="num w-10 shrink-0 text-right font-semibold">{e.count}</span>
              </div>
            ))}
            {byName.length === 0 && <p className="text-sm text-muted-foreground">No events recorded yet — browse the public site with analytics consent granted.</p>}
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <h2 className="kicker mb-3">Leads by source</h2>
            {((data.leadsBySource as { source: string; count: number }[]) ?? []).map((s) => (
              <div key={s.source} className="flex justify-between border-b border-border/40 py-1.5 text-sm last:border-0">
                <span className="text-muted-foreground">{s.source}</span>
                <span className="num font-semibold">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <h2 className="kicker mb-3">Top searches</h2>
            {((data.topSearches as { query: string; count: number }[]) ?? []).slice(0, 6).map((s) => (
              <div key={s.query} className="flex justify-between border-b border-border/40 py-1.5 text-sm last:border-0">
                <span className="truncate text-muted-foreground">{s.query || "(browse)"}</span>
                <span className="num font-semibold">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <h2 className="kicker mb-3">Attribution (UTM source)</h2>
            {((data.attribution as { utmSource: string; count: number }[]) ?? []).slice(0, 6).map((a) => (
              <div key={a.utmSource} className="flex justify-between border-b border-border/40 py-1.5 text-sm last:border-0">
                <span className="text-muted-foreground">{a.utmSource}</span>
                <span className="num font-semibold">{a.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Audit ------------------------------------- */

function AuditSection() {
  const [data, setData] = React.useState<{ entries: Record<string, unknown>[]; total: number } | null>(null);
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    api.get<{ entries: Record<string, unknown>[]; total: number } | null>(`/api/admin/audit?page=${page}`).then(setData).catch(() => setData({ entries: [], total: 0 }));
  }, [page]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">Redacted before/after snapshots for every material action ({formatNumber(data?.total ?? 0)} entries).</p>
      </header>
      {data === null ? (
        <LoadingState rows={4} />
      ) : (
        <div className="space-y-2">
          {data.entries.map((e) => (
            <details key={String(e.id)} className="rounded-lg border border-border/70 bg-card p-3 text-sm">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-brand" aria-hidden />
                <span className="font-mono text-xs font-semibold">{String(e.action)}</span>
                <span className="text-xs text-muted-foreground">{String(e.resourceType)}:{String(e.resourceId).slice(0, 10)}…</span>
                <span className="ml-auto text-xs text-muted-foreground">{String(e.actor ?? e.actorType)} · {formatDate(String(e.createdAt), undefined, { dateStyle: "short", timeStyle: "short" })}</span>
              </summary>
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                {e.before ? <pre className="max-h-40 overflow-auto rounded bg-sand p-2 font-mono text-[10px]">before: {JSON.stringify(e.before, null, 1)}</pre> : null}
                {e.after ? <pre className="max-h-40 overflow-auto rounded bg-sand p-2 font-mono text-[10px]">after: {JSON.stringify(e.after, null, 1)}</pre> : null}
              </div>
            </details>
          ))}
          {data.entries.length === 0 && <p className="text-sm text-muted-foreground">No audit entries yet.</p>}
          <div className="flex justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="num self-center px-2 text-sm text-muted-foreground">Page {page}</span>
            <Button variant="outline" size="sm" disabled={data.entries.length < 25} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Flags ------------------------------------- */

function FlagsSection({ canEdit }: { canEdit: boolean }) {
  const [flags, setFlags] = React.useState<Record<string, unknown>[] | null>(null);
  const [savedValues, setSavedValues] = React.useState<Record<string, { isEnabled: boolean; rolloutPercent: number }>>({});
  const [savingKey, setSavingKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.get<{ flags: Record<string, unknown>[] }>("/api/admin/flags").then((r) => {
      setFlags(r.flags);
      setSavedValues(Object.fromEntries(r.flags.map((flag) => [String(flag.key), { isEnabled: Boolean(flag.isEnabled), rolloutPercent: Number(flag.rolloutPercent) }])));
    }).catch(() => setFlags([]));
  }, []);

  const updateDraft = (key: string, changes: Record<string, unknown>) => {
    setFlags((current) => current?.map((flag) => String(flag.key) === key ? { ...flag, ...changes } : flag) ?? null);
  };

  const save = async (flag: Record<string, unknown>) => {
    const key = String(flag.key);
    setSavingKey(key);
    try {
      await api.patch("/api/admin/flags", {
        key, expectedUpdatedAt: flag.updatedAt,
        isEnabled: Boolean(flag.isEnabled), rolloutPercent: Number(flag.rolloutPercent),
      });
      const refreshed = await api.get<{ flags: Record<string, unknown>[] }>("/api/admin/flags");
      setFlags(refreshed.flags);
      setSavedValues(Object.fromEntries(refreshed.flags.map((item) => [String(item.key), { isEnabled: Boolean(item.isEnabled), rolloutPercent: Number(item.rolloutPercent) }])));
      toast.success(`Flag '${key}' updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
      if (e instanceof Error && e.message.toLowerCase().includes("changed since")) {
        const refreshed = await api.get<{ flags: Record<string, unknown>[] }>("/api/admin/flags").catch(() => null);
        if (refreshed) {
          setFlags(refreshed.flags);
          setSavedValues(Object.fromEntries(refreshed.flags.map((item) => [String(item.key), { isEnabled: Boolean(item.isEnabled), rolloutPercent: Number(item.rolloutPercent) }])));
        }
      }
    } finally {
      setSavingKey(null);
    }
  };

  if (!flags) return <LoadingState rows={3} />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Feature flags</h1>
        <p className="mt-1 text-sm text-muted-foreground">Runtime risk control (Q29). Rollout percentages gate exposure; changes are audited.</p>
      </header>
      <div className="space-y-3">
        {flags.map((f) => (
          <div key={String(f.key)} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-4">
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold">{String(f.key)}</p>
              <p className="text-xs text-muted-foreground">{String(f.description ?? "")}</p>
              <p className="num mt-1 text-xs text-muted-foreground">Rollout: {String(f.rolloutPercent)}% · updated {f.updatedBy ? String(f.updatedBy) : "system"}</p>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <span className="num text-xs text-muted-foreground">{String(f.rolloutPercent)}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={Number(f.rolloutPercent)}
                  disabled={!canEdit || savingKey === String(f.key)}
                  aria-label={`Rollout for ${String(f.key)}`}
                  onChange={(e) => updateDraft(String(f.key), { rolloutPercent: Number(e.target.value) })}
                  className="w-32 accent-[var(--brand)]"
                />
              </label>
              <Switch
                aria-label={`Enable ${String(f.key)}`}
                disabled={!canEdit || savingKey === String(f.key)}
                checked={Boolean(f.isEnabled)}
                onCheckedChange={(v) => updateDraft(String(f.key), { isEnabled: v })}
              />
              {canEdit && <Button size="sm" disabled={savingKey === String(f.key) || (savedValues[String(f.key)]?.isEnabled === Boolean(f.isEnabled) && savedValues[String(f.key)]?.rolloutPercent === Number(f.rolloutPercent))} onClick={() => save(f)}>{savingKey === String(f.key) ? "Saving…" : "Save"}</Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Units ------------------------------------ */

interface UnitsResponse {
  total: number;
  page: number;
  pageSize: number;
  availabilityOptions: string[];
  typeOptions: string[];
  projects: UnitProject[];
  properties: UnitProperty[];
  units: (UnitRow & { project: { name: string; slug: string } | null; property: { id: string; title: string; slug: string; projectId: string | null } | null })[];
  managedVia: string;
}

const AVAILABILITY_STYLES: Record<string, string> = {
  AVAILABLE: "bg-success/10 text-success",
  RESERVED: "bg-warning/10 text-warning",
  SOLD: "bg-muted text-muted-foreground",
  RENTED: "bg-muted text-muted-foreground",
  HELD: "bg-secondary text-secondary-foreground",
  WITHDRAWN: "bg-muted text-muted-foreground",
};

function UnitsSection({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = React.useState<UnitsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [project, setProject] = React.useState("all");
  const [availability, setAvailability] = React.useState("all");
  const [type, setType] = React.useState("all");
  const [beds, setBeds] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [exporting, setExporting] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [selectedUnit, setSelectedUnit] = React.useState<UnitRow | null>(null);

  React.useEffect(() => { setPage(1); }, [project, availability, type, beds]);

  React.useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (project !== "all") params.set("project", project);
    if (availability !== "all") params.set("availability", availability);
    if (type !== "all") params.set("type", type);
    if (beds !== "all") params.set("beds", beds);
    api.get<UnitsResponse>(`/api/admin/units?${params.toString()}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Units unavailable"));
  }, [project, availability, type, beds, page, reloadKey]);

  const refresh = () => setReloadKey((key) => key + 1);
  const openEdit = (unit: UnitsResponse["units"][number]) => { setSelectedUnit(unit); setEditorOpen(true); };
  const openCreate = () => { setSelectedUnit(null); setEditorOpen(true); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (project !== "all") params.set("project", project);
      if (availability !== "all") params.set("availability", availability);
      if (type !== "all") params.set("type", type);
      if (beds !== "all") params.set("beds", beds);
      const csv = await api.get<string>(`/api/admin/units?${params.toString()}`);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `units-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Units CSV exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={() => location.reload()} />;
  if (!data) return <LoadingState rows={5} />;

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  /* group rows by project for the rendered table */
  const groups: { name: string; slug: string | null; rows: UnitsResponse["units"] }[] = [];
  for (const u of data.units) {
    const name = u.project?.name ?? u.property?.title ?? "Unassigned units";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.rows.push(u);
    else groups.push({ name, slug: u.project?.slug ?? u.property?.slug ?? null, rows: [u] });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Units inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatNumber(data.total)} units across {formatNumber(data.projects.length)} projects — tower/floor, size, price and availability per unit.
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />Manual edits are audited. Imported values retain their source snapshot, with Admin edits stored as overrides.</p>
        </div>
        <div className="flex flex-wrap gap-2">{canEdit && <><Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>Import CSV</Button><Button size="sm" onClick={openCreate} disabled={!data.projects.length}>Add unit</Button></>}<Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={exporting}>{exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}Export CSV</Button></div>
      </header>

      <div className="flex flex-wrap gap-2">
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="h-9 w-56" aria-label="Filter by project"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects ({formatNumber(data.projects.reduce((s, p) => s + p.unitCount, 0))})</SelectItem>
            {data.projects.map((p) => (
              <SelectItem key={p.id} value={p.slug}>{p.name} ({p.unitCount})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={availability} onValueChange={setAvailability}>
          <SelectTrigger className="h-9 w-44" aria-label="Filter by availability"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All availability</SelectItem>
            {data.availabilityOptions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-9 w-40" aria-label="Filter by unit type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {data.typeOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={beds} onValueChange={setBeds}>
          <SelectTrigger className="h-9 w-36" aria-label="Filter by bedrooms"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any beds</SelectItem>
            <SelectItem value="0">Studio</SelectItem>
            {[1, 2, 3, 4, 5].map((b) => <SelectItem key={b} value={String(b)}>{b} bed{b > 1 ? "s" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {data.units.length === 0 ? (
        <EmptyState title="No units match these filters" description="Adjust project, availability, type or bedrooms filters." />
      ) : (
        <div className="overflow-x-safe rounded-xl border border-border/70">
          <table className="w-full min-w-[880px] text-sm">
            <caption className="sr-only">Unit inventory grouped by project</caption>
            <thead>
              <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-3 font-medium">Unit</th>
                <th scope="col" className="p-3 font-medium">Type</th>
                <th scope="col" className="p-3 font-medium">Beds / Baths</th>
                <th scope="col" className="p-3 font-medium">Size (sqft)</th>
                <th scope="col" className="p-3 font-medium">Floor</th>
                <th scope="col" className="p-3 font-medium">Aspect</th>
                <th scope="col" className="p-3 font-medium">Price</th>
                <th scope="col" className="p-3 font-medium">Availability</th>
                <th scope="col" className="p-3 font-medium">Source</th>
                {canEdit && <th scope="col" className="p-3 font-medium">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={`${g.name}-${g.rows[0].id}`}>
                  <tr className="border-b border-border/60 bg-sand/25">
                    <th scope="colgroup" colSpan={canEdit ? 10 : 9} className="p-2.5 text-left">
                      {g.slug ? (
                        <Link to={`/projects/${g.slug}`} className="text-xs font-semibold uppercase tracking-wide text-brand-strong hover:underline">
                          {g.name}
                        </Link>
                      ) : (
                        <span className="text-xs font-semibold uppercase tracking-wide text-brand-strong">{g.name}</span>
                      )}
                      <span className="ml-2 num text-[11px] font-normal text-muted-foreground">{g.rows.length} on this page</span>
                    </th>
                  </tr>
                  {g.rows.map((u) => (
                    <tr key={u.id} className="border-b border-border/40 last:border-0">
                      <td className="num p-3 font-semibold">{u.unitNumber ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">{u.unitType}</td>
                      <td className="num p-3">{u.bedrooms === 0 ? "Studio" : `${u.bedrooms} / ${u.bathrooms}`}</td>
                      <td className="num p-3">{u.areaSqft ? formatNumber(u.areaSqft) : "—"}</td>
                      <td className="num p-3">{u.floor ?? "—"}</td>
                      <td className="p-3 text-xs text-muted-foreground">{u.aspect ?? "—"}</td>
                      <td className="num p-3 font-medium">
                        {u.priceMinor ? formatMoney(u.priceMinor, { currency: u.currency }) : "—"}
                      </td>
                      <td className="p-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", AVAILABILITY_STYLES[u.availabilityStatus] ?? "bg-muted text-muted-foreground")}>
                          {u.availabilityStatus}
                        </span>
                      </td>
                      <td className="p-3"><details className="max-w-56 text-xs"><summary className="cursor-pointer">{u.sourceType}{u.sourceKey ? ` · ${u.sourceKey}` : ""}</summary><div className="mt-1 space-y-1 text-muted-foreground"><p>Source snapshot keys: {Object.keys(u.sourceSnapshot).join(", ") || "none"}</p><p>Editorial overrides: {Object.keys(u.editorOverrides).join(", ") || "none"}</p><p>Updated {formatDate(u.updatedAt)}</p>{u.statusHistory.map((history, index) => <p key={`${history.createdAt}-${index}`}>{history.fromStatus ?? "Created"} → {history.toStatus}{history.reason ? ` · ${history.reason}` : ""}</p>)}</div></details></td>
                      {canEdit && <td className="p-3"><Button size="sm" variant="outline" onClick={() => openEdit(u)}>Edit</Button></td>}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="num text-xs text-muted-foreground">
          {formatNumber(data.total)} units · page {page} of {formatNumber(totalPages)}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
      {canEdit && <><UnitEditorDialog open={editorOpen} onOpenChange={setEditorOpen} unit={selectedUnit} projects={data.projects} properties={data.properties} onChanged={refresh} /><UnitImportDialog open={importOpen} onOpenChange={setImportOpen} projects={data.projects} defaultProjectId={data.projects.find((item) => item.slug === project)?.id ?? data.projects[0]?.id ?? ""} onChanged={refresh} /></>}
    </div>
  );
}

/* ------------------------------ Evidence ---------------------------------- */

interface EvidenceDomainReportDto {
  key: string;
  label: string;
  records: number;
  sourceRecorded: number;
  sourceRecordedPct: number;
  verifiableProvenance: number;
  verifiableProvenancePct: number;
  coverageNote: string;
  demoFlagged: number;
  demoFlaggedPct: number;
  lastRetrievedAt: string | null;
  stateDistribution: Partial<Record<MetricState, number>>;
}

interface EvidenceResponse {
  dataState: string;
  generatedAt: string;
  domains: EvidenceDomainReportDto[];
  totals: { records: number; sourceRecordedPct: number; verifiableProvenancePct: number; demoFlaggedPct: number };
}

const METRIC_STATE_CHIP: Record<MetricState, string> = {
  VERIFIED_SOURCE: "bg-success/10 text-success",
  APPROVED_INTERNAL: "bg-success/10 text-success",
  MODELED: "bg-brand-soft text-brand-strong",
  USER_INPUT: "bg-secondary text-muted-foreground",
  ILLUSTRATIVE: "bg-brand-faint text-brand-strong",
  STALE: "bg-warning/10 text-warning",
  UNAVAILABLE: "bg-warning/5 text-warning/80",
};

const DATA_STATE_CHIP: Record<string, string> = {
  LOCAL_DEMO: "border-brand/40 bg-brand-soft text-brand-strong",
  STAGING_FIXTURE: "border-brand/40 bg-brand-soft text-brand-strong",
  PRODUCTION_VERIFIED: "border-success/40 bg-success/10 text-success",
  PRODUCTION_UNVERIFIED: "border-warning/40 bg-warning/10 text-warning",
};

function CoverageMeter({ pct, label }: { pct: number; label?: string }) {
  const tone = pct >= 80 ? "bg-success" : pct >= 40 ? "bg-brand" : "bg-warning";
  return (
    <div className="min-w-28">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sand" role="img" aria-label={`${label ?? "Coverage"} ${pct}%`}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="num mt-1 block text-[11px] text-muted-foreground">{pct}%</span>
    </div>
  );
}

function EvidenceSection() {
  const [data, setData] = React.useState<EvidenceResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.get<EvidenceResponse>("/api/admin/evidence").then(setData).catch((e) => setError(e instanceof Error ? e.message : "Evidence overview unavailable"));
  }, []);

  if (error) return <ErrorState message={error} onRetry={() => location.reload()} />;
  if (!data) return <LoadingState rows={5} />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Evidence & provenance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-domain record counts, source coverage, freshness and data-state distribution (U09 state machine, §37/§38).
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card p-4">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide",
            DATA_STATE_CHIP[data.dataState] ?? "border-border bg-secondary text-muted-foreground"
          )}
        >
          Environment: {data.dataState.replace(/_/g, " ")}
        </span>
        <p className="text-xs text-muted-foreground">
          Every figure inherits this environment state — demo/staging datasets are presented as <strong>illustrative</strong> even when a row claims a verified source.
          Snapshot {formatDate(data.generatedAt, undefined, { dateStyle: "medium", timeStyle: "short" })}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Governed records", value: formatNumber(data.totals.records) },
          { label: "Source recorded", value: `${data.totals.sourceRecordedPct}%` },
          { label: "Verifiable provenance", value: `${data.totals.verifiableProvenancePct}%` },
          { label: "Demo / illustrative", value: `${data.totals.demoFlaggedPct}%` },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-border/70 bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <p className="num mt-1.5 font-display text-2xl font-semibold">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-safe rounded-xl border border-border/70">
        <table className="w-full min-w-[1080px] text-sm">
          <caption className="sr-only">Provenance coverage by data domain</caption>
          <thead>
            <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="p-3 font-medium">Domain</th>
              <th scope="col" className="p-3 font-medium">Records</th>
              <th scope="col" className="p-3 font-medium">Source recorded</th>
              <th scope="col" className="p-3 font-medium">Verifiable provenance</th>
              <th scope="col" className="p-3 font-medium">Demo / illustrative</th>
              <th scope="col" className="p-3 font-medium">Last retrieved</th>
              <th scope="col" className="p-3 font-medium">Data-state distribution</th>
            </tr>
          </thead>
          <tbody>
            {data.domains.map((d) => (
              <tr key={d.key} className="border-b border-border/40 last:border-0">
                <td className="p-3">
                  <p className="font-medium">{d.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{d.coverageNote}</p>
                </td>
                <td className="num p-3 font-semibold">{formatNumber(d.records)}</td>
                <td className="p-3"><CoverageMeter pct={d.sourceRecordedPct} label={`${d.label} source recorded`} /></td>
                <td className="p-3"><CoverageMeter pct={d.verifiableProvenancePct} label={`${d.label} verifiable provenance`} /></td>
                <td className="num p-3">
                  {formatNumber(d.demoFlagged)} <span className="text-xs text-muted-foreground">({d.demoFlaggedPct}%)</span>
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {d.lastRetrievedAt ? formatDate(d.lastRetrievedAt, undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(d.stateDistribution).map(([state, count]) => (
                      <span
                        key={state}
                        title={`${state}: ${count} of ${d.records} records`}
                        className={cn("num rounded-full px-2 py-0.5 text-[10px] font-semibold", METRIC_STATE_CHIP[state as MetricState] ?? "bg-muted text-muted-foreground")}
                      >
                        {state === "ILLUSTRATIVE" ? "Illustrative" : state === "VERIFIED_SOURCE" ? "Verified" : state === "APPROVED_INTERNAL" ? "Approved" : state === "MODELED" ? "Modeled" : state === "USER_INPUT" ? "User input" : state === "STALE" ? "Stale" : "Unavailable"} · {formatNumber(count as number)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        <strong>Source recorded</strong> = share of records whose source-publisher field is present (sourceType / sourceName / source).{" "}
        <strong>Verifiable provenance</strong> is the stricter per-domain definition shown under each domain (e.g. citable sourceUrl for market metrics,
        community linkage for DLD rows). Coverage gaps are reported, never masked.
      </p>
    </div>
  );
}

/* ------------------------------ Data Quality ------------------------------- */

interface ValidationSummaryDto {
  totalRecords: number;
  validRecords: number;
  excludedRecords: number;
  exclusionReasons: Record<string, number>;
  perSqftEligibleRecords: number;
}

interface DataQualityResponse {
  generatedAt: string;
  dataState: string;
  status: string;
  note: string;
  coverage: Record<"rents" | "transactions", { storedRows: number; evaluatedRows: number; truncated: boolean; illustrativeRows: number; latestObservedDate: string | null; latestStoredAt: string | null }>;
  rents: ValidationSummaryDto;
  transactions: ValidationSummaryDto;
  perSqftCoverage: { areaName: string; validRecords: number; perSqftEligible: number; coveragePct: number }[];
  rules: { key: string; domain: string; severity: string; description: string }[];
  openIssues: number;
  openIssuesBySeverity: { severity: string; count: number }[];
}

function ValidationCard({ title, summary }: { title: string; summary: ValidationSummaryDto }) {
  const maxReason = Math.max(...Object.values(summary.exclusionReasons), 1);
  return (
    <div className="rounded-xl border border-border/70 bg-card p-5">
      <h2 className="kicker mb-3">{title}</h2>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="num font-display text-2xl font-semibold">{formatNumber(summary.totalRecords)}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total rows</p>
        </div>
        <div>
          <p className="num font-display text-2xl font-semibold text-success">{formatNumber(summary.validRecords)}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Valid</p>
        </div>
        <div>
          <p className="num font-display text-2xl font-semibold text-warning">{formatNumber(summary.excludedRecords)}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Excluded</p>
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        {Object.entries(summary.exclusionReasons).map(([reason, count]) => (
          <div key={reason} className="flex items-center gap-2 text-xs">
            <span className="w-52 shrink-0 truncate font-mono text-muted-foreground" title={reason}>{reason}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-sand">
              <div className={cn("h-full rounded", count > 0 ? (["zero_bedrooms_non_studio", "non_positive_rent", "non_positive_amount"].includes(reason) ? "bg-destructive/70" : "bg-warning") : "bg-transparent")} style={{ width: `${(count / maxReason) * 100}%` }} />
            </div>
            <span className="num w-8 shrink-0 text-right font-semibold">{count}</span>
          </div>
        ))}
      </div>
      <p className="num mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
        Per-sqft eligible (usable size): <strong className="text-foreground">{formatNumber(summary.perSqftEligibleRecords)}</strong> of {formatNumber(summary.validRecords)} valid rows
      </p>
    </div>
  );
}

function DataQualitySection() {
  const [data, setData] = React.useState<DataQualityResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.get<DataQualityResponse>("/api/admin/data-quality").then(setData).catch((e) => setError(e instanceof Error ? e.message : "Data-quality summary unavailable"));
  }, []);

  if (error) return <ErrorState message={error} onRetry={() => location.reload()} />;
  if (!data) return <LoadingState rows={5} />;

  const exportDqReport = () => {
    const lines: string[] = [];
    lines.push(`Investment Experts — Data Quality Report,${data.generatedAt}`);
    lines.push(`Environment data state,${data.dataState}`);
    lines.push(`Scan status,${data.status}`);
    for (const [domain, coverage] of Object.entries(data.coverage)) lines.push(`${domain} scan coverage,${coverage.evaluatedRows},${coverage.storedRows},${coverage.truncated ? "PARTIAL" : "COMPLETE"}`);
    lines.push("");
    lines.push("Domain,Total rows,Valid,Excluded,Per-sqft eligible");
    lines.push(`Rents,${data.rents.totalRecords},${data.rents.validRecords},${data.rents.excludedRecords},${data.rents.perSqftEligibleRecords}`);
    lines.push(`Transactions,${data.transactions.totalRecords},${data.transactions.validRecords},${data.transactions.excludedRecords},${data.transactions.perSqftEligibleRecords}`);
    lines.push("");
    lines.push("Exclusion reasons (rents)");
    for (const [k, v] of Object.entries(data.rents.exclusionReasons)) lines.push(`${k},${v}`);
    lines.push("");
    lines.push("Exclusion reasons (transactions)");
    for (const [k, v] of Object.entries(data.transactions.exclusionReasons)) lines.push(`${k},${v}`);
    lines.push("");
    lines.push("Area,Valid records,Per-sqft eligible,Coverage %");
    for (const c of data.perSqftCoverage) lines.push([c.areaName, c.validRecords, c.perSqftEligible, c.coveragePct].map(csvCell).join(","));
    lines.push("");
    lines.push("Open ingestion issues," + data.openIssues);
    lines.push("");
    lines.push("Rule,Domain,Severity,Description");
    for (const r of data.rules) lines.push([r.key, r.domain, r.severity, r.description].map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `data-quality-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("DQ report exported");
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Data quality</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Validation exclusions and per-sqft coverage for the evaluated records below.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Query-scoped governance — records are reported, never deleted. {data.openIssues > 0 && <>Open ingestion issues: <strong className="text-warning">{data.openIssues}</strong> (see Imports &amp; Quality).</>}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={exportDqReport}>
          <Download className="h-4 w-4" aria-hidden /> Export DQ report (CSV)
        </Button>
      </header>

      <section aria-label="Data quality scan coverage" className="rounded-xl border p-4 text-sm">
        <p><strong>{data.status}</strong> · Measured {data.generatedAt}</p>
        <p className="mt-2 text-muted-foreground">{data.note}</p>
        {Object.entries(data.coverage).map(([domain, coverage]) => <p className="mt-2" key={domain}>{domain}: {coverage.evaluatedRows} evaluated / {coverage.storedRows} stored · {coverage.illustrativeRows} illustrative · latest observation {coverage.latestObservedDate ?? "unknown"} · latest stored {coverage.latestStoredAt ?? "unknown"}{coverage.truncated && " · PARTIAL"}</p>)}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ValidationCard title="Rents validation (DLD contracts)" summary={data.rents} />
        <ValidationCard title="Transactions validation (DLD sales)" summary={data.transactions} />
      </div>

      <div className="rounded-xl border border-border/70 bg-card p-5">
        <h2 className="kicker mb-3">Per-community per-sqft coverage</h2>
        <div className="max-h-72 overflow-y-auto scroll-elegant">
          <table className="w-full text-sm">
            <caption className="sr-only">Per-sqft coverage by community</caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-2 font-medium">Area</th>
                <th scope="col" className="p-2 font-medium">Valid rows</th>
                <th scope="col" className="p-2 font-medium">Per-sqft eligible</th>
                <th scope="col" className="p-2 font-medium">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {data.perSqftCoverage.map((c) => (
                <tr key={c.areaName} className="border-b border-border/40 last:border-0">
                  <td className="p-2 font-medium">{c.areaName}</td>
                  <td className="num p-2 text-muted-foreground">{formatNumber(c.validRecords)}</td>
                  <td className="num p-2 text-muted-foreground">{formatNumber(c.perSqftEligible)}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-sand" role="img" aria-label={`${c.areaName} per-sqft coverage ${c.coveragePct}%`}>
                        <div
                          className={cn("h-full rounded-full", c.coveragePct >= 80 ? "bg-success" : c.coveragePct >= 40 ? "bg-brand" : "bg-warning")}
                          style={{ width: `${Math.min(100, c.coveragePct)}%` }}
                        />
                      </div>
                      <span className="num text-xs font-semibold">{c.coveragePct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-x-safe rounded-xl border border-border/70">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Data-quality rule catalogue (read-only)</caption>
          <thead>
            <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="p-3 font-medium">Rule</th>
              <th scope="col" className="p-3 font-medium">Domain</th>
              <th scope="col" className="p-3 font-medium">Severity</th>
              <th scope="col" className="p-3 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {data.rules.map((r) => (
              <tr key={`${r.domain}-${r.key}`} className="border-b border-border/40 last:border-0">
                <td className="p-3 font-mono text-xs font-semibold">{r.key}</td>
                <td className="p-3 text-xs text-muted-foreground">{r.domain}</td>
                <td className="p-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", r.severity === "HARD" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
                    {r.severity}
                  </span>
                </td>
                <td className="p-3 text-xs text-muted-foreground">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
