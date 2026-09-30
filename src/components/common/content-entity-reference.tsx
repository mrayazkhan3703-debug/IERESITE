"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import type { ContentBlock } from "@/lib/content-blocks";

const SECTIONS = { property: "properties", project: "projects", community: "communities", developer: "developers", advisor: "agents" } as const;
export function ContentEntityReference({ block, locale }: { block: Extract<ContentBlock, { type: "entity" }>; locale: "en" | "ar" }) {
  const path = `/${SECTIONS[block.entity]}/${block.slug}`;
  const [available, setAvailable] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let active = true;
    setAvailable(null);
    fetch(`/api${path}`).then((response) => { if (active) setAvailable(response.ok); }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [path]);
  return <div className="my-4 min-h-12 rounded-lg border border-border/70 p-3 text-sm">{available === null ? <span className="text-muted-foreground">{locale === "ar" ? "جارٍ التحقق من الرابط…" : "Checking reference…"}</span> : available ? <Link to={path} className="font-medium text-brand-strong underline underline-offset-2">{block.label}</Link> : <span className="text-muted-foreground">{locale === "ar" ? "هذا المرجع غير متاح حالياً." : "This reference is currently unavailable."}</span>}</div>;
}
