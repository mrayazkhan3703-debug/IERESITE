import { z } from "zod";

export const advisorListingTypeSchema = z.enum(["SALE", "RENT", "SHORT_TERM"]);
type ListingType = z.infer<typeof advisorListingTypeSchema>;

/** A named lookup without a transaction preference must not silently become a sale search. */
export function advisorListingTypes(listingType?: ListingType): ListingType[] {
  return listingType ? [listingType] : ["SALE", "RENT", "SHORT_TERM"];
}
