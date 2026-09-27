"use client";

import { GuideArticleView } from "./guide-view";

export default function ArticleView({ slug }: { slug: string }) {
  return <GuideArticleView slug={slug} base="insights" baseLabel="Insights" fallbackCategory="Insight" />;
}
