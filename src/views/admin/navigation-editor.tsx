"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import { clientRequestId } from "@/lib/client-request-id";
import type { SiteSettings } from "@/lib/site-settings";

type Item = SiteSettings["companyLinks"][number];
type Labels = Pick<Item, "key" | "labelEn" | "labelAr">;
const label = (item: Labels, locale: "en" | "ar") => (locale === "en" ? item.labelEn : item.labelAr) || (item.key ? t(item.key, locale) : "");
const labels = (item: Labels, locale: "en" | "ar", text: string): Labels => ({ key: undefined, labelEn: locale === "en" ? text : label(item, "en"), labelAr: locale === "ar" ? text : label(item, "ar") });
const newLink = (): Item => ({ to: "/contact", labelEn: "New link", labelAr: "رابط جديد", enabled: true });
function move<T>(items: T[], index: number, delta: -1 | 1) {
  const next = [...items]; const target = index + delta;
  if (target >= 0 && target < items.length) [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function LabelFields({ value, onChange }: { value: Labels; onChange: (value: Labels) => void }) {
  return <div className="grid gap-2 sm:grid-cols-2">{(["en", "ar"] as const).map((locale) => <label key={locale} className="space-y-1 text-xs">{locale === "en" ? "English label" : "Arabic label"}<Input maxLength={100} dir={locale === "ar" ? "rtl" : undefined} value={label(value, locale)} onChange={(event) => onChange(labels(value, locale, event.target.value))} /></label>)}</div>;
}

function LinkRows({ items, onChange, max }: { items: Item[]; onChange: (items: Item[]) => void; max: number }) {
  const update = (index: number, item: Item) => onChange(items.map((current, i) => i === index ? item : current));
  return <div className="space-y-3">{items.map((item, index) => <div key={index} className="space-y-2 rounded-lg border p-3">
    <LabelFields value={item} onChange={(value) => update(index, { ...item, ...value })} />
    <label className="block space-y-1 text-xs">Public destination<Input value={item.to + (item.query && Object.keys(item.query).length ? `?${new URLSearchParams(item.query)}` : "")} onChange={(event) => { const [to, query] = event.target.value.split("?"); update(index, { ...item, to, query: query ? Object.fromEntries(new URLSearchParams(query)) : undefined }); }} placeholder="/pages/your-page" /></label>
    <div className="flex flex-wrap items-center gap-2"><label className="mr-auto flex items-center gap-2 text-xs"><input type="checkbox" checked={item.enabled !== false} onChange={(event) => update(index, { ...item, enabled: event.target.checked })} />Visible</label><Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => onChange(move(items, index, -1))}>Up</Button><Button type="button" size="sm" variant="outline" disabled={index === items.length - 1} onClick={() => onChange(move(items, index, 1))}>Down</Button><Button type="button" size="sm" variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))}>Remove</Button></div>
  </div>)}<Button type="button" size="sm" variant="outline" disabled={items.length >= max} onClick={() => onChange([...items, newLink()])}>Add link</Button></div>;
}

export function NavigationEditor({ settings, onChange }: { settings: SiteSettings; onChange: (patch: Partial<SiteSettings>) => void }) {
  return <div className="space-y-5">
    <h3 className="font-semibold">Header groups</h3>
    {settings.headerGroups.map((group, index) => <section key={group.id} className="space-y-3 rounded-xl border p-4"><LabelFields value={group} onChange={(value) => onChange({ headerGroups: settings.headerGroups.map((current, i) => i === index ? { ...current, ...value } : current) })} /><LinkRows items={group.items} max={10} onChange={(items) => onChange({ headerGroups: settings.headerGroups.map((current, i) => i === index ? { ...current, items } : current) })} /><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => onChange({ headerGroups: move(settings.headerGroups, index, -1) })}>Move group up</Button><Button type="button" size="sm" variant="outline" disabled={index === settings.headerGroups.length - 1} onClick={() => onChange({ headerGroups: move(settings.headerGroups, index, 1) })}>Move group down</Button><Button type="button" size="sm" variant="ghost" disabled={settings.headerGroups.length === 1} onClick={() => onChange({ headerGroups: settings.headerGroups.filter((_, i) => i !== index) })}>Remove group</Button></div></section>)}
    <Button type="button" size="sm" variant="outline" disabled={settings.headerGroups.length >= 5} onClick={() => onChange({ headerGroups: [...settings.headerGroups, { id: `group-${clientRequestId()}`, labelEn: "New group", labelAr: "مجموعة جديدة", items: [] }] })}>Add header group</Button>
    <h3 className="font-semibold">Advisor link</h3><LinkRows items={[settings.advisorLink]} max={1} onChange={(items) => onChange({ advisorLink: items[0] ?? { ...settings.advisorLink, enabled: false } })} />
    <h3 className="font-semibold">Company links</h3><LinkRows items={settings.companyLinks} max={8} onChange={(companyLinks) => onChange({ companyLinks })} />
    <h3 className="font-semibold">Footer columns</h3>
    {settings.footerColumns.map((column, index) => <section key={column.id} className="space-y-3 rounded-xl border p-4"><LabelFields value={column} onChange={(value) => onChange({ footerColumns: settings.footerColumns.map((current, i) => i === index ? { ...current, ...value } : current) })} /><LinkRows items={column.links} max={12} onChange={(links) => onChange({ footerColumns: settings.footerColumns.map((current, i) => i === index ? { ...current, links } : current) })} /><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => onChange({ footerColumns: move(settings.footerColumns, index, -1) })}>Move column up</Button><Button type="button" size="sm" variant="outline" disabled={index === settings.footerColumns.length - 1} onClick={() => onChange({ footerColumns: move(settings.footerColumns, index, 1) })}>Move column down</Button><Button type="button" size="sm" variant="ghost" disabled={settings.footerColumns.length === 1} onClick={() => onChange({ footerColumns: settings.footerColumns.filter((_, i) => i !== index) })}>Remove column</Button></div></section>)}
    <Button type="button" size="sm" variant="outline" disabled={settings.footerColumns.length >= 5} onClick={() => onChange({ footerColumns: [...settings.footerColumns, { id: `footer-${clientRequestId()}`, labelEn: "New column", labelAr: "عمود جديد", links: [] }] })}>Add footer column</Button>
  </div>;
}
