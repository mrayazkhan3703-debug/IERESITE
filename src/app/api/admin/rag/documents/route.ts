import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { createRagDocument } from "@/server/domain/rag-admin-command";

const schema = z.object({
  sourceId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().min(1).max(180),
  locale: z.enum(["en", "ar"]),
  content: z.string().min(41).max(50_000),
  changeNote: z.string().max(300).optional(),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await createRagDocument(actor, input, clientIp(req)), { status: 201 });
});
