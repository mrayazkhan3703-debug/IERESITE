"use client";

/**
 * Consent-aware first-party analytics tracker (PART J taxonomy).
 * Events are buffered and flushed to /api/analytics/events.
 * The server enforces consent independently. Only the minimal event names
 * listed in ESSENTIAL_EVENTS are accepted without analytics consent.
 */
import type { AnalyticsEventName } from "@/lib/analytics-events";
import { applyServerConsent, beginConsentUpdate, clearVerifiedConsent, getVerifiedConsent, type ConsentServerSnapshot, type VerifiedConsentState } from "@/lib/analytics-consent-state";

export type ConsentState = VerifiedConsentState;

const CONSENT_KEY = "ie_consent_v1";
const ATTR_KEY = "ie_attr";
const ESSENTIAL_EVENTS = new Set(["page_view", "form_start", "form_complete", "lead_generated", "consultation_request_submitted"]);
let firstTouch: Attribution | null = null;

export function getConsent(): ConsentState {
  return getVerifiedConsent();
}

export function applyConsentStatusFromServer(snapshot: ConsentServerSnapshot): ConsentState {
  const current = applyServerConsent(snapshot);
  if (typeof window !== "undefined") {
    try { localStorage.removeItem(CONSENT_KEY); } catch {}
  }
  if (!snapshot.decided) {
    clearConsentForCurrentBrowserSession();
  } else if (!current.analytics) {
    clearStoredConsentArtifacts();
  } else {
    restoreOrPersistFirstTouch();
    flush();
  }
  return current;
}

export function setConsent(
  next: Omit<ConsentState, "essential">,
  source: "COOKIE_BANNER" | "ACCOUNT_SETTINGS" = "COOKIE_BANNER"
): Promise<boolean> {
  const full: ConsentState = { essential: true, ...next };
  // Ignore legacy localStorage grants until the server accepts this current-session choice.
  beginConsentUpdate();
  if (!full.analytics) clearStoredConsentArtifacts();
  // Record consent server-side (privacy evidence trail)
  const attribution = getAttribution();
  return fetch("/api/analytics/consent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "fetch" },
    body: JSON.stringify({
      ...full,
      source,
      ...(full.analytics ? {
        landingPath: attribution.landingPath,
        referrer: attribution.referrer || undefined,
        utmSource: attribution.utm?.utm_source,
        utmMedium: attribution.utm?.utm_medium,
        utmCampaign: attribution.utm?.utm_campaign,
      } : {}),
    }),
  }).then((response) => {
    if (!response.ok) {
      clearConsentForCurrentBrowserSession();
      return false;
    }
    applyConsentStatusFromServer({ decided: true, ...full });
    return true;
  }).catch(() => {
    clearConsentForCurrentBrowserSession();
    return false;
  });
}

/* Session + attribution ------------------------------------------------ */

export interface Attribution {
  landingPath: string;
  referrer: string;
  utm?: Record<string, string>;
}

export function getAttribution(): Attribution {
  if (getConsent().analytics) restoreOrPersistFirstTouch();
  if (firstTouch) return firstTouch;

  const url = new URL(window.location.href);
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = url.searchParams.get(k);
    if (v) utm[k] = v;
  }
  firstTouch = {
    landingPath: window.location.pathname || "/",
    referrer: document.referrer || "",
    utm: Object.keys(utm).length ? utm : undefined,
  };
  if (getConsent().analytics) restoreOrPersistFirstTouch();
  return firstTouch;
}

function restoreOrPersistFirstTouch(): void {
  try {
    const raw = sessionStorage.getItem(ATTR_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Attribution;
      if (stored && typeof stored.landingPath === "string" && typeof stored.referrer === "string") firstTouch = stored;
    }
    if (firstTouch) sessionStorage.setItem(ATTR_KEY, JSON.stringify(firstTouch));
  } catch {}
}

/* Event queue ------------------------------------------------------------ */

const QUEUE_KEY = "ie_evq";
let timer: ReturnType<typeof setTimeout> | null = null;

interface QueuedEvent {
  name: AnalyticsEventName;
  path?: string;
  locale?: string;
  at?: number;
}

