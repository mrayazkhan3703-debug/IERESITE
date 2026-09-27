import type { AppConfig } from "@/lib/config";
import { HttpError } from "@/server/auth";
import { createGhlAuthorizationUrl } from "@/server/crm/ghl-oauth";

export const GHL_OAUTH_CALLBACK_PATH = "/api/admin/integrations/ghl/oauth/callback";

export interface GhlOAuthSettings {
  clientId: string;
  clientSecret: string;
  installUrl: string;
  redirectUri: string;
  locationId: string;
  tokenEncryptionKey: string;
}

export function ghlOAuthSettings(config: AppConfig): GhlOAuthSettings {
  const values = {
    clientId: config.GHL_CLIENT_ID?.trim(),
    clientSecret: config.GHL_CLIENT_SECRET?.trim(),
    installUrl: config.GHL_INSTALL_URL?.trim(),
    redirectUri: config.GHL_REDIRECT_URI?.trim(),
    locationId: config.GHL_LOCATION_ID?.trim(),
    tokenEncryptionKey: config.CRM_TOKEN_ENCRYPTION_KEY?.trim(),
  };
  if (Object.values(values).some((value) => !value)) {
    throw new HttpError(503, "GHL OAuth setup is incomplete. Configure the Marketplace install URL, app keys, callback URL, location ID, and token encryption key.", "GHL_OAUTH_NOT_CONFIGURED");
  }

  let redirect: URL;
  try {
    redirect = new URL(values.redirectUri!);
  } catch {
    throw new HttpError(503, "GHL redirect URL must match this app's canonical OAuth callback URL.", "GHL_OAUTH_REDIRECT_MISMATCH");
  }
  const app = new URL(config.APP_URL);
  const isLocalHttp = redirect.protocol === "http:" && redirect.hostname === "localhost" && config.APP_ENV !== "production";
  const isSecure = redirect.protocol === "https:" || isLocalHttp;
  if (!isSecure || redirect.username || redirect.password || redirect.search || redirect.hash
    || redirect.origin !== app.origin || redirect.pathname !== GHL_OAUTH_CALLBACK_PATH) {
    throw new HttpError(503, "GHL redirect URL must match this app's canonical OAuth callback URL.", "GHL_OAUTH_REDIRECT_MISMATCH");
  }
  if (!/^[a-f0-9]{64}$/i.test(values.tokenEncryptionKey!)) {
    throw new HttpError(503, "CRM_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal key.", "GHL_OAUTH_KEY_INVALID");
  }
  try {
    createGhlAuthorizationUrl(values.installUrl!, "s".repeat(43));
  } catch {
    throw new HttpError(503, "GHL Marketplace installation URL must be a safe HTTPS URL.", "GHL_OAUTH_INSTALL_URL_INVALID");
  }
  if (config.APP_ENV === "production" && new URL(values.installUrl!).protocol !== "https:") {
    throw new HttpError(503, "Production GHL installation URLs must use HTTPS.", "GHL_OAUTH_INSTALL_URL_INVALID");
  }
  return values as GhlOAuthSettings;
}
