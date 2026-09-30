"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useHomeData, type HomeData } from "@/components/home/use-home-data";
import { SearchBar } from "@/components/search/search-bar";
import { Link } from "@/lib/router";
import type { ContentBlock } from "@/lib/content-blocks";

const ScenarioLab = dynamic(() => import("@/components/home/scenario-lab").then((module) => module.ScenarioLab));
const MarketPulse = dynamic(() => import("@/components/home/market-pulse").then((module) => module.MarketPulse));
const AtlasPreview = dynamic(() => import("@/components/home/atlas-preview").then((module) => module.AtlasPreview));
const CuratedProperties = dynamic(() => import("@/components/home/curated-properties").then((module) => module.CuratedProperties));
const DataContext = React.createContext<HomeData | null>(null);

function DataScope({ children }: { children: React.ReactNode }) {
  const data = useHomeData();
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

export function CmsModuleScope({ blocks, children }: { blocks: ContentBlock[]; children: React.ReactNode }) {
  const needsData = blocks.some((block) => block.type === "module" && ["market-intelligence", "property-map", "featured-properties"].includes(block.id));
  return needsData ? <DataScope>{children}</DataScope> : <>{children}</>;
}

export function CmsModule({ id, locale }: { id: Extract<ContentBlock, { type: "module" }>["id"]; locale: "en" | "ar" }) {
  const data = React.useContext(DataContext);
  switch (id) {
    case "property-search": return <section className="my-6 rounded-xl border bg-sand/30 p-5"><h2 className="mb-4 font-display text-xl font-semibold">{locale === "ar" ? "ابحث عن عقار" : "Find a property"}</h2><SearchBar chips placeholder={locale === "ar" ? "المجتمع أو المشروع أو الكلمة الرئيسية" : "Community, project or keyword"} /></section>;
    case "calculator-hub": return <ScenarioLab locale={locale} />;
    case "market-intelligence": return <MarketPulse locale={locale} pulse={data?.pulse ?? null} />;
    case "property-map": return <AtlasPreview locale={locale} communities={data?.communities ?? null} communityMetrics={data?.communityMetrics ?? null} projects={data?.projects ?? null} />;
    case "featured-properties": return <CuratedProperties locale={locale} featured={data?.featured ?? null} contextFor={data?.contextFor ?? (() => undefined)} />;
    case "advisor-contact": return <section className="my-6 rounded-xl border border-brand/25 bg-brand-faint p-5"><h2 className="font-display text-lg font-semibold">{locale === "ar" ? "تحدث إلى مستشار" : "Talk to an advisor"}</h2><p className="mt-2 text-sm text-muted-foreground">{locale === "ar" ? "شارك أهدافك مع فريق الاستشارات." : "Share your goals with the advisory team."}</p><Link to="/consultation" className="mt-3 inline-block text-sm font-semibold text-brand-strong underline underline-offset-2">{locale === "ar" ? "ابدأ المحادثة" : "Start a conversation"}</Link></section>;
  }
}
