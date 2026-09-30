"use client";

import * as React from "react";
import { CompanyView } from "./about-view";
import { Link, useRoute } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/common";
import { BriefcaseBusiness } from "lucide-react";

interface Opening {
  slug: string; title: string; department: string; location: string; employmentType: string; workplaceType: string;
  summary: string; description: string; closesAt: string | null;
}

export default function CareersView() {
  const route = useRoute();
  const locale = route.locale === "ar" ? "ar" : "en";
  const [openings, setOpenings] = React.useState<Opening[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    fetch(`/api/careers/openings?locale=${locale}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) { setOpenings(data?.openings ?? []); setLoadFailed(!data); } })
      .catch(() => { if (active) { setOpenings([]); setLoadFailed(true); } });
    return () => { active = false; };
  }, [locale]);

  return <CompanyView page="Careers" kicker="Join us" title="Build the evidence layer of Dubai property" intro="Explore roles currently approved and published by the team.">
    <div className="mt-8 space-y-4">
      {openings === null ? <LoadingState rows={3} /> : loadFailed ? <EmptyState title="Openings could not be loaded" description="Refresh the page to retry." /> : openings.length === 0 ? <EmptyState title="No current openings" description="There are no published vacancies at this time. Please check again later." /> : openings.map((opening) => <article key={opening.slug} className="rounded-xl border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3"><BriefcaseBusiness className="mt-1 h-5 w-5 text-brand" aria-hidden /><div><h2 className="font-display text-lg font-semibold"><Link to={`/careers/${opening.slug}`} className="hover:text-brand-strong">{opening.title}</Link></h2><p className="mt-0.5 text-sm text-muted-foreground">{opening.department} · {opening.location} · {opening.employmentType} · {opening.workplaceType}</p><p className="mt-3 max-w-3xl text-sm text-foreground/85">{opening.summary}</p></div></div>
          <Button variant="outline" size="sm" asChild><Link to={`/careers/${opening.slug}`}>{locale === "ar" ? "عرض الوظيفة" : "View opening"}</Link></Button>
        </div>
      </article>)}
    </div>
  </CompanyView>;
}
