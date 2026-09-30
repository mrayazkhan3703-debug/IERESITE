"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/common";
import { DEFAULT_SITE_SETTINGS, HOME_MODULE_IDS, PAGE_COPY_LABELS, type PageCopyKey, type HomeModuleId, type SiteSettings } from "@/lib/site-settings";
import { MediaForm } from "@/features/admin/shared/media-field";
import { PublicMediaPicker } from "@/features/admin/shared/public-media-picker";
import { NavigationEditor } from "./navigation-editor";
import { useUnsavedChanges } from "@/features/admin/shared/admin-primitives";

type Revision = { id: string; version: number; editedBy: string | null; changeNote: string | null; createdAt: string };
type SettingsReply = { settings: SiteSettings; version: number; updatedAt: string | null; revisions: Revision[] };
const moduleTitles: Record<HomeModuleId, string> = {
  "market-pulse": "Market pulse", "opportunity-radar": "Opportunity radar", "atlas-preview": "Atlas preview", "curated-properties": "Curated properties", "off-plan-radar": "Off-plan radar", "community-intelligence": "Community intelligence", "ai-advisor": "AI advisor", "scenario-lab": "Scenario lab", "evidence-methodology": "Evidence methodology", "advisor-matching": "Advisor matching", "international-entry": "International entry", "trust-proof": "Trust proof", "final-cta": "Final call to action",
};

