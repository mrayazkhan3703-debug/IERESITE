import { z } from "zod";

/** Canonical normalized property/listing feed record contract. */
export const feedRecordSchema = z.object({
  externalId: z.string().min(1).max(100),
  title: z.string().min(5).max(200),
  community: z.string().min(2).max(120),
  project: z.string().max(160).optional(),
  developer: z.string().max(160).optional(),
  propertyType: z.enum(["APARTMENT", "VILLA", "TOWNHOUSE", "PENTHOUSE", "DUPLEX", "STUDIO", "OFFICE", "RETAIL", "PLOT"]).default("APARTMENT"),
  listingType: z.enum(["SALE", "RENT"]).default("SALE"),
  bedrooms: z.number().min(0).max(20).default(0),
  bathrooms: z.number().min(0).max(20).default(0),
  areaSqft: z.number().positive().max(200000).optional(),
  priceAed: z.number().positive().max(500000000),
  offPlan: z.boolean().default(false),
  availability: z.enum(["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN"]).default("AVAILABLE"),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  view: z.string().max(40).optional(),
  furnishing: z.enum(["FURNISHED", "SEMI_FURNISHED", "UNFURNISHED"]).optional(),
  handover: z.string().max(20).optional(),
  description: z.string().max(5000).optional(),
  agentEmail: z.string().email().optional(),
  sourceUpdatedAt: z.string().optional(),
});

export type FeedRecord = z.infer<typeof feedRecordSchema>;
