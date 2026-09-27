/**
 * Deterministic investor calculators (Q19) — V2 compatibility facade.
 *
 * Since U11 (Shared Financial Scenario Engine, V2 §21) all math lives in
 * src/lib/scenario-engine.ts; this module preserves the V1 export surface
 * (same names, same signatures, same numbers — calculator-view, the
 * affordability widget, AI tools and the selftest harness keep working) and
 * additionally re-exports the V2 engine capabilities:
 *
 *   buildScenarios · yieldBreakdown · mortgageProfile · paymentPlanTimeline ·
 *   SCENARIO_ENGINE_VERSION
 *
 * Integer/minor-unit arithmetic where practical; NO AI arithmetic. Every result
 * separates facts (inputs), assumptions, and illustrative projections — never
 * presented as guaranteed outcomes.
 */

import {
  SCENARIO_ENGINE_VERSION,
  computeRoi,
  buildScenarios as engineBuildScenarios,
  yieldBreakdown as engineYieldBreakdown,
  mortgageProfile as engineMortgageProfile,
  normalizePaymentPlan,
  type RoiInput as RoiInputV2,
  type RoiResult as RoiResultV2,
  type RoiScenarioSet,
  type YieldInput,
  type YieldBreakdownResult,
  type MortgageProfileInput,
  type MortgageProfileResult,
  type PaymentPlanStageInput,
  type PaymentPlanResult,
  type PaymentPlanTimelineEntry,
  type BorrowerCategory,
  type PropertyStatusKind,
  type MortgagePurpose,
  annuityMonthlyPayment,
  defaultDownPaymentPct,
  regulatoryMaxLtv,
  importFromProject,
  cashflowCsv,
} from "@/lib/scenario-engine";

export { SCENARIO_ENGINE_VERSION };
export type {
  RoiInputV2,
  RoiResultV2,
  RoiScenarioSet,
  YieldInput,
  YieldBreakdownResult,
  MortgageProfileInput,
  MortgageProfileResult,
  PaymentPlanStageInput,
  PaymentPlanResult,
  PaymentPlanTimelineEntry,
  BorrowerCategory,
  PropertyStatusKind,
  MortgagePurpose,
};

/* ------------------------------ V1 ROI (compat) ------------------------------ */

export interface RoiInput {
  purchasePrice: number; // AED
  annualRent: number; // AED
  annualCosts: number; // service charge, maintenance etc
  appreciationPctPerYear?: number; // ASSUMPTION
  years?: number;
}

export interface RoiResult {
  grossYieldPct: number;
  netYieldPct: number;
  annualNetIncome: number;
  totalNetIncome: number;
  capitalAppreciation: number;
  projectedValue: number;
  totalReturn: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  assumptions: { appreciationPctPerYear: number; years: number };
}

/** Legacy ROI scenario — delegates to the V2 engine with flat-rent/no-vacancy/no-cost
 *  semantics, then maps back to the V1 result shape (numbers are unchanged). */
export function roiScenario(input: RoiInput): RoiResult {
  const years = Math.max(1, Math.min(30, Math.round(input.years ?? 5)));
  const appreciation = input.appreciationPctPerYear ?? 0;
  const r = computeRoi({
    purchasePrice: input.purchasePrice,
    annualRent: input.annualRent,
    rentGrowthPct: 0,
    vacancyPct: 0,
    serviceChargePerSqft: 0,
    sizeSqft: 0,
    maintenanceAnnual: input.annualCosts,
    managementPct: 0,
    appreciationPct: appreciation,
    purchaseCostsPct: 0,
    exitCostsPct: 0,
    horizonYears: years,
  });
  const totalNetIncome = Math.round(r.cashflowSeries[r.cashflowSeries.length - 1]?.cumulative ?? 0);
  return {
    grossYieldPct: r.grossYield,
    netYieldPct: r.netYield,
    annualNetIncome: Math.round(r.netIncomeAnnual),
    totalNetIncome,
    capitalAppreciation: r.capitalAppreciation,
    projectedValue: r.projectedValue,
    totalReturn: r.totalReturn,
    totalReturnPct: r.totalReturnPct,
    annualizedReturnPct: r.annualizedReturn,
    assumptions: { appreciationPctPerYear: appreciation, years },
  };
}

/** V2 ROI three-scenario set (downside / base / upside) — see scenario-engine §21.1. */
export function buildScenarios(input: RoiInputV2): RoiScenarioSet {
  return engineBuildScenarios(input);
}

/* ------------------------------ V1 yield (compat) ---------------------------- */

export interface YieldResult {
  grossYieldPct: number;
  netYieldPct: number;
  annualNetIncome: number;
  monthlyRentAvg: number;
}

/** Legacy rental yield — delegates to the engine's §21.3 breakdown (the input annual
 *  rent is treated as the scheduled amount; costs land in maintenance/other). */
