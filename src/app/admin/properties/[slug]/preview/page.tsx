import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getPropertyDetailV2 } from "@/server/domain/read-models";
import { catalogReadFilter } from "@/server/domain/resource-policy";
import { requirePermission } from "@/server/auth";
import PropertyDetailView from "@/views/property-detail-view";

export const dynamic = "force-dynamic";

type PreviewPageProps = { params: Promise<{ slug: string }> };

const loadPreview = cache(async (slug: string) => {
  const user = await requirePermission("property:read");
  return getPropertyDetailV2(slug, { previewScope: catalogReadFilter(user) });
});

export async function generateMetadata({ params }: PreviewPageProps): Promise<Metadata> {
  const { slug } = await params;
  const property = await loadPreview(slug);
  return property
    ? { title: `Preview: ${property.title}`, robots: { index: false, follow: false } }
    : { title: "Property preview unavailable", robots: { index: false, follow: false } };
}

export default async function PropertyPreviewPage({ params }: PreviewPageProps) {
  const { slug } = await params;
  const property = await loadPreview(slug);
  if (!property) notFound();
  const printOrigin = new URL(process.env.APP_URL ?? "https://ieresite.onrender.com").origin;

  return (
    <AppShell>
      <aside className="border-b border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
        <div className="container-page flex flex-wrap items-center justify-between gap-2">
          <p><strong>Private draft preview.</strong> Only authorized catalog staff can view this saved property. It is not published.</p>
          <a className="font-semibold underline underline-offset-4" href="/admin/properties">Back to Property Studio</a>
        </div>
      </aside>
      <PropertyDetailView slug={property.slug} initialData={property} manageMetadata={false} previewMode printOrigin={printOrigin} />
    </AppShell>
  );
}
