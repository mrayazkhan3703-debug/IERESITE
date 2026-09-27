import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession } from "@/server/auth";
import { apiHandler } from "@/server/api-handler";
import { getConfig } from "@/lib/config";
import { cookies } from "next/headers";

export const POST = apiHandler(async () => {
  const config = getConfig();
  const jar = await cookies();
  const token = jar.get(config.AUTH_COOKIE_NAME)?.value;
  await destroySession(token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
