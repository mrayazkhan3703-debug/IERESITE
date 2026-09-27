import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, requireUser } from "@/server/auth";
import { db, parseJson } from "@/lib/db";

const schema = z.object({
  locale: z.enum(["en", "ar"]).optional(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()).optional(),
  marketingOptIn: z.boolean().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => JSON.stringify(value.preferences ?? {}).length <= 10_000, "Preferences are too large");

export const GET = apiHandler(async () => {
  const user = await requireUser();
  const profile = await db.userProfile.findUnique({ where: { userId: user.id } });
  return NextResponse.json({
    locale: profile?.locale ?? "en",
    currency: profile?.currency ?? "AED",
    marketingOptIn: profile?.marketingOptIn ?? false,
    preferences: parseJson<Record<string, unknown>>(profile?.preferencesJson, {}),
  });
});

export const PATCH = apiHandler(async (req) => {
  const user = await requireUser();
  const input = schema.parse(await jsonBody(req));
  const profile = await db.$transaction(async (tx) => {
    const updated = await tx.userProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        locale: input.locale ?? "en",
        currency: input.currency ?? "AED",
        marketingOptIn: input.marketingOptIn ?? false,
        preferencesJson: input.preferences ? JSON.stringify(input.preferences) : null,
      },
      update: {
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.marketingOptIn !== undefined ? { marketingOptIn: input.marketingOptIn } : {}),
        ...(input.preferences ? { preferencesJson: JSON.stringify(input.preferences) } : {}),
      },
    });
    await audit({ actorType: "USER", actorId: user.id, action: "user.preferences_updated", resourceType: "user", resourceId: user.id, after: input }, tx);
    return updated;
  });
  return NextResponse.json({
    locale: profile.locale,
    currency: profile.currency,
    marketingOptIn: profile.marketingOptIn,
    preferences: parseJson<Record<string, unknown>>(profile.preferencesJson, {}),
  });
});
