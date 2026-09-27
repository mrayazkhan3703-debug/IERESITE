import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { createSeoMetadataCommand, updateSeoMetadataCommand } from "@/server/domain/seo-metadata-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  await requirePermission("seo:read");
  const query = new URL(req.url).searchParams.get("q")?.trim();
  const entries = await db.seoMetadata.findMany({
    where: query ? { OR: [{ routeKey: { contains: query, mode: "insensitive" } }, { title: { contains: query, mode: "insensitive" } }] } : {},
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { _count: { select: { revisions: true } } },
  });
  return NextResponse.json({ entries: entries.map(({ _count, ...entry }) => ({
    ...entry,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    revisionCount: _count.revisions,
  })) });
});

const inputSchema = z.object({
  routeKey: z.string().trim().min(1).max(300),
  title: z.string().max(300).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  canonicalPath: z.string().max(500).nullable().optional(),
  noindex: z.boolean(),
  ogImageMediaId: z.string().min(1).nullable().optional(),
  priority: z.number().min(0).max(1).nullable().optional(),
  changefreq: z.enum(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]).nullable().optional(),
});

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("seo:update");
  const input = inputSchema.strict().parse(await jsonBody<z.infer<typeof inputSchema>>(req));
  return NextResponse.json(await createSeoMetadataCommand(actor, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("seo:update");
  const schema = inputSchema.extend({ seoMetadataId: z.string().min(1), expectedUpdatedAt: z.string().datetime(), changeNote: z.string().max(300).nullable().optional() }).strict();
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await updateSeoMetadataCommand(actor, input, clientIp(req)));
});
