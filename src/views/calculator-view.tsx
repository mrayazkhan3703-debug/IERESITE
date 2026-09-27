"use client";

import * as React from "react";
import { Link, useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, ProvenanceBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { events } from "@/lib/analytics-tracker";
import * as calc from "@/lib/calculators";
import { intlLocale, localeOf } from "@/lib/i18n";
import { calculatorCopy, paymentDueCopy, type CalculatorCopyKey } from "@/lib/calculator-copy";
import { formatMoney, formatNumber, formatPercent, INDICATIVE_FX } from "@/lib/money";
import { formatAEDPrecise, formatAEDPreciseMonthly, formatPctPrecise, fullValueTooltip, fullValueTooltipMonthly } from "@/lib/format-precise";
import { RoiProjectionChart, RoiProjectionPoint } from "@/components/charts/roi-projection-chart";
import { YieldDonut } from "@/components/charts/yield-donut";
import { CALCULATOR_TOOLS as TOOLS } from "@/lib/calculator-tools";
import { cn } from "@/lib/utils";
import { AlertTriangle, Download, TrendingDown, TrendingUp } from "lucide-react";

export default function CalculatorView({ tool }: { tool: string }) {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const c = React.useMemo(() => calculatorCopy(locale), [locale]);
  const active = TOOLS.find((t) => t.key === tool) ?? TOOLS[0];
  const presetPrice = Number(loc.query.price ?? 0) || undefined;
  /* U14 (§24): ?preset={id} loads a saved scenario from the account list
   * (localStorage ie_saved_scenarios_v2 — deterministic client-side engine store). */
  const presetId = loc.query.preset;

  usePageMeta({
    title: `${c(active.title)} — Dubai Property Tools`,
    description: `${c(active.blurb)} Deterministic calculations with explicit assumptions — results are projections and estimates (non-guaranteed).`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: c(active.title),
      applicationCategory: "FinanceApplication",
    },
  });

  React.useEffect(() => {
    events.calculatorUse(tool);
  }, [tool]);

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: c("Home"), to: "/" }, { label: c("Investor Tools"), to: "/calculators" }, { label: c(active.label) }]} />

      {/* Tool tabs — V3-F §11: snap-scroll strip on phones (full-bleed, 44px
          targets), wrap ≥sm (scroll-snap is inert on non-scroll containers). */}
      <nav aria-label={c("Calculator tools")} className="mt-4 -mx-4 flex snap-x gap-2 overflow-x-safe px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {TOOLS.map((t) => (
          <Link
            key={t.key}
            to={`/calculators/${t.key}`}
            aria-current={t.key === active.key ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2.5 text-sm font-medium transition-ui sm:min-h-0 sm:py-2",
              t.key === active.key ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" aria-hidden />
            {c(t.label)}
          </Link>
        ))}
      </nav>

      <div className="mt-8 grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{c(active.title)}</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">{c(active.blurb)}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {c("Scenario engine")} <span dir="ltr" className="data-value font-semibold text-foreground">{calc.SCENARIO_ENGINE_VERSION}</span> — {c("versioned formulas shared across the platform.")}
          </p>

          <div className="mt-8">
            {active.key === "roi" && <RoiCalc presetPrice={presetPrice} presetId={presetId} />}
            {active.key === "yield" && <YieldCalc presetPrice={presetPrice} />}
            {active.key === "mortgage" && <MortgageCalc presetPrice={presetPrice} />}
            {active.key === "payment-plan" && <PaymentPlanCalc />}
            {active.key === "currency" && <CurrencyCalc />}
          </div>
        </div>

        {/* Assumptions sidebar */}
        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label={c("Methodology and assumptions")}>
          <div className="rounded-xl border border-info/30 bg-info/5 p-5">
            <p className="kicker mb-2">{c("How to read these results")}</p>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><strong className="text-foreground">{c("Facts")}</strong> — {c("your inputs and any listing data.")}</li>
              <li><strong className="text-foreground">{c("Assumptions")}</strong> — {c("sliders and fields you control (appreciation, vacancy, rate).")}</li>
              <li><strong className="text-foreground">{c("Projections")}</strong> — {c("computed scenarios.")} <em>{c("Estimates and projections only — never guaranteed outcomes.")}</em></li>
            </ul>
            <p className="mt-4 border-t border-info/20 pt-3 text-xs leading-relaxed text-muted-foreground">
              {c("Calculations are deterministic and run entirely in your browser. Rents, prices and yields are scenario inputs — verify against current market data before transacting. Nothing here is investment, legal or tax advice.")}
            </p>
          </div>
          <div className="mt-4 rounded-xl border border-border/70 bg-card p-5">
            <p className="kicker mb-2">{c("Next step")}</p>
            <p className="text-sm text-muted-foreground">{c("Turn a scenario into a shortlist with an advisor.")}</p>
            <Button asChild className="mt-3 w-full" size="sm">
              <Link to="/consultation">{c("Book a consultation")}</Link>
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------ shared bits ------------------------------ */

