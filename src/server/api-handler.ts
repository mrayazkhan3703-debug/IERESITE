import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError, errorResponse } from "@/server/auth";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { getConfig } from "@/lib/config";

/** Wrap an API handler with error mapping, rate limiting, and JSON body parsing */
export function apiHandler<TCtx = unknown>(
  handler: (req: Request, ctx: TCtx) => Promise<Response>,
  opts?: { rateLimit?: { limit: number; windowMs: number; key?: string } }
) {
  return async (req: Request, ctx: TCtx): Promise<Response> => {
    try {
      if (opts?.rateLimit) {
        const config = getConfig();
        const key = `${opts.rateLimit.key ?? "general"}:${clientIp(req)}`;
        const rl = rateLimit(key, opts.rateLimit.limit, opts.rateLimit.windowMs);
        if (!rl.ok) {
          return NextResponse.json(
            { error: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
          );
        }
      }
      // CSRF defense: every mutation, including multipart uploads, must carry the
      // custom header that cross-origin HTML forms cannot set.
      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        const h = req.headers.get("x-requested-with");
        if (h !== "fetch") {
          return NextResponse.json({ error: "Missing anti-CSRF header", code: "CSRF" }, { status: 403 });
        }
      }
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(
          {
            error: err.issues[0]?.message ?? "Validation failed",
            code: "VALIDATION",
            details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
          { status: 400 }
        );
      }
      return errorResponse(err);
    }
  };
}

export async function jsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body", "BAD_JSON");
  }
}

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
