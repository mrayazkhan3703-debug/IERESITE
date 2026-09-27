import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { OG_IMAGE } from "@/lib/seo-schema";
import { getPropertyDetailV2 } from "@/server/domain/read-models";
import PropertyDetailView from "@/views/property-detail-view";

export const dynamic = "force-dynamic";

type ArabicPropertyPageProps = {
  params: Promise<{ slug: string }>;
};

const loadProperty = cache((slug: string) => getPropertyDetailV2(slug));

export async function generateMetadata({ params }: ArabicPropertyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const property = await loadProperty(slug);
  if (!property) {
    return { title: "العقار غير موجود", robots: { index: false, follow: false } };
  }

  const englishPath = `/properties/${property.slug}`;
  const canonical = `/ar${englishPath}`;
  const description =
    property.shortDescription ??
    `${property.propertyType} في ${property.community.name}، ${property.bedrooms} غرف نوم و${property.bathrooms} حمامات.`;
  const image = property.media[0]?.url ?? OG_IMAGE.url;

  return {
    title: property.title,
    description,
    alternates: {
      canonical,
      languages: { en: englishPath, ar: canonical, "x-default": englishPath },
    },
    openGraph: {
      type: "website",
      url: canonical,
      title: property.title,
      description,
      locale: "ar_AE",
      alternateLocale: ["en_AE"],
      images: [image],
    },
    twitter: { card: "summary_large_image", title: property.title, description, images: [image] },
    robots: { index: true, follow: true },
  };
}

export default async function ArabicPropertyPage({ params }: ArabicPropertyPageProps) {
  const { slug } = await params;
  const property = await loadProperty(slug);
  if (!property) notFound();

  return (
    <AppShell>
      <PropertyDetailView slug={property.slug} initialData={property} manageMetadata={false} />
    </AppShell>
  );
}
