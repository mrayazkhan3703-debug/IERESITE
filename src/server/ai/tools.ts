/**
 * AI Advisor tools (Q25): whitelisted, zod-validated deterministic tools.
 * The AI can only reference inventory returned by tools — it never invents
 * properties, prices, or availability (F05 / R12 / R13).
 */
import { z } from "zod";
import { db, parseJson } from "@/lib/db";
import { search } from "@/server/search/service";
import { queryToSearchState, searchStateSchema, type SearchState } from "@/server/search/types";
import { retrieve } from "@/server/rag/pipeline";
import * as calc from "@/lib/calculators";
import {
  PUBLIC_COMMUNITY_WHERE,
  PUBLIC_DEVELOPER_WHERE,
  PUBLIC_PROJECT_WHERE,
  PUBLIC_PROPERTY_WHERE,
  publicListingWindowWhere,
} from "@/server/domain/visibility";

export interface ToolResult {
  ok: boolean;
  data: unknown;
  error?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  argsSchema: z.ZodTypeAny;
  execute: (args: any, context?: { locale?: string }) => Promise<ToolResult>;
}

/* Property search tool ------------------------------------------------------ */

const propertySearchArgs = z.object({
  listingType: z.enum(["SALE", "RENT"]).optional(),
  communities: z.array(z.string()).optional(),
  propertyTypes: z.array(z.string()).optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  bedroomsMin: z.number().optional(),
  bedroomsMax: z.number().optional(),
  bathroomsMin: z.number().optional(),
  areaMin: z.number().optional(),
  q: z.string().optional(),
  offPlan: z.boolean().optional(),
  seaView: z.boolean().optional(),
  /* V2 (U13 §22.2): modeled-yield and handover criteria are first-class search
   * filters (mirrors the public search UI filters). */
  yieldMin: z.number().min(0).max(25).optional(),
  handoverBy: z.string().max(20).optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "area_desc"]).optional(),
  limit: z.number().int().min(1).max(6).optional(),
});

/** Normalize community names or slugs → slugs (models pass names like "Dubai Marina"). */
async function normalizeCommunitySlugs(communities: string[] | undefined): Promise<string[] | undefined> {
  if (!communities?.length) return communities;
  const all = await db.community.findMany({ where: PUBLIC_COMMUNITY_WHERE, select: { slug: true, name: true } });
  const byName = new Map(all.map((c) => [c.name.toLowerCase().replace(/[^a-z0-9]/g, ""), c.slug]));
  const bySlug = new Set(all.map((c) => c.slug));
  return communities
    .map((c) => {
      if (bySlug.has(c)) return c;
      const norm = c.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (byName.has(norm)) return byName.get(norm)!;
      // partial match
      for (const [name, slug] of byName) if (name.includes(norm) || norm.includes(name)) return slug;
      return null;
    })
    .filter((c): c is string => !!c);
}

async function execPropertySearch(args: z.infer<typeof propertySearchArgs>): Promise<ToolResult> {
  const view: string[] = [];
  if (args.seaView) view.push("SEA");
  const communitySlugs = await normalizeCommunitySlugs(args.communities);
  const state = searchStateSchema.parse({
    listingType: args.listingType ?? "SALE",
    communities: communitySlugs,
    propertyTypes: args.propertyTypes?.map((p) => p.toUpperCase()),
    priceMin: args.priceMin,
    priceMax: args.priceMax,
    bedroomsMin: args.bedroomsMin,
    bedroomsMax: args.bedroomsMax,
    bathroomsMin: args.bathroomsMin,
    areaMin: args.areaMin,
    q: args.q ? [args.q, ...view].join(" ") : view.join(" ") || undefined,
    offPlan: args.offPlan,
    yieldMin: args.yieldMin,
    handoverBy: args.handoverBy,
    sort: args.sort ?? "relevance",
    page: 1,
    pageSize: args.limit ?? 4,
  });
  const result = await search(state);
  return {
    ok: true,
    data: {
      total: result.total,
      properties: result.results.map((r) => ({
        slug: r.slug,
        title: r.title,
        community: r.community.name,
        project: r.project?.name ?? null,
        propertyType: r.propertyType,
        bedrooms: r.bedrooms,
        bathrooms: r.bathrooms,
        areaSqft: r.areaSqft,
        priceAed: Number(r.price.minor) / 100,
        availability: r.availabilityStatus,
        offPlan: r.offPlan,
        coverUrl: r.cover?.url ?? null,
        sourceType: "INDEX",
        isDemoData: r.isDemoData ?? false,
        url: `/properties/${r.slug}`,
      })),
      note: "Only these properties exist in current inventory. Cite them by title exactly.",
    },
  };
}

