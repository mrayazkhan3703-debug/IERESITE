/**
 * Environment configuration with fail-fast validation (Build Prompt §11).
 * Grouped by domain; optional integrations degrade gracefully,
 * production-critical vars throw at first server access.
 */
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().positive());

const boundedInt = (def: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().positive().max(max));

const proxyHops = z.string().optional()
  .transform((value) => value === undefined || value === "" ? 0 : Number(value))
  .pipe(z.number().int().min(0).max(8));

const optionalPseudonymKey = z.string().optional()
  .transform((value) => value?.trim() || undefined)
  .pipe(z.string().min(32).optional());

const schema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  STAGING_WEB_ONLY: bool(false),
  APP_URL: z.string().url().default("http://localhost:3000"),
  TRUSTED_PROXY_HOPS: proxyHops,
  IP_PSEUDONYM_KEY: optionalPseudonymKey,
  APP_LOCALE_DEFAULT: z.string().default("en"),
  APP_LOCALES: z.string().default("en,ar"),
  DATABASE_URL: z.string().min(1),
  AUTH_SESSION_TTL_HOURS: int(168),
  AUTH_COOKIE_NAME: z.string().default("ie_session"),
  AUTH_MFA_ENCRYPTION_KEY: z.string().optional(),
  AUTH_MFA_REQUIRED: bool(true),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
  ADMIN_BOOTSTRAP_NAME: z.string().optional(),
  SEARCH_PROVIDER: z.enum(["local", "postgres", "typesense"]).default("local"),
  TYPESENSE_URL: z.string().optional(),
  TYPESENSE_API_KEY: z.string().optional(),
  MAP_PROVIDER: z.enum(["osm", "mapbox"]).default("osm"),
  MAPBOX_TOKEN: z.string().optional(),
  AI_PROVIDER: z.enum(["mock", "zai", "gemini", "openai"]).default("mock"),
  AI_MODEL: z.string().default("default"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  AI_LIVE_ENABLED: bool(false),
  AI_DAILY_REQUEST_LIMIT: boundedInt(25, 1000),
  AI_DAILY_TOKEN_LIMIT: boundedInt(60000, 500000),
  AI_MAX_PROMPT_CHARS: boundedInt(48000, 200000),
  AI_MAX_OUTPUT_TOKENS: boundedInt(1024, 8192),
  AI_REQUEST_TIMEOUT_MS: int(20000),
  AI_MAX_TOOL_TURNS: int(6),
  AI_RATE_LIMIT_PER_HOUR: int(10),
  CRM_PROVIDER: z.enum(["localdev", "ghl", "custom"]).default("localdev"),
  CRM_LIVE_ENABLED: bool(false),
  CRM_API_URL: z.string().optional(),
  CRM_API_KEY: z.string().optional(),
  CRM_WEBHOOK_SECRET: z.string().optional(),
  CRM_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GHL_CLIENT_ID: z.string().optional(),
  GHL_CLIENT_SECRET: z.string().optional(),
  GHL_INSTALL_URL: z.string().optional(),
  GHL_REDIRECT_URI: z.string().optional(),
  GHL_LOCATION_ID: z.string().optional(),
  GHL_WEBHOOKS_ENABLED: bool(false),
  GHL_PIPELINE_ID: z.string().optional(),
  GHL_PIPELINE_STAGE_ID: z.string().optional(),
  EMAIL_PROVIDER: z.enum(["localdev", "ses", "resend", "smtp"]).default("localdev"),
  /* No official company email supplied (V3 §10 / V3-B01) — internal outbound
   * sender default is a non-public localdev value, never rendered in UI. */
  EMAIL_FROM: z.string().default("no-reply@localhost"),
  ANALYTICS_PROVIDER: z.enum(["firstparty", "ga4"]).default("firstparty"),
  GA4_MEASUREMENT_ID: z.string().optional(),
  JOB_SCHEDULER_ENABLED: bool(true),
  JOB_INTERVAL_MS: int(15000),
  WORKER_HEALTH_PORT: int(3001),
  REDIS_URL: z.string().url().optional(),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("iere-local"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: int(1025),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  RATE_LIMIT_GENERAL_PER_MIN: int(60),
  RATE_LIMIT_AUTH_PER_MIN: int(5),
  RATE_LIMIT_LEAD_PER_HOUR: int(10),
  MEDIA_MAX_UPLOAD_MB: int(25),
}).superRefine((config, context) => {
  if (config.STAGING_WEB_ONLY && config.APP_ENV !== "staging") {
    context.addIssue({ code: "custom", path: ["STAGING_WEB_ONLY"], message: "Web-only preview is valid only in staging" });
  }
  if (config.APP_ENV === "production" && !config.IP_PSEUDONYM_KEY) {
    context.addIssue({ code: "custom", path: ["IP_PSEUDONYM_KEY"], message: "Required in production to pseudonymize client IPs stored with sessions and audit records" });
  }
});

export type AppConfig = z.infer<typeof schema>;

/** Staging is HTTPS too; only local development may set non-Secure cookies. */
export function requiresSecureCookies(env: Pick<AppConfig, "APP_ENV">): boolean {
  return env.APP_ENV !== "development";
}

