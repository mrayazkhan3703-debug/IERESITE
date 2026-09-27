"use client";

import { CompanyView } from "./about-view";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { ProvenanceBadge } from "@/components/common";

export default function CareersView() {
  return (
    <CompanyView
      page="Careers"
      kicker="Join us"
      title="Build the evidence layer of Dubai property"
      intro="We hire for judgment: advisors who can defend a number, engineers who sweat provenance, and operators who treat a lead like a promise."
    >
      <div className="mt-8 space-y-4">
        {[
          { title: "Senior Property Consultant — Waterfront & Off-Plan", team: "Advisory", location: "Downtown Dubai" },
          { title: "Investment Analyst (Market Intelligence)", team: "Research", location: "Downtown Dubai" },
          { title: "Full-Stack Engineer (Platform)", team: "Engineering", location: "Dubai / Remote-friendly" },
        ].map((r) => (
          <div key={r.title} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-5">
            <div>
              <h2 className="font-display text-lg font-semibold">{r.title}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{r.team} · {r.location}</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/contact" query={{ topic: `Application: ${r.title}` }}>Apply via contact</Link>
            </Button>
          </div>
        ))}
        <div className="rounded-lg border border-border/70 bg-sand/50 p-4 text-xs text-muted-foreground">
          <ProvenanceBadge chip={{ sourceType: "DEMO" }} />
          <span className="ml-2">Role descriptions are illustrative for this development deployment — confirm live openings with the team.</span>
        </div>
      </div>
    </CompanyView>
  );
}