export function rentalYield(input: { purchasePrice: number; annualRent: number; annualCosts?: number }): YieldResult {
  const y = engineYieldBreakdown(
    {
      monthlyScheduledRent: input.annualRent / 12,
      vacancyAllowancePct: 0,
      serviceChargeAnnual: 0,
      maintenanceAnnual: 0,
      managementPct: 0,
      otherAnnual: input.annualCosts ?? 0,
    },
    input.purchasePrice
  );
  return {
    grossYieldPct: y.grossYield,
    netYieldPct: y.netYield,
    annualNetIncome: Math.round(y.noi),
    monthlyRentAvg: Math.round(y.monthlyScheduledRent),
  };
}

/** V2 rental-yield breakdown with scheduled/effective rent separation (§21.3). */
export function yieldBreakdown(input: YieldInput, purchasePrice: number): YieldBreakdownResult {
  return engineYieldBreakdown(input, purchasePrice);
}

/* ---------------------------- V1 mortgage (compat) --------------------------- */

export interface MortgageInput {
  propertyPrice: number;
  downPaymentPct?: number; // default 20
  interestRatePct?: number; // annual, default 4.5
  years?: number; // default 25
}

export interface MortgageResult {
  loanAmount: number;
  downPayment: number;
  monthlyPayment: number;
  totalInterest: number;
  totalPaid: number;
  firstMonthInterest: number;
  schedule: { month: number; interest: number; principal: number; balance: number }[];
  assumptions: { downPaymentPct: number; interestRatePct: number; years: number; rateFixed: true };
}

/** Legacy mortgage schedule — delegates to the engine's annuity math (identical
 *  numbers); the V1 shape (month-keyed first-year schedule) is preserved. */
export function mortgageSchedule(input: MortgageInput): MortgageResult {
  const p = engineMortgageProfile({
    borrowerCategory: "resident-first",
    propertyPrice: input.propertyPrice,
    propertyStatus: "ready",
    downPaymentPct: input.downPaymentPct ?? 20,
    annualRatePct: input.interestRatePct ?? 4.5,
    termYears: input.years ?? 25,
    purpose: "owner",
  });
  return {
    loanAmount: p.loanAmount,
    downPayment: p.downPayment,
    monthlyPayment: p.monthlyPayment,
    totalInterest: p.totalInterest,
    totalPaid: p.totalPaid,
    firstMonthInterest: p.paymentSchedule[0]?.interest ?? 0,
    schedule: p.paymentSchedule.map((row) => ({ month: row.period, interest: row.interest, principal: row.principal, balance: row.balance })),
    assumptions: {
      downPaymentPct: p.assumptions.downPaymentPct,
      interestRatePct: p.assumptions.annualRatePct,
      years: p.assumptions.termYears,
      rateFixed: true,
    },
  };
}

/** V2 mortgage profile — regulatory LTV preset + three-line separation copy (§21.4). */
export function mortgageProfile(input: MortgageProfileInput): MortgageProfileResult {
  return engineMortgageProfile(input);
}

export { defaultDownPaymentPct, regulatoryMaxLtv, annuityMonthlyPayment };

/* -------------------------- V1 payment plan (compat) ------------------------- */

export interface PaymentPlanInput {
  propertyPrice: number;
  installments: { label: string; percent: number }[];
}

export interface PaymentPlanResultV1 {
  installments: { label: string; percent: number; amount: number }[];
  totalPercent: number;
  totalAmount: number;
  balanced: boolean;
}

/** Legacy payment plan — delegates to the engine's normalizePaymentPlan (§21.5). */
export function paymentPlan(input: PaymentPlanInput): PaymentPlanResultV1 {
  const plan = normalizePaymentPlan(
    input.installments.map((i) => ({ name: i.label, percent: i.percent })),
    input.propertyPrice
  );
  return {
    installments: plan.stages.map((s) => ({ label: s.name, percent: s.percent, amount: s.amount })),
    totalPercent: plan.validation.totalPercent,
    totalAmount: plan.totalAmount,
    balanced: plan.validation.valid,
  };
}

/** V2 payment plan: normalized timeline + 100% validation + cumulative cashflow. */
export function paymentPlanTimeline(stages: PaymentPlanStageInput[], purchasePrice: number): PaymentPlanResult {
  return normalizePaymentPlan(stages, purchasePrice);
}

export { importFromProject, cashflowCsv };

/* ------------------------------ shared utilities ----------------------------- */

export function pricePerSqft(price: number, areaSqft: number): number | null {
  if (!areaSqft || areaSqft <= 0) return null;
  return Math.round((price / areaSqft) * 100) / 100;
}

export interface ComparisonRow {
  metric: string;
  values: (string | number | null)[];
  /** which columns are missing data (R04: missing-data indicators) */
}

export function currencyConvert(amountAed: number, rate: number): number {
  return Math.round(amountAed * rate * 100) / 100;
}
