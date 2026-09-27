"use client";

import * as React from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { navigate } from "@/lib/router";
import { api } from "@/lib/api-client";
import {
  Search,
  Map,
  Calculator,
  Phone,
  Bot,
  TrendingUp,
  Scale,
  Building2,
  Landmark,
  Users,
  Home,
  BookOpen,
  Lightbulb,
  Globe,
  Info,
  FileText,
  CornerDownLeft,
} from "lucide-react";

/** Static entry: label, route, icon, keywords for matching. */
interface StaticEntry {
  label: string;
  route: string;
  icon: typeof Search;
  keywords?: string;
}

const QUICK_ACTIONS: StaticEntry[] = [
  { label: "Search properties for sale", route: "/properties?type=sale", icon: Search, keywords: "buy sale listings homes apartments villas" },
  { label: "Search properties for rent", route: "/properties?type=rent", icon: Search, keywords: "rent rental lease tenants annual" },
  { label: "Map search", route: "/properties/map", icon: Map, keywords: "map explore areas geography" },
  { label: "AI Property Advisor", route: "/advisor", icon: Bot, keywords: "ai chat assistant ask question" },
  { label: "Book a consultation", route: "/consultation", icon: Phone, keywords: "call meeting advisor book schedule viewing" },
  { label: "Compare properties", route: "/compare", icon: Scale, keywords: "compare side by side shortlist" },
  { label: "Investment opportunities", route: "/invest/opportunities", icon: TrendingUp, keywords: "invest yield roi returns opportunities" },
];

const TOOLS: StaticEntry[] = [
  { label: "All calculators", route: "/calculators", icon: Calculator, keywords: "tools calculators finance" },
  { label: "Mortgage calculator", route: "/calculators/mortgage", icon: Calculator, keywords: "mortgage loan payment amortization" },
  { label: "ROI scenario calculator", route: "/calculators/roi", icon: Calculator, keywords: "roi return appreciation projection" },
  { label: "Rental yield calculator", route: "/calculators/yield", icon: Calculator, keywords: "yield rent gross net" },
  { label: "Payment plan calculator", route: "/calculators/payment-plan", icon: Calculator, keywords: "off-plan installments plan cash flow" },
  { label: "Currency converter", route: "/calculators/currency", icon: Calculator, keywords: "currency fx usd eur gbp convert" },
];

const BROWSE: StaticEntry[] = [
  { label: "Communities & areas", route: "/communities", icon: Building2, keywords: "areas neighborhoods districts marina downtown" },
  { label: "New projects & off-plan", route: "/projects", icon: Landmark, keywords: "developments construction launch off-plan" },
  { label: "Developers", route: "/developers", icon: Building2, keywords: "emaar damac soba builders" },
  { label: "Advisors & agents", route: "/agents", icon: Users, keywords: "agents brokers advisors team specialists" },
  { label: "Market intelligence", route: "/market", icon: TrendingUp, keywords: "data transactions rents metrics reports" },
  { label: "Guides", route: "/guides", icon: BookOpen, keywords: "guides how-to buying process" },
  { label: "Insights & analysis", route: "/insights", icon: Lightbulb, keywords: "articles analysis research insights" },
  { label: "International buyers", route: "/international", icon: Globe, keywords: "golden visa international abroad remote" },
  { label: "Guides for sellers / valuation", route: "/sell", icon: Home, keywords: "sell valuation list property owner" },
  { label: "About & contact", route: "/about", icon: Info, keywords: "about team careers contact company" },
];

interface AutocompleteItem {
  kind: "community" | "project" | "property" | "area" | string;
  label: string;
  sublabel?: string;
  slug: string;
  count?: number;
}

const KIND_META: Record<string, { route: (slug: string) => string; icon: typeof Search; label: string }> = {
  community: { route: (s) => `/communities/${s}`, icon: Building2, label: "Community" },
  project: { route: (s) => `/projects/${s}`, icon: Landmark, label: "Project" },
  property: { route: (s) => `/properties/${s}`, icon: Home, label: "Property" },
  area: { route: (s) => `/communities/${s}`, icon: Map, label: "Area" },
};

/** Global command palette — Cmd/Ctrl+K. Static navigation + live autocomplete search. */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<AutocompleteItem[] | null>(null);

  // Global shortcut + external open requests (e.g. header search button)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpenRequest = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("ie:open-command-palette", onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("ie:open-command-palette", onOpenRequest);
    };
  }, []);

  // Debounced live search
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .get<{ items: AutocompleteItem[] }>(`/api/search/autocomplete?q=${encodeURIComponent(q)}&limit=6`)
        .then((r) => setResults(r.items ?? []))
        .catch(() => setResults([]));
    }, 220);
    return () => clearTimeout(t);
  }, [query, open]);

  const go = React.useCallback((route: string) => {
    const [path, search] = route.split("?");
    const query: Record<string, string> = {};
    if (search) for (const [k, v] of new URLSearchParams(search)) query[k] = v;
    navigate(path, query);
    setOpen(false);
    setQuery("");
    setResults(null);
  }, []);

  const runSearch = React.useCallback(() => {
    const q = query.trim();
    go(q ? `/properties?q=${encodeURIComponent(q)}` : "/properties");
  }, [query, go]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={query.trim().length < 2}>
      <CommandInput
        placeholder="Search properties, communities, pages…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {query.trim().length >= 2 ? (
            <button type="button" onClick={runSearch} className="mx-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-ui hover:text-foreground">
              No direct matches — search listings for “{query.trim()}” <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            "Type to search inventory, or pick a destination below."
          )}
        </CommandEmpty>

        {/* Live inventory results (only when query ≥ 2 chars) */}
        {results !== null && results.length > 0 && (
          <CommandGroup heading="Inventory">
            {results.map((r) => {
              const meta = KIND_META[r.kind] ?? { route: () => "/properties", icon: Search, label: r.kind };
              return (
                <CommandItem
                  key={`${r.kind}-${r.slug}`}
                  value={`${r.kind}-${r.label}-${r.slug}`}
                  onSelect={() => go(meta.route(r.slug))}
                >
                  <meta.icon className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.sublabel ? `${r.sublabel} · ` : ""}
                    {meta.label}
                  </span>
                </CommandItem>
              );
            })}
            <CommandItem value={`search-listings-${query}`} onSelect={runSearch}>
              <Search className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              <span className="flex-1">See all listings matching “{query.trim()}”</span>
            </CommandItem>
          </CommandGroup>
        )}
        {results !== null && results.length > 0 && <CommandSeparator />}

        {/* Static navigation */}
        {query.trim().length < 2 && (
          <>
            <CommandGroup heading="Quick actions">
              {QUICK_ACTIONS.map((a) => (
                <CommandItem key={a.route} value={`${a.label} ${a.keywords ?? ""}`} onSelect={() => go(a.route)}>
                  <a.icon className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Investor tools">
              {TOOLS.map((a) => (
                <CommandItem key={a.route} value={`${a.label} ${a.keywords ?? ""}`} onSelect={() => go(a.route)}>
                  <a.icon className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Browse">
              {BROWSE.map((a) => (
                <CommandItem key={a.route} value={`${a.label} ${a.keywords ?? ""}`} onSelect={() => go(a.route)}>
                  <a.icon className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Company">
              <CommandItem value="about about team company" onSelect={() => go("/about")}>
                <Info className="h-4 w-4 shrink-0 text-brand" aria-hidden /> About us
              </CommandItem>
              <CommandItem value="contact contact phone email reach" onSelect={() => go("/contact")}>
                <FileText className="h-4 w-4 shrink-0 text-brand" aria-hidden /> Contact
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
