"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, LoadingState, ProvenanceBadge } from "@/components/common";
import { formatDate } from "@/lib/money";
import { ShieldCheck } from "lucide-react";

interface DeveloperCard {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  verificationStatus: string;
  lastVerifiedAt: string | null;
  projectCount: number;
}

export default function DevelopersView() {
  const [developers, setDevelopers] = React.useState<DeveloperCard[] | null>(null);

  usePageMeta({
    title: "Dubai Property Developers — Profiles & Track Records",
    description:
      "Profiles of Dubai's leading property developers — current and completed projects, locations, payment-plan approaches and source-backed delivery information.",
  });

  React.useEffect(() => {
    api.get<{ developers: DeveloperCard[] }>("/api/developers").then((r) => setDevelopers(r.developers)).catch(() => setDevelopers([]));
  }, []);

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Developers" }]} />
      <div className="mt-4">
        <SectionHeading
          kicker="Developer intelligence"
          title="Who builds what — and how they deliver"
          as="h1"
          description="Developer profiles with verification status and delivery track record. In production, delivery history is computed from DLD project data with full provenance."
        />
      </div>
      {developers === null ? (
        <LoadingState rows={4} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {developers.map((d) => (
            <Link
              key={d.id}
              to={`/developers/${d.slug}`}
              className="group rounded-xl border border-border/70 bg-card p-6 transition-ui hover:border-brand/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-soft font-display text-lg font-semibold text-brand-strong" aria-hidden>
                  {d.name.slice(0, 2).toUpperCase()}
                </div>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  {d.verificationStatus.replace(/_/g, " ").toLowerCase()}
                  {d.lastVerifiedAt && ` · ${formatDate(d.lastVerifiedAt)}`}
                </span>
              </div>
              <h2 className="mt-4 font-display text-lg font-semibold text-ink group-hover:text-brand-strong">{d.name}</h2>
              <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{d.summary}</p>
              <p className="num mt-4 border-t border-border/60 pt-3 text-sm font-medium">{d.projectCount} active projects</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
