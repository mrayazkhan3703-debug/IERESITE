import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonBody, apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { DEFAULT_SITE_SETTINGS, parseSiteSettings } from "@/lib/site-settings";
import { listSiteSettingRevisions, readSiteSettings, saveSiteSettings } from "@/server/domain/site-settings-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requirePermission("site-settings:update");
  const [current, revisions] = await Promise.all([readSiteSettings(), listSiteSettingRevisions()]);
  return NextResponse.json({ ...current, revisions: revisions.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })) });
});

const saveSchema = z.object({
  expectedVersion: z.number().int().min(0),
  settings: z.unknown().refine((value) => parseSiteSettings(value) !== null),
  changeNote: z.string().trim().max(300).optional(),
}).strict();

export const PUT = apiHandler(async (req) => {
  const actor = await requirePermission("site-settings:update");
  const input = saveSchema.parse(await jsonBody<z.infer<typeof saveSchema>>(req));
  const result = await saveSiteSettings(actor, {
    expectedVersion: input.expectedVersion,
    settings: parseSiteSettings(input.settings) ?? DEFAULT_SITE_SETTINGS,
    changeNote: input.changeNote,
  }, clientIp(req));
  return NextResponse.json(result);
});
