import type { Locale } from "./i18n";

const en = {
  consent: {
    region: "Cookie consent", title: "Your privacy choices",
    description: "We use essential cookies to run the platform. With your consent we also measure usage (analytics), personalize recommendations, and share limited context when you submit an enquiry.",
    privacy: "Privacy notice", manage: "Manage anytime", purposes: "Consent purposes", essential: "Essential (always on)",
    analytics: "Analytics & performance", personalization: "Personalized recommendations", marketing: "Marketing communications",
    customize: "Customize", failed: "Your choices could not be saved. Non-essential analytics remain disabled; please try again.",
    saving: "Saving…", accept: "Accept all", reject: "Essential only", save: "Save choices",
  },
  faq: {
    home: "Home", name: "FAQ", kicker: "Questions", title: "Frequently asked questions",
    description: "Straight answers — and where a rule can change, we say so.",
    empty: "No FAQs are available in this language yet.", question: "Still have a question?",
    help: "Ask the AI Advisor or request a consultation with a human specialist.",
    advisor: "Ask the AI Advisor", consultation: "Request a consultation",
    GENERAL: "General", BUYING: "Buying", SELLING: "Selling", OFF_PLAN: "Off-plan", INVESTMENT: "Investment",
    INTERNATIONAL: "International buyers", AI_ADVISOR: "AI Advisor", PRIVACY: "Privacy & data", other: "Other questions",
  },
  consultation: {
    home: "Home", name: "Book a Consultation", kicker: "Advisory", title: "Request a consultation",
    description: "Request 30 minutes with a specialist. Your preferred time is not checked against a live calendar and is not confirmed until our team contacts you.",
    metaDescription: "Request a preferred time with a property specialist. Your date and time are not confirmed until the team contacts you.",
    service: "Property consultation", select: "Choose a preferred date and time", date: "Select date", time: "Select time slot",
    timeNote: "30 minutes · Gulf Standard Time (UTC+4) · preferred times only, not live availability",
    format: "Meeting format", VIDEO: "Video call", OFFICE: "In office", PHONE: "Phone", WHATSAPP: "WhatsApp",
    details: "Your details", fullName: "Full name *", phone: "Phone *", email: "Email", topic: "What would you like to discuss?",
    topicHint: "Budget, communities of interest, timeline…", consent: "Consent", contact: "I agree to be contacted about this request. *",
    marketing: "Send me relevant investment opportunities and market updates.", submit: "Send consultation request",
    missingTime: "Please pick a preferred date and time.", missingConsent: "Please agree to be contacted about your request.",
    failed: "Your request could not be recorded. Please try again or contact our team.",
    confirmed: "Appointment confirmed", received: "Consultation request received", existing: "Existing request found",
    reference: "Request reference", confirmedNote: "Your appointment is confirmed.",
    requestNote: "This is a preferred time request, not a confirmed appointment. Our team must contact you to confirm availability and details.",
    statusNote: "Current request status", statusHelp: "Contact our team if you need help.", preferred: "Preferred time", back: "Back to homepage",
  },
} as const;

