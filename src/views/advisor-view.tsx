"use client";

import * as React from "react";
import { Link, navigate, useRoute } from "@/lib/router";
import { api, ApiError } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { events } from "@/lib/analytics-tracker";
import { Breadcrumbs } from "@/components/common";
import { AdvisorMatches, AdvisorMatchCard } from "@/components/advisor/advisor-matches";
import { AttachmentList, type AdvisorAttachment } from "@/components/advisor/attachments";
import { IntentChips } from "@/components/advisor/intent-chips";
import { ScopingCard, type ScopeKind } from "@/components/advisor/scoping-card";
import { HandoffConfirmationCard, type HandoffDetail } from "@/components/advisor/handoff-card";
import { filtersToChips, type IntentFilterSet } from "@/components/advisor/intent-format";
import { Sparkles, Send, User, ExternalLink, BookOpen, Calculator, ShieldAlert, Loader2, Phone, ArrowRight, MessageSquarePlus, History, Info } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";

interface NlIntent {
  filters: IntentFilterSet;
  explanation?: string;
  unrecognized?: string[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: { label: string; url?: string | null }[];
  handoff?: boolean;
  toolNames?: string[];
  matches?: AdvisorMatchCard[];
  fallback?: boolean;
  /** V2 §22.2 — parsed structured intent shown as editable chips under the user bubble. */
  intent?: NlIntent;
  /** V2 §22.4 — structured attachments for assistant turns (absent on V1 messages). */
  attachments?: AdvisorAttachment[];
  /** V2 §22.2 — criteria the assistant actually used for its inventory search. */
  searchCriteria?: IntentFilterSet;
  /** V2 §22.6 — context transferred on human handoff. */
  handoffDetail?: HandoffDetail;
}

interface ChatResponse {
  conversationId: string;
  reply: string;
  citations: { label: string; url?: string | null }[];
  toolCalls: { name: string; status: string }[];
  handoff: boolean;
  fallback: boolean;
  matches?: AdvisorMatchCard[];
  attachments?: AdvisorAttachment[];
  searchCriteria?: IntentFilterSet | null;
  handoffDetail?: HandoffDetail | null;
}

/** Conversation continuity across reloads (blueprint: conversations persist server-side;
 *  the client remembers the last conversation id locally and restores it silently). */
const CONVERSATION_KEY = "ie_advisor_conversation";

const SUGGESTIONS = [
  // V2 §22.2 showcase pair — the second one demonstrates structured chips parsing
  // (yield + handover criteria are first-class filter chips now).
  "Compare Downtown Dubai and Business Bay for a AED 3M rental investment",
  "Find 2BR under AED 2.7M in Marina or Creek Harbour with modeled gross yield above 5.5% and handover before Q4 2028",
  "2-bed sea view apartment under 2.5M in Marina or Beachfront",
  "Best gross yield I can get with 800k budget in JVC?",
  "Explain a payment plan using verified project information",
  "What are the buyer costs for a 2M AED property?",
  "Family villa with garden in Arabian Ranches under 4.5M",
];
const SUGGESTIONS_AR = [
  "ابحث عن شقة بغرفتي نوم ضمن ميزانية أحددها",
  "اعرض الخيارات ذات الإطلالة البحرية في المنطقة التي أذكرها",
  "اشرح خطة الدفع إذا كانت بيانات المشروع متاحة",
  "ما المعلومات الموثقة المتاحة عن الإيجار والعائد؟",
];

/**
 * Cheap client-side gate for the NL intent parse (§22.2): only messages that
 * look like a search request get POSTed to /api/search/nl. Questions about a
 * scoped listing ("What is the yield here?") skip the parse — no chip noise.
 */
function looksLikeSearchIntent(s: string, locale: Locale): boolean {
  const text = s.toLowerCase();
  if (locale === "ar") {
    const hasSearchVerb = /(?:ابحث|أبحث|اعرض|قارن|اقترح|أرغب في البحث|أريد البحث)/u.test(text);
    const hasCriteria = /(?:غرف|شقة|فيلا|استوديو|مليون|ألف|ميزانية|للبيع|للإيجار|إيجار|تحت|أقل من|إطلالة بحرية)/u.test(text);
    const startsQuestion = /^(?:ما|كيف|لماذا|متى|أي|هل|اشرح|أخبرني)/u.test(text.trim());
    if (startsQuestion) return hasSearchVerb;
    return hasSearchVerb || hasCriteria;
  }
  const hasSearchVerb = /\b(find|search|look(ing)? for|show me|suggest|list|browse|compare)\b/.test(text);
  const hasCriteria =
    /\b(bed|bedroom|villa|apartment|studio|penthouse|townhouse|duplex)\b/.test(text) ||
    /\d\s*(m|k|million|aed)\b/.test(text) ||
    /\b(under|up to|above|budget|off-?plan|handover|yield)\b/.test(text);
  const startsQuestion = /^(what|how|why|when|which|whose|is|are|do|does|can|could|would|should|explain|tell me about|who)\b/.test(text);
  if (startsQuestion) return hasSearchVerb;
  return hasSearchVerb || hasCriteria;
}

/**
 * Contextual quick replies after the latest assistant answer.
 * Deterministic client-side heuristics over the message shape
 * (structured matches / handoff / topic keywords) — no extra LLM call,
 * so suggestions never add latency or cost.
 */
function followUpSuggestions(m: Message, locale: Locale): string[] {
  const out: string[] = [];
  const text = m.content.toLowerCase();
  const hasCards = (m.attachments?.length ?? 0) > 0 || (m.matches?.length ?? 0) > 0;

  if (locale === "ar") {
    if (hasCards) {
      out.push("هل توجد بيانات موثقة لمقارنة العائد الإجمالي بينها؟");
      out.push("قارن بينها وفق السعر والمساحة المتاحين");
      if ((m.matches?.length ?? m.attachments?.length ?? 0) >= 3) out.push("اعرض بدائل أقل سعراً إن وجدت");
    }
    if (/(?:عائد|مردود|yield)/u.test(text)) out.push("كيف يُحسب العائد الإجمالي؟");
    if (/(?:خطة الدفع|أقساط|التسليم)/u.test(text)) out.push("ما تفاصيل خطة الدفع الموثقة؟");
    if (/(?:رسوم|تكلفة|تكاليف|نقل الملكية)/u.test(text)) out.push("ما الرسوم التي تحتاج إلى مصدر موثق؟");
    if (/(?:رهن|تمويل|قرض)/u.test(text)) out.push("ما المعلومات المتاحة عن التمويل؟");
    if (/(?:إيجار|الإيجار|مستأجر)/u.test(text)) out.push("ما بيانات الإيجار الموثقة المتاحة؟");
    if (/(?:على المخطط|قيد الإنشاء)/u.test(text)) out.push("ما المعلومات الموثقة عن مخاطر الشراء على المخطط؟");
    if (out.length < 2) {
      out.push("ما المعلومات الموثقة المتاحة عن هذا الخيار؟");
      out.push("عدّل معايير البحث أو ابدأ بحثاً جديداً");
    }
    return out.slice(0, 3);
  }

  if (hasCards) {
    out.push("Which of these has the best gross yield?");
    out.push("Compare them on price per sqft");
    if ((m.matches?.length ?? m.attachments?.length ?? 0) >= 3) out.push("Show me cheaper alternatives");
  }
  if (/\byield\b|\breturn\b|\bcap rate\b/.test(text)) out.push("How is gross yield calculated?");
  if (/payment plan|installment|handover/.test(text)) out.push("What are typical post-handover splits?");
  if (/\bcost|\bfee|\bdld\b|\btransfer|\bagency/.test(text)) out.push("What's negotiable in these costs?");
  if (/mortgage|\bloan\b|monthly payment|down payment/.test(text)) out.push("What do UAE banks require for a mortgage?");
  if (/\brent|\btenant\b|short-?term/.test(text)) out.push("Short-term or annual rental — which nets more?");
  if (/\boff-?plan\b/.test(text)) out.push("What are the risks of buying off-plan?");

  if (out.length < 2) {
    out.push("What are the buyer costs on this?");
    out.push("Set up a search alert for this");
  }
  return out.slice(0, 3);
}

let msgSeq = 0;

export default function AdvisorView() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [conversationId, setConversationId] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [rateLimited, setRateLimited] = React.useState<string | null>(null);
  const [restored, setRestored] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const leadForm = useLeadForm();
  const loc = useRoute();
  const locale: Locale = loc.locale === "ar" ? "ar" : "en";

