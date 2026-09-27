export type AdvisorLocale = "en" | "ar";

export function normalizeAdvisorLocale(locale: string | undefined): AdvisorLocale {
  return locale === "ar" ? "ar" : "en";
}

export function advisorLocaleInstruction(localeInput: string | undefined): string {
  const locale = normalizeAdvisorLocale(localeInput);
  if (locale === "ar") {
    return "RESPONSE LANGUAGE: Reply in clear Modern Standard Arabic. Keep source titles, property/project/community names, URLs, schema keys, and enum values exactly as supplied. Do not translate uncertain terms into factual claims; explain uncertainty in Arabic.";
  }
  return "RESPONSE LANGUAGE: Reply in English. Keep source titles, property/project/community names, URLs, schema keys, and enum values exactly as supplied. Explain uncertainty plainly.";
}

function normalizeArabicSearchText(text: string): string {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const easternArabicIndic = "۰۱۲۳۴۵۶۷۸۹";
  return text.normalize("NFKC").toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String(arabicIndic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(easternArabicIndic.indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/[٬,]/g, "");
}

export type ArabicSearchCriteria = {
  bedroomsMin?: number;
  priceMax?: number;
  listingType?: "SALE" | "RENT";
  communities?: string[];
  offPlan?: boolean;
  seaView?: boolean;
};

/** Extract only explicit Arabic-language search filters; leave ambiguous claims as text. */
export function extractArabicSearchCriteria(query: string, knownCommunities: string[] = []): ArabicSearchCriteria {
  const q = normalizeArabicSearchText(query);
  if (!/[\p{Script=Arabic}]/u.test(q)) return {};
  const filters: ArabicSearchCriteria = {};

  if (/(?:غرفتين|غرفتان|غرفتي\s+نوم)/u.test(q)) filters.bedroomsMin = 2;
  else if (/(?:ثلاث|ثلاثة)\s+غرف(?:ة)?(?:\s+نوم)?/u.test(q)) filters.bedroomsMin = 3;
  else if (/(?:أربع|اربعة|أربعة)\s+غرف(?:ة)?(?:\s+نوم)?/u.test(q)) filters.bedroomsMin = 4;
  else if (/استوديو/u.test(q)) filters.bedroomsMin = 0;
  else {
    const bedrooms = q.match(/(?:^|\s)(\d{1,2})\s*(?:غرف(?:ة)?|غرفة)(?:\s+نوم)?(?=\s|$)/u);
    const count = Number(bedrooms?.[1]);
    if (bedrooms && Number.isInteger(count) && count >= 0 && count <= 20) filters.bedroomsMin = count;
  }

  const price = q.match(/(?:أقل\s+من|اقل\s+من|دون|تحت|لا\s+يتجاوز|حتى|بحد\s+أقصى|ميزانية(?:ي)?)(?:\s+(?:بمبلغ|قدرها))?\s*(?:(?:درهم|aed)\s*)?(\d+(?:\.\d+)?)\s*(مليون|ملايين|ألف|الف)?/u);
  if (price?.[1]) {
    const amount = Number(price[1]);
    const unit = price[2] ?? "";
    const multiplier = /مليون|ملايين/u.test(unit) ? 1_000_000 : /ألف|الف/u.test(unit) ? 1_000 : 1;
    const priceMax = Math.round(amount * multiplier);
    // A small unqualified number is ambiguous; never silently turn it into millions.
    if ((unit || amount >= 1000) && priceMax > 0 && priceMax <= 500_000_000) filters.priceMax = priceMax;
  }

  if (/(?:للإيجار|للايجار|إيجار|ايجار|استئجار)/u.test(q)) filters.listingType = "RENT";
  else if (/(?:للبيع|شراء|اشتر|تملك)/u.test(q)) filters.listingType = "SALE";
  if (/(?:على\s+المخطط|قيد\s+الإنشاء|قيد\s+الانشاء)/u.test(q)) filters.offPlan = true;
  if (/(?:إطلالة\s+بحرية|اطلالة\s+بحرية|مطلة\s+على\s+البحر)/u.test(q)) filters.seaView = true;

  const communities = knownCommunities.filter((name) => q.includes(normalizeArabicSearchText(name))).slice(0, 6);
  if (communities.length) filters.communities = communities;
  return filters;
}
