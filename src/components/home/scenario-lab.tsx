"use client";

/**
 * Investor Scenario Lab preview (V2 §11.9) — five inputs, deterministic math.
 * Runs the shared scenario engine (src/lib/scenario-engine.ts) LOCALLY:
 * no API call, no persistence beyond localStorage (ie_scenario_lab_v2).
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { events } from "@/lib/analytics-tracker";
import { Play, ArrowRight, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { computeRoi, SCENARIO_ENGINE_VERSION, type RoiInput, type RoiResult } from "@/lib/scenario-engine";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";

const STORAGE_KEY = "ie_scenario_lab_v2";

type Financing = "cash" | "mortgage";
type PropertyKind = "apartment" | "townhouse" | "villa";
type Horizon = 3 | 5 | 10 | 15;

interface LabState {
  budget: number;
  financing: Financing;
  horizon: Horizon;
  propertyType: PropertyKind;
  monthlyRent: number;
}

const DEFAULTS: LabState = {
  budget: 1_500_000,
  financing: "mortgage",
  horizon: 10,
  propertyType: "apartment",
  monthlyRent: 8_000,
};

/* Stated, type-specific assumptions — surfaced in the UI, never hidden. */
const TYPE_ASSUMPTIONS: Record<PropertyKind, { sizeSqft: number; serviceChargePerSqft: number }> = {
  apartment: { sizeSqft: 1_000, serviceChargePerSqft: 18 },
  townhouse: { sizeSqft: 2_200, serviceChargePerSqft: 8 },
  villa: { sizeSqft: 4_000, serviceChargePerSqft: 5 },
};

const COMMON_ASSUMPTIONS = {
  rentGrowthPct: 4,
  vacancyPct: 5,
  maintenanceAnnual: 3_000,
  managementPct: 5,
  appreciationPct: 3.5,
  purchaseCostsPct: 4,
  exitCostsPct: 2,
};

const FINANCING = { downPaymentPct: 25, annualRatePct: 4.5, termYears: 25 };

function buildInput(s: LabState): RoiInput {
  const type = TYPE_ASSUMPTIONS[s.propertyType];
  return {
    purchasePrice: s.budget,
    annualRent: s.monthlyRent * 12,
    rentGrowthPct: COMMON_ASSUMPTIONS.rentGrowthPct,
    vacancyPct: COMMON_ASSUMPTIONS.vacancyPct,
    serviceChargePerSqft: type.serviceChargePerSqft,
    sizeSqft: type.sizeSqft,
    maintenanceAnnual: COMMON_ASSUMPTIONS.maintenanceAnnual,
    managementPct: COMMON_ASSUMPTIONS.managementPct,
    ...(s.financing === "mortgage" ? { financing: FINANCING } : {}),
    appreciationPct: COMMON_ASSUMPTIONS.appreciationPct,
    purchaseCostsPct: COMMON_ASSUMPTIONS.purchaseCostsPct,
    exitCostsPct: COMMON_ASSUMPTIONS.exitCostsPct,
    horizonYears: s.horizon,
  };
}

function loadSaved(): LabState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LabState>;
    if (
      typeof parsed.budget !== "number" ||
      typeof parsed.monthlyRent !== "number" ||
      !Number.isFinite(parsed.budget) || parsed.budget <= 0 ||
      !Number.isFinite(parsed.monthlyRent) || parsed.monthlyRent < 0 ||
      !["cash", "mortgage"].includes(parsed.financing ?? "") ||
      ![3, 5, 10, 15].includes(parsed.horizon ?? 0) ||
      !["apartment", "townhouse", "villa"].includes(parsed.propertyType ?? "")
    ) {
      return null;
    }
    return {
      budget: parsed.budget!,
      financing: parsed.financing!,
      horizon: parsed.horizon! as Horizon,
      propertyType: parsed.propertyType!,
      monthlyRent: parsed.monthlyRent!,
    };
  } catch {
    return null;
  }
}

function ResultCell({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3.5 py-3">
      <p className="type-label text-[10px] text-muted-foreground">{label}</p>
      <p className="type-data-value mt-1 text-ink">{value}</p>
      {note && <p className="type-metadata mt-0.5 text-[11px]">{note}</p>}
    </div>
  );
}

