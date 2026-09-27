/**
 * Shared Financial Scenario Engine (V2 §21) — the single deterministic math core
 * shared by property pages, project pages, the four investor calculators, AI tools
 * and the investor dashboard. Version: SCENARIO_ENGINE_VERSION.
 *
 * Contract:
 *  - Pure functions only: no I/O, no Date.now(), no randomness, no globals mutation.
 *  - Same inputs ⇒ byte-identical outputs (selftest: scenario.roi-determinism).
 *  - The engine only does math. Wording/prose is layered by callers; every ROI-family
 *    result carries `disclaimer: "projection"` so no surface can imply guaranteed returns.
 *
 * Versioned formulas and assumptions — see docs/V2_FINANCIAL_ENGINE.md for the full
 * method reference (IRR method, LTV preset provenance, precision rules).
 */

export const SCENARIO_ENGINE_VERSION = "2.0.0";

/** Every projection-family result is stamped with this sentinel; UI copy must keep
 *  the "projection / estimate — not guaranteed" framing. */
export type ScenarioDisclaimer = "projection";

/* ===================================================================================== *
 * 1) ROI (§21.1)
 * ===================================================================================== */

export interface RoiFinancingInput {
  /** Down payment as percent of purchase price, e.g. 20 for 20% */
  downPaymentPct: number;
  /** Annual nominal interest rate, percent (fixed-rate assumption) */
  annualRatePct: number;
  /** Loan term in years */
  termYears: number;
}

export interface RoiInput {
  purchasePrice: number;
  /** Year-1 gross scheduled annual rent (AED) */
  annualRent: number;
  /** Annual rent growth assumption, percent per year */
  rentGrowthPct: number;
  /** Vacancy assumption, percent of scheduled rent (unoccupied allowance) */
  vacancyPct: number;
  /** Service charge rate, AED per sqft per year */
  serviceChargePerSqft: number;
  /** Property size in sqft */
  sizeSqft: number;
  /** Maintenance assumption, AED per year */
  maintenanceAnnual: number;
  /** Property management fee, percent of effective (collected) rent */
  managementPct: number;
  /** Optional mortgage financing (annuity, fixed rate) */
  financing?: RoiFinancingInput;
  /** Capital appreciation assumption, percent per year */
  appreciationPct: number;
  /** Purchase-side costs (transfer fee etc.), percent of purchase price */
  purchaseCostsPct: number;
  /** Exit/sale costs, percent of projected sale value */
  exitCostsPct: number;
  /** Investment horizon in years */
  horizonYears: number;
}

export interface RoiCashflowPoint {
  year: number;
  /** Effective (vacancy-adjusted) rent collected in the year */
  rent: number;
  /** Operating costs (service charge + maintenance + management) in the year */
  costs: number;
  /** Mortgage debt service (12 × annuity payment) in the year; 0 when unlevered/after term */
  debtService: number;
  /** rent − costs − debtService */
  netCash: number;
  /** Cumulative netCash from year 1 through this year */
  cumulative: number;
}

