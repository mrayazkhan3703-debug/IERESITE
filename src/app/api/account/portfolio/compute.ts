/**
 * Portfolio computation (V2 §25, U15) — server-side, user-scoped.
 *
 * Deterministic math reuses the shared scenario engine (yieldBreakdown,
 * paymentTimeline). Valuations are honest about their basis: asking-price
 * modeled values, community-metric modeled values, or user-entered purchase
 * price — every figure carries its basis so the UI can label MODELED vs
 * user-provided (§25.1).
 *
 * Cash-flow assumptions mirror the InvestScenarioStudio defaults (vacancy 5%,
 * maintenance max(2000, 1% of price)/yr, management 5% of effective rent) so
 * portfolio numbers reconcile with scenario numbers computed elsewhere.
 */
import { db } from "@/lib/db";
import { PUBLIC_PROJECT_WHERE, PUBLIC_PROPERTY_WHERE } from "@/server/domain/visibility";
import {
  yieldBreakdown,
  paymentTimeline,
  SCENARIO_ENGINE_VERSION,
  type PaymentPlanStageInput,
} from "@/lib/scenario-engine";

/* Assumptions — surfaced verbatim in API responses so every surface can label them. */
export const PORTFOLIO_ASSUMPTIONS = {
  vacancyAllowancePct: 5,
  maintenanceAnnualPctOfPrice: 1,
  maintenanceAnnualMin: 2000,
  managementPct: 5,
} as const;

export type ValuationBasis = "ASKING_PRICE" | "COMMUNITY_METRIC" | "PURCHASE_PRICE";

export interface PortfolioMortgage {
  balanceMinor: string;
  monthlyPaymentMinor: string;
  ratePct: number | null;
  termYears: number | null;
}

export interface PortfolioValuation {
  minor: string;
  currency: "AED";
  basis: ValuationBasis;
  /** Human explanation for the MODELED / user-provided label. */
  basisNote: string;
}

export interface PortfolioYield {
  grossScheduledRentAnnual: number;
  effectiveRentAnnual: number;
  noi: number;
  grossYieldPct: number;
  netYieldPct: number;
  operatingCosts: { serviceCharge: number; maintenance: number; management: number; other: number; total: number };
}

export interface PortfolioCashflow {
  /** Scheduled annual rent (AED) */
  rent: number;
  /** Annual mortgage debt service (12 × monthly payment) */
  mortgage: number;
  serviceCharge: number;
  maintenance: number;
  management: number;
  net: number;
}

export interface PortfolioPaymentDue {
  stage: string;
  percent: number;
  amountMinor: string;
  /** ISO date when purchaseDate + dueOffsetMonths resolve; null otherwise. */
  dueDate: string | null;
  dueLabel: string;
}

export interface PortfolioConstruction {
  completionPercent: number | null;
  handoverDate: string | null;
  constructionStatus: string | null;
  sourceVerifiedAt: string | null;
}

export interface PortfolioHoldingApi {
  id: string;
  label: string;
  propertyId: string | null;
  propertySlug: string | null;
  projectId: string | null;
  projectSlug: string | null;
  /** Link target on the platform (property page preferred, else project page). */
  href: string | null;
  community: { name: string; slug: string } | null;
  lat: number | null;
  lng: number | null;
  purchasePriceMinor: string;
  purchaseDate: string | null;
  rentAnnualMinor: string | null;
  sizeSqft: number | null;
  serviceChargePerSqft: number | null;
  mortgage: PortfolioMortgage | null;
  notes: string | null;
  valuation: PortfolioValuation;
  equityMinor: string | null;
  yield: PortfolioYield | null;
  cashflow: PortfolioCashflow;
  paymentSchedule: PortfolioPaymentDue[];
  construction: PortfolioConstruction | null;
  updatedAt: string;
}

export interface PortfolioTotalsApi {
  holdingsCount: number;
  valueMinor: string;
  acquisitionCostMinor: string;
  equityMinor: string | null;
  annualRentMinor: string | null;
  netIncomeMinor: string | null;
  grossYieldPct: number | null;
  netYieldPct: number | null;
}

export interface PortfolioApi {
  engineVersion: string;
  assumptions: {
    vacancyAllowancePct: number;
    maintenance: string;
    managementPct: number;
    note: string;
  };
  holdings: PortfolioHoldingApi[];
  totals: PortfolioTotalsApi;
}

