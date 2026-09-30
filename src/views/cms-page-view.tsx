"use client";

import { GuideArticleView } from "@/views/guide-view";

export default function CmsPageView({ slug }: { slug: string }) {
  return <GuideArticleView slug={slug} base="pages" baseLabel="Pages" fallbackCategory="Page" />;
}
