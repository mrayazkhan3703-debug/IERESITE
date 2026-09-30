"use client";

/**
 * ProjectDetailV2 client type + project-page helpers (U07 — §15).
 * Mirrors the additive server projection in getProjectDetailV2.
 */

import type { MediaDTO } from "@/lib/types";
import type { EntityAgentLite } from "@/components/entity/entity-shared";

export interface ProjectDetailV2 {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  summary: string | null;
  description: string | null;
  status: string;
  projectType: string;
  launchDate: string | null;
  handoverDate: string | null;
  completionPercent: number | null;
  constructionStatus: string | null;
  constructionSourceUrl: string | null;
  constructionSourceVerifiedAt: string | null;
  totalUnits: number | null;
  startingPriceMinor: string | null;
  currency: string;
  lat: number;
  lng: number;
  highlights: string[];
  keyAmenities: string[];
  developer: { id: string; name: string; slug: string; summary: string | null; verificationStatus: string; lastVerifiedAt: string | null };
  community: { id: string; name: string; slug: string; summary: string | null; lat: number; lng: number };
  media: MediaDTO[];
  progressMedia?: MediaDTO[];
  amenities: { key: string; name: string }[];
  paymentPlans: {
    id: string;
    name: string;
    totalPercent: number;
    postHandover: boolean;
    verificationStatus: string;
    isDefault: boolean;
    installments: { sequence: number; label: string; percent: number; dueOffsetMonths: number | null }[];
  }[];
  documents: { id: string; label: string | null; docType: string; gated: boolean; url: string }[];
  units: {
    id: string;
    unitNumber: string | null;
    unitType: string;
    bedrooms: number;
    bathrooms: number;
    areaSqft: number | null;
    priceMinor: string | null;
    currency: string;
    availabilityStatus: string;
    floor: number | null;
    aspect: string | null;
    propertySlug: string | null;
  }[];
  statusHistory: { toStatus: string; reason: string | null; createdAt: string }[];
  availableProperties: {
    slug: string;
    title: string;
    bedrooms: number;
    bathrooms: number;
    areaSqft: number | null;
    priceMinor: string;
    availabilityStatus: string;
    cover: MediaDTO | null;
  }[];
  advisors: EntityAgentLite[];
  isDemoData: boolean;
  sourceVerifiedAt: string | null;
}

export interface SimilarProjectCard {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  status: string;
  community: { id: string; name: string; slug: string };
  developer: { id: string; name: string; slug: string };
  startingPrice: { minor: string; currency: string } | null;
  handoverDate: string | null;
  completionPercent: number | null;
  cover: { url: string; altText: string | null } | null;
  totalUnits: number | null;
  lat: number;
  lng: number;
}
