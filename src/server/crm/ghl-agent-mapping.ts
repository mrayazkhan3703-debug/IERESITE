export const GHL_AGENT_MAPPING_PROVIDER = "ghl";
export const GHL_AGENT_MAPPING_KIND = "AGENT";

export interface VerifiedGhlAgent {
  id: string;
  name: string | null;
}

/** Validate the provider response before persisting any external identity. */
export function verifiedGhlAgent(value: unknown, expectedUserId: string, expectedLocationId: string): VerifiedGhlAgent {
  if (!value || typeof value !== "object") throw new Error("GHL user verification returned an invalid response");
  const user = value as Record<string, unknown>;
  if (user.id !== expectedUserId) throw new Error("GHL user verification returned a different user ID");
  const roles = user.roles;
  if (!roles || typeof roles !== "object" || !Array.isArray((roles as Record<string, unknown>).locationIds)) {
    throw new Error("GHL user verification did not include location membership");
  }
  const locationIds = (roles as { locationIds: unknown[] }).locationIds;
  if (!locationIds.includes(expectedLocationId)) throw new Error("GHL user does not belong to the configured location");
  return { id: expectedUserId, name: typeof user.name === "string" ? user.name.trim().slice(0, 200) || null : null };
}

export function verifiedGhlAgentId(metadataJson: string | null, externalId: string, locationId: string): string | null {
  if (!metadataJson) return null;
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return metadata.verified === true && metadata.locationId === locationId
      && metadata.ghlUserId === externalId
      ? externalId
      : null;
  } catch {
    return null;
  }
}
