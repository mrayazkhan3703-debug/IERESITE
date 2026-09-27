import type { ComponentType } from "react";
import { notFound } from "next/navigation";
import PageShell from "@/components/page-shell";
import { criticalPageMetadata } from "./critical-page";
import { resolveSpaRoutePage } from "./route-contract";

/** Each concrete module imports its own view, never the old all-view client table. */
export function staticPage(path: string, View: ComponentType) {
  return {
    generateMetadata: () => criticalPageMetadata(path),
    Page: function Page() { return <PageShell><View /></PageShell>; },
  };
}

type SlugProps = { params: Promise<{ slug: string }> };
export function entityPage(prefix: string, View: ComponentType<{ slug: string }>) {
  return {
    generateMetadata: async ({ params }: SlugProps) => criticalPageMetadata(`${prefix}/${(await params).slug}`),
    Page: async function Page({ params }: SlugProps) {
      const { slug } = await params;
      // A mocked client DTO must not turn a missing/private server entity into 200.
      if (!(await resolveSpaRoutePage(`${prefix}/${slug}`))) notFound();
      return <PageShell><View slug={slug} /></PageShell>;
    },
  };
}
