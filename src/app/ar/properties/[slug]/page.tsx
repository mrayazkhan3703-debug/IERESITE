import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getPropertyDetailV2 } from "@/server/domain/read-models";
import { resolveSpaRoutePage, spaRouteMetadata } from "@/server/seo/route-contract";
import PropertyDetailView from "@/views/property-detail-view";

export const dynamic = "force-dynamic";

type ArabicPropertyPageProps = {
  params: Promise<{ slug: string }>;
};

const loadProperty = cache((slug: string) => getPropertyDetailV2(slug));

export async function generateMetadata({ params }: ArabicPropertyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const englishPath = `/properties/${slug}`;
  return spaRouteMetadata(englishPath, "ar", await resolveSpaRoutePage(englishPath));
}

export default async function ArabicPropertyPage({ params }: ArabicPropertyPageProps) {
  const { slug } = await params;
  const property = await loadProperty(slug);
  if (!property) notFound();
  const printOrigin = new URL(process.env.APP_URL ?? "https://ieresite.onrender.com").origin;

  return (
    <AppShell>
      <PropertyDetailView slug={property.slug} initialData={property} manageMetadata={false} printOrigin={printOrigin} />
    </AppShell>
  );
}