const minor = (n: number): string => String(Math.round(n * 100));
const minorBigInt = (n: number): bigint => BigInt(Math.round(n * 100));
const major = (m: bigint): number => Number(m) / 100;

function parseMortgage(json: string | null): PortfolioMortgage | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as {
      balanceMinor?: string | number;
      monthlyPaymentMinor?: string | number;
      ratePct?: number;
      termYears?: number;
    };
    const balance = raw.balanceMinor !== undefined ? Number(raw.balanceMinor) : NaN;
    const monthly = raw.monthlyPaymentMinor !== undefined ? Number(raw.monthlyPaymentMinor) : NaN;
    if (!Number.isFinite(balance) || balance <= 0) return null;
    return {
      balanceMinor: String(Math.round(balance)),
      monthlyPaymentMinor: Number.isFinite(monthly) && monthly > 0 ? String(Math.round(monthly)) : "0",
      ratePct: typeof raw.ratePct === "number" && Number.isFinite(raw.ratePct) ? raw.ratePct : null,
      termYears: typeof raw.termYears === "number" && Number.isFinite(raw.termYears) ? raw.termYears : null,
    };
  } catch {
    return null;
  }
}

/** dueDate = purchaseDate + dueOffsetMonths (calendar-month addition, day clamped). */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Load the full portfolio for a user with all computed context (§25.1–25.5). */
export async function loadPortfolio(userId: string): Promise<PortfolioApi> {
  const holdings = await db.portfolioHolding.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      property: {
        include: {
          community: { select: { name: true, slug: true, lat: true, lng: true } },
          listings: { orderBy: { createdAt: "desc" }, take: 1, select: { priceMinor: true, currency: true, serviceChargePerSqft: true } },
          project: {
            select: {
              slug: true,
              name: true,
              status: true,
              handoverDate: true,
              completionPercent: true,
              constructionStatus: true,
              constructionSourceVerifiedAt: true,
              lat: true,
              lng: true,
              community: { select: { name: true, slug: true } },
              paymentPlans: {
                where: { isDefault: true },
                take: 1,
                include: { installments: { orderBy: { sequence: "asc" } } },
              },
            },
          },
        },
      },
      project: {
        select: {
          slug: true,
          name: true,
          status: true,
          handoverDate: true,
          completionPercent: true,
          constructionStatus: true,
          constructionSourceVerifiedAt: true,
          lat: true,
          lng: true,
          community: { select: { name: true, slug: true } },
          paymentPlans: {
            where: { isDefault: true },
            take: 1,
            include: { installments: { orderBy: { sequence: "asc" } } },
          },
        },
      },
    },
  });

  // Community AVG_PRICE_PER_SQFT lookup (latest period per community) for
  // holdings without a live asking price — labeled COMMUNITY_METRIC.
  const communitySlugs = new Set<string>();
  for (const h of holdings) {
    const slug = h.property?.community.slug ?? h.project?.community.slug;
    if (slug && !(h.property?.listings[0] && h.property.listings[0].priceMinor > 0n)) communitySlugs.add(slug);
  }
  const metricByCommunityId = new Map<string, number>();
  if (communitySlugs.size > 0) {
    const metrics = await db.marketMetric.findMany({
      where: { metricKey: "AVG_PRICE_PER_SQFT", community: { slug: { in: [...communitySlugs] } } },
      orderBy: { periodStart: "desc" },
    });
    for (const m of metrics) {
      if (!metricByCommunityId.has(m.communityId ?? "")) metricByCommunityId.set(m.communityId ?? "", m.valueNumeric);
    }
  }
  const communityIdBySlug = new Map<string, string>();
  if (communitySlugs.size > 0) {
    const communities = await db.community.findMany({
      where: { slug: { in: [...communitySlugs] } },
      select: { id: true, slug: true },
    });
    for (const c of communities) communityIdBySlug.set(c.slug, c.id);
  }

  const now = new Date();
  const out: PortfolioHoldingApi[] = [];
  const totals = {
    holdingsCount: holdings.length,
    valueMinor: 0n,
    acquisitionCostMinor: 0n,
    equityMinor: 0n,
    annualRentMinor: 0n,
    netIncomeMinor: 0n,
  };

  for (const h of holdings) {
    const priceMajor = major(h.purchasePriceMinor);
    const project = h.property?.project ?? h.project ?? null;
    const plan = project?.paymentPlans[0] ?? null;

    /* --- Valuation basis (§25.1 — honest MODELED labeling) ------------- */
    let valuation: PortfolioValuation;
    const listing = h.property?.listings[0] ?? null;
    if (listing && listing.priceMinor > 0n) {
      valuation = {
        minor: String(listing.priceMinor),
        currency: "AED",
        basis: "ASKING_PRICE",
        basisNote: "Modeled from the property's current asking price — not a certified valuation.",
      };
    } else {
      const commSlug = h.property?.community.slug ?? project?.community.slug ?? null;
      const metric = commSlug ? metricByCommunityId.get(communityIdBySlug.get(commSlug) ?? "") : undefined;
      if (metric && h.sizeSqft && h.sizeSqft > 0) {
        const modeled = metric * h.sizeSqft;
        valuation = {
          minor: minor(modeled),
          currency: "AED",
          basis: "COMMUNITY_METRIC",
          basisNote: "Modeled from the community's average AED/sqft metric — not a certified valuation.",
        };
      } else {
        valuation = {
          minor: String(h.purchasePriceMinor),
          currency: "AED",
          basis: "PURCHASE_PRICE",
          basisNote: "User-entered purchase price (no platform listing or community metric available).",
        };
      }
    }

    const mortgage = parseMortgage(h.mortgageJson);
    const valueMajor = Number(valuation.minor) / 100;
    const equityMajor = mortgage ? valueMajor - Number(mortgage.balanceMinor) / 100 : null;

    /* --- Yield + cash flow (§25.3) via the shared engine ---------------- */
    const rentAnnualMajor = h.rentAnnualMinor ? major(h.rentAnnualMinor) : null;
    const serviceChargeRate = h.serviceChargePerSqft ?? h.property?.listings[0]?.serviceChargePerSqft ?? null;
    const serviceChargeAnnual = serviceChargeRate && h.sizeSqft ? serviceChargeRate * h.sizeSqft : 0;
    const maintenanceAnnual = Math.max(
      PORTFOLIO_ASSUMPTIONS.maintenanceAnnualMin,
      priceMajor * (PORTFOLIO_ASSUMPTIONS.maintenanceAnnualPctOfPrice / 100)
    );

    let yieldInfo: PortfolioYield | null = null;
    if (rentAnnualMajor && rentAnnualMajor > 0) {
      const yb = yieldBreakdown(
        {
          monthlyScheduledRent: rentAnnualMajor / 12,
          vacancyAllowancePct: PORTFOLIO_ASSUMPTIONS.vacancyAllowancePct,
          serviceChargeAnnual,
          maintenanceAnnual,
          managementPct: PORTFOLIO_ASSUMPTIONS.managementPct,
          otherAnnual: 0,
        },
        priceMajor
      );
      yieldInfo = {
        grossScheduledRentAnnual: yb.grossScheduledRentAnnual,
        effectiveRentAnnual: yb.effectiveRentAnnual,
        noi: yb.noi,
        grossYieldPct: yb.grossYield,
        netYieldPct: yb.netYield,
        operatingCosts: yb.operatingCosts,
      };
    }

    const managementAnnual = yieldInfo ? yieldInfo.operatingCosts.management : (rentAnnualMajor ?? 0) * (PORTFOLIO_ASSUMPTIONS.managementPct / 100);
    const mortgageAnnual =
      mortgage && Number(mortgage.monthlyPaymentMinor) > 0 ? (Number(mortgage.monthlyPaymentMinor) / 100) * 12 : 0;
    const rentScheduled = rentAnnualMajor ?? 0;
    const cashflow: PortfolioCashflow = {
      rent: Math.round(rentScheduled),
      mortgage: Math.round(mortgageAnnual),
      serviceCharge: Math.round(serviceChargeAnnual),
      maintenance: Math.round(maintenanceAnnual),
      management: Math.round(managementAnnual),
      net: Math.round(rentScheduled - mortgageAnnual - serviceChargeAnnual - maintenanceAnnual - managementAnnual),
    };

    /* --- Payment schedule (§25.4) from the project payment plan --------- */
    let paymentSchedule: PortfolioPaymentDue[] = [];
    if (plan && plan.installments.length > 0) {
      const stages: PaymentPlanStageInput[] = plan.installments.map((i) => ({
        name: i.label,
        percent: i.percent,
        dueAt:
          i.dueOffsetMonths !== null && Number.isFinite(i.dueOffsetMonths)
            ? { monthsFromBooking: i.dueOffsetMonths }
            : undefined,
      }));
      const timeline = paymentTimeline(stages, priceMajor);
      paymentSchedule = timeline
        .map((t) => {
          const stage = stages.find((s) => s.name === t.name);
          const months = stage?.dueAt && "monthsFromBooking" in stage.dueAt ? stage.dueAt.monthsFromBooking : null;
          const dueDate = h.purchaseDate && months !== null ? addMonths(h.purchaseDate, months).toISOString() : null;
          return { stage: t.name, percent: t.percent, amountMinor: minor(t.amount), dueDate, dueLabel: t.dueLabel };
        })
        .filter((p) => {
          if (!p.dueDate) return true; // milestone/undated stages stay listed — never a fabricated date
          return new Date(p.dueDate) >= now;
        });
    }

    /* --- Construction tracker (§25.5) ----------------------------------- */
    const construction: PortfolioConstruction | null = project
      ? {
          completionPercent: project.completionPercent ?? null,
          handoverDate: project.handoverDate?.toISOString() ?? null,
          constructionStatus: project.constructionStatus ?? null,
          sourceVerifiedAt: project.constructionSourceVerifiedAt?.toISOString() ?? null,
        }
      : null;

    totals.valueMinor += BigInt(valuation.minor);
    totals.acquisitionCostMinor += h.purchasePriceMinor;
    if (equityMajor !== null) totals.equityMinor += minorBigInt(equityMajor);
    if (h.rentAnnualMinor) totals.annualRentMinor += h.rentAnnualMinor;
    totals.netIncomeMinor += minorBigInt(cashflow.net);

    out.push({
      id: h.id,
      label: h.label,
      propertyId: h.propertyId,
      propertySlug: h.property?.slug ?? null,
      projectId: h.projectId ?? h.property?.projectId ?? null,
      projectSlug: project?.slug ?? null,
      href: h.property?.slug ? `/properties/${h.property.slug}` : project ? `/projects/${project.slug}` : null,
      community: h.property?.community
        ? { name: h.property.community.name, slug: h.property.community.slug }
        : project?.community
          ? { name: project.community.name, slug: project.community.slug }
          : null,
      lat: h.property?.community.lat ?? project?.lat ?? null,
      lng: h.property?.community.lng ?? project?.lng ?? null,
      purchasePriceMinor: String(h.purchasePriceMinor),
      purchaseDate: h.purchaseDate?.toISOString() ?? null,
      rentAnnualMinor: h.rentAnnualMinor ? String(h.rentAnnualMinor) : null,
      sizeSqft: h.sizeSqft,
      serviceChargePerSqft: h.serviceChargePerSqft,
      mortgage,
      notes: h.notes,
      valuation,
      equityMinor: equityMajor !== null ? minor(equityMajor) : null,
      yield: yieldInfo,
      cashflow,
      paymentSchedule,
      construction,
      updatedAt: h.updatedAt.toISOString(),
    });
  }

  const totalCostMajor = major(totals.acquisitionCostMinor);
  const totalRentMajor = out.reduce((s, h) => s + (h.rentAnnualMinor ? Number(h.rentAnnualMinor) / 100 : 0), 0);
  const totalNoi = out.reduce((s, h) => s + (h.yield?.noi ?? 0), 0);
  const anyMortgage = holdings.some((h) => parseMortgage(h.mortgageJson));

  return {
    engineVersion: SCENARIO_ENGINE_VERSION,
    assumptions: {
      vacancyAllowancePct: PORTFOLIO_ASSUMPTIONS.vacancyAllowancePct,
      maintenance: `max(AED ${PORTFOLIO_ASSUMPTIONS.maintenanceAnnualMin.toLocaleString("en-US")}, ${PORTFOLIO_ASSUMPTIONS.maintenanceAnnualPctOfPrice}% of purchase price) per year`,
      managementPct: PORTFOLIO_ASSUMPTIONS.managementPct,
      note:
        "Cash-flow lines use documented default assumptions (same as the scenario studio) so portfolio figures reconcile with scenario figures. Valuations are modeled — not certified. The AI never makes autonomous investment decisions.",
    },
    holdings: out,
    totals: {
      holdingsCount: totals.holdingsCount,
      valueMinor: String(totals.valueMinor),
      acquisitionCostMinor: String(totals.acquisitionCostMinor),
      equityMinor: anyMortgage ? String(totals.equityMinor) : null,
      annualRentMinor: totalRentMajor > 0 ? String(totals.annualRentMinor) : null,
      netIncomeMinor: String(totals.netIncomeMinor),
      grossYieldPct: totalCostMajor > 0 && totalRentMajor > 0 ? Math.round((totalRentMajor / totalCostMajor) * 10000) / 100 : null,
      netYieldPct: totalCostMajor > 0 && totalNoi !== 0 ? Math.round((totalNoi / totalCostMajor) * 10000) / 100 : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Input schema (AED major units in → minor units stored)              */
/* ------------------------------------------------------------------ */

import { z } from "zod";

export const mortgageInputSchema = z.object({
  balance: z.number().min(1).max(500_000_000),
  monthlyPayment: z.number().min(0).max(5_000_000).optional(),
  ratePct: z.number().min(0).max(30).optional(),
  termYears: z.number().int().min(1).max(35).optional(),
});

export const holdingInputSchema = z.object({
  label: z.string().min(2).max(160),
  /** Platform property reference — slug preferred (client cards carry listing ids); id accepted too. */
  propertySlug: z.string().max(200).optional().nullable(),
  propertyId: z.string().max(64).optional().nullable(),
  projectId: z.string().max(64).optional().nullable(),
  purchasePrice: z.number().min(1).max(500_000_000),
  purchaseDate: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), { message: "Invalid purchase date" }),
  rentAnnual: z.number().min(0).max(50_000_000).optional().nullable(),
  sizeSqft: z.number().min(0).max(100_000).optional().nullable(),
  serviceChargePerSqft: z.number().min(0).max(500).optional().nullable(),
  mortgage: mortgageInputSchema.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export type HoldingInput = z.infer<typeof holdingInputSchema>;

export function holdingInputToData(input: HoldingInput) {
  return {
    label: input.label.trim(),
    propertyId: input.propertyId ?? null,
    projectId: input.projectId ?? null,
    purchasePriceMinor: BigInt(Math.round(input.purchasePrice * 100)),
    purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
    rentAnnualMinor: input.rentAnnual ? BigInt(Math.round(input.rentAnnual * 100)) : null,
    sizeSqft: input.sizeSqft ?? null,
    serviceChargePerSqft: input.serviceChargePerSqft ?? null,
    mortgageJson: input.mortgage
      ? JSON.stringify({
          balanceMinor: String(Math.round(input.mortgage.balance * 100)),
          monthlyPaymentMinor: input.mortgage.monthlyPayment ? String(Math.round(input.mortgage.monthlyPayment * 100)) : "0",
          ratePct: input.mortgage.ratePct ?? null,
          termYears: input.mortgage.termYears ?? null,
        })
      : null,
    notes: input.notes?.trim() || null,
  };
}

/** Verify the referenced property/project exists and is public. The slug path
 *  is primary because client-side cards carry LISTING ids (search DTO), not
 *  property ids — resolving by slug is unambiguous. */
export async function resolveEntityRefs(input: HoldingInput): Promise<{ propertyId: string | null; projectId: string | null }> {
  let propertyId: string | null = null;
  let projectId: string | null = null;
  if (input.propertySlug || input.propertyId) {
    const prop = await db.property.findFirst({
      where: {
        ...PUBLIC_PROPERTY_WHERE,
        ...(input.propertySlug ? { slug: input.propertySlug } : { id: input.propertyId as string }),
      },
      select: { id: true, projectId: true },
    });
    if (prop) {
      propertyId = prop.id;
      projectId = prop.projectId ?? input.projectId ?? null;
    }
  }
  if (!propertyId && input.projectId) {
    const proj = await db.project.findFirst({
      where: { id: input.projectId, ...PUBLIC_PROJECT_WHERE },
      select: { id: true },
    });
    if (proj) projectId = proj.id;
  }
  return { propertyId, projectId };
}
