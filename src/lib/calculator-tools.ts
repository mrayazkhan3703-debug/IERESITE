import { TrendingUp, Calculator, Landmark, Home, Coins } from "lucide-react";
import type { CalculatorCopyKey } from "./calculator-copy";

/** Calculator tool slugs — single source of truth shared by the SPA router and the calculator view.
 *  Unknown slugs must 404 instead of silently rendering a different tool (SEO/UX contract). */
export const CALCULATOR_TOOL_KEYS = ["roi", "yield", "mortgage", "payment-plan", "currency"] as const;

export type CalculatorToolKey = (typeof CALCULATOR_TOOL_KEYS)[number];

export function isCalculatorToolKey(slug: string): slug is CalculatorToolKey {
  return (CALCULATOR_TOOL_KEYS as readonly string[]).includes(slug);
}

/** Shared tool metadata for the calculator hub and the tab bar. */
export interface CalculatorToolDef {
  key: CalculatorToolKey;
  label: CalculatorCopyKey;
  icon: typeof TrendingUp;
  title: CalculatorCopyKey;
  blurb: CalculatorCopyKey;
  outputs: CalculatorCopyKey[];
}

export const CALCULATOR_TOOLS: CalculatorToolDef[] = [
  {
    key: "roi",
    label: "ROI Scenario",
    icon: TrendingUp,
    title: "ROI Scenario Calculator",
    blurb: "Model total return over a horizon: rental income, financing and an appreciation assumption you control — with downside / base / upside scenarios.",
    outputs: ["Gross & net yield", "IRR & break-even year", "Downside / base / upside comparison"],
  },
  {
    key: "yield",
    label: "Rental Yield",
    icon: Calculator,
    title: "Rental Yield Calculator",
    blurb: "Gross and net yield with scheduled rent, vacancy allowance and operating costs separated line by line.",
    outputs: ["Gross vs effective rent", "Operating cost breakdown", "Net operating income & yields"],
  },
  {
    key: "mortgage",
    label: "Mortgage",
    icon: Landmark,
    title: "Mortgage Calculator",
    blurb: "Monthly payment and interest totals by borrower category, with your LTV vs the regulatory maximum clearly separated.",
    outputs: ["Monthly payment (precise)", "Your LTV vs regulatory maximum", "First-year amortization"],
  },
  {
    key: "payment-plan",
    label: "Payment Plan",
    icon: Home,
    title: "Payment Plan Calculator",
    blurb: "Turn an off-plan plan into a validated cash-flow timeline with amounts, cumulative totals and CSV export.",
    outputs: ["Timeline with due labels", "100% total validation", "Cashflow CSV export"],
  },
  {
    key: "currency",
    label: "Currency",
    icon: Coins,
    title: "Currency Converter",
    blurb: "Convert AED amounts with clearly-labeled indicative rates.",
    outputs: ["Converted amount", "Indicative rate shown", "No live-FX claim"],
  },
];
