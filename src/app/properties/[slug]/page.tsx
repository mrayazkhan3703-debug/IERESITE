import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { OG_IMAGE } from "@/lib/seo-schema";
import { getPropertyDetailV2 } from "@/server/domain/read-models";
import PropertyDetailView from "@/views/property-detail-view";

export const dynamic = "force-dynamic";

type PropertyPageProps = {
  params: Promise<{ slug: string }>;
};

const loadProperty = cache((slug: string) => getPropertyDetailV2(slug));

function propertyDescription(property: NonNullable<Awaited<ReturnType<typeof getPropertyDetailV2>>>): string {
  return (
    property.shortDescription ??
    `${property.propertyType} in ${property.community.name}${property.project ? ` — ${property.project.name}` : ""}. ${
      property.bedrooms === 0 ? "Studio" : `${property.bedrooms} bedroom`
    }, ${property.bathrooms} bath${property.builtUpAreaSqft ? `, ${property.builtUpAreaSqft.toLocaleString("en-US")} sqft` : ""}.`
  );
}

export async function generateMetadata({ params }: PropertyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const property = await loadProperty(slug);
  if (!property) {
    return {
      title: "Property not found",
      robots: { index: false, follow: false },
    };
  }

  const canonical = `/properties/${property.slug}`;
  const description = propertyDescription(property);
  const image = property.media[0]
    ? {
        url: property.media[0].url,
        width: property.media[0].width ?? undefined,
        height: property.media[0].height ?? undefined,
        alt: property.media[0].altText ?? property.title,
      }
    : OG_IMAGE;

  return {
    title: property.title,
    description,
    alternates: {
      canonical,
      languages: {
        en: canonical,
        ar: `/ar${canonical}`,
        "x-default": canonical,
      },
    },
    openGraph: {
      type: "website",
      url: canonical,
      title: property.title,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: property.title,
      description,
      images: [image.url],
    },
    robots: { index: true, follow: true },
  };
}

export default async function PropertyPage({ params }: PropertyPageProps) {
  const { slug } = await params;
  const property = await loadProperty(slug);
  if (!property) notFound();
  const cspNonce = (await headers()).get("x-nonce") ?? undefined;

  const canonicalPath = `/properties/${property.slug}`;
  const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
  const absolute = (path: string) => new URL(path, baseUrl).toString();
  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "RealEstateListing",
      name: property.title,
      url: absolute(canonicalPath),
      ...(property.listing?.publishedAt ? { datePosted: property.listing.publishedAt } : {}),
      ...(property.listing
        ? {
            offers: {
              "@type": "Offer",
              price: Number(property.listing.priceMinor) / 100,
              priceCurrency: property.listing.currency,
              availability:
                property.listing.availabilityStatus === "AVAILABLE"
                  ? "https://schema.org/InStock"
                  : "https://schema.org/SoldOut",
            },
          }
        : {}),
      ...(property.media[0] ? { image: [property.media[0].url] } : {}),
      address: {
        "@type": "PostalAddress",
        addressLocality: property.community.name,
        addressRegion: "Dubai",
        addressCountry: "AE",
      },
      numberOfRooms: property.bedrooms === 0 ? 1 : property.bedrooms,
      ...(property.builtUpAreaSqft
        ? {
            floorSize: {
              "@type": "QuantitativeValue",
              value: property.builtUpAreaSqft,
              unitCode: "FTK",
            },
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: absolute("/") },
        { "@type": "ListItem", position: 2, name: "Properties", item: absolute("/properties") },
        {
          "@type": "ListItem",
          position: 3,
          name: property.community.name,
          item: absolute(`/communities/${property.community.slug}`),
        },
        { "@type": "ListItem", position: 4, name: property.title, item: absolute(canonicalPath) },
      ],
    },
  ];

  return (
    <AppShell>
      {schemas.map((schema, index) => (
        <script
          key={index}
          nonce={cspNonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
        />
      ))}
      <PropertyDetailView slug={property.slug} initialData={property} manageMetadata={false} />
    </AppShell>
  );
}