function NumberField({
  id,
  label,
  value,
  onChange,
  suffix,
  step = 1000,
  min = 0,
  hint,
}: {
  id: string;
  label: React.ReactNode;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  step?: number;
  min?: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative" dir="ltr">
        {/* V3-F §11 — 44px touch targets below sm; desktop density restored ≥sm. */}
      <Input id={id} type="number" value={value || ""} min={min} step={step} onChange={(e) => onChange(Number(e.target.value) || 0)} className="num h-11 pr-12 sm:h-9" />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SliderField({
  id,
  label,
  thumbLabel,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  id: string;
  label: React.ReactNode;
  thumbLabel: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
  hint?: string;
}) {
  return (
    <div className="space-y-2.5">
      <Label htmlFor={id}>{label}</Label>
      <Slider dir="ltr" id={id} thumbLabels={[thumbLabel]} value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ------------------------------- ROI V2 --------------------------------- */

type ScenarioKey = "downside" | "base" | "upside";

function RoiCalc({ presetPrice, presetId }: { presetPrice?: number; presetId?: string }) {
  const locale = localeOf(useRoute().locale);
  const c = React.useMemo(() => calculatorCopy(locale), [locale]);
  const [price, setPrice] = React.useState(presetPrice ?? 2_000_000);
  const [rent, setRent] = React.useState(130_000);
  const [rentGrowth, setRentGrowth] = React.useState(3);
  const [vacancy, setVacancy] = React.useState(5);
  const [appreciation, setAppreciation] = React.useState(3);
  const [years, setYears] = React.useState(10);

  const [servicePerSqft, setServicePerSqft] = React.useState(16);
  const [sizeSqft, setSizeSqft] = React.useState(1000);
  const [maintenance, setMaintenance] = React.useState(6000);
  const [managementPct, setManagementPct] = React.useState(5);
  const [purchaseCostsPct, setPurchaseCostsPct] = React.useState(4);
  const [exitCostsPct, setExitCostsPct] = React.useState(2);
  const [financed, setFinanced] = React.useState(true);
  const [downPct, setDownPct] = React.useState(20);
  const [rate, setRate] = React.useState(4.5);
  const [term, setTerm] = React.useState(25);

  const [scenarioKey, setScenarioKey] = React.useState<ScenarioKey>("base");
  const [presetNote, setPresetNote] = React.useState<string | null>(null);

  /* U14 (§24): restore a saved scenario by id (ie_saved_scenarios_v2). One-shot
   * on mount — the user's edits afterwards stay authoritative. */
  React.useEffect(() => {
    if (!presetId) return;
    try {
      const raw = localStorage.getItem("ie_saved_scenarios_v2");
      if (!raw) return;
      const list = JSON.parse(raw) as {
        id: string;
        timestamp: string;
        inputs: {
          purchasePrice: number;
          annualRent: number;
          sizeSqft: number;
          serviceChargePerSqft: number;
          horizonYears: number;
          financing: "cash" | "mortgage";
          downPaymentPct: number;
        };
      }[];
      const found = Array.isArray(list) ? list.find((s) => s.id === presetId) : undefined;
      if (!found) return;
      setPrice(found.inputs.purchasePrice);
      setRent(found.inputs.annualRent);
      setSizeSqft(found.inputs.sizeSqft);
      setServicePerSqft(found.inputs.serviceChargePerSqft);
      setYears(found.inputs.horizonYears);
      setFinanced(found.inputs.financing === "mortgage");
      if (found.inputs.financing === "mortgage") setDownPct(found.inputs.downPaymentPct);
      setPresetNote(found.timestamp);
    } catch {
      /* unreadable store — silently fall back to defaults */
    }
  }, [presetId]);

  const input = React.useMemo<calc.RoiInputV2>(
    () => ({
      purchasePrice: price,
      annualRent: rent,
      rentGrowthPct: rentGrowth,
      vacancyPct: vacancy,
      serviceChargePerSqft: servicePerSqft,
      sizeSqft: sizeSqft,
      maintenanceAnnual: maintenance,
      managementPct: managementPct,
      financing: financed ? { downPaymentPct: downPct, annualRatePct: rate, termYears: term } : undefined,
      appreciationPct: appreciation,
      purchaseCostsPct: purchaseCostsPct,
      exitCostsPct: exitCostsPct,
      horizonYears: years,
    }),
    [price, rent, rentGrowth, vacancy, servicePerSqft, sizeSqft, maintenance, managementPct, purchaseCostsPct, exitCostsPct, financed, downPct, rate, term, appreciation, years]
  );

  const scenarios = React.useMemo(() => calc.buildScenarios(input), [input]);
  const active = scenarios[scenarioKey];

  const projection: RoiProjectionPoint[] = React.useMemo(() => {
    const pts: RoiProjectionPoint[] = [{ year: 0, rentalIncome: 0, appreciation: 0 }];
    for (const p of active.result.cashflowSeries) {
      const projected = Math.round(price * Math.pow(1 + active.input.appreciationPct / 100, p.year));
      pts.push({ year: p.year, rentalIncome: Math.round(p.cumulative), appreciation: projected - price });
    }
    return pts;
  }, [active, price]);

  const scenarioTabs: { key: ScenarioKey; icon?: typeof TrendingUp; label: string; netYield: number }[] = [
    { key: "downside", icon: TrendingDown, label: c("Downside"), netYield: scenarios.downside.result.netYield },
    { key: "base", label: c("Base"), netYield: scenarios.base.result.netYield },
    { key: "upside", icon: TrendingUp, label: c("Upside"), netYield: scenarios.upside.result.netYield },
  ];

  return (
    <div className="space-y-8">
      {presetNote && (
        <p role="status" className="rounded-lg border border-brand/30 bg-brand-soft/60 px-4 py-2.5 text-sm text-brand-strong">
          {c("Loaded saved scenario")} ({new Date(presetNote).toLocaleDateString(intlLocale(locale))}) — {c("engine re-runs it with the current version.")}
        </p>
      )}
      {/* Inputs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NumberField id="roi-price" label={c("Purchase price (AED)")} value={price} onChange={setPrice} suffix="AED" step={25000} />
        <NumberField id="roi-rent" label={c("Annual scheduled rent (AED)")} value={rent} onChange={setRent} suffix="AED" step={1000} />
        <NumberField id="roi-size" label={c("Property size")} value={sizeSqft} onChange={setSizeSqft} suffix={c("sqft")} step={50} hint={c("Drives the service-charge line below.")} />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <SliderField
          id="roi-growth"
          thumbLabel={c("Rent growth per year")}
          label={<>{c("Rent growth:")} <span dir="ltr" className="num font-semibold text-foreground">{rentGrowth}% {c("per year")}</span></>}
          value={rentGrowth} onChange={setRentGrowth} min={0} max={10} step={0.5}
          hint={c("Assumption — applied to scheduled rent each year.")}
        />
        <SliderField
          id="roi-vac"
          thumbLabel={c("Vacancy")}
          label={<>{c("Vacancy:")} <span dir="ltr" className="num font-semibold text-foreground">{vacancy}%</span></>}
          value={vacancy} onChange={setVacancy} min={0} max={20} step={1}
          hint={c("Assumption — share of the year unoccupied.")}
        />
        <SliderField
          id="roi-app"
          thumbLabel={c("Capital appreciation per year")}
          label={<>{c("Capital appreciation:")} <span dir="ltr" className="num font-semibold text-foreground">{appreciation}% {c("per year")}</span></>}
          value={appreciation} onChange={setAppreciation} min={-5} max={12} step={0.5}
          hint={c("Assumption — historical appreciation is not a forecast.")}
        />
        <SliderField
          id="roi-years"
          thumbLabel={c("Investment horizon in years")}
          label={<>{c("Horizon:")} <span dir="ltr" className="num font-semibold text-foreground">{years} {c("years")}</span></>}
          value={years} onChange={setYears} min={1} max={20} step={1}
        />
      </div>

      {/* Advanced assumptions + financing */}
      <details className="rounded-xl border border-border/70 bg-card">
        <summary className="cursor-pointer select-none p-4 text-sm font-medium text-muted-foreground transition-ui hover:text-foreground">
          {c("Advanced assumptions & financing (service charge, costs, mortgage)")}
        </summary>
        <div className="space-y-6 border-t border-border/60 p-4 pt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField id="roi-service" label={c("Service charge rate")} value={servicePerSqft} onChange={setServicePerSqft} suffix="AED/sqft" step={1} hint={c("Annual, per sqft.")} />
            <NumberField id="roi-maint" label={c("Maintenance (AED/yr)")} value={maintenance} onChange={setMaintenance} suffix="AED" step={500} />
            <NumberField id="roi-mgmt" label={c("Management fee")} value={managementPct} onChange={setManagementPct} suffix="%" step={1} min={0} hint={c("Percent of effective rent.")} />
            <NumberField id="roi-pcosts" label={c("Purchase costs")} value={purchaseCostsPct} onChange={setPurchaseCostsPct} suffix="%" step={0.5} hint={c("Transfer fee etc. — paid upfront.")} />
            <NumberField id="roi-ecosts" label={c("Exit costs")} value={exitCostsPct} onChange={setExitCostsPct} suffix="%" step={0.5} hint={c("Deducted from the projected sale value.")} />
          </div>
          <div className="rounded-lg border border-border/60 bg-sand/30 p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={financed} onChange={(e) => setFinanced(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
              {c("Model mortgage financing (annuity, fixed rate)")}
            </label>
            {financed && (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <SliderField id="roi-down" thumbLabel={c("Down payment percentage")} label={<>{c("Down payment:")} <span dir="ltr" className="num font-semibold text-foreground">{downPct}%</span></>} value={downPct} onChange={setDownPct} min={10} max={90} step={5} />
                <SliderField id="roi-rate" thumbLabel={c("Interest rate")} label={<>{c("Interest rate:")} <span dir="ltr" className="num font-semibold text-foreground">{rate.toFixed(2)}%</span></>} value={rate} onChange={setRate} min={2} max={10} step={0.05} />
                <SliderField id="roi-term" thumbLabel={c("Term in years")} label={<>{c("Term:")} <span dir="ltr" className="num font-semibold text-foreground">{term} {c("years")}</span></>} value={term} onChange={setTerm} min={5} max={30} step={1} />
              </div>
            )}
          </div>
        </div>
      </details>

      {/* Scenario tabs (§21.1 downside / base / upside) */}
      <div>
        <div role="tablist" aria-label={c("Scenario")} className="flex flex-wrap gap-2">
          {scenarioTabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={scenarioKey === t.key}
              onClick={() => setScenarioKey(t.key)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-ui",
                scenarioKey === t.key ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon && <t.icon className="h-4 w-4" aria-hidden />}
              {t.label}
              <span className="num rounded-full bg-background/70 px-2 py-0.5 text-xs text-muted-foreground" title={c("Net yield for this scenario")}>
                {formatPctPrecise(t.netYield)}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {c(scenarioKey === "downside" ? "Downside" : scenarioKey === "upside" ? "Upside" : "Base")}: {(
            scenarioKey === "downside" ? ["Scheduled rent −15%", "Appreciation halved", "Vacancy +3pp"] as const
              : scenarioKey === "upside" ? ["Scheduled rent +10%", "Appreciation ×1.5", "Vacancy −2pp"] as const
                : ["Your inputs as entered"] as const
          ).map(c).join(" · ")} — <em>{c("projection, not a guarantee")}</em>.
        </p>
      </div>

      {/* Result cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: c("Gross yield (yr 1)"), value: formatPctPrecise(active.result.grossYield), tip: c("Scheduled rent ÷ purchase price") },
          { label: c("Net yield (yr 1)"), value: formatPctPrecise(active.result.netYield), tip: c("Net operating income ÷ purchase price") },
          { label: c("Net income (yr 1)"), value: formatAEDPrecise(active.result.netIncomeAnnual), tip: fullValueTooltip(active.result.netIncomeAnnual) },
          { label: c("Cash-on-cash (yr 1)"), value: formatPctPrecise(active.result.cashOnCash), tip: `${c("Year-1 net cash")} ÷ ${formatAEDPrecise(active.result.initialCashInvested)} ${c("cash invested")}` },
          { label: c("IRR"), value: active.result.irr === null ? "—" : formatPctPrecise(active.result.irr), tip: c("Newton-method IRR over the yearly cashflow series (income + exit proceeds)") },
          {
            label: c("Break-even year"),
            value: active.result.breakEvenYear === null ? `${c("Beyond")} ${years} ${c("years")}` : `${c("Year")} ${active.result.breakEvenYear}`,
            tip: c("First year cumulative net income covers the initial cash invested (income payback only)"),
          },
        ].map((r) => (
          <div key={r.label} className="rounded-lg border border-border/70 bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{r.label}</p>
            <p dir="ltr" className="data-value mt-1.5 font-display text-2xl font-semibold" title={r.tip}>{r.value}</p>
            {r.label === c("IRR") && active.result.irr === null && (
              <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-warning">{c("not converged")}</p>
            )}
          </div>
        ))}
      </div>

      {/* Total return block */}
      <div className="rounded-lg border border-brand/25 bg-brand-faint/60 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-lg font-semibold">{c("Total return")} — {c(scenarioKey === "downside" ? "Downside" : scenarioKey === "upside" ? "Upside" : "Base")} {c("scenario")}</p>
          <p dir="ltr" className="data-value font-display text-2xl font-semibold text-brand-strong" title={fullValueTooltip(active.result.totalReturn)}>
            {formatAEDPrecise(active.result.totalReturn)}
            <span className="ml-2 text-base text-muted-foreground">
              ({formatPctPrecise(active.result.totalReturnPct)} · {formatPctPrecise(active.result.annualizedReturn)} {c("per year")})
            </span>
          </p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          = {c("net cash income")} {formatAEDPrecise(active.result.cashflowSeries[active.result.cashflowSeries.length - 1]?.cumulative ?? 0)} + {c("exit equity")}{" "}
          {formatAEDPrecise(active.result.exitEquity)} ({c("projected value")} {formatAEDPrecise(active.result.projectedValue)} − {c("exit costs")} − {c("loan balance")}) −{" "}
          {formatAEDPrecise(active.result.initialCashInvested)} {c("cash invested")}.
          <strong> {c("Illustrative projection — an estimate, not a guaranteed outcome.")}</strong>
        </p>
      </div>

      {/* Scenario comparison block (对照块) */}
      <div role="region" aria-label={c("Downside, base and upside scenario comparison")} tabIndex={0} className="overflow-x-safe rounded-lg border border-border/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">{c("Downside, base and upside scenario comparison")}</caption>
          <thead>
            <tr className="border-b border-border/70 bg-sand/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="p-3 font-medium">{c("Metric")}</th>
              <th scope="col" className="p-3 font-medium">{c("Downside")}</th>
              <th scope="col" className="p-3 font-medium">{c("Base")}</th>
              <th scope="col" className="p-3 font-medium">{c("Upside")}</th>
            </tr>
          </thead>
          <tbody>
            {[
              { metric: c("Net yield (yr 1)"), fmt: (r: calc.RoiResultV2) => formatPctPrecise(r.netYield) },
              { metric: c("Total return"), fmt: (r: calc.RoiResultV2) => formatAEDPrecise(r.totalReturn) },
              { metric: c("Annualized return"), fmt: (r: calc.RoiResultV2) => `${formatPctPrecise(r.annualizedReturn)} ${c("per year")}` },
              { metric: c("IRR"), fmt: (r: calc.RoiResultV2) => (r.irr === null ? "—" : formatPctPrecise(r.irr)) },
              { metric: c("Break-even"), fmt: (r: calc.RoiResultV2) => (r.breakEvenYear === null ? `${c("Beyond")} ${years} ${c("years")}` : `${c("Year")} ${r.breakEvenYear}`) },
            ].map((row) => (
              <tr key={row.metric} className="border-b border-border/40 last:border-0">
                <th scope="row" className="p-3 text-start font-medium text-muted-foreground">{row.metric}</th>
                <td dir="ltr" className="data-value p-3">{row.fmt(scenarios.downside.result)}</td>
                <td dir="ltr" className={cn("data-value p-3 font-semibold", scenarioKey === "base" && "text-brand-strong")}>{row.fmt(scenarios.base.result)}</td>
                <td dir="ltr" className="data-value p-3">{row.fmt(scenarios.upside.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border/50 bg-sand/20 p-3 text-xs text-muted-foreground">
          {c("Scenario derivation is deterministic: downside = rent −15%, appreciation halved, vacancy +3pp; upside = rent +10%, appreciation ×1.5, vacancy −2pp. All three are projections (non-guaranteed).")}
        </p>
      </div>

      <RoiProjectionChart points={projection} purchasePrice={price} />
    </div>
  );
}

/* ------------------------------ Yield V2 -------------------------------- */

function YieldCalc({ presetPrice }: { presetPrice?: number }) {
  const locale = localeOf(useRoute().locale);
  const c = React.useMemo(() => calculatorCopy(locale), [locale]);
  const [price, setPrice] = React.useState(presetPrice ?? 1_500_000);
  const [monthlyRent, setMonthlyRent] = React.useState(8750);
  const [vacancy, setVacancy] = React.useState(5);
  const [serviceCharge, setServiceCharge] = React.useState(16000);
  const [maintenance, setMaintenance] = React.useState(6000);
  const [managementPct, setManagementPct] = React.useState(5);
  const [other, setOther] = React.useState(1200);

  const result = React.useMemo(
    () =>
      calc.yieldBreakdown(
        {
          monthlyScheduledRent: monthlyRent,
          vacancyAllowancePct: vacancy,
          serviceChargeAnnual: serviceCharge,
          maintenanceAnnual: maintenance,
          managementPct: managementPct,
          otherAnnual: other,
        },
        price
      ),
    [price, monthlyRent, vacancy, serviceCharge, maintenance, managementPct, other]
  );

  const costRows = [
    { label: c("Service charge"), value: result.operatingCosts.serviceCharge },
    { label: c("Maintenance"), value: result.operatingCosts.maintenance },
    { label: `${c("Management")} (${formatPctPrecise(managementPct, 1)} ${c("of effective rent")})`, value: result.operatingCosts.management },
    { label: c("Other"), value: result.operatingCosts.other },
  ];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField id="y-price" label={c("Purchase price (AED)")} value={price} onChange={setPrice} suffix="AED" step={50000} />
        <NumberField id="y-rent" label={c("Scheduled monthly rent")} value={monthlyRent} onChange={setMonthlyRent} suffix="AED" step={250} hint={c("Contracted rent before vacancy.")} />
        <NumberField id="y-service" label={c("Service charge (AED/yr)")} value={serviceCharge} onChange={setServiceCharge} suffix="AED" step={500} />
        <NumberField id="y-maint" label={c("Maintenance (AED/yr)")} value={maintenance} onChange={setMaintenance} suffix="AED" step={500} />
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        <SliderField
          id="y-vac"
          thumbLabel={c("Vacancy allowance")}
          label={<>{c("Vacancy allowance:")} <span dir="ltr" className="num font-semibold text-foreground">{vacancy}%</span></>}
          value={vacancy} onChange={setVacancy} min={0} max={20} step={1}
          hint={c("Assumption — unoccupied periods reduce effective rent.")}
        />
        <SliderField
          id="y-mgmt"
          thumbLabel={c("Management fee")}
          label={<>{c("Management fee:")} <span dir="ltr" className="num font-semibold text-foreground">{managementPct}%</span></>}
          value={managementPct} onChange={setManagementPct} min={0} max={15} step={0.5}
          hint={c("Charged on effective (collected) rent.")}
        />
        <NumberField id="y-other" label={c("Other costs (AED/yr)")} value={other} onChange={setOther} suffix="AED" step={250} />
      </div>

      {/* Yield cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: c("Gross scheduled rent (yr)"), value: formatAEDPrecise(result.grossScheduledRentAnnual), tip: fullValueTooltip(result.grossScheduledRentAnnual) },
          { label: c("Effective rent (yr)"), value: formatAEDPrecise(result.effectiveRentAnnual), tip: fullValueTooltip(result.effectiveRentAnnual) },
          { label: c("Gross yield"), value: formatPctPrecise(result.grossYield), tip: c("Gross SCHEDULED rent ÷ purchase price") },
          { label: c("Net yield"), value: formatPctPrecise(result.netYield), tip: c("Net operating income ÷ purchase price") },
        ].map((r) => (
          <div key={r.label} className="rounded-lg border border-border/70 bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{r.label}</p>
            <p dir="ltr" className="data-value mt-1.5 font-display text-2xl font-semibold" title={r.tip}>{r.value}</p>
          </div>
        ))}
      </div>

      {/* Rent decomposition: scheduled → vacancy → effective → costs → NOI */}
      <div className="rounded-lg border border-border/70 bg-card p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c("Rent decomposition (annual)")}</p>
          <span dir="ltr" className="data-value text-[11px] text-muted-foreground" title={fullValueTooltip(result.grossScheduledRentAnnual)}>
            {formatAEDPrecise(result.grossScheduledRentAnnual)} {c("scheduled")}
          </span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-border/60 bg-sand/30 p-3">
            <dt className="text-xs text-muted-foreground">{c("Scheduled monthly rent")}</dt>
            <dd dir="ltr" className="data-value mt-1 font-semibold" title={fullValueTooltip(result.monthlyScheduledRent)}>{formatAEDPrecise(result.monthlyScheduledRent)}</dd>
          </div>
          <div className="rounded-md border border-border/60 bg-sand/30 p-3">
            <dt className="text-xs text-muted-foreground">{c("Vacancy allowance (−)")}</dt>
            <dd dir="ltr" className="data-value mt-1 font-semibold" title={fullValueTooltip(result.vacancyAllowance)}>{formatAEDPrecise(result.vacancyAllowance)}</dd>
          </div>
          <div className="rounded-md border border-border/60 bg-sand/30 p-3">
            <dt className="text-xs text-muted-foreground">{c("Effective monthly rent")}</dt>
            <dd dir="ltr" className="data-value mt-1 font-semibold" title={fullValueTooltip(result.effectiveMonthlyRent)}>{formatAEDPrecise(result.effectiveMonthlyRent)}</dd>
          </div>
          <div className="rounded-md border border-success/40 bg-success/10 p-3">
            <dt className="text-xs text-muted-foreground">{c("Net operating income (yr)")}</dt>
            <dd dir="ltr" className="data-value mt-1 font-semibold text-foreground" title={fullValueTooltip(result.noi)}>{formatAEDPrecise(result.noi)}</dd>
          </div>
        </dl>
        <div className="mt-4 border-t border-border/60 pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {c("Operating costs")} — {formatAEDPrecise(result.operatingCosts.total)} {c("per year")}
          </p>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {costRows.map((c) => (
              <li key={c.label} className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1.5">
                <span className="text-muted-foreground">{c.label}</span>
                <span dir="ltr" className="data-value font-medium" title={fullValueTooltip(c.value)}>{formatAEDPrecise(c.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Donut */}
      <div className="rounded-lg border border-border/70 bg-card p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c("Where the scheduled rent goes")}</p>
          <span className="num text-[11px] text-muted-foreground">{formatAEDPrecise(result.grossScheduledRentAnnual)} {c("scheduled")}</span>
        </div>
        <YieldDonut
          grossYieldPct={result.grossYield}
          netYieldPct={result.netYield}
          annualRent={result.grossScheduledRentAnnual}
          annualCosts={result.operatingCosts.total}
          vacancyLoss={result.vacancyAllowance}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Effective rent = scheduled rent minus the {vacancy}% vacancy allowance. Net yield uses NOI (effective rent − operating costs of{" "}
        {formatAEDPrecise(result.operatingCosts.total)}/yr). The vacancy-adjusted rent is never labeled as an average monthly rent.
      </p>
    </div>
  );
}

/* ----------------------------- Mortgage V2 ------------------------------ */

const BORROWER_OPTIONS: { value: calc.BorrowerCategory; label: CalculatorCopyKey }[] = [
  { value: "resident-first", label: "UAE resident — first property" },
  { value: "resident-additional", label: "UAE resident — additional property" },
  { value: "nonresident-first", label: "Non-resident — first property" },
  { value: "nonresident-additional", label: "Non-resident — additional property" },
];

function MortgageCalc({ presetPrice }: { presetPrice?: number }) {
  const locale = localeOf(useRoute().locale);
  const c = React.useMemo(() => calculatorCopy(locale), [locale]);
  const [price, setPrice] = React.useState(presetPrice ?? 2_000_000);
  const [category, setCategory] = React.useState<calc.BorrowerCategory>("resident-first");
  const [status, setStatus] = React.useState<calc.PropertyStatusKind>("ready");
  const [purpose, setPurpose] = React.useState<calc.MortgagePurpose>("owner");
  const [rate, setRate] = React.useState(4.5);
  const [term, setTerm] = React.useState(25);
  // Down payment defaults to the regulatory maximum − 5pp for the borrower category
  // (§21.4 — no more universal "20%"); re-derived whenever the profile changes.
  const [downPct, setDownPct] = React.useState(() => calc.defaultDownPaymentPct("resident-first", "ready"));
  React.useEffect(() => {
    setDownPct(calc.defaultDownPaymentPct(category, status));
  }, [category, status]);

  const profile = React.useMemo(
    () => calc.mortgageProfile({ borrowerCategory: category, propertyPrice: price, propertyStatus: status, downPaymentPct: downPct, annualRatePct: rate, termYears: term, purpose }),
    [category, price, status, downPct, rate, term, purpose]
  );

  const exceedsRegulatory = profile.userLtv > profile.regulatoryMaxLtv.maxLtvPct;
  const minDownPct = 100 - profile.regulatoryMaxLtv.maxLtvPct;

  const selectCls = "h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none transition-ui focus:border-brand/60 sm:h-9 sm:text-sm";

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField id="m-price" label={c("Property price (AED)")} value={price} onChange={setPrice} suffix="AED" step={50000} />
        <div className="space-y-1.5">
          <Label htmlFor="m-category">{c("Borrower category")}</Label>
          <select id="m-category" value={category} onChange={(e) => setCategory(e.target.value as calc.BorrowerCategory)} className={selectCls}>
            {BORROWER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{c(o.label)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-status">{c("Property status")}</Label>
          <select id="m-status" value={status} onChange={(e) => setStatus(e.target.value as calc.PropertyStatusKind)} className={selectCls}>
            <option value="ready">{c("Ready")}</option>
            <option value="offplan">{c("Off-plan")}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-purpose">{c("Purpose")}</Label>
          <select id="m-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as calc.MortgagePurpose)} className={selectCls}>
            <option value="owner">{c("Owner-occupied")}</option>
            <option value="investment">{c("Investment")}</option>
          </select>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <SliderField
          id="m-down"
          thumbLabel={c("Down payment percentage")}
          label={<>{c("Down payment:")} <span dir="ltr" className="num font-semibold text-foreground">{downPct}%</span></>}
          value={downPct} onChange={setDownPct} min={minDownPct} max={100} step={1}
          hint={c("Defaults to an LTV 5pp below the regulatory maximum — a scenario input, not a loan eligibility judgment.")}
        />
        <SliderField
          id="m-rate"
          thumbLabel={c("Interest rate")}
          label={<>{c("Interest rate:")} <span dir="ltr" className="num font-semibold text-foreground">{rate.toFixed(2)}%</span></>}
          value={rate} onChange={setRate} min={2} max={10} step={0.05}
          hint={c("Assumption — fixed rate, varies by lender.")}
        />
        <SliderField
          id="m-term"
          thumbLabel={c("Loan term in years")}
          label={<>{c("Term:")} <span dir="ltr" className="num font-semibold text-foreground">{term} {c("years")}</span></>}
          value={term} onChange={setTerm} min={5} max={35} step={1}
        />
      </div>

      <div className="rounded-lg border border-brand/25 bg-brand-faint/60 p-6">
        <p className="kicker">{c("Estimated monthly payment")}</p>
        <p dir="ltr" className="data-value mt-1 font-display text-4xl font-semibold text-brand-strong" title={locale === "ar" ? `${fullValueTooltip(profile.monthlyPayment)}/شهر` : fullValueTooltipMonthly(profile.monthlyPayment)}>
          {locale === "ar" ? `${formatAEDPrecise(profile.monthlyPayment)}/شهر` : formatAEDPreciseMonthly(profile.monthlyPayment)}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: c("Loan amount"), value: profile.loanAmount },
            { label: c("Down payment"), value: profile.downPayment },
            { label: `${c("Total interest")} (${term} ${c("years")})`, value: profile.totalInterest },
          ].map((x) => (
            <div key={x.label}>
              <p className="text-xs text-muted-foreground">{x.label}</p>
              <p dir="ltr" className="data-value font-semibold" title={fullValueTooltip(x.value)}>{formatAEDPrecise(x.value)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* LTV separation: user scenario vs regulatory maximum vs lender decision (§21.4) */}
      <div className={cn("rounded-lg border p-5", exceedsRegulatory ? "border-warning/50 bg-warning/10" : "border-border/70 bg-card")}>
        <p className="kicker mb-3">{c("LTV — three separate lines")}</p>
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 pb-3">
            <div>
              <p className="text-sm font-semibold">{c("Your scenario LTV")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c("Your scenario — the down payment, rate and term above are inputs you chose. This is a scenario input, not a loan eligibility judgment.")}</p>
            </div>
            <p dir="ltr" className="data-value font-display text-2xl font-semibold">{formatPctPrecise(profile.userLtv)}</p>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 pb-3">
            <div>
              <p className="text-sm font-semibold">
                {c("Regulatory maximum LTV")}
                <span className="ml-2 rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {c("preset · as of")} {profile.regulatoryMaxLtv.asOf}
                </span>
              </p>
              <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{locale === "en" ? profile.disclaimers.regulatoryMaximum : <>{c("Preset regulatory table, pending compliance re-verification; not currently effective law.")} {c("Regulatory maximum LTV")}: <bdi dir="ltr">{profile.regulatoryMaxLtv.maxLtvPct}%</bdi> · {c(BORROWER_OPTIONS.find((o) => o.value === category)!.label)} · {c(status === "ready" ? "Ready" : "Off-plan")}</>}</p>
            </div>
            <p dir="ltr" className="data-value font-display text-2xl font-semibold text-muted-foreground">{formatPctPrecise(profile.regulatoryMaxLtv.maxLtvPct, 0)}</p>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <p className="text-xs leading-relaxed text-muted-foreground">{c("Lender decision — actual approval, pricing and final LTV are determined solely by lender underwriting. This calculator never implies any lender approval or offer.")}</p>
          </div>
        </div>
        {exceedsRegulatory && (
          <p role="alert" className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            {c("Your scenario exceeds the preset regulatory maximum; treat these numbers as hypothetical.")} <bdi dir="ltr">{formatPctPrecise(profile.userLtv, 0)} / {profile.regulatoryMaxLtv.maxLtvPct}%</bdi>
          </p>
        )}
      </div>

      {/* First-year schedule */}
      <div role="region" aria-label={c("First-year amortization schedule")} tabIndex={0} className="overflow-x-safe rounded-lg border border-border/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
        <table className="w-full min-w-[480px] text-sm">
          <caption className="sr-only">{c("First-year amortization schedule")}</caption>
          <thead>
            <tr className="border-b border-border/70 bg-sand/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="p-3 font-medium">{c("Month")}</th>
              <th scope="col" className="p-3 font-medium">{c("Interest")}</th>
              <th scope="col" className="p-3 font-medium">{c("Principal")}</th>
              <th scope="col" className="p-3 font-medium">{c("Balance")}</th>
            </tr>
          </thead>
          <tbody>
            {profile.paymentSchedule.map((row) => (
              <tr key={row.period} className="border-b border-border/40 last:border-0">
                <td className="num p-3 text-muted-foreground">{row.period}</td>
                <td dir="ltr" className="data-value p-3" title={fullValueTooltip(row.interest)}>{formatAEDPrecise(row.interest)}</td>
                <td dir="ltr" className="data-value p-3" title={fullValueTooltip(row.principal)}>{formatAEDPrecise(row.principal)}</td>
                <td dir="ltr" className="data-value p-3 font-medium" title={fullValueTooltip(row.balance)}>{formatAEDPrecise(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {c("Assumes a fixed rate, the selected term and no fees. Preset regulatory table is pending compliance re-verification; lender underwriting alone determines actual approval.")} <bdi dir="ltr">{rate.toFixed(2)}% · {term}</bdi> {c("years")} · <bdi dir="ltr">{profile.regulatoryMaxLtv.asOf}</bdi>
      </p>
    </div>
  );
}

/* --------------------------- Payment plan V2 ---------------------------- */

interface PlanStageState {
  name: string;
  percent: number;
  dueMonths: number | null;
}

const DEFAULT_PLAN_STAGES: (Omit<PlanStageState, "name"> & { name: CalculatorCopyKey })[] = [
  { name: "Booking", percent: 10, dueMonths: 0 },
  { name: "During construction", percent: 50, dueMonths: 18 },
  { name: "On handover", percent: 30, dueMonths: 36 },
  { name: "Post-handover", percent: 10, dueMonths: 60 },
];

const STAGE_BAR_COLORS = ["bg-brand", "bg-success", "bg-warning", "bg-info", "bg-brand-strong", "bg-success/70", "bg-warning/70", "bg-info/70"];

function PaymentPlanCalc() {
  const locale = localeOf(useRoute().locale);
  const c = React.useMemo(() => calculatorCopy(locale), [locale]);
  const [price, setPrice] = React.useState(2_000_000);
  const [stages, setStages] = React.useState<PlanStageState[]>(() => DEFAULT_PLAN_STAGES.map((stage) => ({ ...stage, name: c(stage.name) })));

  const engineStages = React.useMemo<calc.PaymentPlanStageInput[]>(
    () => stages.map((s) => ({ name: s.name, percent: s.percent, dueAt: s.dueMonths === null ? undefined : { monthsFromBooking: s.dueMonths } })),
    [stages]
  );
  const result = React.useMemo(() => calc.paymentPlanTimeline(engineStages, price), [engineStages, price]);

  const move = (i: number, dir: -1 | 1) => {
    setStages((p) => {
      const next = [...p];
      const j = i + dir;
      if (j < 0 || j >= next.length) return p;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const downloadCsv = () => {
    const csv = calc.cashflowCsv(engineStages, price);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payment-plan-cashflow.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="max-w-sm">
        <NumberField id="pp-price" label={c("Property price (AED)")} value={price} onChange={setPrice} suffix="AED" step={50000} />
      </div>

      {/* Stage editor: add / remove / reorder */}
      <div className="space-y-3">
        <p className="kicker">{c("Plan structure (percent per stage)")}</p>
        {stages.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Input
              aria-label={`${c("Stage")} ${i + 1} ${c("label")}`}
              value={row.name}
              onChange={(e) => setStages((p) => p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
              className="min-w-0 h-11 flex-1 sm:h-9"
            />
            <div className="flex items-center gap-2">
              <Input
                aria-label={`${c("Stage")} ${i + 1} ${c("percent")}`}
                type="number"
                min={0}
                max={100}
                value={row.percent}
                onChange={(e) => setStages((p) => p.map((r, j) => (j === i ? { ...r, percent: Number(e.target.value) || 0 } : r)))}
                dir="ltr" className="num h-11 w-24 sm:h-9"
              />
              <span className="text-sm text-muted-foreground" aria-hidden>%</span>
            </div>
            <Input
              aria-label={`${c("Stage")} ${i + 1} ${c("due months from booking (optional)")}`}
              type="number"
              min={0}
              max={600}
              value={row.dueMonths ?? ""}
              placeholder={c("mo")}
              onChange={(e) => setStages((p) => p.map((r, j) => (j === i ? { ...r, dueMonths: e.target.value === "" ? null : Number(e.target.value) || 0 } : r)))}
              dir="ltr" className="num h-11 w-20 sm:h-9"
              title={c("Months from booking — leave empty for milestone/unordered stages")}
            />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-11 w-11 p-0 sm:h-8 sm:w-8" aria-label={`${c("Move stage")} ${i + 1} ${c("up")}`} onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
              <Button variant="ghost" size="sm" className="h-11 w-11 p-0 sm:h-8 sm:w-8" aria-label={`${c("Move stage")} ${i + 1} ${c("down")}`} onClick={() => move(i, 1)} disabled={i === stages.length - 1}>↓</Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 w-11 p-0 sm:h-8 sm:w-8"
                aria-label={`${c("Remove stage")} ${i + 1}`}
                onClick={() => setStages((p) => p.filter((_, j) => j !== i))}
                disabled={stages.length <= 1}
              >
                ×
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => setStages((p) => [...p, { name: "", percent: 0, dueMonths: null }])}>
          {c("+ Add stage")}
        </Button>
      </div>

      {/* Validation */}
      {!result.validation.valid && (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <p className="font-semibold">{c("Plan does not total 100%")}</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {(locale === "ar" ? [c("Each stage must be between 0% and 100%; the total must equal 100% within ±0.01%.")] : result.validation.errors).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Timeline visualization (§21.5) */}
      <div className="rounded-lg border border-border/70 bg-card p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <p className="kicker">{c("Payment timeline")}</p>
          <div className="flex items-center gap-3">
            <span className={cn("num text-xs font-semibold", result.validation.valid ? "text-success" : "text-warning")}>
              {formatPercent(result.validation.totalPercent, undefined, 2)} {c("of price")}
            </span>
            <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={downloadCsv}>
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {c("Cashflow CSV")}
            </Button>
          </div>
        </div>
        {/* Stacked proportion bar */}
        <div className="flex h-6 w-full overflow-hidden rounded-full border border-border/60 bg-border/30" role="img" aria-label={c("Payment plan stages as proportional segments of the total")}>
          {result.stages.map((s, i) => (
            <div
              key={s.name + i}
              className={cn("h-full transition-ui", STAGE_BAR_COLORS[i % STAGE_BAR_COLORS.length])}
              style={{ width: `${Math.max(0, s.percent)}%` }}
              title={`${s.name}: ${s.percent}% · ${formatAEDPrecise(s.amount)} · ${paymentDueCopy(s.dueLabel, locale)}`}
            />
          ))}
        </div>
        {/* Per-stage rows */}
        <div className="mt-5 space-y-4">
          {result.stages.map((s, i) => (
            <div key={s.name + i}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <span className="font-medium">{s.name || `${c("Stage")} ${i + 1}`}</span>
                <span dir="ltr" className="data-value text-muted-foreground">
                  {formatPctPrecise(s.percent, 1)}
                  <span className="mx-1.5" aria-hidden>·</span>
                  <span title={fullValueTooltip(s.amount)}>{formatAEDPrecise(s.amount)}</span>
                  <span className="mx-1.5" aria-hidden>·</span>
                  <span className="text-xs">{c("cumulative")} {formatAEDPrecise(s.cumulative)} ({formatPctPrecise(s.cumulativePercent, 1)})</span>
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/60">
                  <div className={cn("h-full rounded-full", STAGE_BAR_COLORS[i % STAGE_BAR_COLORS.length])} style={{ width: `${Math.min(100, Math.max(0, s.percent))}%` }} />
                </div>
                <span className="w-36 shrink-0 text-end text-xs text-muted-foreground">{paymentDueCopy(s.dueLabel, locale)}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {c("Stages with explicit months-from-booking are ordered chronologically; otherwise your declared order is used. Totals")}{" "}
          <span dir="ltr" className="data-value font-semibold text-foreground" title={fullValueTooltip(result.totalAmount)}>{formatAEDPrecise(result.totalAmount)}</span> {c("against a")}{" "}
          {formatAEDPrecise(price)} {c("price.")}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ Currency -------------------------------- */

function CurrencyCalc() {
  const locale = localeOf(useRoute().locale);
  const c = React.useMemo(() => calculatorCopy(locale), [locale]);
  const [amount, setAmount] = React.useState(2_000_000);
  const [target, setTarget] = React.useState("USD");
  const converted = calc.currencyConvert(amount, INDICATIVE_FX[target] ?? 1);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cur-amt">{c("Amount (AED)")}</Label>
          <Input id="cur-amt" dir="ltr" type="number" value={amount || ""} min={0} step={10000} onChange={(e) => setAmount(Number(e.target.value) || 0)} className="num h-11 sm:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cur-target">{c("Convert to")}</Label>
          <select
            id="cur-target"
            dir="ltr"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none transition-ui focus:border-brand/60 sm:h-9 sm:text-sm"
          >
            {Object.keys(INDICATIVE_FX).filter((c) => c !== "AED").map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-card p-6">
        <p className="kicker">{c("Converted amount")}</p>
        <p dir="ltr" className="num mt-1 font-display text-4xl font-semibold">
          {formatNumber(converted, undefined, { maximumFractionDigits: 0 })} <span className="text-lg text-muted-foreground">{target}</span>
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ProvenanceBadge chip={{ sourceType: "DEMO", isIllustrative: true }} />
          {c("Indicative rate")} {formatNumber(INDICATIVE_FX[target], undefined, { maximumFractionDigits: 4 })} <bdi dir="ltr">{target}/AED</bdi> — {c("manually maintained, not live FX. Confirm with your bank before transactions.")}
        </p>
      </div>
    </div>
  );
}
