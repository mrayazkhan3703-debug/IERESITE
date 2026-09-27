import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requireUser, audit } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";

const schema = z.object({ note: z.string().max(500).optional() });

/** Deletion request (DSR): logged for handling with audit trail; not auto-executed */
export const POST = apiHandler(async (req) => {
  const user = await requireUser();
  const body = await jsonBody<z.infer<typeof schema>>(req).catch(() => ({ note: undefined }));
  const input = schema.parse(body);

  const contact = await db.contact.findFirst({ where: { email: user.email } });

  const existing = await db.dataSubjectRequest.findFirst({
    where: { userId: user.id, requestType: "DELETE", status: { in: ["RECEIVED", "VERIFYING", "IN_PROGRESS"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return NextResponse.json({ requestId: existing.id, status: existing.status, duplicate: true });

  const dsr = await db.$transaction(async (tx) => {
    const created = await tx.dataSubjectRequest.create({
      data: {
        requestType: "DELETE",
        status: "RECEIVED",
        subjectEmail: user.email,
        userId: user.id,
        contactId: contact?.id ?? null,
        requestNote: input.note ?? null,
      },
    });
    await audit({
      actorType: "USER",
      actorId: user.id,
      action: "privacy.delete_requested",
      resourceType: "user",
      resourceId: user.id,
      after: { requestId: created.id },
      ip: clientIp(req),
    }, tx);
    return created;
  });

  return NextResponse.json({ requestId: dsr.id, status: dsr.status }, { status: 201 });
});
