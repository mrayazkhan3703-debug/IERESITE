/** Shared DTO contracts between API and client (PART D distilled). */

export interface MediaDTO {
  id: string;
  url: string;
  altText?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  kind?: string;
  mimeType?: string;
  posterUrl?: string | null;
}

export interface PriceDTO {
  minor: string; // decimal string of minor units (ADR-009)
  currency: string;
  qualifier?: string | null;
  rentFrequency?: string | null;
}

export interface ListingCardDTO {
  id: string;
  slug: string;
  title: string;
  propertyType: string;
  listingType: "SALE" | "RENT" | "SHORT_TERM";
  bedrooms: number;
  bathrooms: number;
  areaSqft?: number | null;
  price: PriceDTO;
  availabilityStatus: string;
  offPlan: boolean;
  isFeatured: boolean;
  isExclusive: boolean;
  community: { id: string; name: string; slug: string };
  project?: { id: string; name: string; slug: string } | null;
  developer?: { id: string; name: string; slug: string } | null;
  agent?: { id: string; name: string; slug: string; phone?: string | null } | null;
  cover?: MediaDTO | null;
  lat: number;
  lng: number;
  handoverQuarter?: string | null;
  view?: string | null;
  furnishing?: string | null;
  isDemoData?: boolean;
  paymentPlan?: { name: string; totalPercent: number; installments: { label: string; percent: number }[] } | null;
}

export interface SearchFacets {
  communities: { id: string; name: string; slug: string; count: number }[];
  propertyTypes: { key: string; count: number }[];
  priceBuckets: { key: string; minMinor: string; maxMinor: string | null; count: number }[];
  bedroomCounts: { key: number; count: number }[];
  amenities: { key: string; name: string; count: number }[];
  developers: { id: string; name: string; count: number }[];
  total: number;
}

export interface SearchResponse {
  results: ListingCardDTO[];
  facets: SearchFacets;
  total: number;
  page: number;
  pageSize: number;
  tookMs: number;
  /** true when served from SQL fallback rather than the index (degraded mode) */
  degraded?: boolean;
}

export interface AgentDTO {
  id: string;
  slug: string;
  name: string;
  jobTitle: string;
  bio: string;
  phoneE164?: string | null;
  whatsappE164?: string | null;
  email?: string | null;
  photo?: MediaDTO | null;
  languages: { code: string; name: string; fluency: string }[];
  specialties: string[];
  communities: { id: string; name: string; slug: string }[];
  yearsExperience: number;
  active: boolean;
  leadCapacityState: string;
  listingCount?: number;
  /* V3-02 (verified team data) — additive fields. Empty/null attributes are
   * UNVERIFIED (no CRM data yet) and must not be displayed as claims. */
  /** leadership|sales|marketing|hr|admin|other — team grouping. */
  department?: string | null;
  /** Appears in the public /agents advisory directory. */
  publicAdvisor?: boolean;
  /** Human-readable phone form (display only; tel: uses phoneE164). */
  phoneDisplay?: string | null;
  /** Direct static photo asset path (e.g. /images/team/member-01.jpg). */
  photoUrl?: string | null;
}

export interface ProjectCardDTO {
  id: string;
  slug: string;
  name: string;
  tagline?: string | null;
  status: string;
  community: { id: string; name: string; slug: string };
  developer: { id: string; name: string; slug: string };
  startingPrice?: PriceDTO | null;
  handoverDate?: string | null;
  completionPercent?: number | null;
  cover?: MediaDTO | null;
  totalUnits?: number | null;
  propertyTypes?: string[];
}

export interface CommunityCardDTO {
  id: string;
  slug: string;
  name: string;
  summary?: string | null;
  areaType: string;
  listingCount?: number;
  avgPricePerSqft?: PriceDTO | null;
  image?: MediaDTO | null;
  lat: number;
  lng: number;
  lifestyleTags: string[];
}

export interface DeveloperDTO {
  id: string;
  slug: string;
  name: string;
  summary?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  logo?: MediaDTO | null;
  verificationStatus: string;
  lastVerifiedAt?: string | null;
  projectCount?: number;
  projects?: ProjectCardDTO[];
}

export interface LeadSubmitPayload {
  intent: string;
  name: string;
  email?: string;
  phone?: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  entitySlug?: string;
  entityTitle?: string;
  consentContact: boolean;
  consentMarketing?: boolean;
  preferredLocale?: string;
  sourceChannel?: string;
  scheduledAt?: string;
  bookingType?: string;
  channel?: string;
  topic?: string;
  budgetMin?: string;
  budgetMax?: string;
  agentSlug?: string;
}

export interface LeadSubmitResult {
  leadId: string;
  reference: string;
  status: string;
  duplicate: boolean;
  booking?: {
    reference: string;
    status: string;
    scheduledAt: string;
    created: boolean;
  };
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  organizationId?: string | null;
  roles: string[];
}

export interface MarketMetricDTO {
  id: string;
  community?: { id: string; name: string; slug: string } | null;
  metricKey: string;
  periodStart: string;
  periodEnd: string;
  valueNumeric: number;
  unit: string;
  sourceName: string;
  methodology?: string | null;
  isIllustrative: boolean;
}

export interface ProvenanceChip {
  sourceType: string;
  sourceName?: string;
  verifiedAt?: string;
  isIllustrative?: boolean;
  isDemoData?: boolean;
}

export interface AiChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: { label: string; sourceId: string; url?: string | null }[];
  properties?: ListingCardDTO[];
  handoff?: boolean;
}