/* Entity lookups --------------------------------------------------------------- */

const lookupArgs = z.object({ slug: z.string().optional(), name: z.string().optional() });

async function execProjectLookup(args: z.infer<typeof lookupArgs>): Promise<ToolResult> {
  const project = args.slug
    ? await db.project.findFirst({ where: { slug: args.slug, ...PUBLIC_PROJECT_WHERE } })
    : await db.project.findFirst({ where: { name: { contains: args.name ?? "" }, ...PUBLIC_PROJECT_WHERE } });
  if (!project) return { ok: false, data: null, error: "Project not found" };
  const plans = await db.paymentPlan.findMany({ where: { projectId: project.id }, include: { installments: true } });
  return {
    ok: true,
    data: {
      name: project.name,
      slug: project.slug,
      status: project.status,
      developer: (await db.developer.findUnique({ where: { id: project.developerId } }))?.name,
      community: (await db.community.findUnique({ where: { id: project.communityId } }))?.name,
      handoverDate: project.handoverDate?.toISOString().slice(0, 10),
      completionPercent: project.completionPercent,
      startingPriceAed: project.startingPriceMinor ? Number(project.startingPriceMinor) / 100 : null,
      paymentPlans: plans.map((p) => ({
        name: p.name,
        verificationStatus: p.verificationStatus,
        installments: p.installments.map((i) => ({ label: i.label, percent: i.percent })),
      })),
      constructionSource: project.constructionSourceUrl,
      sourceVerifiedAt: project.sourceVerifiedAt?.toISOString(),
      sourceType: project.sourceType,
      isDemoData: project.isDemoData,
      url: `/projects/${project.slug}`,
    },
  };
}

async function execCommunityLookup(args: z.infer<typeof lookupArgs>): Promise<ToolResult> {
  const community = args.slug
    ? await db.community.findFirst({ where: { slug: args.slug, ...PUBLIC_COMMUNITY_WHERE } })
    : await db.community.findFirst({ where: { name: { contains: args.name ?? "" }, ...PUBLIC_COMMUNITY_WHERE } });
  if (!community) return { ok: false, data: null, error: "Community not found" };
  return {
    ok: true,
    data: {
      name: community.name,
      slug: community.slug,
      summary: community.summary,
      areaType: community.areaType,
      avgPricePerSqftAed: community.avgPricePerSqftMinor ? Number(community.avgPricePerSqftMinor) / 100 : null,
      lifestyleTags: parseJson<string[]>(community.lifestyleTagsJson, []),
      sourceType: community.sourceType,
      isDemoData: community.isDemoData,
      updatedAt: community.updatedAt.toISOString(),
      url: `/communities/${community.slug}`,
    },
  };
}

async function execDeveloperLookup(args: z.infer<typeof lookupArgs>): Promise<ToolResult> {
  const developer = args.slug
    ? await db.developer.findFirst({ where: { slug: args.slug, ...PUBLIC_DEVELOPER_WHERE } })
    : await db.developer.findFirst({ where: { name: { contains: args.name ?? "" }, ...PUBLIC_DEVELOPER_WHERE } });
  if (!developer) return { ok: false, data: null, error: "Developer not found" };
  const projects = await db.project.findMany({ where: { developerId: developer.id, ...PUBLIC_PROJECT_WHERE }, select: { name: true, slug: true, status: true } });
  return {
    ok: true,
    data: {
      name: developer.name,
      slug: developer.slug,
      summary: developer.summary,
      verificationStatus: developer.verificationStatus,
      lastVerifiedAt: developer.lastVerifiedAt?.toISOString(),
      projects: projects.slice(0, 8),
      url: `/developers/${developer.slug}`,
    },
  };
}

/* Property lookup (V2 §22 — scoped advisor entry / "tell me about this listing") ---- */

const propertyLookupArgs = z.object({ slug: z.string().min(1).max(120) });