export interface RoiResult {
  /** Gross scheduled yield, percent (year-1 scheduled rent / purchase price) */
  grossYield: number;
  /** Net yield, percent (year-1 NOI / purchase price) */
  netYield: number;
  /** Year-1 net operating income (AED) */
  netIncomeAnnual: number;
  /** Cash-on-cash return, percent (year-1 net cash / initial cash invested) */
  cashOnCash: number;
  /** Total profit over the horizon (AED): cumulative net cash + exit equity − cash invested */
  totalReturn: number;
  /** Total return as percent of initial cash invested */
  totalReturnPct: number;
  /** Annualized (CAGR-style) return, percent */
  annualizedReturn: number;
  /** Internal rate of return on the yearly cashflow series, percent — null when Newton fails */
  irr: number | null;
  /** First year where cumulative net income ≥ initial cash invested — null when never within horizon */
  breakEvenYear: number | null;
  /** Projected sale value at horizon (AED, at the appreciation assumption) */
  projectedValue: number;
  /** Capital appreciation component (projectedValue − purchasePrice) */
  capitalAppreciation: number;
  /** Initial cash invested (down payment + purchase costs, or full price + costs when unlevered) */
  initialCashInvested: number;
  /** Exit equity at horizon: projected value − exit costs − outstanding loan balance */
  exitEquity: number;
  /** Per-year cashflow table, years 1..horizon */
  cashflowSeries: RoiCashflowPoint[];
  disclaimer: ScenarioDisclaimer;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Effective (vacancy-adjusted) rent for year y — deterministic geometric growth. */
function effectiveRentForYear(input: RoiInput, year: number): number {
  const growthFactor = Math.pow(1 + input.rentGrowthPct / 100, year - 1);
  return input.annualRent * growthFactor * (1 - clampPct(input.vacancyPct) / 100);
}

/** Operating costs for year y (service charge + maintenance scale flat; management is
 *  charged on that year's effective rent). */
function operatingCostsForYear(input: RoiInput, year: number): number {
  const rent = effectiveRentForYear(input, year);
  const serviceCharge = input.serviceChargePerSqft * Math.max(0, input.sizeSqft);
  return serviceCharge + Math.max(0, input.maintenanceAnnual) + rent * (clampPct(input.managementPct) / 100);
}

/** Equal-payment (annuity) monthly installment. Hand-rolled — no financial libraries. */
export function annuityMonthlyPayment(loan: number, annualRatePct: number, termYears: number): number {
  const n = Math.max(1, Math.round(termYears * 12));
  const r = annualRatePct / 100 / 12;
  if (loan <= 0) return 0;
  if (r === 0) return loan / n;
  return (loan * r) / (1 - Math.pow(1 + r, -n));
}

/** Outstanding loan balance after `monthsPaid` installments (closed form). */
export function outstandingLoanBalance(loan: number, annualRatePct: number, monthlyPayment: number, monthsPaid: number): number {
  if (loan <= 0 || monthsPaid <= 0) return Math.max(0, loan);
  const r = annualRatePct / 100 / 12;
  if (r === 0) return Math.max(0, loan - monthlyPayment * monthsPaid);
  const k = Math.pow(1 + r, monthsPaid);
  return Math.max(0, loan * k - (monthlyPayment * (k - 1)) / r);
}

/** IRR via Newton–Raphson on the NPV of a period-indexed cashflow series.
 *  Iteration cap 100, tolerance 1e-7. Returns null on divergence — never throws. */
export function irrNewton(cashflows: number[], opts?: { maxIter?: number; tolerance?: number; guess?: number }): number | null {
  const maxIter = opts?.maxIter ?? 100;
  const tol = opts?.tolerance ?? 1e-7;
  let rate = opts?.guess ?? 0.08;
  if (cashflows.length < 2) return null;
  if (!cashflows.every((c) => Number.isFinite(c))) return null;

  const npv = (r: number): number => cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0);
  const dNpv = (r: number): number => cashflows.reduce((s, cf, t) => (t === 0 ? s : s - (t * cf) / Math.pow(1 + r, t + 1)), 0);

  for (let i = 0; i < maxIter; i++) {
    const f = npv(rate);
    const df = dNpv(rate);
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-12) return null;
    const step = f / df;
    const next = rate - step;
    if (!Number.isFinite(next) || next <= -0.9999 || next > 1000) return null;
    if (Math.abs(step) < tol || Math.abs(f) < tol) {
      const final = npv(next);
      return Number.isFinite(final) && Math.abs(final) < 1e-4 * Math.max(1, Math.abs(cashflows[0])) ? next : null;
    }
    rate = next;
  }
  return null;
}

function clampPct(p: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(p) ? p : 0));
}

