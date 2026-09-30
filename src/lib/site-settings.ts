import { z } from "zod";
import { SITE_CONTACT } from "@/lib/config";

export const HOME_MODULE_IDS = [
  "market-pulse", "opportunity-radar", "atlas-preview", "curated-properties",
  "off-plan-radar", "community-intelligence", "ai-advisor", "scenario-lab",
  "evidence-methodology", "advisor-matching", "international-entry", "trust-proof", "final-cta",
] as const;
export type HomeModuleId = typeof HOME_MODULE_IDS[number];

const localPath = z.string().trim().min(1).max(300).refine((value) => {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("%") || /[\\\u0000-\u001f]/.test(value)) return false;
  return !/^\/(?:admin|api|account|auth|_next)(?:\/|$)/i.test(value);
}, "Use a same-site public route.");

const labelKey = z.string().regex(/^[a-z][a-zA-Z0-9_.-]{1,79}$/).optional();
const localizedLabel = z.string().trim().max(100).optional();
const navItem = z.object({
  to: localPath,
  key: labelKey,
  labelEn: localizedLabel,
  labelAr: localizedLabel,
  enabled: z.boolean().optional(),
  query: z.record(z.string().max(50), z.string().max(100)).optional(),
}).strict().refine((item) => Boolean(item.key || (item.labelEn?.trim() && item.labelAr?.trim())), "Provide a built-in label key or both English and Arabic labels.");

const navGroup = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  key: labelKey,
  labelEn: localizedLabel,
  labelAr: localizedLabel,
  items: z.array(navItem).max(10),
}).strict().refine((group) => Boolean(group.key || (group.labelEn?.trim() && group.labelAr?.trim())), "Provide a built-in label key or both group labels.");

const footerColumn = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  key: labelKey,
  labelEn: localizedLabel,
  labelAr: localizedLabel,
  links: z.array(navItem).max(12),
}).strict().refine((column) => Boolean(column.key || (column.labelEn?.trim() && column.labelAr?.trim())), "Provide a built-in label key or both column labels.");

const siteSettingsSchema = z.object({
  headerGroups: z.array(navGroup).min(1).max(5),
  advisorLink: navItem,
  companyLinks: z.array(navItem).max(8),
  footerColumns: z.array(footerColumn).min(1).max(5),
  contact: z.object({
    phoneDisplay: z.string().trim().min(3).max(50),
    phoneE164: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    whatsappE164: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    whatsappDisplay: z.string().trim().min(3).max(50),
    addressLine1: z.string().trim().max(160),
    addressLine2: z.string().trim().max(160),
    mapsUrl: z.string().url().refine((value) => value.startsWith("https://")),
    officeHours: z.string().trim().max(240),
  }).strict(),
  globalCta: z.object({ key: labelKey, labelEn: localizedLabel, labelAr: localizedLabel, to: localPath })
    .strict().refine((cta) => Boolean(cta.key || (cta.labelEn?.trim() && cta.labelAr?.trim())), "Provide a built-in label key or both CTA labels."),
  homeModuleOrder: z.array(z.enum(HOME_MODULE_IDS)).max(HOME_MODULE_IDS.length)
    .refine((items) => new Set(items).size === items.length, "Homepage modules cannot be repeated."),
  socialLinks: z.array(z.object({
    platform: z.enum(["linkedin", "instagram", "facebook", "youtube", "x"]),
    href: z.string().url().refine((value) => value.startsWith("https://")),
    labelEn: z.string().trim().min(1).max(60),
    labelAr: z.string().trim().min(1).max(60),
  }).strict()).max(8),
  defaultOgMediaId: z.string().min(1).max(128).nullable(),
  fallbackImageMediaId: z.string().min(1).max(128).nullable(),
}).strict();

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  headerGroups: [
    { id: "properties", key: "nav.groups.properties", items: [
      { to: "/buy", key: "nav.buy" }, { to: "/rent", key: "nav.rent" },
      { to: "/off-plan", key: "nav.offPlan" }, { to: "/projects", key: "nav.newLaunches", query: { sort: "new" } },
    ] },
    { id: "explore", key: "nav.groups.explore", items: [
      { to: "/communities", key: "nav.communities" }, { to: "/developers", key: "nav.developers" },
      { to: "/properties/map", key: "nav.map" }, { to: "/market", key: "nav.market" },
    ] },
    { id: "invest", key: "nav.groups.invest", items: [
      { to: "/invest/opportunities", key: "nav.opportunities" }, { to: "/calculators", key: "nav.investorTools" },
      { to: "/market", key: "nav.reports" }, { to: "/international", key: "nav.internationalBuyers" },
    ] },
  ],
  advisorLink: { to: "/agents", key: "nav.groups.advisors" },
  companyLinks: [
    { to: "/about/team", key: "footer.company.team" },
    { to: "/about", key: "footer.company.about" },
    { to: "/contact", key: "footer.company.contact" },
  ],
  footerColumns: [
    { id: "discover", key: "footer.discover.title", links: [
      { to: "/buy", key: "footer.discover.buy" }, { to: "/rent", key: "footer.discover.rent" },
      { to: "/off-plan", key: "footer.discover.offPlan" }, { to: "/projects", key: "footer.discover.newProjects", query: { sort: "new" } },
      { to: "/communities", key: "footer.discover.communities" }, { to: "/properties/map", key: "footer.discover.map" },
    ] },
    { id: "intelligence", key: "footer.intelligence.title", links: [
      { to: "/market", key: "footer.intelligence.market" }, { to: "/market/transactions", key: "footer.intelligence.transactions" },
      { to: "/market/rents", key: "footer.intelligence.rentalTrends" }, { to: "/market", key: "footer.intelligence.reports", query: { tab: "reports" } },
      { to: "/calculators", key: "footer.intelligence.calculators" },
    ] },
    { id: "company", key: "footer.company.title", links: [
      { to: "/about", key: "footer.company.about" }, { to: "/about/team", key: "footer.company.team" },
      { to: "/agents", key: "footer.company.advisors" }, { to: "/contact", key: "footer.company.contact" },
      { to: "/careers", key: "footer.company.careers" },
    ] },
    { id: "legal", key: "footer.legal.title", links: [
      { to: "/privacy", key: "footer.legal.privacy" }, { to: "/terms", key: "footer.legal.terms" },
      { to: "/cookie-settings", key: "footer.legal.cookies" },
    ] },
  ],
  contact: {
    phoneDisplay: SITE_CONTACT.phone,
    phoneE164: SITE_CONTACT.phoneE164,
    whatsappE164: SITE_CONTACT.whatsappE164,
    whatsappDisplay: SITE_CONTACT.whatsappLabel,
    addressLine1: SITE_CONTACT.addressLine1,
    addressLine2: SITE_CONTACT.addressLine2,
    mapsUrl: SITE_CONTACT.mapsUrl,
    officeHours: "",
  },
  globalCta: { key: "nav.contact.book", to: "/consultation" },
  homeModuleOrder: [...HOME_MODULE_IDS],
  socialLinks: [],
  defaultOgMediaId: null,
  fallbackImageMediaId: null,
};

export function parseSiteSettings(value: unknown): SiteSettings | null {
  const parsed = siteSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isPublicSitePath(value: string): boolean {
  return localPath.safeParse(value).success;
}