async function execPropertyLookup(args: z.infer<typeof propertyLookupArgs>): Promise<ToolResult> {
  const property = await db.property.findFirst({
    where: { slug: args.slug, ...PUBLIC_PROPERTY_WHERE },
    include: {
      community: { select: { name: true, slug: true } },
      project: { select: { name: true, slug: true } },
      listings: { where: publicListingWindowWhere(), orderBy: { createdAt: "desc" }, take: 1 },
      media: { orderBy: [{ sortOrder: "asc" }, { isCover: "desc" }], include: { media: true }, take: 1 },
    },
  });
  if (!property) return { ok: false, data: null, error: "Property not found" };
  const listing = property.listings[0];
  return {
    ok: true,
    data: {
      properties: [
        {
          slug: property.slug,
          title: property.title,
          community: property.community.name,
          project: property.project?.name ?? null,
          propertyType: property.propertyType,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          areaSqft: property.builtUpAreaSqft,
          priceAed: listing ? Number(listing.priceMinor) / 100 : null,
          availability: listing?.availabilityStatus ?? "UNKNOWN",
          offPlan: listing?.offPlan ?? false,
          coverUrl: property.media[0]?.media.url ?? null,
          handoverQuarter: property.handoverQuarter,
          serviceChargePerSqft: listing?.serviceChargePerSqft ?? null,
          listingType: listing?.listingType ?? "SALE",
          sourceType: property.sourceType,
          isDemoData: property.isDemoData,
          sourceUpdatedAt: property.sourceUpdatedAt?.toISOString() ?? null,
          url: `/properties/${property.slug}`,
        },
      ],
      note: "Facts for ONE specific listing (user is viewing it). Use these facts directly; never substitute another property.",
    },
  };
}

/* Market snapshot lookup (V2 §22.3 — transaction/rental market data for communities) -- */

const marketLookupArgs = z.object({
  communities: z.array(z.string()).min(1).max(4),
});

