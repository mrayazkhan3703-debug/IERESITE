"use client";

/**
 * Scenario studio (U12 §20) — embedded scenario tooling on the investment hub.
 * Inputs (budget / rent / size / horizon / financing) run the SHARED scenario
 * engine locally: computeRoi + buildScenarios (downside/base/upside) with a
 * three-column comparison. Scenarios save to localStorage
 * (ie_saved_scenarios_v2: {id, timestamp, inputs, outputs}) with load/delete.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataStateBadge } from "@/components/common";
import { computeRoi, buildScenarios, SCENARIO_ENGINE_VERSION, type RoiInput, type RoiResult, type RoiScenarioSet } from "@/lib/scenario-engine";
import { formatAEDPrecise, formatPctPrecise, fullValueTooltip } from "@/lib/format-precise";
import { formatNumber, formatDate } from "@/lib/money";
import { t, localeOf } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import { events } from "@/lib/analytics-tracker";
import { useToast } from "@/hooks/use-toast";
import { Play, Save, Trash2, Upload, ShieldAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ie_saved_scenarios_v2";
const MAX_SAVED = 12;

interface ScenarioInputs {
  purchasePrice: number;
  annualRent: number;
  sizeSqft: number;
  serviceChargePerSqft: number;
  horizonYears: number;
  financing: "cash" | "mortgage";
  downPaymentPct: number;
}

interface SavedScenario {
  id: string;
  timestamp: string;
  inputs: ScenarioInputs;
  outputs: {
    grossYieldPct: number;
    netYieldPct: number;
    irrPct: number | null;
    breakEvenYear: number | null;
    totalReturnPct: number;
    cashOnCashPct: number;
  };
}

const DEFAULT_INPUTS: ScenarioInputs = {
  purchasePrice: 1_500_000,
  annualRent: 110_000,
  sizeSqft: 950,
  serviceChargePerSqft: 15,
  horizonYears: 10,
  financing: "mortgage",
  downPaymentPct: 25,
};

function toEngineInput(i: ScenarioInputs): RoiInput {
  return {
    purchasePrice: i.purchasePrice,
    annualRent: i.annualRent,
    rentGrowthPct: 4,
    appreciationPct: 3.5,
    vacancyPct: 5,
    serviceChargePerSqft: i.serviceChargePerSqft,
    sizeSqft: i.sizeSqft,
    maintenanceAnnual: Math.max(2000, i.purchasePrice * 0.01),
    managementPct: 5,
    purchaseCostsPct: 4.25,
    exitCostsPct: 2,
    horizonYears: i.horizonYears,
    ...(i.financing === "mortgage"
      ? {
          financing: {
            downPaymentPct: i.downPaymentPct,
            annualRatePct: 4.5,
            termYears: 25,
          },
        }
      : {}),
  };
}

function loadSaved(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedScenario[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SAVED) : [];
  } catch {
    return [];
  }
}

function persistSaved(list: SavedScenario[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch {
    /* storage full/blocked — the run still works, only persistence fails */
  }
}

function summaryOf(result: RoiResult): SavedScenario["outputs"] {
  return {
    grossYieldPct: result.grossYield,
    netYieldPct: result.netYield,
    irrPct: result.irr,
    breakEvenYear: result.breakEvenYear,
    totalReturnPct: result.totalReturnPct,
    cashOnCashPct: result.cashOnCash,
  };
}