export function ScenarioLab({ locale }: { locale: Locale }) {
  const [state, setState] = React.useState<LabState>(DEFAULTS);
  const [restored, setRestored] = React.useState(false);
  const [storageReady, setStorageReady] = React.useState(false);
  const [result, setResult] = React.useState<RoiResult | null>(null);

  /* Keep the first client render identical to SSR; restore browser storage after mount. */
  React.useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setState(saved);
      setRestored(true);
      setResult(computeRoi(buildInput(saved)));
    }
    setStorageReady(true);
  }, []);

  React.useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable — lab still works, just not restored */
    }
  }, [state, storageReady]);

  const run = () => {
    if (!Number.isFinite(state.budget) || state.budget <= 0 || state.monthlyRent < 0) return;
    const r = computeRoi(buildInput(state));
    setResult(r);
    events.scenarioRun(state.horizon, state.financing === "mortgage");
    if (restored) setRestored(false);
  };

  const patch = (p: Partial<LabState>) => setState((s) => ({ ...s, ...p }));
  const type = TYPE_ASSUMPTIONS[state.propertyType];

  const assumptionsLine = t("home.scenario.assumptions", locale)
    .replace("{growth}", String(COMMON_ASSUMPTIONS.rentGrowthPct))
    .replace("{vacancy}", String(COMMON_ASSUMPTIONS.vacancyPct))
    .replace("{sc}", String(type.serviceChargePerSqft))
    .replace("{mgmt}", String(COMMON_ASSUMPTIONS.managementPct))
    .replace("{app}", String(COMMON_ASSUMPTIONS.appreciationPct));

  return (
    <section className="section-plain section" aria-labelledby="scenario-heading">
      <div className="container-page">
        <div className="mb-6 max-w-2xl">
          <p className="kicker mb-2">{t("home.scenario.kicker", locale)}</p>
          <h2 id="scenario-heading" className="type-h2">
            {t("home.scenario.title", locale)}
          </h2>
          <p className="mt-2 text-balance text-muted-foreground">{t("home.scenario.subtitle", locale)}</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_10px_36px_-24px_rgba(0,0,0,0.25)]">
          <div className="grid lg:grid-cols-12">
            {/* Inputs */}
            <div className="min-w-0 border-b border-border/60 p-5 sm:p-6 lg:col-span-7 lg:border-b-0 lg:border-e">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="scenario-budget">{t("home.scenario.budget", locale)}</Label>
                  <Input
                    id="scenario-budget"
                    type="number"
                    inputMode="numeric"
                    min={100_000}
                    step={50_000}
                    value={state.budget}
                    onChange={(e) => patch({ budget: Number(e.target.value) })}
                    className="num h-11 sm:h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scenario-rent">{t("home.scenario.targetRent", locale)}</Label>
                  <Input
                    id="scenario-rent"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={250}
                    value={state.monthlyRent}
                    onChange={(e) => patch({ monthlyRent: Number(e.target.value) })}
                    className="num h-11 sm:h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("home.scenario.financing", locale)}</Label>
                  <div className="flex gap-1.5" role="group" aria-label="Financing mode">
                    {(["cash", "mortgage"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={state.financing === f}
                        onClick={() => patch({ financing: f })}
                        className={cn(
                          "min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-ui lg:min-h-0",
                          state.financing === f
                            ? "border-brand bg-brand text-primary-foreground"
                            : "border-border bg-secondary/60 hover:bg-secondary"
                        )}
                      >
                        {t(`home.scenario.${f}`, locale)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("home.scenario.horizon", locale)}</Label>
                  <div className="flex gap-1.5" role="group" aria-label="Investment horizon">
                    {([3, 5, 10, 15] as const).map((h) => (
                      <button
                        key={h}
                        type="button"
                        aria-pressed={state.horizon === h}
                        onClick={() => patch({ horizon: h })}
                        className={cn(
                          "num min-h-11 flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-ui lg:min-h-0",
                          state.horizon === h
                            ? "border-brand bg-brand text-primary-foreground"
                            : "border-border bg-secondary/60 hover:bg-secondary"
                        )}
                      >
                        {formatNumber(h)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t("home.scenario.propertyType", locale)}</Label>
                  <div className="flex gap-1.5" role="group" aria-label="Property type">
                    {(["apartment", "townhouse", "villa"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={state.propertyType === p}
                        onClick={() => patch({ propertyType: p })}
                        className={cn(
                          "min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-ui lg:min-h-0",
                          state.propertyType === p
                            ? "border-brand bg-brand text-primary-foreground"
                            : "border-border bg-secondary/60 hover:bg-secondary"
                        )}
                      >
                        {t(`home.scenario.${p}`, locale)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button size="lg" className="min-h-11 rounded-full lg:min-h-0" onClick={run}>
                  <Play className="h-4 w-4" aria-hidden /> {t("home.scenario.run", locale)}
                </Button>
                {restored && (
                  <p className="text-xs text-muted-foreground">Restored your last scenario from this device.</p>
                )}
              </div>
            </div>

            {/* Results */}
            <div className="min-w-0 bg-sand/40 p-5 sm:p-6 lg:col-span-5">
              {result ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <ResultCell
                      label={t("home.scenario.grossYield", locale)}
                      value={formatPctPrecise(result.grossYield)}
                      note={`rent ${formatAEDPrecise(state.monthlyRent * 12)}/yr scheduled`}
                    />
                    <ResultCell
                      label={t("home.scenario.netYield", locale)}
                      value={formatPctPrecise(result.netYield)}
                      note={`NOI ${formatAEDPrecise(result.netIncomeAnnual)}/yr`}
                    />
                    <ResultCell
                      label={t("home.scenario.irr", locale)}
                      value={result.irr !== null ? formatPctPrecise(result.irr) : "—"}
                      note={result.irr !== null ? `${state.horizon}-year cashflow series` : "Newton solver did not converge"}
                    />
                    <ResultCell
                      label={t("home.scenario.breakEven", locale)}
                      value={
                        result.breakEvenYear !== null
                          ? t("home.scenario.breakEvenYears", locale).replace("{n}", formatNumber(result.breakEvenYear))
                          : t("home.scenario.beyondHorizon", locale)
                      }
                      note={`cash in ${formatAEDPrecise(result.initialCashInvested)}`}
                    />
                  </div>

                  <Button
                    asChild
                    variant="outline"
                    className="min-h-11 w-full rounded-full lg:min-h-0"
                  >
                    <Link
                      to="/properties"
                      query={{
                        priceMax: String(Math.round(state.budget)),
                        propertyType: state.propertyType,
                      }}
                    >
                      {t("home.scenario.matching", locale)} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                    </Link>
                  </Button>

                  <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                    {t("home.scenario.disclaimer", locale)}
                  </p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground/80">{assumptionsLine}</p>
                  <p className="text-[11px] text-muted-foreground/60">
                    {t("home.scenario.engine", locale).replace("{v}", SCENARIO_ENGINE_VERSION)}
                  </p>
                </div>
              ) : (
                <div className="flex h-full min-h-56 flex-col items-center justify-center text-center">
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Set your five inputs and run the scenario — gross and net yield, IRR and break-even appear here,
                    computed on your device.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