/** Core ROI computation — deterministic, pure. */
export function computeRoi(input: RoiInput): RoiResult {
  const horizon = Math.max(1, Math.min(50, Math.round(input.horizonYears)));
  const price = Math.max(0, input.purchasePrice);
  const purchaseCosts = price * (clampPct(input.purchaseCostsPct) / 100);
  const financing = input.financing;

  const downPayment = financing ? price * (clampPct(financing.downPaymentPct) / 100) : price;
  const loan = financing ? Math.max(0, price - downPayment) : 0;
  const initialCashInvested = downPayment + purchaseCosts;

  const monthlyPayment = financing && loan > 0 ? annuityMonthlyPayment(loan, financing.annualRatePct, financing.termYears) : 0;
  const termYears = financing ? Math.max(1, Math.min(50, Math.round(financing.termYears))) : 0;

  const cashflowSeries: RoiCashflowPoint[] = [];
  let cumulative = 0;
  for (let y = 1; y <= horizon; y++) {
    const rent = effectiveRentForYear(input, y);
    const costs = operatingCostsForYear(input, y);
    const debtService = financing && loan > 0 && y <= termYears ? monthlyPayment * 12 : 0;
    const netCash = rent - costs - debtService;
    cumulative += netCash;
    cashflowSeries.push({
      year: y,
      rent: round2(rent),
      costs: round2(costs),
      debtService: round2(debtService),
      netCash: round2(netCash),
      cumulative: round2(cumulative),
    });
  }

  // Year-1 headline metrics
  const rent1 = effectiveRentForYear(input, 1);
  const costs1 = operatingCostsForYear(input, 1);
  const noi1 = rent1 - costs1;
  const debtService1 = financing && loan > 0 ? monthlyPayment * 12 : 0;
  const grossYield = price > 0 ? (input.annualRent / price) * 100 : 0;
  const netYield = price > 0 ? (noi1 / price) * 100 : 0;
  const cashOnCash = initialCashInvested > 0 ? ((rent1 - costs1 - debtService1) / initialCashInvested) * 100 : 0;

  // Exit math
  const projectedValue = Math.round(price * Math.pow(1 + input.appreciationPct / 100, horizon));
  const capitalAppreciation = projectedValue - price;
  const exitCosts = projectedValue * (clampPct(input.exitCostsPct) / 100);
  const outstandingAtExit = financing && loan > 0 ? outstandingLoanBalance(loan, financing.annualRatePct, monthlyPayment, horizon * 12) : 0;
  const exitEquity = projectedValue - exitCosts - outstandingAtExit;

  const cumulativeNetCash = cumulative;
  const totalReturn = cumulativeNetCash + exitEquity - initialCashInvested;
  const totalReturnPct = initialCashInvested > 0 ? (totalReturn / initialCashInvested) * 100 : 0;
  let annualizedReturn: number;
  if (initialCashInvested > 0 && 1 + totalReturn / initialCashInvested > 0) {
    const annualized = (Math.pow(1 + totalReturn / initialCashInvested, 1 / horizon) - 1) * 100;
    annualizedReturn = Number.isFinite(annualized) ? annualized : totalReturnPct / horizon;
  } else {
    annualizedReturn = totalReturnPct / horizon;
  }

  // Break-even: first year cumulative net income covers the initial cash invested
  // (pure income payback — exit proceeds deliberately excluded).
  let breakEvenYear: number | null = null;
  for (const p of cashflowSeries) {
    if (p.cumulative >= initialCashInvested) {
      breakEvenYear = p.year;
      break;
    }
  }

  // IRR: t0 = −cash invested; yearly net cash; final year adds exit equity.
  const irrFlows: number[] = [-initialCashInvested];
  for (let y = 1; y <= horizon; y++) {
    irrFlows.push(y === horizon ? cashflowSeries[y - 1].netCash + exitEquity : cashflowSeries[y - 1].netCash);
  }
  const hasSignChange = irrFlows.some((c) => c > 0) && irrFlows.some((c) => c < 0);
  const irrDecimal = hasSignChange ? irrNewton(irrFlows) : null;
  const irr = irrDecimal === null ? null : irrDecimal * 100;

  return {
    grossYield: round2(grossYield),
    netYield: round2(netYield),
    netIncomeAnnual: round2(noi1),
    cashOnCash: round2(cashOnCash),
    totalReturn: Math.round(totalReturn),
    totalReturnPct: round2(totalReturnPct),
    annualizedReturn: round2(annualizedReturn),
    irr: irr === null ? null : round2(irr),
    breakEvenYear,
    projectedValue,
    capitalAppreciation,
    initialCashInvested: Math.round(initialCashInvested),
    exitEquity: round2(exitEquity),
    cashflowSeries,
    disclaimer: "projection",
  };
}

