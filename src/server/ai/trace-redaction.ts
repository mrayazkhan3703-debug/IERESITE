type SafePropertySummary = {
  slug: string;
  title: string;
  community: string;
  priceAed: number | null;
  url: string;
};

const REDACTED = { redacted: true } as const;

const CALCULATOR_FIELDS: Record<string, readonly string[]> = {
  calculate_roi: ["purchasePrice", "annualRent", "annualCosts", "appreciationPctPerYear", "years"],
  calculate_yield: ["purchasePrice", "annualRent", "annualCosts"],
  calculate_mortgage: [
    "propertyPrice", "downPaymentPct", "interestRatePct", "years", "borrowerCategory", "propertyStatus", "purpose",
  ],
  calculate_payment_plan: ["purchasePrice", "stages"],
};

const SAFE_CALCULATOR_ENUMS: Record<string, readonly string[]> = {
  borrowerCategory: ["resident-first", "resident-additional", "nonresident-first", "nonresident-additional"],
  propertyStatus: ["ready", "offplan"],
  purpose: ["owner", "investment"],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeCalculatorInput(toolName: string, value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const allowed = CALCULATOR_FIELDS[toolName];
  if (!record || !allowed) return { ...REDACTED };

  const safe: Record<string, unknown> = {};
  for (const field of allowed) {
    const fieldValue = record[field];
    if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) {
      safe[field] = fieldValue;
      continue;
    }
    const enumValues = SAFE_CALCULATOR_ENUMS[field];
    if (typeof fieldValue === "string" && enumValues?.includes(fieldValue)) safe[field] = fieldValue;
  }

  if (toolName === "calculate_payment_plan" && Array.isArray(record.stages)) {
    safe.stages = record.stages.flatMap((stage) => {
      const stageRecord = asRecord(stage);
      if (!stageRecord || typeof stageRecord.percent !== "number" || !Number.isFinite(stageRecord.percent)) return [];
      const cleanStage: { percent: number; monthsFromBooking?: number } = { percent: stageRecord.percent };
      const dueAt = asRecord(stageRecord.dueAt);
      const monthsFromBooking = dueAt?.monthsFromBooking ?? stageRecord.monthsFromBooking;
      if (typeof monthsFromBooking === "number" && Number.isFinite(monthsFromBooking)) {
        cleanStage.monthsFromBooking = monthsFromBooking;
      }
      return [cleanStage];
    });
  }

  return safe;
}

function containsContactDetail(value: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)
    || /\+?\d[\d\s().-]{7,}\d/.test(value);
}

function safePublicLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.trim().slice(0, 120);
  return clean && !containsContactDetail(clean) ? clean : "";
}

function safeSearchProperties(value: unknown): SafePropertySummary[] {
  const data = asRecord(value);
  const candidates = data && Array.isArray(data.properties) ? data.properties : [];
  return candidates.slice(0, 6).flatMap((candidate) => {
    const property = asRecord(candidate);
    if (!property) return [];
    const slug = typeof property.slug === "string" ? property.slug : "";
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/i.test(slug)) return [];
    const price = property.priceAed;
    return [{
      slug,
      title: safePublicLabel(property.title),
      community: safePublicLabel(property.community),
      priceAed: typeof price === "number" && Number.isFinite(price) && price >= 0 ? price : null,
      url: `/properties/${slug}`,
    }];
  });
}

/** Persist only bounded allowlisted data; never store free-form tool input or output. */
export function redactAiToolTrace(
  toolName: string,
  args: unknown,
  result: { ok?: unknown; data?: unknown } | null | undefined,
): { input: Record<string, unknown>; output: Record<string, unknown> } {
  if (toolName === "search_properties") {
    return { input: { ...REDACTED }, output: { properties: safeSearchProperties(result?.data) } };
  }
  if (toolName.startsWith("calculate_")) {
    return { input: safeCalculatorInput(toolName, args), output: { ...REDACTED } };
  }
  return { input: { ...REDACTED }, output: { ...REDACTED } };
}

/** Re-sanitize legacy rows before showing calculator assumptions in a handoff. */
export function calculatorAssumptionSummary(toolName: string, input: unknown): string | null {
  const safe = safeCalculatorInput(toolName, input);
  if (safe.redacted) return null;
  const parts = Object.entries(safe).flatMap(([key, value]) => {
    if (typeof value === "number" || typeof value === "string") return [`${key}=${value}`];
    if (key === "stages" && Array.isArray(value)) {
      const stages = value.flatMap((stage) => {
        const item = asRecord(stage);
        if (!item || typeof item.percent !== "number") return [];
        return [`${item.percent}%${typeof item.monthsFromBooking === "number" ? `@${item.monthsFromBooking}mo` : ""}`];
      });
      return stages.length ? [`stages=${stages.join("/")}`] : [];
    }
    return [];
  });
  return parts.length ? parts.slice(0, 6).join(", ") : null;
}

/** Re-sanitize old search rows before exposing any shortlist data. */
export function safeHandoffProperties(value: unknown): SafePropertySummary[] {
  return safeSearchProperties(value);
}
