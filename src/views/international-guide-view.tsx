"use client";

import { GuideArticleView } from "./guide-view";

export default function IntlGuideView({ slug }: { slug: string }) {
  return (
    <GuideArticleView
      slug={slug}
      base="guides"
      baseLabel="International"
      fallbackCategory="International"
      leadContext={{ intent: "CONSULT", entityTitle: "International buyer consultation" }}
    />
  );
}
