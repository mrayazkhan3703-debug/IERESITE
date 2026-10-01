"use client";
import type { ReactNode } from "react";
import { Link, navigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogOut } from "lucide-react";
import { ADMIN_SECTIONS, canViewAdminSection, type AdminSection } from "./admin-sections";

export function AdminShell({ user, activeSection, onSignOut, children }: {
  user: { email: string; roles: string[] };
  activeSection: AdminSection;
  onSignOut: () => Promise<void>;
  children: ReactNode;
}) {
  const sections = ADMIN_SECTIONS.filter((section) => canViewAdminSection(section.key, user.roles));
  const navLinkClass = (active: boolean) => cn(
    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-ui",
    active ? "bg-brand-soft text-brand-strong" : "text-foreground/75 hover:bg-secondary",
  );
  return <div className="flex min-h-[calc(100vh-4rem)]">
    <aside className="hidden w-56 shrink-0 border-r border-border/70 bg-sand/30 lg:block" aria-label="Admin sections">
      <div className="sticky top-20 p-4"><p className="kicker px-2 pb-2">Console</p><nav className="space-y-0.5">
        {sections.map((section) => <Link key={section.key} to={`/admin/${section.key}`} aria-current={activeSection === section.key ? "page" : undefined} className={navLinkClass(activeSection === section.key)}><section.icon className="h-4 w-4" aria-hidden />{section.label}</Link>)}
      </nav><div className="mt-6 border-t border-border/70 pt-4"><p className="px-3 text-xs text-muted-foreground">{user.email}</p><p className="mt-0.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-brand-strong">{user.roles.join(" · ")}</p><Button variant="ghost" size="sm" className="mt-3 w-full justify-start gap-2 text-muted-foreground" onClick={async () => { await onSignOut(); navigate("/"); }}><LogOut className="h-4 w-4" aria-hidden />Sign out</Button></div></div>
    </aside>
    <div className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8"><nav className="mb-4 flex gap-2 overflow-x-auto scroll-elegant pb-1 lg:hidden" aria-label="Admin sections">
      {sections.map((section) => <Link key={section.key} to={`/admin/${section.key}`} aria-current={activeSection === section.key ? "page" : undefined} className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-ui", activeSection === section.key ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground")}>{section.label}</Link>)}
    </nav>{children}</div>
  </div>;
}
