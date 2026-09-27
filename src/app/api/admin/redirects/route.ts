import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { createRedirectCommand, updateRedirectCommand } from "@/server/domain/redirect-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  await requirePermission("seo:read");
  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim();
  const state = url.searchParams.get("state");
  const redirects = await db.redirect.findMany({
    where: {
      ...(state === "active" ? { isActive: true } : state === "disabled" ? { isActive: false } : {}),
      ...(query ? { OR: [{ fromPath: { contains: query, mode: "insensitive" as const } }, { toPath: { contains: query, mode: "insensitive" as const } }, { note: { contains: query, mode: "insensitive" as const } }] } : {}),
    },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ redirects: redirects.map((redirect) => ({ ...redirect, createdAt: redirect.createdAt.toISOString(), updatedAt: redirect.updatedAt.toISOString() })) });
});

const inputSchema = z.object({
  fromPath: z.string().min(1).max(500),
  toPath: z.string().min(1).max(500),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(303), z.literal(307), z.literal(308)]),
  note: z.string().max(500).nullable().optional(),
});

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("seo:update");
  const input = inputSchema.strict().parse(await jsonBody<z.infer<typeof inputSchema>>(req));
  return NextResponse.json(await createRedirectCommand(actor, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("seo:update");
  const schema = inputSchema.extend({ redirectId: z.string().min(1), expectedUpdatedAt: z.string().datetime(), isActive: z.boolean() }).strict();
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await updateRedirectCommand(actor, input, clientIp(req)));
});