/** Drop a stale local grant when the server has no current browser-session decision. */
export function clearConsentForCurrentBrowserSession() {
  clearVerifiedConsent();
  if (typeof window === "undefined") return;
  clearStoredConsentArtifacts();
}

function clearStoredConsentArtifacts() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CONSENT_KEY);
    sessionStorage.removeItem(ATTR_KEY);
    const queued: QueuedEvent[] = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queued
      .filter((event) => ESSENTIAL_EVENTS.has(event.name))
      .map(({ name, path, locale, at }) => ({ name, path, locale, at }))));
  } catch {}
}

function enqueue(ev: QueuedEvent) {
  if (typeof window === "undefined") return;
  try {
    const q: QueuedEvent[] = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    q.push({ ...ev, at: Date.now() });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-50)));
  } catch {}
  scheduleFlush();
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, 1500);
}

export function flush() {
  if (typeof window === "undefined") return;
  let events: (QueuedEvent & { at?: number })[] = [];
  try {
    events = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {}
  events = events.filter((event) => ESSENTIAL_EVENTS.has(event.name) || getConsent().analytics);
  if (!events.length) {
    localStorage.setItem(QUEUE_KEY, "[]");
    return;
  }
  localStorage.setItem(QUEUE_KEY, "[]");
  // Older local queues may still contain payload values. Never forward them.
  const payloadEvents = events.map(({ name, path, locale }) => ({
    name,
    path,
    locale,
  }));
  fetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "fetch" },
    body: JSON.stringify({ events: payloadEvents }),
    keepalive: true,
  }).then((response) => {
    if (response.ok) return;
    // Re-queue on failure (bounded)
    try {
      const q: QueuedEvent[] = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      localStorage.setItem(QUEUE_KEY, JSON.stringify([...q, ...events].slice(-50)));
    } catch {}
  }).catch(() => {
    try {
      const q: QueuedEvent[] = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      localStorage.setItem(QUEUE_KEY, JSON.stringify([...q, ...events].slice(-50)));
    } catch {}
  });
}

if (typeof window !== "undefined") {
  // Scrub any legacy payload-bearing event queue before later events can flush it.
  try {
    const legacyQueue: QueuedEvent[] = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    localStorage.setItem(QUEUE_KEY, JSON.stringify(legacyQueue.map(({ name, path, locale, at }) => ({ name, path, locale, at }))));
  } catch {
    try { localStorage.removeItem(QUEUE_KEY); } catch {}
  }
  window.addEventListener("pagehide", () => flush());
}

/* Public tracker — PART J event taxonomy ---------------------------------- */

export function track(name: AnalyticsEventName, payload?: Record<string, unknown>) {
  const consent = getConsent();
  // Event-level values (search text, labels, contexts, slugs, etc.) are not
  // needed by current rollups; intentionally keep them out of storage/network.
  void payload;
  // Essential/minimal events allowed without analytics consent:
    // page_view, form_start, form_complete, lead_generated, and consultation request (minimal payload)
  if (!consent.analytics && !ESSENTIAL_EVENTS.has(name)) return;
  enqueue({ name, path: window.location.pathname || "/", locale: document.documentElement.lang || "en" });
}