export function SiteSettingsSection() {
  const [settings, setSettings] = React.useState<SiteSettings | null>(null);
  const [version, setVersion] = React.useState(0);
  const [revisions, setRevisions] = React.useState<Revision[]>([]);
  const [changeNote, setChangeNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const savedSnapshot = React.useRef("");
  useUnsavedChanges(settings !== null && JSON.stringify(settings) !== savedSnapshot.current);

  const load = React.useCallback(async () => {
    try {
      const result = await api.get<SettingsReply>("/api/admin/site-settings");
      setSettings(result.settings ?? DEFAULT_SITE_SETTINGS); setVersion(result.version ?? 0); setRevisions(result.revisions ?? []);
      savedSnapshot.current = JSON.stringify(result.settings ?? DEFAULT_SITE_SETTINGS);
      setLoadFailed(false);
    } catch { setLoadFailed(true); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const updateContact = (field: keyof SiteSettings["contact"], value: string) => {
    setSettings((current) => current ? { ...current, contact: { ...current.contact, [field]: value } } : current);
  };
  const moveModule = (id: HomeModuleId, delta: -1 | 1) => setSettings((current) => {
    if (!current) return current;
    const order = [...current.homeModuleOrder]; const from = order.indexOf(id); const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return current;
    [order[from], order[to]] = [order[to], order[from]];
    return { ...current, homeModuleOrder: order };
  });
  const toggleModule = (id: HomeModuleId, included: boolean) => setSettings((current) => {
    if (!current) return current;
    return { ...current, homeModuleOrder: included ? current.homeModuleOrder.filter((value) => value !== id) : [...current.homeModuleOrder, id] };
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!settings) return;
    setSaving(true);
    try {
      const result = await api.put<{ version: number }>("/api/admin/site-settings", { expectedVersion: version, settings, changeNote });
      setVersion(result.version); setChangeNote(""); toast.success("Public site settings saved"); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Settings could not be saved"); if (error instanceof Error && (error.message.toLowerCase().includes("changed") || error.message.toLowerCase().includes("version"))) await load(); }
    finally { setSaving(false); }
  };

  if (!settings) return loadFailed ? <div className="rounded-xl border border-border/70 p-5"><h1 className="font-display text-2xl font-semibold">Site settings</h1><p className="mt-2 text-sm text-muted-foreground">Settings did not load. Refresh the page or check that this account has owner/admin access.</p><Button className="mt-4" variant="outline" onClick={() => void load()}>Try again</Button></div> : <LoadingState rows={5} />;
  const customCta = settings.globalCta;
  return <MediaForm className="space-y-6" onSubmit={save}>
    <header><h1 className="font-display text-2xl font-semibold">Site settings</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Edit public contact details, navigation, footer, the home page module order and the main call to action. URLs are limited to HTTPS or safe same-site public routes. Every save creates a version and audit record.</p></header>

    <section className="grid gap-4 rounded-xl border border-border/70 bg-card p-5 sm:grid-cols-2">
      <h2 className="font-display text-lg font-semibold sm:col-span-2">Public contact</h2>
      <label className="space-y-1 text-sm">Phone display<Input value={settings.contact.phoneDisplay} onChange={(event) => updateContact("phoneDisplay", event.target.value)} /></label>
      <label className="space-y-1 text-sm">Phone E.164<Input value={settings.contact.phoneE164} onChange={(event) => updateContact("phoneE164", event.target.value)} placeholder="+971…" /></label>
      <label className="space-y-1 text-sm">WhatsApp E.164<Input value={settings.contact.whatsappE164} onChange={(event) => updateContact("whatsappE164", event.target.value)} /></label>
      <label className="space-y-1 text-sm">WhatsApp display<Input value={settings.contact.whatsappDisplay} onChange={(event) => updateContact("whatsappDisplay", event.target.value)} /></label>
      <label className="space-y-1 text-sm sm:col-span-2">Address line 1<Input value={settings.contact.addressLine1} onChange={(event) => updateContact("addressLine1", event.target.value)} /></label>
      <label className="space-y-1 text-sm sm:col-span-2">Address line 2<Input value={settings.contact.addressLine2} onChange={(event) => updateContact("addressLine2", event.target.value)} /></label>
      <label className="space-y-1 text-sm">Directions URL (HTTPS)<Input type="url" value={settings.contact.mapsUrl} onChange={(event) => updateContact("mapsUrl", event.target.value)} /></label>
      <label className="space-y-1 text-sm">Office hours<Input value={settings.contact.officeHours} onChange={(event) => updateContact("officeHours", event.target.value)} /></label>
    </section>

    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-5">
      <div><h2 className="font-display text-lg font-semibold">Navigation and footer links</h2><p className="mt-1 text-xs text-muted-foreground">Edit English and Arabic labels, destinations, ordering and visibility. Destinations must be public routes on this site.</p></div>
      <NavigationEditor settings={settings} onChange={(patch) => setSettings({ ...settings, ...patch })} />
    </section>

    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-5">
      <div><h2 className="font-display text-lg font-semibold">Home page modules</h2><p className="mt-1 text-xs text-muted-foreground">Move modules up or down, or hide them. The hero stays first; unsupported modules cannot be added.</p></div>
      <ol className="space-y-2">{settings.homeModuleOrder.map((id, index) => <li key={id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><span className="text-sm font-medium">{index + 1}. {moduleTitles[id]}</span><span className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => moveModule(id, -1)}>Up</Button><Button type="button" size="sm" variant="outline" disabled={index === settings.homeModuleOrder.length - 1} onClick={() => moveModule(id, 1)}>Down</Button><Button type="button" size="sm" variant="ghost" onClick={() => toggleModule(id, true)}>Hide</Button></span></li>)}</ol>
      <div className="flex flex-wrap gap-2">{HOME_MODULE_IDS.filter((id) => !settings.homeModuleOrder.includes(id)).map((id) => <Button type="button" key={id} size="sm" variant="outline" onClick={() => toggleModule(id, false)}>Add {moduleTitles[id]}</Button>)}</div>
    </section>

    <section className="space-y-4 rounded-xl border border-border/70 bg-card p-5">
      <div><h2 className="font-display text-lg font-semibold">Core page copy</h2><p className="mt-1 text-xs text-muted-foreground">Customize headings and introductions in both languages. Leave a field on its built-in copy to retain the approved default. Source-sensitive guidance belongs in Content Studio.</p></div>
      {(Object.keys(PAGE_COPY_LABELS) as PageCopyKey[]).map((key) => <div key={key} className="space-y-2 rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{PAGE_COPY_LABELS[key]}</h3><Button type="button" size="sm" variant="ghost" onClick={() => setSettings({ ...settings, pageCopy: { ...settings.pageCopy, [key]: null } })}>Use built-in copy</Button></div><div className="grid gap-3 sm:grid-cols-2">{(["en", "ar"] as const).map((locale) => <label key={locale} className="space-y-1 text-xs">{locale === "en" ? "English" : "Arabic"}<Textarea rows={2} maxLength={1000} dir={locale === "ar" ? "rtl" : undefined} placeholder="Built-in copy is active" value={settings.pageCopy[key]?.[locale] ?? ""} onChange={(event) => setSettings({ ...settings, pageCopy: { ...settings.pageCopy, [key]: { en: settings.pageCopy[key]?.en ?? "", ar: settings.pageCopy[key]?.ar ?? "", [locale]: event.target.value } } })} /></label>)}</div></div>)}
    </section>

    <section className="grid gap-3 rounded-xl border border-border/70 bg-card p-5 sm:grid-cols-3">
      <h2 className="font-display text-lg font-semibold sm:col-span-3">Main call to action</h2>
      <label className="space-y-1 text-sm">English label<Input value={customCta.labelEn ?? ""} placeholder={customCta.key ? "Built-in label is active" : "English label"} onChange={(event) => setSettings({ ...settings, globalCta: { ...customCta, key: undefined, labelEn: event.target.value, labelAr: customCta.labelAr ?? "" } })} /></label>
      <label className="space-y-1 text-sm">Arabic label<Input value={customCta.labelAr ?? ""} placeholder={customCta.key ? "Built-in label is active" : "Arabic label"} onChange={(event) => setSettings({ ...settings, globalCta: { ...customCta, key: undefined, labelEn: customCta.labelEn ?? "", labelAr: event.target.value } })} /></label>
      <label className="space-y-1 text-sm">Public route<Input value={customCta.to} onChange={(event) => setSettings({ ...settings, globalCta: { ...customCta, to: event.target.value } })} /></label>
    </section>

    <section className="grid gap-4 rounded-xl border border-border/70 bg-card p-5 md:grid-cols-2"><div className="md:col-span-2"><h2 className="font-display text-lg font-semibold">Default public images</h2><p className="mt-1 text-xs text-muted-foreground">Only public Media Library images are accepted. Route-specific SEO images can still override the global default.</p></div><PublicMediaPicker label="Default social preview image" value={settings.defaultOgMediaId ?? ""} onChange={(defaultOgMediaId) => setSettings({ ...settings, defaultOgMediaId: defaultOgMediaId || null })} /><PublicMediaPicker label="Fallback image" value={settings.fallbackImageMediaId ?? ""} onChange={(fallbackImageMediaId) => setSettings({ ...settings, fallbackImageMediaId: fallbackImageMediaId || null })} /></section>

    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-5"><h2 className="font-display text-lg font-semibold">Social links</h2>{settings.socialLinks.map((social, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"><label className="space-y-1 text-xs">Platform<select className="h-10 w-full rounded-md border bg-background px-3" value={social.platform} onChange={(event) => setSettings({ ...settings, socialLinks: settings.socialLinks.map((value, i) => i === index ? { ...value, platform: event.target.value as typeof social.platform } : value) })}>{["linkedin", "instagram", "facebook", "youtube", "x"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="space-y-1 text-xs">HTTPS destination<Input type="url" value={social.href} onChange={(event) => setSettings({ ...settings, socialLinks: settings.socialLinks.map((value, i) => i === index ? { ...value, href: event.target.value } : value) })} /></label>{(["labelEn", "labelAr"] as const).map((key) => <label key={key} className="space-y-1 text-xs">{key === "labelEn" ? "English label" : "Arabic label"}<Input maxLength={60} value={social[key]} onChange={(event) => setSettings({ ...settings, socialLinks: settings.socialLinks.map((value, i) => i === index ? { ...value, [key]: event.target.value } : value) })} /></label>)}<Button type="button" variant="ghost" size="sm" onClick={() => setSettings({ ...settings, socialLinks: settings.socialLinks.filter((_, i) => i !== index) })}>Remove social link</Button></div>)}<Button type="button" variant="outline" size="sm" disabled={settings.socialLinks.length >= 8} onClick={() => setSettings({ ...settings, socialLinks: [...settings.socialLinks, { platform: "linkedin", href: "", labelEn: "LinkedIn", labelAr: "لينكد إن" }] })}>Add social link</Button></section>

    <section className="flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-card p-5"><label className="min-w-64 flex-1 space-y-1 text-sm">Change note<Input maxLength={300} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="Why are these settings changing?" /></label><Badge variant="outline">Version {version}</Badge><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save site settings"}</Button></section>
    <section className="rounded-xl border border-border/70 bg-card p-5"><h2 className="font-display text-lg font-semibold">Recent revisions</h2>{revisions.length ? <ol className="mt-3 space-y-2">{revisions.map((revision) => <li key={revision.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><span><Badge variant="outline">v{revision.version}</Badge><span className="ml-2">{revision.changeNote ?? "No note"}</span></span><span className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</span></li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No settings revisions yet.</p>}</section>
  </MediaForm>;
}