/* ---- Scenario wrapper (§21.1 downside / base / upside) --------------------------------- */

export type RoiScenarioKey = "downside" | "base" | "upside";

export interface RoiScenarioOutcome {
  key: RoiScenarioKey;
  label: string;
  /** Human-readable list of the adjustments applied vs the base input */
  adjustments: string[];
  /** The adjusted engine input (transparent — the UI can show exactly what changed) */
  input: RoiInput;
  result: RoiResult;
}

export interface RoiScenarioSet {
  engineVersion: string;
  disclaimer: ScenarioDisclaimer;
  downside: RoiScenarioOutcome;
  base: RoiScenarioOutcome;
  upside: RoiScenarioOutcome;
}

/** Three-scenario wrap: downside = rent −15% / appreciation halved / vacancy +3pp;
 *  upside = rent +10% / appreciation ×1.5 / vacancy −2pp (clamped at 0).
 *  Pure derivation — the base result equals computeRoi(input). */
export function buildScenarios(input: RoiInput): RoiScenarioSet {
  const baseInput: RoiInput = { ...input };
  const downsideInput: RoiInput = {
    ...input,
    annualRent: input.annualRent * 0.85,
    appreciationPct: input.appreciationPct / 2,
    vacancyPct: clampPct(input.vacancyPct + 3),
  };
  const upsideInput: RoiInput = {
    ...input,
    annualRent: input.annualRent * 1.1,
    appreciationPct: input.appreciationPct * 1.5,
    vacancyPct: clampPct(input.vacancyPct - 2),
  };
  return {
    engineVersion: SCENARIO_ENGINE_VERSION,
    disclaimer: "projection",
    downside: {
      key: "downside",
      label: "Downside",
      adjustments: ["Scheduled rent −15%", "Appreciation halved", "Vacancy +3pp"],
      input: downsideInput,
      result: computeRoi(downsideInput),
    },
    base: {
      key: "base",
      label: "Base",
      adjustments: ["Your inputs as entered"],
      input: baseInput,
      result: computeRoi(baseInput),
    },
    upside: {
      key: "upside",
      label: "Upside",
      adjustments: ["Scheduled rent +10%", "Appreciation ×1.5", "Vacancy −2pp"],
      input: upsideInput,
      result: computeRoi(upsideInput),
    },
  };
}

/* ===================================================================================== *
 * 2) Rental yield (§21.3) — scheduled / effective separation
 * ===================================================================================== */

export interface YieldInput {
  /** Contracted (scheduled) monthly rent BEFORE vacancy adjustment */
  monthlyScheduledRent: number;
  /** Vacancy allowance, percent of scheduled rent */
  vacancyAllowancePct: number;
  /** Annual service charge (AED) */
  serviceChargeAnnual: number;
  /** Annual maintenance (AED) */
  maintenanceAnnual: number;
  /** Management fee, percent of effective (collected) rent */
  managementPct: number;
  /** Other annual operating costs (AED) */
  otherAnnual: number;
}

export interface YieldOperatingCosts {
  serviceCharge: number;
  maintenance: number;
  management: number;
  other: number;
  total: number;
}

export interface YieldBreakdownResult {
  /** Gross SCHEDULED rent per year (never labeled as "average monthly rent") */
  grossScheduledRentAnnual: number;
  /** Scheduled monthly rent (input passthrough, for transparent labeling) */
  monthlyScheduledRent: number;
  /** Vacancy allowance (AED/year) */
  vacancyAllowance: number;
  /** Effective (vacancy-adjusted) rent per year */
  effectiveRentAnnual: number;
  /** Effective monthly rent */
  effectiveMonthlyRent: number;
  operatingCosts: YieldOperatingCosts;
  /** Net operating income = effective rent − operating costs */
  noi: number;
  /** Gross scheduled yield, percent of purchase price (0 when price unknown) */
  grossYield: number;
  /** Net yield on effective rent, percent of purchase price */
  netYield: number;
}

