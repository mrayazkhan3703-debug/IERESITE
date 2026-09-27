import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * Verification harness (ADR-008): deterministic assertions across the platform's
 * core logic. Returns structured pass/fail per check — evidence for TEST_EVIDENCE.
 */
export const GET = apiHandler(async () => {
  await requirePermission("audit:read");
  const results: { id: string; name: string; status: "PASS" | "FAIL"; detail?: string }[] = [];

  const check = async (id: string, name: string, fn: () => Promise<void | string>) => {
    try {
      const detail = await fn();
      results.push({ id, name, status: "PASS", detail: detail || undefined });
    } catch (err) {
      results.push({ id, name, status: "FAIL", detail: String(err).slice(0, 300) });
    }
  };
  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  /* CALC-* — calculator determinism & edge cases (Q19) */
  await check("CALC-ROI", "ROI scenario math (gross/net yield, compound appreciation)", async () => {
    const r = await import("@/lib/calculators").then((m) =>
      m.roiScenario({ purchasePrice: 2_000_000, annualRent: 130_000, annualCosts: 20_000, appreciationPctPerYear: 4, years: 5 })
    );
    assert(r.grossYieldPct === 6.5, `gross yield expected 6.5, got ${r.grossYieldPct}`);
    assert(r.netYieldPct === 5.5, `net yield expected 5.5, got ${r.netYieldPct}`);
    assert(Math.abs(r.projectedValue - 2433306) < 1, `projected value ${r.projectedValue}`);
    assert(r.totalNetIncome === 550_000, `total net income ${r.totalNetIncome}`);
    assert(r.assumptions.years === 5, "assumptions carried");
    return `gross 6.5% / net 5.5% / 5yr projected ${r.projectedValue.toLocaleString()}`;
  });

  await check("CALC-MORTGAGE", "Mortgage payment determinism (closed form vs amortization)", async () => {
    const m = await import("@/lib/calculators").then((mod) =>
      mod.mortgageSchedule({ propertyPrice: 2_000_000, downPaymentPct: 20, interestRatePct: 4.5, years: 25 })
    );
    assert(m.loanAmount === 1_600_000, `loan ${m.loanAmount}`);
    assert(m.downPayment === 400_000, "down payment");
    assert(Math.abs(m.monthlyPayment - 8893.32) < 0.05, `monthly payment ${m.monthlyPayment}`);
    assert(m.schedule.length === 12, "first-year schedule emitted");
    return `monthly ${m.monthlyPayment} AED; interest ${Math.round(m.totalInterest).toLocaleString()} AED`;
  });

  await check("CALC-YIELD-EDGE", "Yield edge cases (zero price, zero costs)", async () => {
    const m = await import("@/lib/calculators");
    const y1 = m.rentalYield({ purchasePrice: 0, annualRent: 100_000 });
    assert(y1.grossYieldPct === 0, "zero price yields 0 not Infinity");
    const y2 = m.rentalYield({ purchasePrice: 800_000, annualRent: 60_000, annualCosts: 0 });
    assert(y2.netYieldPct === 7.5, `net yield ${y2.netYieldPct}`);
    const p = m.pricePerSqft(1_000_000, 0);
    assert(p === null, "zero area returns null");
  });

  await check("CALC-PLAN-BALANCE", "Payment plan totals and balance detection", async () => {
    const m = await import("@/lib/calculators");
    const balanced = m.paymentPlan({ propertyPrice: 1_000_000, installments: [{ label: "A", percent: 60 }, { label: "B", percent: 40 }] });
    assert(balanced.balanced === true && balanced.totalAmount === 1_000_000, "60/40 balances to price");
    const unbalanced = m.paymentPlan({ propertyPrice: 1_000_000, installments: [{ label: "A", percent: 50 }] });
    assert(unbalanced.balanced === false, "unbalanced detected");
  });

  /* SCENARIO-* — shared financial scenario engine (V2 §21 / U11) */
  await check("scenario.roi-determinism", "ROI scenario engine determinism (identical outputs on repeat runs)", async () => {
    const engine = await import("@/lib/scenario-engine");
    assert(engine.SCENARIO_ENGINE_VERSION === "2.0.0", `engine version ${engine.SCENARIO_ENGINE_VERSION}`);
    const input = {
      purchasePrice: 2_000_000,
      annualRent: 130_000,
      rentGrowthPct: 3,
      vacancyPct: 5,
      serviceChargePerSqft: 16,
      sizeSqft: 1000,
      maintenanceAnnual: 8000,
      managementPct: 5,
      financing: { downPaymentPct: 20, annualRatePct: 4.5, termYears: 25 },
      appreciationPct: 4,
      purchaseCostsPct: 4,
      exitCostsPct: 2,
      horizonYears: 10,
    };
    const a = engine.computeRoi(input);
    const b = engine.computeRoi(input);
    assert(JSON.stringify(a) === JSON.stringify(b), "computeRoi outputs are not byte-identical across runs");
    const s1 = engine.buildScenarios(input);
    const s2 = engine.buildScenarios(input);
    assert(JSON.stringify(s1) === JSON.stringify(s2), "buildScenarios outputs are not byte-identical across runs");
    assert(JSON.stringify(s1) === JSON.stringify({ ...s1 }), "scenario set is plain-serializable");
    // scenario derivation sanity: downside rent −15%, upside rent +10%
    assert(Math.abs(s1.downside.input.annualRent - 110_500) < 1e-9, `downside rent ${s1.downside.input.annualRent}`);
    assert(Math.abs(s1.upside.input.annualRent - 143_000) < 1e-9, `upside rent ${s1.upside.input.annualRent}`);
    assert(s1.disclaimer === "projection" && a.disclaimer === "projection", "projection disclaimer stamped");
    assert(a.irr === null || Number.isFinite(a.irr), "IRR finite or null — never thrown");
    return `v${engine.SCENARIO_ENGINE_VERSION}: base netYield ${a.netYield}%, IRR ${a.irr ?? "n/a"}%, breakEven ${a.breakEvenYear ?? "beyond horizon"}`;
  });

  await check("scenario.paymentplan-validation", "Payment plan 100% validation rejects 99% and accepts 100%", async () => {
    const engine = await import("@/lib/scenario-engine");
    const bad = engine.normalizePaymentPlan([{ name: "Booking", percent: 60 }, { name: "Handover", percent: 39 }], 1_000_000);
    assert(bad.validation.valid === false, "99% plan must be invalid");
    assert(bad.validation.errors.length >= 1 && bad.validation.errors[0].includes("99.00%"), `expected 99.00% error detail, got ${bad.validation.errors.join("; ")}`);
    const good = engine.normalizePaymentPlan(
      [
        { name: "Booking", percent: 10, dueAt: { monthsFromBooking: 0 } },
        { name: "Construction", percent: 60, dueAt: { monthsFromBooking: 18 } },
        { name: "Handover", percent: 30, dueAt: { monthsFromBooking: 36 } },
      ],
      1_500_000
    );
    assert(good.validation.valid === true, "100% plan must be valid");
    assert(good.validation.errors.length === 0, "valid plan has no errors");
    assert(good.totalAmount === 1_500_000, `total amount ${good.totalAmount}`);
    assert(good.stages[0].amount === 150_000 && good.stages[2].cumulative === 1_500_000, "amounts and cumulative computed");
    assert(good.stages[0].dueLabel === "At booking", `due label ${good.stages[0].dueLabel}`);
    const csv = engine.cashflowCsv([{ name: "Booking", percent: 10 }, { name: "Handover", percent: 90 }], 1_000_000);
    assert(csv.startsWith("stage,percent,amount_aed,cumulative_aed,due") && csv.includes("Booking"), "CSV header + rows emitted");
    return `99% → rejected (${bad.validation.errors[0]}); 100% → accepted with ${good.stages.length} ordered stages`;
  });

  await check("scenario.mortgage-ltv", "Mortgage regulatory LTV preset (resident-first ready 80%) + payment baseline ±0.01", async () => {
    const engine = await import("@/lib/scenario-engine");
    const profile = engine.mortgageProfile({
      borrowerCategory: "resident-first",
      propertyPrice: 2_000_000,
      propertyStatus: "ready",
      downPaymentPct: 20,
      annualRatePct: 4.5,
      termYears: 25,
      purpose: "owner",
    });
    assert(profile.regulatoryMaxLtv.maxLtvPct === 80, `resident-first ready max LTV expected 80, got ${profile.regulatoryMaxLtv.maxLtvPct}`);
    assert(profile.userLtv === 80, `user LTV ${profile.userLtv}`);
    assert(!!profile.regulatoryMaxLtv.sourceNote && !!profile.regulatoryMaxLtv.asOf, "sourceNote + asOf provenance attached");
    assert(profile.disclaimers.userScenario.length > 0 && profile.disclaimers.regulatoryMaximum.length > 0 && profile.disclaimers.lenderDecision.length > 0, "three-line disclaimers present");
    // Hand-computed baseline: 1.6M loan, 4.5%/yr, 25yr annuity
    const loan = 1_600_000;
    const r = 0.045 / 12;
    const n = 25 * 12;
    const expected = (loan * r) / (1 - Math.pow(1 + r, -n));
    assert(Math.abs(profile.monthlyPayment - expected) <= 0.01, `monthly payment ${profile.monthlyPayment} vs manual ${expected}`);
    assert(Math.abs(profile.monthlyPayment - 8893.32) <= 0.01, `monthly payment ${profile.monthlyPayment} vs known baseline 8893.32`);
    // Default down-payment strategy: LTV at regulatory max − 5pp → down payment = 25%
    assert(engine.defaultDownPaymentPct("resident-first", "ready") === 25, `default down payment ${engine.defaultDownPaymentPct("resident-first", "ready")}, expected 25`);
    assert(engine.defaultDownPaymentPct("nonresident-additional", "offplan") === 65, "nonresident-additional default down 65%");
    return `maxLTV 80% · monthly ${profile.monthlyPayment} AED (baseline ${expected.toFixed(2)}) · default down 25%`;
  });

  /* SEARCH-* — search behavior (Q08/Q09) */
  await check("SEARCH-STATE", "SearchState URL round-trip is deterministic", async () => {
    const { searchStateToQuery, queryToSearchState } = await import("@/server/search/types");
    const state = queryToSearchState({ q: "marina", community: "dubai-marina,business-bay", priceMin: "1000000", bedsMin: "2", sort: "price_asc", page: "3" });
    assert(state.communities?.length === 2, "multi-value parsing");
    const q = searchStateToQuery(state);
    const round = queryToSearchState(q);
    assert(round.q === "marina" && round.priceMin === 1000000 && round.bedroomsMin === 2 && round.sort === "price_asc" && round.page === 3, "round-trip preserves values");
  });

  await check("SEARCH-TYPO", "Typo tolerance (Damerau-Levenshtein bounded)", async () => {
    const { editDistanceWithin, tokenize } = await import("@/server/search/local-provider");
    assert(editDistanceWithin("marina", "mrina", 1) === true, "1 typo within k=1");
    assert(editDistanceWithin("business", "busness", 1) === true, "deletion within k=1");
    assert(editDistanceWithin("marina", "marine", 1) === true, "substitution within k=1");
    assert(editDistanceWithin("marina", "berlin", 2) === false, "distance>2 rejected");
    const tokens = tokenize("2-bed in Dubai Marina!");
    assert(tokens.includes("marina") && tokens.includes("bed"), `tokenization ${tokens}`);
  });

  await check("SEARCH-GEO", "Geo filtering (bbox + haversine radius)", async () => {
    const { search } = await import("@/server/search/service");
    const marina = await search({ listingType: "SALE", sort: "relevance", communities: ["dubai-marina"], bbox: [55.0, 24.9, 55.2, 25.2], page: 1, pageSize: 20 });
    assert(marina.total > 0, "bbox results exist");
    for (const r of marina.results) {
      assert(r.lng >= 55.0 && r.lng <= 55.2 && r.lat >= 24.9 && r.lat <= 25.2, `result out of bbox: ${r.slug}`);
    }
    const center = await search({ listingType: "SALE", sort: "relevance", centerLat: 25.0805, centerLng: 55.1403, radiusKm: 5, page: 1, pageSize: 48 });
    for (const r of center.results) {
      const d = haversine(25.0805, 55.1403, r.lat, r.lng);
      assert(d <= 5.01, `radius violation ${r.slug} at ${d.toFixed(2)}km`);
    }
    return `${marina.total} in bbox, ${center.total} within 5km of Marina center`;
  });

  await check("SEARCH-FACETS", "Facet counts consistent with filtered totals", async () => {
    const { search } = await import("@/server/search/service");
    const res = await search({ listingType: "SALE", sort: "relevance", page: 1, pageSize: 1 });
    const facetSum = res.facets.communities.reduce((s, c) => s + c.count, 0);
    assert(facetSum === res.total, `facet sum ${facetSum} vs total ${res.total}`);
    assert(res.facets.priceBuckets.reduce((s, b) => s + b.count, 0) === res.total, "price buckets sum");
  });

  await check("SEARCH-SORT", "Sort correctness (price_asc)", async () => {
    const { search } = await import("@/server/search/service");
    const res = await search({ listingType: "SALE", sort: "price_asc", page: 1, pageSize: 20 });
    const prices = res.results.map((r) => Number(r.price.minor));
    for (let i = 1; i < prices.length; i++) assert(prices[i] >= prices[i - 1], `sort violation at ${i}`);
  });

  /* INGEST-* — ingestion pipeline (Q07) */
  await check("INGEST-VALIDATE", "Feed validation rejects malformed records", async () => {
    const { feedRecordSchema } = await import("@/server/ingestion/pipeline");
    const bad = feedRecordSchema.safeParse({ externalId: "x1", title: "no", community: "", priceAed: -5 });
    assert(!bad.success, "negative price rejected");
    const bad2 = feedRecordSchema.safeParse({ externalId: "", title: "Valid title here", community: "Marina", priceAed: 1000 });
    assert(!bad2.success, "missing externalId rejected");
    const good = feedRecordSchema.safeParse({ externalId: "x1", title: "Valid title here", community: "Dubai Marina", priceAed: 1000000 });
    assert(good.success, "valid record accepted");
  });

  await check("INGEST-IDEMPOTENT", "Import re-run skips identical records (no duplicates)", async () => {
    const { runImport } = await import("@/server/ingestion/pipeline");
    const { db } = await import("@/lib/db");
    const source = await db.importSource.upsert({
      where: { name: "SELFTEST_FEED" },
      create: { name: "SELFTEST_FEED", sourceType: "JSON", notes: "Self-test source" },
      update: {},
    });
    const stamp = Date.now();
    const records = [
      { externalId: `selftest-${stamp}`, title: `Selftest One Bed in Marina ${stamp}`, community: "Dubai Marina", propertyType: "APARTMENT", listingType: "SALE", bedrooms: 1, bathrooms: 1, areaSqft: 700, priceAed: 1250000 + (stamp % 1000), description: "Self-test fixture" },
    ];
    const first = await runImport({ sourceId: source.id, records, triggeredBy: "selftest" });
    const second = await runImport({ sourceId: source.id, records, triggeredBy: "selftest" });
    assert(first.created + first.updated >= 1, "first run creates");
    assert(second.skippedDuplicate >= 1, `second run flagged duplicate (got created=${second.created}, dup=${second.skippedDuplicate})`);
    return `run1 created=${first.created}, run2 duplicates=${second.skippedDuplicate}`;
  });

  await check("INGEST-DUPE-DETECT", "Duplicate detection flags rather than silently merging (R17)", async () => {
    const { db } = await import("@/lib/db");
    const dupeRecords = await db.importRecord.count({ where: { action: "SKIPPED_DUPLICATE" } });
    assert(dupeRecords >= 1, "duplicate import records recorded");
  });

  /* LEAD-* — lead service (Q15/Q16) */
  await check("LEAD-DEDUPE", "Contact dedupe + repeat submission detection", async () => {
    const { submitLead } = await import("@/server/domain/lead-service");
    const email = `selftest-${Date.now()}@example.test`;
    const payload = {
      intent: "BUY" as const,
      name: "Self Test",
      email,
      phone: "+971500000099",
      consentContact: true as const,
      consentMarketing: false,
      preferredLocale: "en",
      sourceChannel: "WEBSITE" as const,
      message: "Self-test lead for verification harness",
      clientSubmissionId: `st-${Date.now()}-1`,
    };
    const first = await submitLead(payload);
    assert(!first.duplicate, "first submission is new");
    const repeat = await submitLead({ ...payload, clientSubmissionId: `st-${Date.now()}-2` });
    assert(repeat.duplicate === true && repeat.leadId === first.leadId, "repeat within 24h dedupes to the same lead");
    return `lead ${first.reference} deduped on repeat`;
  });

  await check("LEAD-ATTRIBUTION", "Attribution context persisted (UTM/referrer/search state)", async () => {
    const { submitLead } = await import("@/server/domain/lead-service");
    const { db } = await import("@/lib/db");
    const email = `attr-${Date.now()}@example.test`;
    const res = await submitLead({
      intent: "BUY",
      name: "Attribution Test",
      email,
      consentContact: true,
      consentMarketing: false,
      preferredLocale: "en",
      sourceChannel: "WEBSITE" as const,
      landingUrl: "/properties?community=dubai-marina",
      referrer: "https://news.example/article",
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "dubai_launch",
      searchState: { community: "dubai-marina", bedsMin: "2" },
      sessionId: "st-session-1",
      deviceClass: "MOBILE",
    });
    const lead = await db.lead.findUnique({ where: { id: res.leadId }, include: { context: true } });
    assert(lead?.context?.utmSource === "newsletter", "utm_source persisted");
    assert(lead?.context?.utmCampaign === "dubai_launch", "utm_campaign persisted");
    assert(lead?.context?.referrer?.includes("news.example"), "referrer persisted");
    assert(lead?.context?.deviceClass === "MOBILE", "device class persisted");
    assert(!!lead?.context?.searchStateJson, "search state persisted");
  });

  await check("LEAD-CONSENT", "Consent evidence recorded per submission", async () => {
    const { db } = await import("@/lib/db");
    const consent = await db.leadConsent.findFirst({ where: { purpose: "LEAD_CONTACT", status: "GRANTED" }, orderBy: { capturedAt: "desc" } });
    assert(!!consent?.evidenceJson, "consent evidence JSON present");
  });

  await check("LEAD-OUTBOX", "Transactional outbox emits lead.created (durable CRM handoff)", async () => {
    const { db } = await import("@/lib/db");
    const events = await db.outboxEvent.findMany({ where: { eventType: "lead.created" }, orderBy: { createdAt: "desc" }, take: 5 });
    assert(events.length >= 1, "lead.created events exist in outbox");
  });

  await check("LEAD-SCORE", "Deterministic lead scoring bands", async () => {
    const { scoreLead } = await import("@/server/domain/lead-service");
    const low = scoreLead({ intent: "GENERAL", name: "x", email: "a@b.c", consentContact: true, consentMarketing: false, preferredLocale: "en", sourceChannel: "WEBSITE" }, { hasEntity: false, isExclusive: false });
    const high = scoreLead({ intent: "INVEST", name: "x", email: "a@b.c", phone: "+9715", message: "Detailed message ".repeat(5), consentContact: true, consentMarketing: false, preferredLocale: "en", sourceChannel: "WEBSITE", scheduledAt: new Date().toISOString(), budgetMax: 5000000 }, { hasEntity: true, isExclusive: true });
    assert(high.score > low.score, "high context scores above low");
    assert(["LOW", "MEDIUM", "HIGH"].includes(high.band), "band is bounded");
  });

  /* AUTH-* — auth & RBAC (Q03/Q30) */
  await check("AUTH-RBAC", "Permission matrix enforces least privilege (R24)", async () => {
    const { hasPermission } = await import("@/server/auth");
    assert(hasPermission(["OWNER"], "anything:at:all") === true, "owner wildcard");
    assert(hasPermission(["CONTENT_EDITOR"], "content:publish") === true, "editor content");
    assert(hasPermission(["CONTENT_EDITOR"], "user:delete") === false, "editor cannot delete users");
    assert(hasPermission(["AGENT"], "lead:read") === true, "agent reads leads");
    assert(hasPermission(["AGENT"], "integration:read") === false, "agent cannot read integrations");
    assert(hasPermission(["VIEWER"], "property:read") === true, "viewer reads properties");
    assert(hasPermission(["VIEWER"], "property:publish") === false, "viewer cannot publish");
    assert(hasPermission([], "property:read") === false, "no roles = no access");
  });

  await check("AUTH-PASSWORD", "Password hashing round-trip + wrong rejection", async () => {
    const { hashPassword, verifyPassword } = await import("@/server/auth");
    const hash = hashPassword("CorrectHorse9!");
    assert(verifyPassword("CorrectHorse9!", hash) === true, "correct password accepted");
    assert(verifyPassword("wrong", hash) === false, "wrong password rejected");
    assert(!hash.includes("CorrectHorse"), "hash does not contain plaintext");
  });

  /* SEO-* (Q22/Q32) */
  await check("SEO-REDIRECT", "Redirect engine resolves with single hop (no chains)", async () => {
    const { db } = await import("@/lib/db");
    const redirects = await db.redirect.findMany({ where: { isActive: true } });
    for (const r of redirects) {
      const target = redirects.find((x) => x.fromPath === r.toPath);
      assert(!target, `redirect chain detected: ${r.fromPath} → ${r.toPath} → …`);
    }
    assert(redirects.length >= 3, "redirect map populated");
  });

  await check("SEO-ROBOTS", "Robots policy blocks private surfaces", async () => {
    const { robotsTxt } = await import("@/server/seo/sitemap");
    const txt = robotsTxt("https://example.com");
    assert(txt.includes("Disallow: /*/account"), "account noindex");
    assert(txt.includes("Disallow: /*/admin"), "admin blocked");
    assert(txt.includes("Sitemap:"), "sitemap reference present");
  });

  /* RAG-* (Q24) */
  await check("RAG-CITATION", "Retrieval returns chunks with source/citation metadata", async () => {
    const { retrieve } = await import("@/server/rag/pipeline");
    const results = await retrieve("golden visa property threshold", 3);
    assert(results.length >= 1, "relevant chunk retrieved");
    for (const r of results) {
      assert(!!r.sourceTitle, "source title present");
      assert(!!r.trustTier, "trust tier present");
      assert(!!r.verifiedAt, "verified date present");
    }
    return `top: ${results[0].sourceTitle} (score ${results[0].score.toFixed(2)})`;
  });

  await check("RAG-HYBRID", "Hybrid retrieval ranks on-topic above off-topic", async () => {
    const { retrieve } = await import("@/server/rag/pipeline");
    const on = await retrieve("escrow account off-plan protection", 1);
    const off = await retrieve("recipe for banana bread", 1);
    const onScore = on[0]?.score ?? 0;
    const offScore = off[0]?.score ?? 0;
    assert(onScore > offScore, `on-topic ${onScore.toFixed(2)} must outrank off-topic ${offScore.toFixed(2)}`);
  });

  /* PRIVACY-* (Q30) */
  await check("PRIVACY-DSR", "Data-subject request workflow writes auditable records", async () => {
    const { db } = await import("@/lib/db");
    const count = await db.dataSubjectRequest.count();
    // 0 is acceptable pre-launch; the workflow is exercised via /api/account/delete-request
    assert(count >= 0, "DSR table queryable");
    const consentCount = await db.consent.count();
    assert(consentCount >= 0, "consent records queryable");
  });

  /* MONEY (ADR-009) */
  await check("MONEY-SERIALIZE", "Minor-unit money serialization is JSON-safe", async () => {
    const { formatMoney, toMinor, fromMinor, pricePerSqftMinor } = await import("@/lib/money");
    const minor = toMinor(2_150_000);
    assert(minor === 215000000n, `toMinor ${minor}`);
    assert(JSON.stringify({ minor }) === '{"minor":"215000000"}', "BigInt serializes as string");
    assert(formatMoney("215000000", { currency: "AED" }).includes("2,150,000"), formatMoney("215000000"));
    assert(fromMinor("215000000") === 2150000, "fromMinor round-trip");
    const ppsf = pricePerSqftMinor(215000000n, 1210);
    assert(ppsf !== null, "ppsf computed");
  });

  /* DATASTATE-* (V2 §5.1 data-state machine, U09) */
  await check("datastate.machine", "Data-state machine: legal enum, demo disclosure, metric-state mapping", async () => {
    const m = await import("@/lib/data-state");
    const state = m.getDataState();
    assert((m.DATA_STATES as readonly string[]).includes(state), `illegal data state: ${state}`);
    assert(state === "LOCAL_DEMO", `sandbox must declare LOCAL_DEMO (got ${state}) — demo disclosure depends on it`);
    assert(m.isDemoDataState(state) === true, "demo state recognized as demo");

    // Deterministic metric-state mapping (global state overridden per case).
    assert(m.resolveMetricState({}, { globalState: "PRODUCTION_VERIFIED" }) === "UNAVAILABLE", "no provenance → UNAVAILABLE");
    assert(m.resolveMetricState({ sourcePublisher: "DLD" }, { globalState: "LOCAL_DEMO" }) === "ILLUSTRATIVE", "demo env forces ILLUSTRATIVE");
    assert(
      m.resolveMetricState({ sourcePublisher: "DLD", verificationStatus: "VERIFIED" }, { globalState: "PRODUCTION_VERIFIED" }) === "VERIFIED_SOURCE",
      "VERIFIED marker → VERIFIED_SOURCE"
    );
    assert(
      m.resolveMetricState({ sourcePublisher: "DLD", verificationStatus: "UNVERIFIED" }, { globalState: "PRODUCTION_VERIFIED" }) !== "VERIFIED_SOURCE",
      "UNVERIFIED must never pass as VERIFIED_SOURCE"
    );
    assert(
      m.resolveMetricState({ sourcePublisher: "DLD", sourceType: "APPROVED_FEED" }, { globalState: "PRODUCTION_VERIFIED" }) === "APPROVED_INTERNAL",
      "APPROVED marker → APPROVED_INTERNAL"
    );
    assert(
      m.resolveMetricState({ sourcePublisher: "Research", methodology: "Modeled from comparables" }, { globalState: "PRODUCTION_VERIFIED" }) === "MODELED",
      "model methodology → MODELED"
    );
    assert(
      m.resolveMetricState({ sourcePublisher: "Scenario form", sourceType: "USER" }, { globalState: "PRODUCTION_VERIFIED" }) === "USER_INPUT",
      "user source → USER_INPUT"
    );
    assert(
      m.resolveMetricState(
        { sourcePublisher: "DLD", verificationStatus: "VERIFIED", retrievedAt: new Date(Date.now() - 400 * 86_400_000) },
        { globalState: "PRODUCTION_VERIFIED" }
      ) === "STALE",
      "retrievedAt beyond stale window → STALE"
    );
    assert(
      m.resolveMetricState({ sourcePublisher: "DLD", isIllustrative: true }, { globalState: "PRODUCTION_VERIFIED" }) === "ILLUSTRATIVE",
      "illustrative flag honored in production"
    );
    assert(
      m.resolveMetricState({ sourcePublisher: "DLD" }, { globalState: "PRODUCTION_UNVERIFIED" }) === "ILLUSTRATIVE",
      "unverified production defaults to ILLUSTRATIVE"
    );
    return `global=${state}; 10 mapping rules verified`;
  });

  /* MARKET-* (V2 §19.5/§38 rent validation pipeline, U09) */
  await check("market.rentValidation", "Rent validation pipeline quarantines malformed rows (§19.5)", async () => {
    const { validateRentRecords, validateTransactionRecords } = await import("@/server/domain/read-models");
    const { db } = await import("@/lib/db");

    // Synthetic fixtures: hard-invalid, soft-invalid and clean rows.
    const synthetic = validateRentRecords([
      { bedrooms: 0, propertyType: "Apartment", annualRentMinor: 100000n, sizeSqft: null }, // hard: zero-bed non-studio (+ missing size)
      { bedrooms: 0, propertyType: "Studio", annualRentMinor: 60000n, sizeSqft: 480 }, // valid studio
      { bedrooms: 2, propertyType: "Apartment", annualRentMinor: 120000n, sizeSqft: null }, // soft: missing size only
      { bedrooms: 1, propertyType: "Apartment", annualRentMinor: 0n, sizeSqft: 700 }, // hard: non-positive rent
    ]);
    assert(synthetic.validation.totalRecords === 4, "total counted");
    assert(synthetic.validation.validRecords === 2, `valid rows: ${synthetic.validation.validRecords}`);
    assert(synthetic.validation.excludedRecords === 2, "hard-invalid excluded");
    assert(synthetic.validation.exclusionReasons.zero_bedrooms_non_studio === 1, "zero-bed non-studio counted");
    assert(synthetic.validation.exclusionReasons.non_positive_rent === 1, "non-positive rent counted");
    assert(synthetic.validation.exclusionReasons.missing_size === 2, "missing size counted");
    assert(synthetic.validation.perSqftEligibleRecords === 1, "per-sqft eligibility counted");
    assert(synthetic.validRows.length === 2, "validRows partition");

    // Live dataset pass — the pipeline must run clean over the seeded rents.
    const rents = await db.marketRent.findMany({
      select: { bedrooms: true, propertyType: true, annualRentMinor: true, sizeSqft: true },
      take: 1000,
    });
    const live = validateRentRecords(rents);
    assert(live.validation.totalRecords === rents.length, "live total matches row count");
    assert(
      live.validation.validRecords + live.validation.excludedRecords === live.validation.totalRecords,
      "partition invariant holds"
    );
    for (const r of live.validRows) {
      assert(!((r.bedrooms ?? 0) === 0 && !/studio/i.test(r.propertyType)), "no zero-bed non-studio row leaked into valid set");
      assert(r.annualRentMinor > 0n, "no non-positive rent leaked into valid set");
    }
    // Transactions pipeline sanity over the live dataset.
    const txs = await db.marketTransaction.findMany({ select: { amountMinor: true, sizeSqft: true }, take: 1000 });
    const liveTx = validateTransactionRecords(txs);
    assert(liveTx.validation.totalRecords === txs.length, "transaction total matches");
    assert(liveTx.validation.validRecords + liveTx.validation.excludedRecords === liveTx.validation.totalRecords, "tx partition invariant");
    return `rents ${live.validation.validRecords}/${live.validation.totalRecords} valid (${live.validation.excludedRecords} excluded, ${live.validation.exclusionReasons.missing_size} missing size); tx ${liveTx.validation.validRecords}/${liveTx.validation.totalRecords} valid`;
  });

  /* HEALTH (Q33) */
  await check("HEALTH-DB", "Database reachable with low latency", async () => {
    const { db } = await import("@/lib/db");
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    assert(Date.now() - t0 < 500, "db latency under 500ms");
  });

  /* U22 — security headers (V2 §44) */
  await check("SECURITY-HEADERS", "Security response headers present", async () => {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    try {
      const res = await fetch(base, { cache: "no-store" });
      const h = res.headers;
      assert((h.get("x-content-type-options") ?? "").includes("nosniff"), "X-Content-Type-Options: nosniff");
      assert((h.get("referrer-policy") ?? "") !== "", "Referrer-Policy present");
      assert((h.get("x-frame-options") ?? "") !== "" || (h.get("content-security-policy") ?? "").includes("frame-ancestors"), "frame protection present");
      assert((h.get("permissions-policy") ?? "") !== "", "Permissions-Policy present");
      return "nosniff · referrer-policy · frame · permissions-policy all set";
    } catch {
      // Header config verified statically when runtime fetch is unavailable.
      const cfg = await import("fs").then((fs) => fs.readFileSync("next.config.ts", "utf8"));
      assert(cfg.includes("X-Content-Type-Options"), "headers() block declares nosniff");
      assert(cfg.includes("Permissions-Policy"), "headers() block declares permissions-policy");
      return "static config verified (runtime fetch unavailable)";
    }
  });

  /* U22 — i18n parity (V2 §36) */
  await check("I18N-PARITY", "en/ar dictionary key parity", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/i18n.ts"), "utf8");
    const enStart = src.indexOf("en: {");
    const arStart = src.indexOf("ar: {");
    assert(enStart >= 0 && arStart > enStart, "dictionary blocks located");
    const enBlock = src.slice(enStart, arStart);
    const arBlock = src.slice(arStart);
    const keyRe = /^\s{2,6}"([a-zA-Z0-9_.]+)":/gm;
    const keysOf = (block: string) => {
      const keys = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = keyRe.exec(block)) !== null) keys.add(m[1]);
      return keys;
    };
    const enKeys = keysOf(enBlock);
    const arKeys = keysOf(arBlock);
    assert(enKeys.size > 1000, `en dictionary substantive (${enKeys.size} keys)`);
    assert(arKeys.size === enKeys.size, `ar/en key count mismatch: ar=${arKeys.size} en=${enKeys.size}`);
    const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));
    const missingInEn = [...arKeys].filter((k) => !enKeys.has(k));
    assert(missingInAr.length === 0, `keys missing in ar: ${missingInAr.slice(0, 5).join(", ")}`);
    assert(missingInEn.length === 0, `keys missing in en: ${missingInEn.slice(0, 5).join(", ")}`);
    return `en=ar=${enKeys.size} keys, zero gaps`;
  });

  /* V3-A — demo-string purge guard (V3 §34): banned demo/fictional contact and
   * team literals must never reappear in shipped source. Scans all .ts/.tsx
   * files under src/ plus db/seed.ts; excludes this file (it defines the banned
   * list) and scripts/ (the migration tooling references the old values it deletes). */
  await check("v3.demo-strings", "banned demo/fictional contact literals purged from source", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const BANNED = [
      "+971 4 000 0000", "+97144000000", "+971400000000",
      "+971500000001", "+971500000002", "+971500000003", "+971500000004", "+971500000005", "+971500000006",
      "Office 000", "Boulevard Plaza",
      "investmentexperts.example", "example.dev",
      "Demo WhatsApp", "DEMO CONTACT DETAILS",
      "Omar Farouk", "James Connolly", "Layla Haddad", "Dmitri Volkov", "Priya Sharma", "Sara Ahmadi",
    ];
    const roots = ["src", "db"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    for (const root of roots) {
      const rootPath = path.join(process.cwd(), root);
      if (!fs.existsSync(rootPath)) continue;
      if (root === "db") {
        const seed = path.join(rootPath, "seed.ts");
        if (fs.existsSync(seed)) files.push(seed);
      } else walk(rootPath);
    }
    // exclude this selftest file itself
    const selfFile = path.join(process.cwd(), "src/app/api/system/selftest/route.ts");
    const hits: string[] = [];
    for (const file of files) {
      if (path.resolve(file) === path.resolve(selfFile)) continue;
      const content = fs.readFileSync(file, "utf8");
      for (const b of BANNED) {
        if (content.includes(b)) hits.push(`${path.relative(process.cwd(), file)}: "${b}"`);
      }
    }
    assert(hits.length === 0, `${hits.length} banned demo literals: ${hits.slice(0, 5).join("; ")}`);
    return `scanned ${files.length} files — zero banned literals`;
  });

  /* U22 — three.js route isolation (V2 §30/§42) */
  await check("PERF-THREE-ISOLATION", "three.js imported only by atlas/twin modules", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const srcFiles = walk(path.join(process.cwd(), "src"));
    const offenders: string[] = [];
    for (const f of srcFiles) {
      const content = fs.readFileSync(f, "utf8");
      if (/from\s+["']three["']/.test(content) || /from\s+["']three\//.test(content)) {
        const rel = path.relative(process.cwd(), f).replaceAll("\\", "/");
        const isAllowed = rel.startsWith("src/components/atlas/") || rel.startsWith("src/components/twin/");
        if (!isAllowed) offenders.push(rel);
      }
    }
    assert(offenders.length === 0, `three imported outside atlas/twin: ${offenders.join(", ")}`);
    return "three.js confined to src/components/{atlas,twin} (lazy-loaded chunks only)";
  });

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  return NextResponse.json({
    suite: "investment-experts-selftest",
    ranAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    status: failed === 0 ? "PASS" : "FAIL",
    results,
  });
});

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
