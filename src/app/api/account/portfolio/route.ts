import { NextResponse } from "next/server";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requireUser } from "@/server/auth";
import { db } from "@/lib/db";
import { audit } from "@/server/auth";
import { loadPortfolio, holdingInputSchema, holdingInputToData, resolveEntityRefs } from "./compute";

export const dynamic = "force-dynamic";

/**
 * Investor Command Center — portfolio (V2 §25, U15).
 * GET returns the user's holdings with deterministic engine math (yield,
 * cash flow, payment schedule, construction). All queries are strictly
 * session-scoped: a user can only ever read their own rows.
 */
export const GET = apiHandler(async () => {
  const user = await requireUser();
  const portfolio = await loadPortfolio(user.id);
  return NextResponse.json(portfolio);
});

/** Create a holding (manual entry or favorite import). */
export const POST = apiHandler(
  async (req) => {
    const user = await requireUser();
    const raw = await jsonBody<Record<string, unknown>>(req);
    const input = holdingInputSchema.parse(raw);
    const refs = await resolveEntityRefs(input);

    const count = await db.portfolioHolding.count({ where: { userId: user.id } });
    if (count >= 100) {
      return NextResponse.json({ error: "Portfolio limit reached (100 holdings).", code: "LIMIT" }, { status: 400 });
    }

    const holding = await db.portfolioHolding.create({
      data: { userId: user.id, ...holdingInputToData(input), ...refs },
    });
    await audit({
      actorType: "USER",
      actorId: user.id,
      action: "portfolio.holding.created",
      resourceType: "PortfolioHolding",
      resourceId: holding.id,
    });
    return NextResponse.json({ id: holding.id }, { status: 201 });
  },
  { rateLimit: { limit: 30, windowMs: 3600_000, key: "portfolio" } }
);