type CopyShape<T> = { [K in keyof T]: T[K] extends string ? string : CopyShape<T[K]> };
const ar = {
  consent: {
    region: "الموافقة على ملفات تعريف الارتباط", title: "خيارات الخصوصية",
    description: "نستخدم ملفات تعريف الارتباط الضرورية لتشغيل المنصة. وبموافقتك، نقيس الاستخدام ونخصص التوصيات ونشارك سياقاً محدوداً عند إرسال استفسار.",
    privacy: "إشعار الخصوصية", manage: "إدارة الخيارات في أي وقت", purposes: "أغراض الموافقة", essential: "ضرورية (مفعلة دائماً)",
    analytics: "التحليلات والأداء", personalization: "توصيات مخصصة", marketing: "التواصل التسويقي",
    customize: "تخصيص", failed: "تعذر حفظ خياراتك. تظل التحليلات غير الضرورية معطلة؛ يرجى المحاولة مجدداً.",
    saving: "جارٍ الحفظ…", accept: "قبول الكل", reject: "الضرورية فقط", save: "حفظ الخيارات",
  },
  faq: {
    home: "الرئيسية", name: "الأسئلة الشائعة", kicker: "أسئلة", title: "الأسئلة الشائعة",
    description: "إجابات واضحة، مع التنبيه إلى القواعد التي قد تتغير.", empty: "لا تتوفر أسئلة شائعة بهذه اللغة بعد.",
    question: "هل لديك سؤال آخر؟", help: "اسأل المستشار الذكي أو اطلب استشارة مع أحد المختصين.",
    advisor: "اسأل المستشار الذكي", consultation: "اطلب استشارة",
    GENERAL: "عام", BUYING: "الشراء", SELLING: "البيع", OFF_PLAN: "على المخطط", INVESTMENT: "الاستثمار",
    INTERNATIONAL: "المشترون الدوليون", AI_ADVISOR: "المستشار الذكي", PRIVACY: "الخصوصية والبيانات", other: "أسئلة أخرى",
  },
  consultation: {
    home: "الرئيسية", name: "حجز استشارة", kicker: "استشارات", title: "اطلب استشارة",
    description: "اطلب استشارة لمدة 30 دقيقة مع مختص. الوقت المفضل ليس مرتبطاً بتقويم مباشر، ولا يُؤكد الموعد حتى يتواصل معك فريقنا.",
    metaDescription: "اطلب وقتاً مفضلاً للتحدث مع مختص عقاري. لا يُؤكد التاريخ والوقت حتى يتواصل معك الفريق.",
    service: "استشارة عقارية", select: "اختر التاريخ والوقت المفضلين", date: "اختر التاريخ", time: "اختر الوقت",
    timeNote: "30 دقيقة · توقيت الخليج (UTC+4) · أوقات مفضلة فقط، وليست مواعيد متاحة مؤكدة",
    format: "طريقة الاجتماع", VIDEO: "مكالمة فيديو", OFFICE: "في المكتب", PHONE: "الهاتف", WHATSAPP: "واتساب",
    details: "بياناتك", fullName: "الاسم الكامل *", phone: "الهاتف *", email: "البريد الإلكتروني", topic: "ما الذي ترغب في مناقشته؟",
    topicHint: "الميزانية، المناطق التي تهمك، الإطار الزمني…", consent: "الموافقة", contact: "أوافق على التواصل معي بشأن هذا الطلب. *",
    marketing: "أرسلوا لي فرصاً استثمارية وتحديثات السوق ذات الصلة.", submit: "إرسال طلب الاستشارة",
    missingTime: "يرجى اختيار التاريخ والوقت المفضلين.", missingConsent: "يرجى الموافقة على التواصل معك بشأن طلبك.",
    failed: "تعذر تسجيل طلبك. يرجى المحاولة مجدداً أو التواصل مع فريقنا.",
    confirmed: "تم تأكيد الموعد", received: "تم استلام طلب الاستشارة", existing: "يوجد طلب سابق",
    reference: "مرجع الطلب", confirmedNote: "تم تأكيد موعدك.",
    requestNote: "هذا طلب لوقت مفضل، وليس موعداً مؤكداً. يجب أن يتواصل معك فريقنا لتأكيد التوفر والتفاصيل.",
    statusNote: "الحالة الحالية للطلب", statusHelp: "تواصل مع فريقنا إذا كنت بحاجة إلى مساعدة.", preferred: "الوقت المفضل", back: "العودة إلى الرئيسية",
  },
} satisfies CopyShape<typeof en>;

export const journeyDictionaries = { en, ar };
export const journeyCopy = (locale: Locale) => journeyDictionaries[locale];

const faqGroups = ["GENERAL", "BUYING", "SELLING", "OFF_PLAN", "INVESTMENT", "INTERNATIONAL", "AI_ADVISOR", "PRIVACY"] as const;
export function faqGroupLabel(group: string, locale: Locale): string {
  const copy = journeyCopy(locale).faq;
  const known = faqGroups.find((key) => key === group);
  return known ? copy[known] : copy.other;
}