  /* V2 §22 — scoped entry (?property= / ?project= from detail pages) and
   * prefilled question (?q= — prefilled, never auto-sent). */
  const propertySlug = loc.query.property;
  const projectSlug = loc.query.project;
  const presetQ = loc.query.q;
  const scope: { kind: ScopeKind; slug: string } | null = propertySlug
    ? { kind: "property", slug: propertySlug }
    : projectSlug
      ? { kind: "project", slug: projectSlug }
      : null;

  usePageMeta({
    title: t("advisor.title", locale),
    description: t("advisor.subtitle", locale),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Investment Experts AI Property Advisor",
      applicationCategory: "RealEstateApplication",
    },
  });

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  /* V3-F §20 — auto-resize composer: grows with the draft (up to ~5 lines)
   * so long questions stay readable on phones; resets when the message sends. */
  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  React.useEffect(() => {
    events.aiConversation("start");
     
  }, []);

  // ?q= prefill — visible in the composer, sent only when the user chooses to.
  React.useEffect(() => {
    if (presetQ) setInput(decodeURIComponent(presetQ).slice(0, 1000));
  }, [presetQ]);

  /* ai_tool_result_viewed — once per assistant message that rendered
   * structured attachments (U13 analytics requirement). */
  const trackedRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    for (const m of messages) {
      if (m.role === "assistant" && m.attachments?.length && !trackedRef.current.has(m.id)) {
        trackedRef.current.add(m.id);
        events.aiToolResultViewed([...new Set(m.attachments.map((a) => a.kind))].join(","));
      }
    }
  }, [messages]);

  // Restore the last conversation (server is the source of truth; local key only points at it).
  React.useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(CONVERSATION_KEY) : null;
    if (!saved) return;
    let cancelled = false;
    api
      .get<{
        id: string;
        messages: { role: "user" | "assistant"; content: string; citations?: { label: string; url?: string | null }[]; toolNames?: string[] }[];
      }>(`/api/ai/conversations/${saved}`)
      .then((res) => {
        if (cancelled) return;
        if (res.messages?.length) {
          setConversationId(res.id);
          setMessages(
            res.messages.map((m) => ({
              id: `restored-${msgSeq++}`,
              role: m.role,
              content: m.content,
              citations: m.citations,
              toolNames: m.toolNames,
            }))
          );
          setRestored(true);
        } else {
          window.localStorage.removeItem(CONVERSATION_KEY);
        }
      })
      .catch(() => {
        // expired or unavailable — start fresh
        window.localStorage.removeItem(CONVERSATION_KEY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startNewConversation = () => {
    setMessages([]);
    setConversationId(undefined);
    setRestored(false);
    setRateLimited(null);
    window.localStorage.removeItem(CONVERSATION_KEY);
  };

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setRateLimited(null);
    const msgId = `u-${msgSeq++}`;
    setMessages((m) => [...m, { id: msgId, role: "user", content: message }]);
    setBusy(true);
    events.aiConversation("message");

    // V2 §22.2 — parse the natural-language intent in parallel with the chat
    // turn; chips render under the user message as soon as the parse lands
    // (independent of the assistant reply timing). Silent failure = no chips.
    let intent: NlIntent | null = null;
    const nlPromise = looksLikeSearchIntent(message, locale)
      ? api
          .post<NlIntent>("/api/search/nl", { query: message, locale })
          .then((r) => {
            if (r && r.filters && Object.keys(r.filters).length) {
              intent = { filters: r.filters, explanation: r.explanation, unrecognized: r.unrecognized };
              setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, intent: intent ?? x.intent } : x)));
            }
          })
          .catch(() => {})
      : Promise.resolve();

    try {
      const res = await api.post<ChatResponse>("/api/ai/chat", {
        message,
        conversationId,
        locale,
        context: propertySlug || projectSlug ? { propertySlug, projectSlug } : undefined,
      });
      await nlPromise;
      setConversationId(res.conversationId);
      if (typeof window !== "undefined") window.localStorage.setItem(CONVERSATION_KEY, res.conversationId);
      setMessages((m) => [
        ...m,
        {
          id: `a-${msgSeq++}`,
          role: "assistant",
          content: res.reply,
          citations: res.citations,
          handoff: res.handoff,
          toolNames: res.toolCalls.map((tc) => tc.name),
          // V1 protocol field kept for compatibility (old clients / old turns).
          matches: res.matches?.length ? res.matches : undefined,
          attachments: res.attachments?.length ? res.attachments : undefined,
          searchCriteria: res.searchCriteria && Object.keys(res.searchCriteria).length ? res.searchCriteria : undefined,
          handoffDetail: res.handoffDetail ?? undefined,
          fallback: res.fallback,
        },
      ]);
    } catch (err) {
      await nlPromise;
      if (err instanceof ApiError && err.status === 429) {
        setRateLimited(err.message);
      } else {
        setMessages((m) => [
          ...m,
          {
            id: `e-${msgSeq++}`,
            role: "assistant",
            content: locale === "ar"
              ? "تعذّر الوصول إلى خدمة المساعد الآن. حاول مجدداً أو أرسل طلب استشارة منفصلاً؛ لم يتم تحويل هذه المحادثة تلقائياً."
              : "I couldn't reach the assistant service just now. Please try again, or submit a separate consultation request; this chat is not transferred automatically.",
            fallback: true,
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  const clearScope = () => {
    // Continue the same conversation, but unscoped: rewrite the URL without
    // the context params (replace — no history entry).
    navigate("/advisor", {}, { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-7xl md:px-6 lg:px-8 md:py-6">
      <div className="hidden md:block">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: t("nav.advisor", locale) }]} />
      </div>

      <div className="mt-0 grid gap-6 md:mt-4 lg:grid-cols-[1fr_300px]">
        {/* Chat column — mobile §35: full-screen chat. Height = viewport minus the
            app header (h-16 + 1px border = 65px) minus the global MobileTabBar
            (h-14 + 1px border + safe-area) — the composer is the last child of
            this column, so it sits directly above the tab bar, in-flow, no
            z-index fights, keyboard-friendly (100dvh). Desktop keeps a bounded
            full-height column with the side panel. */}
        <div className="flex h-[calc(100dvh-65px-57px-env(safe-area-inset-bottom))] flex-col overflow-hidden border-border/70 bg-card md:h-[calc(100dvh-10.5rem)] md:rounded-xl md:border">
          {/* Header */}
          <div className="border-b border-border/70 bg-sand/40 p-3.5 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground">
                <Sparkles className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-lg font-semibold">{t("advisor.title", locale)}</h1>
                <p className="truncate text-xs text-muted-foreground">
                  {scope ? t(`advisorV2.scoped.${scope.kind}`, locale) : t("advisor.subtitle", locale)}
                </p>
              </div>
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={startNewConversation}
                  className="shrink-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  aria-label={t("advisorV2.mobile.newChat", locale)}
                >
                  <MessageSquarePlus className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{t("advisorV2.mobile.newChat", locale)}</span>
                </Button>
              )}
              {/* V3-F §20 — "How this works" / Guardrails move off the permanent
                  layout on mobile: a 44px info button in the header opens the
                  same companion content in a sheet (desktop keeps the side panel). */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0 rounded-full lg:hidden"
                    aria-label={t("advisorV2.info.how", locale)}
                  >
                    <Info className="h-4.5 w-4.5" aria-hidden />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[85vw] max-w-sm overflow-y-auto p-0">
                  <SheetHeader className="border-b border-border/70 p-5">
                    <SheetTitle className="text-left">{t("advisorV2.info.how", locale)}</SheetTitle>
                    <SheetDescription className="text-left">{t("advisor.subtitle", locale)}</SheetDescription>
                  </SheetHeader>
                  <div className="space-y-4 p-5">
                    <AdvisorCompanion locale={locale} />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          {/* V2 §22 — scoped context card (?property= / ?project=) */}
          {scope && <ScopingCard kind={scope.kind} slug={scope.slug} locale={locale} onClear={clearScope} />}

          {/* Messages */}
          <div ref={listRef} className="scroll-elegant min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5 sm:p-5" role="log" aria-live="polite" aria-label={locale === "ar" ? "محادثة المستشار" : "Advisor conversation"}>
            {restored && (
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-border/70 bg-sand/40 px-3.5 py-1.5 text-[11px] text-muted-foreground">
                <History className="h-3.5 w-3.5 text-brand" aria-hidden />
                {locale === "ar" ? "تمت استعادة محادثتك السابقة" : "Picked up your previous conversation"}
                <button
                  type="button"
                  onClick={startNewConversation}
                  className="font-semibold text-brand-strong underline underline-offset-2 transition-ui hover:text-brand"
                >
                  {locale === "ar" ? "ابدأ من جديد" : "start fresh"}
                </button>
              </div>
            )}
            {messages.length === 0 && !restored && (
              <div className="py-6 text-center sm:py-8">
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  {scope
                    ? t("advisorV2.scoped.property", locale) + " — " + t("advisor.subtitle", locale)
                    : locale === "ar"
                      ? "صف ما تبحث عنه — سأحوّله إلى معايير بحث واضحة وقابلة للتعديل وأبحث في السجلات الحالية. راجع حالة البيانات والمصادر المتاحة لكل نتيجة."
                      : "Describe what you're looking for — I'll turn it into editable search criteria and search current catalog records. Review each result’s data status and available sources."}
                </p>
                <div className="mx-auto mt-4 grid max-w-2xl gap-2 text-left sm:grid-cols-2">
                  {(locale === "ar" ? SUGGESTIONS_AR : SUGGESTIONS).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-xs font-medium text-foreground/80 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md hover:text-brand-strong"
                    >
                      <span className="flex items-center gap-2.5">
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand/70 transition-colors group-hover:text-brand" aria-hidden />
                        {s}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={cn("flex gap-2.5 sm:gap-3", m.role === "user" && "justify-end")}>
                {m.role === "assistant" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground" aria-hidden>
                    <Sparkles className="h-4 w-4" />
                  </div>
                )}
                <div className={cn("min-w-0", m.role === "user" ? "max-w-[85%]" : "flex-1")}>
                  {/* Reply text bubble */}
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-brand text-primary-foreground"
                        : "border border-border/70 bg-sand/30 text-foreground"
                    )}
                  >
                    <div className="whitespace-pre-wrap">{m.content}</div>

                    {/* V2 §22.2 — structured criteria the assistant actually used */}
                    {m.role === "assistant" && m.searchCriteria && filtersToChips(m.searchCriteria, locale).length > 0 && (
                      <p className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                        <span className="font-semibold uppercase tracking-wide">{t("advisorV2.criteria.used", locale)}:</span>
                        {filtersToChips(m.searchCriteria, locale).map((c) => (
                          <span key={c.key} className="rounded-full border border-border/60 bg-card px-2 py-0.5">
                            {c.label}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>

                  {/* V2 §22.2 — editable interpreted-intent chips under the user bubble */}
                  {m.role === "user" && m.intent && (
                    <div className="mt-2 flex justify-end">
                      <div className="w-full sm:w-[92%]">
                        <IntentChips
                          filters={m.intent.filters}
                          explanation={m.intent.explanation}
                          unrecognized={m.intent.unrecognized}
                          locale={locale}
                          busy={busy}
                          onRefine={(q) => send(q)}
                        />
                      </div>
                    </div>
                  )}

                  {/* V2 §22.4 — structured attachments (cards / tables / timelines / scenarios) */}
                  {m.role === "assistant" && m.attachments && m.attachments.length > 0 && (
                    <AttachmentList attachments={m.attachments} locale={locale} />
                  )}

                  {/* Legacy V1 inventory matches — rendered only for messages without
                      the V2 attachment protocol (restored conversations). */}
                  {m.role === "assistant" && !m.attachments?.length && m.matches && m.matches.length > 0 && (
                    <AdvisorMatches matches={m.matches} />
                  )}

                  {/* V2 §22.6 — handoff confirmation card with transferred context */}
                  {m.role === "assistant" && m.handoff && m.handoffDetail && (
                    <HandoffConfirmationCard
                      detail={m.handoffDetail}
                      locale={locale}
                      onLeaveDetails={() =>
                        leadForm.open({
                          formId: `ai_handoff_${conversationId ?? "new"}`,
                          intent: "CONSULT",
                          title: "Continue with a human advisor",
                          description: "The AI advisor has prepared your context — leave your details to continue.",
                        })
                      }
                    />
                  )}

                  {/* Legacy handoff notice (V1 messages) */}
                  {m.role === "assistant" && m.handoff && !m.handoffDetail && (
                    <div className="mt-3 rounded-lg border border-brand/30 bg-brand-faint p-3">
                      <p className="text-xs text-muted-foreground">Handed off to our advisory team with your context.</p>
                      <Button
                        size="sm"
                        className="mt-2"
                        onClick={() =>
                          leadForm.open({
                            formId: `ai_handoff_${conversationId ?? "new"}`,
                            intent: "CONSULT",
                            title: "Continue with a human advisor",
                            description: "The AI advisor has prepared your context — leave your details to continue.",
                          })
                        }
                      >
                        Leave your details
                      </Button>
                    </div>
                  )}

                  {/* Citations */}
                  {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                    <div className="mt-2.5 rounded-xl border border-border/60 bg-sand/30 px-3.5 py-2.5">
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <BookOpen className="h-3 w-3" aria-hidden /> Sources
                      </p>
                      <ul className="space-y-1">
                        {m.citations.map((c, j) => (
                          <li key={j} className="text-xs">
                            {c.url ? (
                              <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-strong underline underline-offset-2">
                                {c.label} <ExternalLink className="h-3 w-3" aria-hidden />
                              </a>
                            ) : (
                              <span className="text-muted-foreground">{c.label}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Tool trace */}
                  {m.role === "assistant" && m.toolNames && m.toolNames.length > 0 && (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                      <Calculator className="h-3 w-3" aria-hidden />
                      {m.toolNames.map((tool, ti) => (
                        <span key={`${tool}-${ti}`} className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                          {tool}
                        </span>
                      ))}
                    </p>
                  )}

                  {m.role === "assistant" && m.fallback && (
                    <p className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                      <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                      {locale === "ar" ? "الخدمة متاحة بشكل محدود — تم حفظ المحادثة" : "Service degraded — conversation preserved"}
                    </p>
                  )}
                </div>
                {m.role === "user" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary" aria-hidden>
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex gap-2.5 sm:gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground" aria-hidden>
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-1.5 rounded-2xl border border-border/70 bg-sand/30 px-4 py-3" aria-live="polite">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                  <span className="ml-2 text-xs text-muted-foreground">{t("advisor.streaming", locale)}</span>
                </div>
              </div>
            )}

            {/* Contextual quick replies after the latest answer */}
            {!busy && !rateLimited && messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && (() => {
              const last = messages[messages.length - 1];
              const suggestions = last ? followUpSuggestions(last, locale) : [];
              if (!suggestions.length) return null;
              return (
                <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-11" aria-label={locale === "ar" ? "أسئلة متابعة مقترحة" : "Suggested follow-up questions"}>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{locale === "ar" ? "التالي:" : "Next:"}</span>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground/80 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md hover:text-brand-strong"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Rate limit notice */}
          {rateLimited && (
            <div className="border-t border-warning/40 bg-warning/10 p-3 text-center text-xs text-warning">
              {rateLimited}{" "}
              <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs text-warning underline">
                <Link to="/consultation">Book a consultation →</Link>
              </Button>
            </div>
          )}

          {/* Composer — last child of the full-height column: on mobile it sits
              directly above the global MobileTabBar (the tab bar owns the safe-area
              inset, so no double padding here); on desktop it closes the bounded
              chat card. §20: auto-resizing textarea + 44px send. */}
          <div className="border-t border-border/70 bg-sand/40 p-2.5 sm:p-4 md:pb-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-end gap-2"
            >
              <Textarea
                ref={taRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={t("advisor.placeholder", locale)}
                aria-label={locale === "ar" ? "أرسل رسالة إلى المستشار الذكي" : "Message the AI advisor"}
                rows={2}
                maxLength={1000}
                className="min-h-11 resize-none"
              />
              <Button type="submit" size="lg" className="h-11 w-11 shrink-0" disabled={busy || !input.trim()} aria-label={locale === "ar" ? "إرسال الرسالة" : "Send message"}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              </Button>
            </form>
            <p className="mt-1.5 text-center text-[10px] leading-relaxed text-muted-foreground sm:text-[11px]">
              {t("advisor.disclosure", locale)}
            </p>
          </div>
        </div>

        {/* Side panel — desktop companion (mobile: same content moves into the
            header info sheet; it never consumes chat width below lg) */}
        <aside className="hidden space-y-4 lg:block">
          <AdvisorCompanion locale={locale} />
        </aside>
      </div>

      <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />
    </div>
  );
}

/* V3-F §20 — companion content (How this works · Guardrails · Prefer a human)
 * shared by the desktop side panel and the mobile header info sheet. */
function AdvisorCompanion({ locale }: { locale: Locale }) {
  return (
    <>
      <div className="rounded-xl border border-border/70 bg-card p-5">
        <p className="kicker mb-3">{t("advisorV2.info.how", locale)}</p>
        <ol className="space-y-3 text-sm text-muted-foreground">
          <li className="flex gap-2.5">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">1</span>
            {t("advisorV2.info.step1", locale)}
          </li>
          <li className="flex gap-2.5">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">2</span>
            {t("advisorV2.info.step2", locale)}
          </li>
          <li className="flex gap-2.5">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">3</span>
            {t("advisorV2.info.step3", locale)}
          </li>
          <li className="flex gap-2.5">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">4</span>
            {t("advisorV2.info.step4", locale)}
          </li>
        </ol>
      </div>

      <div className="rounded-xl border border-border/70 bg-card p-5">
        <p className="kicker mb-2">{t("advisorV2.info.guardrails", locale)}</p>
        <ul className="space-y-2 text-xs text-muted-foreground">
          <li>· {t("advisorV2.info.guard1", locale)}</li>
          <li>· {t("advisorV2.info.guard2", locale)}</li>
          <li>· {t("advisorV2.info.guard3", locale)}</li>
          <li>· {t("advisorV2.info.guard4", locale)}</li>
          <li>· {t("advisorV2.info.guard5", locale)}</li>
        </ul>
      </div>

      <div className="rounded-xl border border-brand/30 bg-brand-faint p-5">
        <p className="font-display font-semibold">{t("advisorV2.info.human", locale)}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{t("advisorV2.info.humanSub", locale)}</p>
        <div className="mt-3 space-y-2">
          <Button asChild className="h-11 w-full sm:h-9" size="sm">
            <Link to="/consultation"><Phone className="h-4 w-4" aria-hidden /> {t("advisorV2.handoff.book", locale)}</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 w-full sm:h-9" size="sm">
            <Link to="/agents">{t("advisorV2.info.browseAdvisors", locale)}</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
