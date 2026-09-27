import { z } from "zod";
import type { AgentDTO, CommunityCardDTO, ListingCardDTO, MediaDTO, PriceDTO, ProjectCardDTO, SearchResponse } from "@/lib/types";

const nullableOptionalString = z.string().nullable().optional();
const nullableOptionalNumber = z.number().finite().nullable().optional();

export const mediaDtoSchema: z.ZodType<MediaDTO> = z.object({
  id: z.string(),
  url: z.string(),
  altText: nullableOptionalString,
  caption: nullableOptionalString,
  width: nullableOptionalNumber,
  height: nullableOptionalNumber,
  kind: z.string().optional(),
});

export const priceDtoSchema: z.ZodType<PriceDTO> = z.object({
  minor: z.string().regex(/^-?\d+$/, "minor units must be a decimal string"),
  currency: z.string().min(3).max(3),
  qualifier: nullableOptionalString,
  rentFrequency: nullableOptionalString,
});

const entityRefSchema = z.object({ id: z.string(), name: z.string(), slug: z.string() });

export const listingCardDtoSchema: z.ZodType<ListingCardDTO> = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  propertyType: z.string(),
  listingType: z.enum(["SALE", "RENT", "SHORT_TERM"]),
  bedrooms: z.number().finite(),
  bathrooms: z.number().finite(),
  areaSqft: nullableOptionalNumber,
  price: priceDtoSchema,
  availabilityStatus: z.string(),
  offPlan: z.boolean(),
  isFeatured: z.boolean(),
  isExclusive: z.boolean(),
  community: entityRefSchema,
  project: entityRefSchema.nullable().optional(),
  developer: entityRefSchema.nullable().optional(),
  agent: entityRefSchema.extend({ phone: nullableOptionalString }).nullable().optional(),
  cover: mediaDtoSchema.nullable().optional(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  handoverQuarter: nullableOptionalString,
  view: nullableOptionalString,
  furnishing: nullableOptionalString,
  isDemoData: z.boolean().optional(),
  paymentPlan: z.object({
    name: z.string(),
    totalPercent: z.number().finite(),
    installments: z.array(z.object({ label: z.string(), percent: z.number().finite() })),
  }).nullable().optional(),
});

export const searchResponseSchema: z.ZodType<SearchResponse> = z.object({
  results: z.array(listingCardDtoSchema),
  facets: z.object({
    communities: z.array(entityRefSchema.extend({ count: z.number().int().nonnegative() })),
    propertyTypes: z.array(z.object({ key: z.string(), count: z.number().int().nonnegative() })),
    priceBuckets: z.array(z.object({ key: z.string(), minMinor: z.string(), maxMinor: z.string().nullable(), count: z.number().int().nonnegative() })),
    bedroomCounts: z.array(z.object({ key: z.number(), count: z.number().int().nonnegative() })),
    amenities: z.array(z.object({ key: z.string(), name: z.string(), count: z.number().int().nonnegative() })),
    developers: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().int().nonnegative() })),
    total: z.number().int().nonnegative(),
    views: z.array(z.object({ key: z.string(), count: z.number().int().nonnegative() })).optional(),
  }),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  tookMs: z.number().finite().nonnegative(),
  degraded: z.boolean().optional(),
});

export const agentDtoSchema: z.ZodType<AgentDTO> = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  jobTitle: z.string(),
  bio: z.string(),
  phoneE164: nullableOptionalString,
  whatsappE164: nullableOptionalString,
  email: nullableOptionalString,
  photo: mediaDtoSchema.nullable().optional(),
  languages: z.array(z.object({ code: z.string(), name: z.string(), fluency: z.string() })),
  specialties: z.array(z.string()),
  communities: z.array(entityRefSchema),
  yearsExperience: z.number().int().nonnegative(),
  active: z.boolean(),
  leadCapacityState: z.string(),
  listingCount: z.number().int().nonnegative().optional(),
  department: nullableOptionalString,
  publicAdvisor: z.boolean().optional(),
  phoneDisplay: nullableOptionalString,
  photoUrl: nullableOptionalString,
});

export const communityCardDtoSchema: z.ZodType<CommunityCardDTO> = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  summary: nullableOptionalString,
  areaType: z.string(),
  listingCount: z.number().int().nonnegative().optional(),
  avgPricePerSqft: priceDtoSchema.nullable().optional(),
  image: mediaDtoSchema.nullable().optional(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  lifestyleTags: z.array(z.string()),
});

export const projectCardDtoSchema: z.ZodType<ProjectCardDTO> = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  tagline: nullableOptionalString,
  status: z.string(),
  community: entityRefSchema,
  developer: entityRefSchema,
  startingPrice: priceDtoSchema.nullable().optional(),
  handoverDate: nullableOptionalString,
  completionPercent: nullableOptionalNumber,
  cover: mediaDtoSchema.nullable().optional(),
  totalUnits: nullableOptionalNumber,
  propertyTypes: z.array(z.string()).optional(),
});
