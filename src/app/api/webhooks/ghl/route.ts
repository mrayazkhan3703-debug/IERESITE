import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { GHL_WEBHOOK_MAX_BODY_BYTES, GhlWebhookConflictError, GhlWebhookEnvelopeError, parseGhlWebhookReceipt, PrismaGhlWebhookStore, receiveGhlWebhook, verifyGhlWebhookSignature } from "@/server/crm/ghl-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class BodyTooLargeError extends Error {}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > GHL_WEBHOOK_MAX_BODY_BYTES) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > GHL_WEBHOOK_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const config = getConfig();
  if (!config.GHL_WEBHOOKS_ENABLED || !config.GHL_LOCATION_ID?.trim()) {
    return json({ error: "GHL webhooks are not enabled for a configured location." }, 503);
  }
  const mediaType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") return json({ error: "Expected application/json." }, 415);

  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedBody(request);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json({ error: "Webhook body exceeds the allowed size." }, 413);
    return json({ error: "Webhook body could not be read." }, 400);
  }

  // HighLevel deprecated the legacy RSA header on 2026-09-01. Never accept an
  // invalid X-GHL-Signature by falling back to X-WH-Signature.
  if (!verifyGhlWebhookSignature(rawBody, request.headers.get("x-ghl-signature"))) {
    return json({ error: "Invalid GHL webhook signature." }, 401);
  }

  try {
    const receipt = parseGhlWebhookReceipt(rawBody);
    const result = await receiveGhlWebhook(new PrismaGhlWebhookStore(), receipt, config.GHL_LOCATION_ID.trim());
    return json({ accepted: true, duplicate: result.duplicate }, 200);
  } catch (error) {
    if (error instanceof GhlWebhookEnvelopeError) return json({ error: error.message }, 400);
    if (error instanceof GhlWebhookConflictError) return json({ error: "Conflicting signed event ID." }, 409);
    // A non-2xx response lets GHL retry if durable receipt storage is unavailable.
    return json({ error: "GHL webhook receipt could not be committed." }, 503);
  }
}