/** Yield decomposition with explicit scheduled → effective rent separation (§21.3). */
export function yieldBreakdown(input: YieldInput, purchasePrice: number): YieldBreakdownResult {
  const monthlyScheduled = Math.max(0, input.monthlyScheduledRent);
  const grossScheduledRentAnnual = monthlyScheduled * 12;
  const vacancyAllowance = grossScheduledRentAnnual * (clampPct(input.vacancyAllowancePct) / 100);
  const effectiveRentAnnual = grossScheduledRentAnnual - vacancyAllowance;
  const management = effectiveRentAnnual * (clampPct(input.managementPct) / 100);
  const operatingCosts: YieldOperatingCosts = {
    serviceCharge: Math.max(0, input.serviceChargeAnnual),
    maintenance: Math.max(0, input.maintenanceAnnual),
    management: round2(management),
    other: Math.max(0, input.otherAnnual),
    total: 0,
  };
  operatingCosts.total = round2(operatingCosts.serviceCharge + operatingCosts.maintenance + operatingCosts.management + operatingCosts.other);
  const noi = effectiveRentAnnual - operatingCosts.total;
  const price = Math.max(0, purchasePrice);
  return {
    grossScheduledRentAnnual: round2(grossScheduledRentAnnual),
    monthlyScheduledRent: round2(monthlyScheduled),
    vacancyAllowance: round2(vacancyAllowance),
    effectiveRentAnnual: round2(effectiveRentAnnual),
    effectiveMonthlyRent: round2(effectiveRentAnnual / 12),
    operatingCosts,
    noi: round2(noi),
    grossYield: price > 0 ? round2((grossScheduledRentAnnual / price) * 100) : 0,
    netYield: price > 0 ? round2((noi / price) * 100) : 0,
  };
}

/* ===================================================================================== *
 * 3) Mortgage (§21.4) — user scenario / regulatory maximum / lender decision separation
 * ===================================================================================== */

export type BorrowerCategory = "resident-first" | "resident-additional" | "nonresident-first" | "nonresident-additional";
export type PropertyStatusKind = "ready" | "offplan";
export type MortgagePurpose = "owner" | "investment";

export interface MortgageProfileInput {
  borrowerCategory: BorrowerCategory;
  propertyPrice: number;
  propertyStatus: PropertyStatusKind;
  downPaymentPct: number;
  annualRatePct: number;
  termYears: number;
  purpose: MortgagePurpose;
}

export interface RegulatoryLtvRule {
  borrowerCategory: BorrowerCategory;
  propertyStatus: PropertyStatusKind;
  /** Regulatory maximum loan-to-value, percent */
  maxLtvPct: number;
  /** Provenance note — the preset table is a SCENARIO INPUT, not legal advice */
  sourceNote: string;
  /** Month this preset snapshot was frozen at (project clock) */
  asOf: string;
}

export const REGULATORY_LTV_SOURCE_NOTE =
  "Simplified UAE regulatory LTV cap preset — must be re-verified by the compliance team before any production use; not presented as currently effective law.";
export const REGULATORY_LTV_AS_OF = "2026-09";

/**
 * Simplified UAE regulatory maximum-LTV preset table (§21.4).
 * NOTE (documented simplification): the <AED 1M first-property +5pp uplift and other
 * edge rules are intentionally NOT modeled — this is a uniform scenario table. All rows
 * carry sourceNote + asOf; compliance must re-verify before production use.
 */