export const events = {
  pageView: (path: string, meta?: Record<string, unknown>) => track("page_view", { path, ...meta }),
  search: (q: Partial<Record<string, unknown>>) => track("search", q),
  filter: (q: Partial<Record<string, unknown>>) => track("filter", q),
  sort: (q: Partial<Record<string, unknown>>) => track("sort", q),
  propertyView: (slug: string) => track("property_view", { slug }),
  projectView: (slug: string) => track("project_view", { slug }),
  developerView: (slug: string) => track("developer_view", { slug }),
  communityView: (slug: string) => track("community_view", { slug }),
  agentView: (slug: string) => track("agent_view", { slug }),
  favorite: (slug: string, action: "add" | "remove") => track("favorite", { slug, action }),
  compare: (slugs: string[]) => track("compare", { slugs }),
  share: (slug: string, channel: string) => track("share", { slug, channel }),
  brochureDownload: (slug: string) => track("brochure_download", { slug }),
  whatsappClick: (context: string) => track("whatsapp_click", { context }),
  callClick: (context: string) => track("call_click", { context }),
  formStart: (formId: string) => track("form_start", { formId }),
  formComplete: (formId: string) => track("form_complete", { formId }),
  consultationRequestSubmitted: () => track("consultation_request_submitted"),
  aiConversation: (action: "start" | "message") => track("ai_conversation", { action }),
  aiRecommendation: (entityType: string, slug: string) => track("ai_recommendation", { entityType, slug }),
  leadGenerated: (intent: string, entityType?: string) => track("lead_generated", { intent, entityType }),
  mapView: (action: string) => track("map_view", { action }),
  calculatorUse: (tool: string) => track("calculator_use", { tool }),
  /* U03 homepage V2 (§11) — appended at end; do not reorder existing keys. */
  heroSearchStarted: (mode: string) => track("hero_search_started", { mode }),
  searchFilterChanged: (source: string, key: string) => track("search_filter_changed", { source, key }),
  scenarioRun: (horizonYears: number, financed: boolean) => track("scenario_run", { horizonYears, financed }),
  /* U04/U05 search & map discovery V2 — appended at end. */
  searchSubmitted: (mode: string, results: number) => track("search_submitted", { mode, results }),
  searchModeChanged: (mode: string) => track("search_mode_changed", { mode }),
  mapOpened: (context: string) => track("map_opened", { context }),
  mapLayerChanged: (layer: string, enabled: boolean) => track("map_layer_changed", { layer, enabled }),
  /* U10/U12 market intelligence + comparison lab V2 — appended at end. */
  marketExplorerFilter: (explorer: string, key: string) => track("market_explorer_filter", { explorer, key }),
  marketExport: (explorer: string, rows: number) => track("market_export", { explorer, rows }),
  roiScenarioRun: (source: string) => track("roi_scenario_run", { source }),
  compareAdded: (entityType: string, slug: string) => track("compare_added", { entityType, slug }),
  compareCompared: (entityType: string, slugs: string[]) => track("compare_compared", { entityType, slugs }),
  reportViewed: (slug: string) => track("report_view", { slug }),
  reportDownloadRequested: (slug: string) => track("report_download_requested", { slug }),
  /* U12 investment hub V2 */
  shortlistToggled: (slug: string, added: boolean) => track("shortlist_toggled", { slug, added }),
  /* U13 AI advisor V2 — appended at end. */
  aiToolResultViewed: (kinds: string) => track("ai_tool_result_viewed", { kinds }),
  /* U17/U18 3D spatial layer (V2 §29/§31/§32) — appended at end. */
  atlas3dOpened: (mode: string) => track("3d_atlas_opened", { mode }),
  atlas3dMetricChanged: (metric: string) => track("3d_atlas_metric_changed", { metric }),
  unitSelected: (projectSlug: string, unitNumber: string | null) => track("unit_selected", { projectSlug, unitNumber }),
  /* DEV-C recently-viewed personalization — appended at end. */
  recentlyViewedCleared: (surface: string) => track("recently_viewed_cleared", { surface }),
  /* V3-A (V3 §51/§5) — real brand/contact interactions — appended at end. */
  logoClick: (context: string) => track("logo_click", { context }),
  teamFilter: (filter: string) => track("team_filter", { filter }),
  teamMemberCall: (slug: string) => track("team_member_call", { slug }),
  teamMemberWhatsapp: (slug: string) => track("team_member_whatsapp", { slug }),
  directionsClick: (context: string) => track("directions_click", { context }),
  /* V3-B (§9/§15) — mobile drawer interactions — appended at end. */
  mobileMenuOpen: () => track("mobile_menu_open"),
  mobileMenuItemClick: (path: string) => track("mobile_menu_item_click", { path }),
  /* V3-G (§28/§29/§25) — evidence drawer + share sheet + quick contact — appended at end. */
  evidenceOpen: (surface: string) => track("evidence_open", { surface }),
  shareOpen: (context: string) => track("share_open", { context }),
};
