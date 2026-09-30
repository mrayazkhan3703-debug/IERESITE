import type { Prisma } from "@prisma/client";

export function publicCareerWhere(locale?: "en" | "ar", now = new Date()): Prisma.CareerOpeningWhereInput {
  return {
    ...(locale ? { locale } : {}), status: "PUBLISHED", publishedAt: { not: null, lte: now },
    AND: [
      { OR: [{ opensAt: null }, { opensAt: { lte: now } }] },
      { OR: [{ closesAt: null }, { closesAt: { gt: now } }] },
    ],
  };
}

export const PUBLIC_CAREER_SELECT = {
  slug: true, locale: true, title: true, department: true, location: true, employmentType: true, workplaceType: true,
  summary: true, description: true, responsibilities: true, requirements: true, benefits: true, salaryDisclosure: true,
  applicationMethod: true, applicationTarget: true, opensAt: true, closesAt: true, publishedAt: true, seoTitle: true, seoDescription: true,
} satisfies Prisma.CareerOpeningSelect;
