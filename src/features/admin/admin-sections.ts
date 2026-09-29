import {
  Activity, BarChart3, BookOpenCheck, Boxes, Building2, Download, FileSearch, Flag, FolderKanban,
  Gauge, Globe2, Images, Landmark, LayoutDashboard, Link2, MapPin, MessageSquareQuote, Newspaper,
  RefreshCcw, ScrollText, ShieldCheck, Users, BriefcaseBusiness,
} from "lucide-react";
import type { ElementType } from "react";

export type AdminSection =
  | "overview" | "leads" | "properties" | "projects" | "communities" | "developers" | "agents" | "users" | "content" | "faqs" | "market-reports" | "knowledge-base" | "testimonials" | "redirects" | "seo-metadata" | "media" | "units" | "imports" | "crm" | "jobs"
  | "analytics" | "audit" | "flags" | "evidence" | "data-quality";

type Role = "OWNER" | "ADMIN" | "MANAGER" | "CONTENT_EDITOR" | "AGENT" | "ANALYST";
export const ADMIN_SECTIONS: { key: AdminSection; label: string; icon: ElementType; roles: readonly Role[] }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, roles: ["OWNER", "ADMIN", "MANAGER", "CONTENT_EDITOR", "AGENT", "ANALYST"] },
  { key: "leads", label: "Leads", icon: Users, roles: ["OWNER", "ADMIN", "AGENT"] },
  { key: "properties", label: "Properties", icon: Building2, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "projects", label: "Projects", icon: FolderKanban, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "communities", label: "Communities", icon: MapPin, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "developers", label: "Developers", icon: Landmark, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "agents", label: "Team", icon: BriefcaseBusiness, roles: ["OWNER", "ADMIN", "MANAGER", "CONTENT_EDITOR"] },
  { key: "users", label: "Users & access", icon: ShieldCheck, roles: ["OWNER", "ADMIN"] },
  { key: "content", label: "Content", icon: Newspaper, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "faqs", label: "FAQs", icon: Newspaper, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "market-reports", label: "Market reports", icon: FileSearch, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "knowledge-base", label: "AI Knowledge", icon: BookOpenCheck, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "testimonials", label: "Testimonials", icon: MessageSquareQuote, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "redirects", label: "Redirects", icon: Link2, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "seo-metadata", label: "SEO metadata", icon: Globe2, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "media", label: "Media Library", icon: Images, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "units", label: "Units", icon: Boxes, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "imports", label: "Imports & Quality", icon: Download, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "evidence", label: "Evidence", icon: FileSearch, roles: ["OWNER", "ADMIN", "ANALYST"] },
  { key: "data-quality", label: "Data Quality", icon: Gauge, roles: ["OWNER", "ADMIN", "ANALYST"] },
  { key: "crm", label: "CRM Sync", icon: RefreshCcw, roles: ["OWNER", "ADMIN"] },
  { key: "jobs", label: "Jobs & DLQ", icon: Activity, roles: ["OWNER", "ADMIN", "CONTENT_EDITOR"] },
  { key: "analytics", label: "Analytics", icon: BarChart3, roles: ["OWNER", "ADMIN", "ANALYST"] },
  { key: "audit", label: "Audit Log", icon: ScrollText, roles: ["OWNER", "ADMIN", "ANALYST"] },
  { key: "flags", label: "Feature Flags", icon: Flag, roles: ["OWNER", "ADMIN"] },
];

export function canViewAdminSection(section: AdminSection, roles: readonly string[]) {
  const definition = ADMIN_SECTIONS.find((candidate) => candidate.key === section);
  return Boolean(definition && definition.roles.some((role) => roles.includes(role)));
}

export function adminSectionFromLocation(path: string, querySection?: string): AdminSection {
  const nested = path.startsWith("/admin/") ? path.slice("/admin/".length).split("/")[0] : undefined;
  const requested = nested || querySection || "overview";
  return ADMIN_SECTIONS.some(({ key }) => key === requested) ? requested as AdminSection : "overview";
}