export const REGULATORY_LTV_PRESETS: readonly RegulatoryLtvRule[] = [
  { borrowerCategory: "resident-first", propertyStatus: "ready", maxLtvPct: 80, sourceNote: REGULATORY_LTV_SOURCE_NOTE, asOf: REGULATORY_LTV_AS_OF },
  { borrowerCategory: "resident-first", propertyStatus: "offplan", maxLtvPct: 50, sourceNote: REGULATORY_LTV_SOURCE_NOTE, asOf: REGULATORY_LTV_AS_OF },
  { borrowerCategory: "resident-additional", propertyStatus: "ready", maxLtvPct: 60, sourceNote: REGULATORY_LTV_SOURCE_NOTE, asOf: REGULATORY_LTV_AS_OF },
  { borrowerCategory: "resident-additional", propertyStatus: "offplan", maxLtvPct: 60, sourceNote: REGULATORY_LTV_SOURCE_NOTE, asOf: REGULATORY_LTV_AS_OF },
  { borrowerCategory: "nonresident-first", propertyStatus: "ready", maxLtvPct: 50, sourceNote: REGULATORY_LTV_SOURCE_NOTE, asOf: REGULATORY_LTV_AS_OF },
  { borrowerCategory: "nonresident-first", propertyStatus: "offplan", maxLtvPct: 50, sourceNote: REGULATORY_LTV_SOURCE_NOTE, asOf: REGULATORY_LTV_AS_OF },
  { borrowerCategory: "nonresident-additional", propertyStatus: "ready", maxLtvPct: 40, sourceNote: REGULATORY_LTV_SOURCE_NOTE, asOf: REGULATORY_LTV_AS_OF },
  { borrowerCategory: "nonresident-additional", propertyStatus: "offplan", maxLtvPct: 40, sourceNote: REGULATORY_LTV_SOURCE_NOTE, asOf: REGULATORY_LTV_AS_OF },
];

export const BORROWER_CATEGORY_LABELS: Record<BorrowerCategory, string> = {
  "resident-first": "UAE resident — first property",
  "resident-additional": "UAE resident — additional property",
  "nonresident-first": "Non-resident — first property",
  "nonresident-additional": "Non-resident — additional property",
};

/** Regulatory maximum LTV for a borrower/property combination (throws only on unknown
 *  combination — the preset table is exhaustive, so callers can treat it as total). */
export function regulatoryMaxLtv(borrowerCategory: BorrowerCategory, propertyStatus: PropertyStatusKind): RegulatoryLtvRule {
  const rule = REGULATORY_LTV_PRESETS.find((r) => r.borrowerCategory === borrowerCategory && r.propertyStatus === propertyStatus);
  if (!rule) throw new Error(`No LTV preset for ${borrowerCategory}/${propertyStatus}`);
  return rule;
}

/** Default down-payment strategy (§21.4): borrow at an LTV 5pp BELOW the regulatory
 *  maximum for the borrower category (i.e. down payment = 100 − (maxLtv − 5)) —
 *  replaces the old universal "20%". Still a scenario input, never an eligibility
 *  judgment. */
export function defaultDownPaymentPct(borrowerCategory: BorrowerCategory, propertyStatus: PropertyStatusKind): number {
  return 100 - (regulatoryMaxLtv(borrowerCategory, propertyStatus).maxLtvPct - 5);
}

