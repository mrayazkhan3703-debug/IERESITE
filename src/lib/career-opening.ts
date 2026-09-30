import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
export const careerDraftSchema = z.object({
  locale: z.enum(["en", "ar"]), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  title: z.string().trim().min(1).max(180), department: z.string().trim().min(1).max(100), location: z.string().trim().min(1).max(120),
  employmentType: z.string().trim().min(1).max(80), workplaceType: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(1000), description: z.string().trim().min(1).max(12000),
  responsibilities: z.string().trim().max(12000).default(""), requirements: z.string().trim().max(12000).default(""),
  benefits: optionalText(12000), salaryDisclosure: optionalText(180),
  applicationMethod: z.enum(["CONTACT", "EMAIL", "URL"]).default("CONTACT"), applicationTarget: optionalText(2000),
  opensAt: z.string().datetime().nullable().optional(), closesAt: z.string().datetime().nullable().optional(),
  seoTitle: optionalText(180), seoDescription: optionalText(300),
});
export type CareerDraft = z.input<typeof careerDraftSchema>;
export type CareerApplication = { title: string; applicationMethod: string; applicationTarget: string | null };

export function validCareerApplication(value: Pick<CareerApplication, "applicationMethod" | "applicationTarget">) {
  if (value.applicationMethod === "CONTACT") return value.applicationTarget === null;
  if (value.applicationMethod === "EMAIL") return z.string().email().safeParse(value.applicationTarget).success;
  if (value.applicationMethod !== "URL" || !value.applicationTarget) return false;
  try { const url = new URL(value.applicationTarget); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}

export function careerApplicationHref(value: CareerApplication, locale: "en" | "ar" = "en") {
  const contactHref = `${locale === "ar" ? "/ar" : ""}/contact?topic=${encodeURIComponent(`Application: ${value.title}`)}`;
  if (!validCareerApplication(value)) return contactHref;
  if (value.applicationMethod === "EMAIL") return `mailto:${value.applicationTarget}?subject=${encodeURIComponent(`Application: ${value.title}`)}`;
  if (value.applicationMethod === "URL") return value.applicationTarget!;
  return contactHref;
}