export function InvestScenarioStudio() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const t_ = (key: string) => t(key, locale);
  const { toast } = useToast();

  const [inputs, setInputs] = React.useState<ScenarioInputs>({ ...DEFAULT_INPUTS });
  const [ran, setRan] = React.useState(false);
  const [scenarioSet, setScenarioSet] = React.useState<RoiScenarioSet | null>(null);
  const [saved, setSaved] = React.useState<SavedScenario[]>([]);

  React.useEffect(() => {
    setSaved(loadSaved());
  }, []);

  const set = (patch: Partial<ScenarioInputs>) => setInputs((prev) => ({ ...prev, ...patch }));

  const run = React.useCallback(
    (inputList: ScenarioInputs) => {
      const set_ = buildScenarios(toEngineInput(inputList));
      setScenarioSet(set_);
      setRan(true);
      events.roiScenarioRun("invest_hub");
    },
    []
  );

  const handleRun = () => run(inputs);

  const handleSave = () => {
    if (!scenarioSet) return;
    const entry: SavedScenario = {
      id: `sc-${Date.now()}`,
      timestamp: new Date().toISOString(),
      inputs: { ...inputs },
      outputs: summaryOf(scenarioSet.base.result),
    };
    const next = [entry, ...saved].slice(0, MAX_SAVED);
    setSaved(next);
    persistSaved(next);
    toast({ title: "Scenario saved", description: "Load it any time from the saved list below." });
  };

  const handleLoad = (entry: SavedScenario) => {
    setInputs({ ...entry.inputs });
    run(entry.inputs);
    toast({ title: "Scenario loaded", description: "Inputs restored and re-run with the current engine version." });
  };

  const handleDelete = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    persistSaved(next);
  };

  const num = (v: string): number => {
    const n = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const scenarioCards = scenarioSet
    ? [
        { key: "downside" as const, outcome: scenarioSet.downside, tone: "border-warning/40" },
        { key: "base" as const, outcome: scenarioSet.base, tone: "border-brand/50" },
        { key: "upside" as const, outcome: scenarioSet.upside, tone: "border-success/40" },
      ]
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* Inputs */}
      <div className="rounded-xl border border-border/70 bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold">{t_("invest.scenario.title")}</h3>
          <span className="num text-[10px] text-muted-foreground">{t_("invest.scenario.engine").replace("{v}", SCENARIO_ENGINE_VERSION)}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t_("invest.scenario.sub")}</p>

        <div className="mt-4 space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="sc-price">{t_("invest.scenario.budget")}</Label>
            <Input
              id="sc-price"
              type="text"
              inputMode="numeric"
              className="num"
              value={formatNumber(inputs.purchasePrice)}
              onChange={(e) => set({ purchasePrice: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-rent">{t_("invest.scenario.rent")}</Label>
            <Input
              id="sc-rent"
              type="text"
              inputMode="numeric"
              className="num"
              value={formatNumber(inputs.annualRent)}
              onChange={(e) => set({ annualRent: num(e.target.value) })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sc-size">{t_("invest.scenario.size")}</Label>
              <Input
                id="sc-size"
                type="text"
                inputMode="numeric"
                className="num"
                value={formatNumber(inputs.sizeSqft)}
                onChange={(e) => set({ sizeSqft: num(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-service">{t_("invest.scenario.serviceCharge")}</Label>
              <Input
                id="sc-service"
                type="text"
                inputMode="numeric"
                className="num"
                value={String(inputs.serviceChargePerSqft)}
                onChange={(e) => set({ serviceChargePerSqft: num(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sc-horizon">{t_("invest.scenario.horizon")}</Label>
              <Input
                id="sc-horizon"
                type="number"
                min={1}
                max={30}
                className="num"
                value={inputs.horizonYears}
                onChange={(e) => set({ horizonYears: Math.max(1, Math.min(30, num(e.target.value))) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t_("invest.scenario.financing")}</Label>
              <ToggleGroup
                type="single"
                value={inputs.financing}
                onValueChange={(v) => v && set({ financing: v as "cash" | "mortgage" })}
                variant="outline"
                className="w-full"
                aria-label={t_("invest.scenario.financing")}
              >
                <ToggleGroupItem value="cash" className="flex-1 text-xs">{t_("invest.scenario.financing.cash")}</ToggleGroupItem>
                <ToggleGroupItem value="mortgage" className="flex-1 text-xs">{t_("invest.scenario.financing.mortgage")}</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          {inputs.financing === "mortgage" && (
            <div className="space-y-1.5">
              <Label htmlFor="sc-down">{t_("invest.scenario.downPayment")}</Label>
              <Input
                id="sc-down"
                type="number"
                min={10}
                max={80}
                className="num"
                value={inputs.downPaymentPct}
                onChange={(e) => set({ downPaymentPct: Math.max(10, Math.min(80, num(e.target.value))) })}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button className="flex-1 gap-1.5" onClick={handleRun}>
              <Play className="h-4 w-4" aria-hidden /> {t_("invest.scenario.run")}
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={handleSave} disabled={!scenarioSet}>
              <Save className="h-4 w-4" aria-hidden /> {t_("invest.scenario.save")}
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-brand-strong" aria-hidden />
            Projections — deterministic math under stated assumptions (rent growth 4%/yr, appreciation 3.5%/yr,
            vacancy 5%, 4.25% purchase costs, 2% exit costs; mortgage 4.5% over 25 years when financed). Not a
            guarantee of future returns.
          </p>
        </div>
      </div>

      {/* Results — three-scenario comparison (§20 scenario tools) */}
      <div className="min-w-0">
        {!ran || !scenarioSet ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sand/30 px-6 py-12 text-center">
            <Sparkles className="h-8 w-8 text-brand" aria-hidden />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Set your inputs and run the numbers — the shared scenario engine returns downside, base and upside
              side by side.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {scenarioCards.map((c) => (
                <div key={c.key} className={cn("rounded-xl border bg-card p-4", c.tone)}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t_(`invest.scenario.${c.key}`)}
                    </p>
                    <DataStateBadge state="MODELED" />
                  </div>
                  <p className="num mt-2 font-display text-2xl font-semibold text-ink" title={fullValueTooltip(c.outcome.result.netYield)}>
                    {formatPctPrecise(c.outcome.result.netYield)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">net yield</p>
                  <dl className="num mt-3 space-y-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t_("invest.scenario.grossYield")}</dt>
                      <dd>{formatPctPrecise(c.outcome.result.grossYield)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t_("invest.scenario.irr")}</dt>
                      <dd>{c.outcome.result.irr !== null ? formatPctPrecise(c.outcome.result.irr) : "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t_("invest.scenario.breakEven")}</dt>
                      <dd>{c.outcome.result.breakEvenYear !== null ? `yr ${c.outcome.result.breakEvenYear}` : "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Total return</dt>
                      <dd>{formatPctPrecise(c.outcome.result.totalReturnPct)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/80">{c.outcome.adjustments.join(" · ")}</p>
                </div>
              ))}
            </div>

            {/* Comparison table (same 5 metrics × 3 scenarios as the calculator) */}
            <div className="overflow-x-safe rounded-xl border border-border/70">
              <table className="w-full min-w-[420px] text-sm">
                <caption className="sr-only">Scenario comparison table</caption>
                <thead>
                  <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="p-3 font-medium">{t_("market.explorer.statMode")}</th>
                    {scenarioCards.map((c) => (
                      <th key={c.key} scope="col" className="p-3 font-medium">{t_(`invest.scenario.${c.key}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Gross yield", (r: RoiResult) => formatPctPrecise(r.grossYield)],
                      ["Net yield", (r: RoiResult) => formatPctPrecise(r.netYield)],
                      ["Cash-on-cash", (r: RoiResult) => formatPctPrecise(r.cashOnCash)],
                      ["IRR", (r: RoiResult) => (r.irr !== null ? formatPctPrecise(r.irr) : "—")],
                      ["Total return", (r: RoiResult) => `${formatPctPrecise(r.totalReturnPct)} · ${formatAEDPrecise(r.totalReturn)}`],
                    ] as [string, (r: RoiResult) => string][]
                  ).map(([label, fmt]) => (
                    <tr key={label} className="border-b border-border/40 last:border-0">
                      <th scope="row" className="p-3 text-left text-xs font-medium text-muted-foreground">{label}</th>
                      {scenarioCards.map((c) => (
                        <td key={c.key} className="num p-3">{fmt(c.outcome.result)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Engine {SCENARIO_ENGINE_VERSION} — deterministic and versioned; the same core powers the calculators,
              property pages and the AI tools. Downside/base/upside derivation: rent ∓15/+10%, appreciation ×0.5/×1.5,
              vacancy +3pp/−2pp.
            </p>
          </div>
        )}

        {/* Saved scenarios — load / delete (§20) */}
        <div className="mt-6 rounded-xl border border-border/70 bg-card p-5">
          <h4 className="font-display text-base font-semibold">{t_("invest.scenario.savedList")}</h4>
          {saved.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t_("invest.scenario.empty")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {saved.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/60 bg-background/60 px-3.5 py-2.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="num font-medium">
                      {t_("invest.scenario.inputsPreset")
                        .replace("{price}", formatAEDPrecise(s.inputs.purchasePrice))
                        .replace("{rent}", formatAEDPrecise(s.inputs.annualRent))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {t_("invest.scenario.savedAt").replace("{date}", formatDate(s.timestamp))} · net yield{" "}
                      <span className="num font-medium">{formatPctPrecise(s.outputs.netYieldPct)}</span>
                      {s.outputs.irrPct !== null ? ` · IRR ${formatPctPrecise(s.outputs.irrPct)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-[11px]" onClick={() => handleLoad(s)}>
                      <Upload className="h-3 w-3" aria-hidden /> {t_("invest.scenario.load")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2.5 text-[11px] text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(s.id)}
                      aria-label={`Delete scenario saved ${formatDate(s.timestamp)}`}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden /> {t_("invest.scenario.delete")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Exposed for tests/docs: the exact engine input the studio builds. */
export { toEngineInput as studioEngineInput, DEFAULT_INPUTS as STUDIO_DEFAULT_INPUTS };