export interface MortgageScheduleRow {
  period: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface MortgageProfileResult {
  engineVersion: string;
  /** Regulatory preset row actually applied (with sourceNote + asOf) */
  regulatoryMaxLtv: RegulatoryLtvRule;
  /** User's scenario LTV, percent */
  userLtv: number;
  loanAmount: number;
  downPayment: number;
  /** Equal-payment (annuity) monthly installment */
  monthlyPayment: number;
  totalInterest: number;
  totalPaid: number;
  /** First 12 amortization periods (summary — full schedule available on request) */
  paymentSchedule: MortgageScheduleRow[];
  /** Three-line separation copy (§21.4): user scenario vs regulatory maximum vs lender decision */
  disclaimers: {
    userScenario: string;
    regulatoryMaximum: string;
    lenderDecision: string;
  };
  assumptions: { downPaymentPct: number; annualRatePct: number; termYears: number; rateFixed: true; purpose: MortgagePurpose };
}

/** Mortgage scenario profile — math identical to the legacy calculator, wrapped with
 *  the regulatory LTV preset and the three-line separation copy. */
export function mortgageProfile(input: MortgageProfileInput): MortgageProfileResult {
  const price = Math.max(0, input.propertyPrice);
  const downPct = clampPct(input.downPaymentPct);
  const ratePct = Math.max(0, input.annualRatePct);
  const termYears = Math.max(1, Math.min(35, Math.round(input.termYears)));

  const downPayment = Math.round(price * (downPct / 100));
  const loan = Math.max(0, price - downPayment);
  const monthly = annuityMonthlyPayment(loan, ratePct, termYears);
  const n = termYears * 12;
  const r = ratePct / 100 / 12;

  const paymentSchedule: MortgageScheduleRow[] = [];
  let balance = loan;
  for (let m = 1; m <= Math.min(n, 12); m++) {
    const interest = balance * r;
    const principal = monthly - interest;
    balance = Math.max(0, balance - principal);
    paymentSchedule.push({
      period: m,
      interest: round2(interest),
      principal: round2(principal),
      balance: Math.round(balance),
    });
  }
  const totalInterest = round2(monthly * n - loan);

  const rule = regulatoryMaxLtv(input.borrowerCategory, input.propertyStatus);
  const userLtv = price > 0 ? round2(((price - downPayment) / price) * 100) : 0;

  return {
    engineVersion: SCENARIO_ENGINE_VERSION,
    regulatoryMaxLtv: rule,
    userLtv,
    loanAmount: loan,
    downPayment,
    monthlyPayment: round2(monthly),
    totalInterest,
    totalPaid: Math.round(monthly * n),
    paymentSchedule,
    disclaimers: {
      userScenario: "Your scenario — the down payment, rate and term above are inputs you chose. This is a scenario input, not a loan eligibility judgment.",
      regulatoryMaximum: `Regulatory maximum LTV ${rule.maxLtvPct}% for ${BORROWER_CATEGORY_LABELS[input.borrowerCategory].toLowerCase()} on ${input.propertyStatus === "ready" ? "ready" : "off-plan"} property — preset table as of ${rule.asOf}, pending compliance re-verification. Not presented as currently effective law.`,
      lenderDecision: "Lender decision — actual approval, pricing and final LTV are determined solely by lender underwriting. This calculator never implies any lender approval or offer.",
    },
    assumptions: { downPaymentPct: downPct, annualRatePct: ratePct, termYears, rateFixed: true, purpose: input.purpose },
  };
}

/* ===================================================================================== *
 * 4) Payment plan (§21.5)
 * ===================================================================================== */

export type PaymentPlanDue = { milestone: string } | { date: string } | { monthsFromBooking: number };

export interface PaymentPlanStageInput {
  name: string;
  percent: number;
  dueAt?: PaymentPlanDue;
}

export interface PaymentPlanTimelineEntry {
  name: string;
  percent: number;
  amount: number;
  cumulative: number;
  cumulativePercent: number;
  dueLabel: string;
}

export interface PaymentPlanValidation {
  valid: boolean;
  totalPercent: number;
  errors: string[];
}

export interface PaymentPlanResult {
  engineVersion: string;
  /** Normalized (sanitized + deterministically reordered) stages */
  stages: PaymentPlanTimelineEntry[];
  validation: PaymentPlanValidation;
  totalAmount: number;
}

/** Deterministic month label for ISO-ish date strings (no locale dependency). */
function formatPlanDate(date: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function dueLabelFor(dueAt?: PaymentPlanDue): string {
  if (!dueAt) return "On plan order";
  if ("monthsFromBooking" in dueAt) {
    return dueAt.monthsFromBooking === 0 ? "At booking" : `Booking + ${dueAt.monthsFromBooking} mo`;
  }
  if ("date" in dueAt) return `On ${formatPlanDate(dueAt.date)}`;
  return `At ${dueAt.milestone}`;
}

/** Deterministic sort: stages are re-ordered ONLY when every stage carries a temporal
 *  key (months-from-booking or calendar date) — then chronological order wins. When any
 *  stage is milestone-ordered or has no dueAt, the user's declared order is preserved
 *  (stable) so manual add/remove/reorder stays authoritative. */
function orderStages(stages: PaymentPlanStageInput[]): PaymentPlanStageInput[] {
  const temporalKey = (s: PaymentPlanStageInput): number | null => {
    if (s.dueAt && "monthsFromBooking" in s.dueAt) return s.dueAt.monthsFromBooking;
    if (s.dueAt && "date" in s.dueAt) {
      const t = new Date(s.dueAt.date).getTime();
      return Number.isNaN(t) ? null : t / (1000 * 60 * 60 * 24 * 30.4375); // months ≈ days/30.4375, comparable with monthsFromBooking
    }
    return null;
  };
  const keys = stages.map(temporalKey);
  if (keys.some((k) => k === null)) return stages;
  return stages
    .map((s, i) => ({ s, k: keys[i] as number, i }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.s);
}

/** 100% validation (§21.5): total must equal 100 within ±0.01, with error detail. */
export function validate100(stages: PaymentPlanStageInput[]): PaymentPlanValidation {
  const errors: string[] = [];
  if (stages.length === 0) {
    return { valid: false, totalPercent: 0, errors: ["Plan has no stages — add at least one payment stage."] };
  }
  stages.forEach((s, i) => {
    if (!Number.isFinite(s.percent)) errors.push(`Stage ${i + 1} (${s.name || "unnamed"}): percent is not a finite number.`);
    else if (s.percent < 0) errors.push(`Stage ${i + 1} (${s.name || "unnamed"}): negative percent is not allowed.`);
    else if (s.percent > 100) errors.push(`Stage ${i + 1} (${s.name || "unnamed"}): percent ${s.percent}% exceeds 100%.`);
  });
  const totalPercent = round2(stages.reduce((s, x) => s + (Number.isFinite(x.percent) ? x.percent : 0), 0));
  if (Math.abs(totalPercent - 100) > 0.01) {
    errors.push(`Stages total ${totalPercent.toFixed(2)}% — must equal 100% within ±0.01%.`);
  }
  return { valid: errors.length === 0, totalPercent, errors };
}

/** Normalize (sanitize → reorder → amount → cumulative) a payment plan. */
export function normalizePaymentPlan(stageInputs: PaymentPlanStageInput[], purchasePrice: number): PaymentPlanResult {
  const price = Math.max(0, purchasePrice);
  const sanitized = stageInputs.map((s, i) => ({
    name: (s.name ?? "").trim() || `Stage ${i + 1}`,
    percent: Number.isFinite(s.percent) ? s.percent : 0,
    dueAt: s.dueAt,
  }));
  const ordered = orderStages(sanitized);

  const validation = validate100(ordered);
  let cumulativeAmount = 0;
  let cumulativePercent = 0;
  const stages: PaymentPlanTimelineEntry[] = ordered.map((s) => {
    const amount = Math.round(price * (s.percent / 100));
    cumulativeAmount += amount;
    cumulativePercent = round2(cumulativePercent + s.percent);
    return {
      name: s.name,
      percent: s.percent,
      amount,
      cumulative: cumulativeAmount,
      cumulativePercent,
      dueLabel: dueLabelFor(s.dueAt),
    };
  });
  return {
    engineVersion: SCENARIO_ENGINE_VERSION,
    stages,
    validation,
    totalAmount: stages.reduce((sum, s) => sum + s.amount, 0),
  };
}

/** Visualization-friendly timeline: [{name, percent, amount, cumulative, dueLabel}]. */
export function paymentTimeline(stages: PaymentPlanStageInput[], purchasePrice: number): PaymentPlanTimelineEntry[] {
  return normalizePaymentPlan(stages, purchasePrice).stages;
}

/** Cashflow CSV export (deterministic string; \r\n rows). */
export function cashflowCsv(stages: PaymentPlanStageInput[], purchasePrice: number): string {
  const plan = normalizePaymentPlan(stages, purchasePrice);
  const rows = ["stage,percent,amount_aed,cumulative_aed,due"];
  for (const s of plan.stages) {
    rows.push([`"${s.name.replace(/"/g, '""')}"`, s.percent, s.amount, s.cumulative, `"${s.dueLabel}"`].join(","));
  }
  rows.push([`"Total"`, plan.validation.totalPercent, plan.totalAmount, plan.totalAmount, `""`].join(","));
  return rows.join("\r\n") + "\r\n";
}

/** Factory: import a developer project plan (read-model shape) into the engine. */
export function importFromProject(
  projectStages: { label: string; percent: number; dueOffsetMonths: number | null }[],
  purchasePrice: number
): PaymentPlanResult {
  return normalizePaymentPlan(
    projectStages.map((s) => ({
      name: s.label,
      percent: s.percent,
      dueAt: s.dueOffsetMonths !== null && Number.isFinite(s.dueOffsetMonths) ? { monthsFromBooking: s.dueOffsetMonths } : undefined,
    })),
    purchasePrice
  );
}