async function execMarketLookup(args: z.infer<typeof marketLookupArgs>): Promise<ToolResult> {
  const slugs = (await normalizeCommunitySlugs(args.communities)) ?? [];
  if (!slugs.length) {
    return { ok: false, data: null, error: "No matching communities found for the given names" };
  }
  const communities = await db.community.findMany({
    where: { slug: { in: slugs }, ...PUBLIC_COMMUNITY_WHERE },
    select: { id: true, name: true, slug: true },
  });
  // Latest period per (community, metricKey)
  const metrics = await db.marketMetric.findMany({
    where: { communityId: { in: communities.map((c) => c.id) } },
    orderBy: [{ communityId: "asc" }, { metricKey: "asc" }, { periodStart: "desc" }],
  });
  const seen = new Set<string>();
  const latest = metrics.filter((m) => {
    const key = `${m.communityId}:${m.metricKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const byCommunity = communities.map((c) => ({
    name: c.name,
    slug: c.slug,
    url: `/communities/${c.slug}`,
    metrics: Object.fromEntries(
      latest
        .filter((m) => m.communityId === c.id)
        .map((m) => [
          m.metricKey,
          {
            value: m.valueNumeric,
            unit: m.unit,
            sourceName: m.sourceName,
            periodStart: m.periodStart.toISOString().slice(0, 10),
            retrievedAt: m.retrievedAt?.toISOString() ?? null,
            isIllustrative: m.isIllustrative,
          },
        ])
    ),
  }));
  if (!byCommunity.some((c) => Object.keys(c.metrics).length)) {
    return {
      ok: true,
      data: {
        communities: byCommunity.map((c) => ({ name: c.name, slug: c.slug, metrics: {} })),
        note: "No market metrics recorded for these communities. Say you have no verified figures rather than estimating.",
      },
    };
  }
  return {
    ok: true,
    data: {
      communities: byCommunity,
      note: "Latest recorded market metrics per community. Quote the sourceName and period; flag modeled/illustrative figures as such. Never extrapolate beyond these values.",
    },
  };
}

/* Knowledge retrieval (RAG) ------------------------------------------------------- */

const knowledgeArgs = z.object({ query: z.string().min(3).max(300) });

async function execKnowledge(args: z.infer<typeof knowledgeArgs>, context?: { locale?: string }): Promise<ToolResult> {
  const chunks = await retrieve(args.query, 3, context?.locale ?? "en");
  if (!chunks.length) {
    return {
      ok: true,
      data: {
        found: false,
        note: "No approved knowledge documents matched. Say you don't have verified information for this rather than guessing.",
      },
    };
  }
  return {
    ok: true,
    data: {
      found: true,
      passages: chunks.map((c) => ({
        content: c.content,
        sourceTitle: c.sourceTitle,
        trustTier: c.trustTier,
        verifiedAt: c.verifiedAt,
        url: c.canonicalUrl,
      })),
      note: "Cite the sourceTitle for any claim you use from these passages.",
    },
  };
}

/* Calculators (deterministic — never LLM arithmetic) --------------------------------- */

const roiArgs = z.object({
  purchasePrice: z.number().positive(),
  annualRent: z.number().positive(),
  annualCosts: z.number().min(0).default(0),
  appreciationPctPerYear: z.number().min(-50).max(100).default(0),
  years: z.number().int().min(1).max(30).default(5),
});

async function execRoi(args: z.infer<typeof roiArgs>): Promise<ToolResult> {
  // V2 scenario engine (§21.1): legacy fields preserved + IRR, break-even and the
  // downside/base/upside wrap so the advisor can frame ranges honestly.
  const engineInput: calc.RoiInputV2 = {
    purchasePrice: args.purchasePrice,
    annualRent: args.annualRent,
    rentGrowthPct: 0,
    vacancyPct: 0,
    serviceChargePerSqft: 0,
    sizeSqft: 0,
    maintenanceAnnual: args.annualCosts,
    managementPct: 0,
    appreciationPct: args.appreciationPctPerYear,
    purchaseCostsPct: 0,
    exitCostsPct: 0,
    horizonYears: args.years,
  };
  const legacy = calc.roiScenario(args);
  const set = calc.buildScenarios(engineInput);
  return {
    ok: true,
    data: {
      ...legacy,
      irrPct: set.base.result.irr,
      breakEvenYear: set.base.result.breakEvenYear,
      scenarios: {
        downside: { netYieldPct: set.downside.result.netYield, totalReturn: set.downside.result.totalReturn, totalReturnPct: set.downside.result.totalReturnPct },
        base: { netYieldPct: set.base.result.netYield, totalReturn: set.base.result.totalReturn, totalReturnPct: set.base.result.totalReturnPct },
        upside: { netYieldPct: set.upside.result.netYield, totalReturn: set.upside.result.totalReturn, totalReturnPct: set.upside.result.totalReturnPct },
      },
      engineVersion: calc.SCENARIO_ENGINE_VERSION,
      disclaimer: "projection",
      note: "Deterministic calculation. Present as a projection/estimate (non-guaranteed) with stated assumptions — never as a guaranteed return.",
    },
  };
}

const mortgageArgs = z.object({
  propertyPrice: z.number().positive(),
  downPaymentPct: z.number().min(0).max(100).default(20),
  interestRatePct: z.number().min(0).max(30).default(4.5),
  years: z.number().int().min(1).max(35).default(25),
  borrowerCategory: z.enum(["resident-first", "resident-additional", "nonresident-first", "nonresident-additional"]).default("resident-first"),
  propertyStatus: z.enum(["ready", "offplan"]).default("ready"),
  purpose: z.enum(["owner", "investment"]).default("owner"),
});

async function execMortgage(args: z.infer<typeof mortgageArgs>): Promise<ToolResult> {
  // V2 (§21.4): regulatory LTV preset + user scenario + lender-decision separation.
  const p = calc.mortgageProfile({
    borrowerCategory: args.borrowerCategory,
    propertyPrice: args.propertyPrice,
    propertyStatus: args.propertyStatus,
    downPaymentPct: args.downPaymentPct,
    annualRatePct: args.interestRatePct,
    termYears: args.years,
    purpose: args.purpose,
  });
  return {
    ok: true,
    data: {
      loanAmount: p.loanAmount,
      downPayment: p.downPayment,
      monthlyPayment: p.monthlyPayment,
      totalInterest: p.totalInterest,
      totalPaid: p.totalPaid,
      schedule: p.paymentSchedule.map((row) => ({ month: row.period, interest: row.interest, principal: row.principal, balance: row.balance })),
      userLtvPct: p.userLtv,
      regulatoryMaxLtvPct: p.regulatoryMaxLtv.maxLtvPct,
      regulatoryMaxLtvAsOf: p.regulatoryMaxLtv.asOf,
      regulatoryMaxLtvSourceNote: p.regulatoryMaxLtv.sourceNote,
      disclaimers: p.disclaimers,
      engineVersion: calc.SCENARIO_ENGINE_VERSION,
      note: "Scenario math only — never imply lender approval; quote the three disclaimers when presenting LTV figures.",
    },
  };
}

const yieldArgs = z.object({
  purchasePrice: z.number().positive(),
  annualRent: z.number().positive(),
  annualCosts: z.number().min(0).default(0),
});

async function execYield(args: z.infer<typeof yieldArgs>): Promise<ToolResult> {
  const r = calc.rentalYield(args);
  return { ok: true, data: r };
}

const paymentPlanArgs = z.object({
  purchasePrice: z.number().positive(),
  stages: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        percent: z.number().min(0).max(100),
        dueAt: z
          .union([z.object({ milestone: z.string().min(1).max(120) }), z.object({ date: z.string().min(8).max(32) }), z.object({ monthsFromBooking: z.number().min(0).max(600) })])
          .optional(),
      })
    )
    .min(1)
    .max(24),
});

async function execPaymentPlan(args: z.infer<typeof paymentPlanArgs>): Promise<ToolResult> {
  // V2 (§21.5): timeline + 100% validation errors surfaced for the advisor.
  const plan = calc.paymentPlanTimeline(args.stages, args.purchasePrice);
  return {
    ok: true,
    data: {
      engineVersion: calc.SCENARIO_ENGINE_VERSION,
      valid: plan.validation.valid,
      totalPercent: plan.validation.totalPercent,
      validationErrors: plan.validation.errors,
      timeline: plan.stages,
      totalAmount: plan.totalAmount,
      cashflowCsv: calc.cashflowCsv(args.stages, args.purchasePrice),
      note: "Validate stages total 100% before presenting; report validationErrors verbatim when present.",
    },
  };
}

/* Registry -------------------------------------------------------------------------------- */

export const TOOLS: ToolDef[] = [
  {
    name: "search_properties",
    description:
      "Search REAL property inventory by structured criteria (community names, property type, bedrooms, price range in AED, off-plan, sea view, min modeled gross yield percent, handover-before quarter like 'Q4 2028', etc). Returns actual available properties with prices. Always use this before recommending any property.",
    argsSchema: propertySearchArgs,
    execute: execPropertySearch,
  },
  {
    name: "lookup_property",
    description:
      "Look up ONE specific property/listing by its exact slug (the user is often viewing it — 'this property', 'here'). Returns its real facts: price, community, project, size, availability, service charge. Use this instead of search when a specific listing is being discussed.",
    argsSchema: propertyLookupArgs,
    execute: execPropertyLookup,
  },
  {
    name: "lookup_project",
    description: "Look up an off-plan project by slug or name: developer, handover, payment plans, construction source and verification dates.",
    argsSchema: lookupArgs,
    execute: execProjectLookup,
  },
  {
    name: "lookup_community",
    description: "Look up a Dubai community/area by slug or name: summary, price context, lifestyle tags.",
    argsSchema: lookupArgs,
    execute: execCommunityLookup,
  },
  {
    name: "lookup_market",
    description:
      "Look up latest recorded MARKET METRICS for 1-4 communities (names or slugs): median transaction price, avg price/sqft, avg 1BR rent, modeled gross yield %, transaction counts — each with source name and period. Use for community comparison or rental-investment questions. Quote sources; flag illustrative figures.",
    argsSchema: marketLookupArgs,
    execute: execMarketLookup,
  },
  {
    name: "lookup_developer",
    description: "Look up a developer by slug or name: summary, verification status, current projects.",
    argsSchema: lookupArgs,
    execute: execDeveloperLookup,
  },
  {
    name: "search_knowledge",
    description:
      "Search approved knowledge documents (guides, regulations, process explanations) for cited, verified information. Use for regulations, fees, visa, buying process questions. Returns passages WITH sources you must cite.",
    argsSchema: knowledgeArgs,
    execute: execKnowledge,
  },
  {
    name: "calculate_roi",
    description:
      "Deterministic ROI scenario calculator (scenario engine v2): purchase price, annual rent, costs, optional appreciation assumption and horizon. Returns gross/net yield, total return, IRR, break-even year and downside/base/upside scenario ranges. Results are projections/estimates (non-guaranteed) — never present them as guaranteed returns.",
    argsSchema: roiArgs,
    execute: execRoi,
  },
  {
    name: "calculate_mortgage",
    description:
      "Deterministic mortgage calculator (scenario engine v2): price, down payment percent, interest rate, term, plus borrower category (resident/non-resident, first/additional property) and property status (ready/off-plan). Returns monthly payment, totals, user LTV vs the regulatory maximum LTV preset (with as-of date and compliance-review note) and the required disclaimers. Never implies lender approval.",
    argsSchema: mortgageArgs,
    execute: execMortgage,
  },
  {
    name: "calculate_yield",
    description: "Deterministic rental yield calculator: purchase price, annual rent, annual costs. Returns gross and net yield percentages.",
    argsSchema: yieldArgs,
    execute: execYield,
  },
  {
    name: "calculate_payment_plan",
    description:
      "Deterministic off-plan payment plan calculator (scenario engine v2): named stages with percent and optional due date (milestone / calendar date / months from booking). Returns the normalized timeline with amounts and cumulative cashflow, 100%-total validation with explicit errors, and a cashflow CSV. Report validation errors verbatim.",
    argsSchema: paymentPlanArgs,
    execute: execPaymentPlan,
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
