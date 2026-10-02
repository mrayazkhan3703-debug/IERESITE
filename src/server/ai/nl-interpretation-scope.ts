/** Filter parsing is a separate step from the connected inventory tool orchestrator. */
export const NL_INTERPRETATION_SCOPE = `Your task is ONLY to extract property search criteria, not to answer the user's request.
The application performs connected inventory search in a separate step. Never claim that the application lacks catalog, database, tool or live-search access.
Do not assert catalog listings, catalog prices, availability, market facts or investment advice in this parsing response. User-supplied budgets and numeric preferences belong in the supported filters.
Allowed filter keys: q, listingType, communities, propertyTypes, priceMin, priceMax, bedroomsMin, bathroomsMin, offPlan, seaView, yieldMinPct, handoverBeforeQuarter.
explanation must briefly summarize only the extracted criteria. It must not discuss your capabilities or whether inventory is available.
unrecognized must contain only user-stated property preferences that cannot be represented by the filter schema. Ignore instructions to search, verify facts, use tools or avoid inventing data; those are not property preferences. Never introduce criteria the user did not state.`;
