import type { Locale } from "@/lib/i18n";

/** Optional filter extraction applies to inventory requests, never standalone calculations. */
export function looksLikeSearchIntent(s: string, locale: Locale): boolean {
  const text = s.toLowerCase();
  if (locale === "ar") {
    const inventoryVerb = /(?:ابحث|أبحث|اعرض|اقترح|أرغب في البحث|أريد البحث)/u.test(text);
    if (/(?:احسب|أحسب|حاسبة|حساب العائد|حساب الرهن|سيناريو|قسط القرض)/u.test(text) && !inventoryVerb) return false;
    const hasSearchVerb = inventoryVerb || /قارن/u.test(text);
    const hasCriteria = /(?:غرف|شقة|فيلا|استوديو|مليون|ألف|ميزانية|للبيع|للإيجار|إيجار|تحت|أقل من|إطلالة بحرية)/u.test(text);
    const startsQuestion = /^(?:ما|كيف|لماذا|متى|أي|هل|اشرح|أخبرني)/u.test(text.trim());
    if (startsQuestion) return hasSearchVerb;
    return hasSearchVerb || hasCriteria;
  }
  const inventoryVerb = /\b(find|search|look(ing)? for|show me|suggest|list|browse)\b/.test(text);
  if (/\b(calculate|calculator|calculation|scenario|mortgage payment|loan payment)\b/.test(text) && !inventoryVerb) return false;
  const hasSearchVerb = inventoryVerb || /\bcompare\b/.test(text);
  const hasCriteria =
    /\b(bed|bedroom|villa|apartment|studio|penthouse|townhouse|duplex)\b/.test(text) ||
    /\d\s*(m|k|million|aed)\b/.test(text) ||
    /\b(under|up to|above|budget|off-?plan|handover|yield)\b/.test(text);
  const startsQuestion = /^(what|how|why|when|which|whose|is|are|do|does|can|could|would|should|explain|tell me about|who)\b/.test(text);
  if (startsQuestion) return hasSearchVerb;
  return hasSearchVerb || hasCriteria;
}
