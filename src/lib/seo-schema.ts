/**
 * Verified structured-data builders (V3-19 SEO structured data).
 *
 * ONE authoritative Organization schema (rendered on the app home + shared
 * company pages) built exclusively from the verified SITE_CONTACT values:
 * name, url, logo, telephone, postal address, sameAs → Google-Maps link.
 * NO email (none was supplied — V3-B01 — so the property is omitted, never
 * invented) and no aggregateRating/review claims anywhere.
 *
 * Person / RealEstateAgent builders emit only fields the team data actually
 * carries: empty jobTitle or a missing phone simply omits the property.
 * Client-safe: pure functions over static config + window-free fallbacks.
 */

import { SITE_CONTACT, SITE_LOGO, SITE_POSTAL_ADDRESS } from "@/lib/config";

/** Absolute URL for a same-origin path (relative fallback pre-hydration). */
export function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

/** Default Open Graph image — the real Dubai-skyline hero artwork (1344×768). */
export const OG_IMAGE = {
  url: "/images/brand/hero-skyline.jpg",
  width: 1344,
  height: 768,
  alt: "Dubai skyline at dusk across the water — Investment Experts",
} as const;

/**
 * The authoritative Organization schema (V3-19). Rendered once per page via
 * usePageMeta on the home route and the shared company views; everything is
 * verified company data (V3-01 real values; V3-B01: no email exists).
 */
export function organizationJsonLd(contact: { phoneE164: string; addressLine1: string; addressLine2: string; mapsUrl: string } = SITE_CONTACT): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: SITE_CONTACT.name,
    url: absoluteUrl("/"),
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl(SITE_LOGO.dark),
      width: SITE_LOGO.width,
      height: SITE_LOGO.height,
    },
    telephone: contact.phoneE164,
    address: {
      "@type": "PostalAddress",
      ...SITE_POSTAL_ADDRESS,
      streetAddress: [contact.addressLine1, contact.addressLine2].filter(Boolean).join(", "),
    },
    /* Verified external identity link — the company's Google-Maps place. */
    sameAs: [contact.mapsUrl],
  };
}

/** Minimal self-contained Organization reference for worksFor/provider. */
export function organizationRef(): Record<string, unknown> {
  return {
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: SITE_CONTACT.name,
    url: absoluteUrl("/"),
    telephone: SITE_CONTACT.phoneE164,
    address: { "@type": "PostalAddress", ...SITE_POSTAL_ADDRESS },
  };
}

export interface PersonSchemaInput {
  slug: string;
  name: string;
  /** Empty/null = unverified → the property is omitted (e.g. members 19/23). */
  jobTitle?: string | null;
  /** Direct member line — omitted when none was supplied. */
  phoneE164?: string | null;
}

/**
 * Person schema for a verified team member (V3 §12 data): name + jobTitle
 * (when supplied) + telephone (when supplied) + profile URL + worksFor ref.
 * No invented employer claims, ratings, or contact channels.
 */
export function personJsonLd(member: PersonSchemaInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": absoluteUrl(`/agents/${member.slug}#person`),
    name: member.name,
    url: absoluteUrl(`/agents/${member.slug}`),
    ...(member.jobTitle ? { jobTitle: member.jobTitle } : {}),
    ...(member.phoneE164 ? { telephone: member.phoneE164 } : {}),
    worksFor: organizationRef(),
  };
}

/**
 * RealEstateAgent schema for an advisor profile (V3 §13): only verified
 * fields — name, telephone where a real number exists, jobTitle when
 * supplied. The advisory-desk record additionally carries the company
 * address so the central routing surface is fully described.
 */
export function realEstateAgentJsonLd(agent: PersonSchemaInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    "@id": absoluteUrl(`/agents/${agent.slug}#agent`),
    url: absoluteUrl(`/agents/${agent.slug}`),
    name: agent.name,
    ...(agent.jobTitle ? { jobTitle: agent.jobTitle } : {}),
    ...(agent.phoneE164 ? { telephone: agent.phoneE164 } : {}),
    ...(agent.slug === "advisory-desk"
      ? {
          address: { "@type": "PostalAddress", ...SITE_POSTAL_ADDRESS },
          areaServed: { "@type": "City", name: "Dubai" },
        }
      : {}),
  };
}
