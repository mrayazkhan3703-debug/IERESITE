import { NextResponse } from "next/server";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requireUser, audit } from "@/server/auth";
import { db } from "@/lib/db";
import { holdingInputSchema, holdingInputToData, resolveEntityRefs } from "../compute";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Update a holding — ownership enforced by the userId filter in the update where. */
export const PATCH = apiHandler(
  async (req, ctx: Ctx) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const raw = await jsonBody<Record<string, unknown>>(req);
    const input = holdingInputSchema.parse(raw);
    const refs = await resolveEntityRefs(input);

    const existing = await db.portfolioHolding.findFirst({ where: { id, userId: user.id }, select: { id: true, label: true } });
    if (!existing) return NextResponse.json({ error: "Holding not found", code: "NOT_FOUND" }, { status: 404 });

    await db.portfolioHolding.update({
      where: { id },
      data: { ...holdingInputToData(input), ...refs },
    });
    await audit({
      actorType: "USER",
      actorId: user.id,
      action: "portfolio.holding.updated",
      resourceType: "PortfolioHolding",
      resourceId: id,
      before: { label: existing.label },
    });
    return NextResponse.json({ ok: true });
  },
  { rateLimit: { limit: 60, windowMs: 3600_000, key: "portfolio" } }
);

/** Delete a holding (its documents cascade). */
export const DELETE = apiHandler(
  async (_req, ctx: Ctx) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const existing = await db.portfolioHolding.findFirst({ where: { id, userId: user.id }, select: { id: true, label: true } });
    if (!existing) return NextResponse.json({ error: "Holding not found", code: "NOT_FOUND" }, { status: 404 });

    await db.portfolioHolding.delete({ where: { id } });
    await audit({
      actorType: "USER",
      actorId: user.id,
      action: "portfolio.holding.deleted",
      resourceType: "PortfolioHolding",
      resourceId: id,
      before: { label: existing.label },
    });
    return NextResponse.json({ ok: true });
  },
  { rateLimit: { limit: 60, windowMs: 3600_000, key: "portfolio" } }
);
