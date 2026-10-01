import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, HttpError, requirePermission } from "@/server/auth";
import { ragDiagnostics } from "@/server/rag/diagnostics";
import { rebuildDocumentIndex } from "@/server/rag/pipeline";
import { clientIp } from "@/server/rate-limit";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req) => {
  await requirePermission("content:read");
  const cursor = z.string().max(180).optional().parse(new URL(req.url).searchParams.get("cursor") ?? undefined);
  return NextResponse.json(await ragDiagnostics(cursor), { headers: { "Cache-Control": "private, no-store" } });
});
export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  if (!actor.roles.some((role) => ["OWNER", "ADMIN"].includes(role))) throw new HttpError(403, "Only owners or admins can rebuild reviewed knowledge.", "FORBIDDEN");
  const input = z.object({ documents: z.array(z.object({ id: z.string().min(1).max(180), version: z.number().int().positive() }).strict()).min(1).max(10) }).strict().parse(await jsonBody(req));
  if (new Set(input.documents.map((doc) => doc.id)).size !== input.documents.length) throw new HttpError(400, "Choose each document once.", "VALIDATION");
  const signal = AbortSignal.timeout(15000);
  const results: { id: string; indexed: boolean; reason: string | null }[] = [];
  for (const doc of input.documents) {
    if (signal.aborted) { results.push({ id: doc.id, indexed: false, reason: "BATCH_TIME_LIMIT" }); continue; }
    try { const indexed = await rebuildDocumentIndex(doc.id, doc.version, signal); results.push({ id: doc.id, indexed, reason: indexed ? null : "REVISION_CHANGED_OR_NOT_APPROVED" }); }
    catch { results.push({ id: doc.id, indexed: false, reason: "INDEX_FAILED" }); }
  }
  await audit({ actorId: actor.id, action: "rag.index.rebuild", resourceType: "RAG_INDEX", resourceId: "bounded-batch", after: { results }, ip: clientIp(req) });
  return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
}, { rateLimit: { key: "rag-bounded-index", limit: 10, windowMs: 3600000 } });
