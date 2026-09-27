/** Portfolio API client types (mirror /api/account/portfolio compute.ts — U15 §25). */

export interface PortfolioMortgage {
  balanceMinor: string;
  monthlyPaymentMinor: string;
  ratePct: number | null;
  termYears: number | null;
}

export type ValuationBasis = "ASKING_PRICE" | "COMMUNITY_METRIC" | "PURCHASE_PRICE";

export interface PortfolioValuation {
  minor: string;
  currency: "AED";
  basis: ValuationBasis;
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
  rent: number;
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
  dueDate: string | null;
  dueLabel: string;
}

export interface PortfolioConstruction {
  completionPercent: number | null;
  handoverDate: string | null;
  constructionStatus: string | null;
  sourceVerifiedAt: string | null;
}

export interface PortfolioHolding {
  id: string;
  label: string;
  propertyId: string | null;
  propertySlug: string | null;
  projectId: string | null;
  projectSlug: string | null;
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

export interface PortfolioTotals {
  holdingsCount: number;
  valueMinor: string;
  acquisitionCostMinor: string;
  equityMinor: string | null;
  annualRentMinor: string | null;
  netIncomeMinor: string | null;
  grossYieldPct: number | null;
  netYieldPct: number | null;
}

export interface PortfolioData {
  engineVersion: string;
  assumptions: {
    vacancyAllowancePct: number;
    maintenance: string;
    managementPct: number;
    note: string;
  };
  holdings: PortfolioHolding[];
  totals: PortfolioTotals;
}

export interface PortfolioDocumentRow {
  id: string;
  category: string;
  holdingId: string | null;
  holdingLabel: string | null;
  label: string | null;
  media: { id: string; url: string; mimeType: string; sizeBytes: number; kind: string };
  createdAt: string;
}

/** AED minor units → major number. */
export const minorToAED = (minor: string | null): number | null =>
  minor === null ? null : Number(minor) / 100;

/** Portfolio document categories (§25.6). */
export const DOC_CATEGORIES = ["SPA", "TITLE_DEED", "OQOOD", "RECEIPT", "FLOOR_PLAN", "MORTGAGE", "TENANCY"] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];
