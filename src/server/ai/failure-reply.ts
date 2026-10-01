/** Safe localized responses; never interpolate provider errors or customer data. */
export function advisorFailureReply(code: string | null, locale = "en"): string {
  const ar = locale === "ar";
  if (code === "AI_KILL_SWITCH") return ar
    ? "أوقف المسؤول مستشار الذكاء الاصطناعي مؤقتاً. لم يُرسل أي طلب إلى النموذج. يمكنك استخدام نموذج الاستشارة للحصول على المساعدة."
    : "The AI advisor is paused by an administrator. No model request was sent. You can still use the consultation form if you would like help.";
  if (code === "AI_LIVE_DISABLED" || code === "AI_PROVIDER_NOT_APPROVED") return ar
    ? "الذكاء الاصطناعي المباشر معطّل في هذه البيئة. لم يُرسل أي طلب إلى النموذج. يمكنك استخدام نموذج الاستشارة للحصول على المساعدة."
    : "Live AI is disabled in this environment. No model request was sent. You can still use the consultation form if you would like help.";
  if (code === "AI_DAILY_REQUEST_LIMIT" || code === "AI_DAILY_TOKEN_LIMIT") return ar
    ? "بلغ مستشار الذكاء الاصطناعي حد الاستخدام اليومي المحدد. لم يُرسل أي طلب إلى النموذج. حاول بعد إعادة ضبط الحد أو استخدم نموذج الاستشارة."
    : "The AI advisor has reached its configured daily usage limit. No model request was sent. Please try again after the limit resets or use the consultation form.";
  if (code === "AI_PROMPT_TOO_LARGE") return ar
    ? "هذه المحادثة تتجاوز حد طلب الذكاء الاصطناعي المحدد. ابدأ محادثة جديدة أو استخدم نموذج الاستشارة."
    : "This conversation is too large for the configured AI request limit. Start a new chat or use the consultation form.";
  if (code === "AI_BUDGET_BUSY") return ar
    ? "مستشار الذكاء الاصطناعي مشغول حالياً. لم يُرسل أي طلب إلى النموذج. حاول قريباً أو استخدم نموذج الاستشارة."
    : "The AI advisor is busy or unavailable. No model request was sent. Please try again shortly or use the consultation form.";
  return ar
    ? "تعذّر الاتصال بخدمة المساعد حالياً. تم حفظ محادثتك. يمكنك إعادة المحاولة قريباً أو إرسال طلب استشارة منفصل؛ لا تُنقل هذه المحادثة تلقائياً."
    : "I'm having trouble reaching the assistant service right now. Your conversation is saved. You can retry in a moment, or submit a consultation request separately; this chat is not transferred automatically.";
}