/**
 * Public site contact block — REAL verified company data (V3-01, V3 §10).
 * Source of truth: user-supplied values in the V3 upgrade prompt.
 * Email channel intentionally omitted — no official email was supplied
 * (V3-B01); do not invent one.
 */
export const SITE_CONTACT = {
  name: "Investment Experts",
  demo: false,
  phone: "+971 50 221 3802",
  phoneE164: "+971502213802",
  phoneHref: "tel:+971502213802",
  whatsappLabel: "+971 50 221 3802",
  whatsappE164: "+971502213802",
  whatsappHref: "https://wa.me/971502213802",
  addressLine1: "Concord Tower 3703, 37th Floor",
  addressLine2: "Dubai Media City, Dubai",
  /** Single-line display form of the two-line address. */
  address: "Concord Tower 3703, 37th Floor, Dubai Media City, Dubai",
  mapsUrl: "https://maps.app.goo.gl/iBGGbKJzhfMExrmA6",
} as const;

/* Site contact governance (V2 §5.1, U09; V3-01 real values). Structured
 * per-channel view over SITE_CONTACT: every channel carries its own `demo`
 * flag so production can never silently ship placeholder details. All
 * channels below are now verified real values (demo: false). The email
 * channel is omitted entirely — none was supplied. Client-safe: static
 * data, no env access. */

export interface SiteContactChannel {
  /** Human-readable display value. */
  value: string;
  /** Actionable href (tel:/https://), or null for non-clickable. */
  href: string | null;
  /** True while the value is a placeholder — production must replace it. */
  demo: boolean;
}

export const SITE_CONTACT_CHANNELS: {
  phone: SiteContactChannel;
  whatsapp: SiteContactChannel;
  address: SiteContactChannel;
} = {
  phone: { value: SITE_CONTACT.phone, href: SITE_CONTACT.phoneHref, demo: SITE_CONTACT.demo },
  whatsapp: { value: SITE_CONTACT.whatsappLabel, href: SITE_CONTACT.whatsappHref, demo: SITE_CONTACT.demo },
  address: { value: SITE_CONTACT.address, href: SITE_CONTACT.mapsUrl, demo: SITE_CONTACT.demo },
};

/* Structured postal-address parts (V3-19) — aligned with schema.org
 * PostalAddress so JSON-LD builders stay factual and single-sourced.
 * Derived from the verified two-line address above; no new claims. */
export const SITE_POSTAL_ADDRESS = {
  streetAddress: SITE_CONTACT.addressLine1, // "Concord Tower 3703, 37th Floor"
  addressLocality: "Dubai Media City",
  addressRegion: "Dubai",
  addressCountry: "AE",
} as const;

/* ------------------------------------------------------------------ */
/* Official logo assets (V3-01)                                        */
/* ------------------------------------------------------------------ */

/**
 * Official Investment Experts logo. The source artwork (white + gold on
 * transparency) is built for DARK surfaces; `ink` is a color-adapted
 * variant (white artwork → ink tone, gold untouched) for LIGHT surfaces.
 * Both keep the exact 600×192 intrinsic ratio (3.125:1).
 */
export const SITE_LOGO = {
  dark: "/brand/investment-experts-logo.png",
  light: "/brand/investment-experts-logo-ink.png",
  width: 600,
  height: 192,
} as const;

/* ------------------------------------------------------------------ */
/* WhatsApp deep links with contextual prefilled messages (V3 §49)     */
/* ------------------------------------------------------------------ */

/** Current page URL (falls back to path when window is unavailable). */
function currentPageUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.href.split("#")[0];
}

export const WHATSAPP_MESSAGES = {
  generic: "Hello Investment Experts, I'd like help finding a Dubai property.",
  property: (title: string) =>
    `Hello Investment Experts, I'm interested in ${title}. ${currentPageUrl()}`,
  project: (name: string) =>
    `Hello Investment Experts, I'd like information about ${name}. ${currentPageUrl()}`,
  international:
    "Hello Investment Experts, I'm an international buyer and would like a consultation.",
  member: (name: string) =>
    `Hello ${name}, I'm contacting you through the Investment Experts website regarding Dubai property.`,
} as const;

/** Company WhatsApp href with an optional contextual prefilled message. */
export function companyWhatsappHref(message?: string): string {
  const base = SITE_CONTACT.whatsappHref;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** Member WhatsApp href (E.164 digits) with a contextual prefilled message. */
export function memberWhatsappHref(whatsappE164: string, message: string): string {
  const digits = whatsappE164.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

let cached: AppConfig | null = null;

/** Validate a supplied environment snapshot without mutating or caching process state. */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  // Render and other hosts may expose unset optional variables as empty strings.
  // Normalize those to undefined so schema defaults and optional fields work.
  const normalized = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      typeof value === "string" && value.trim() === "" ? undefined : value,
    ]),
  );
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  cached = parseConfig(process.env);
  return cached;
}

export const isProd = () => getConfig().APP_ENV === "production";
export const isDev = () => getConfig().APP_ENV === "development";
