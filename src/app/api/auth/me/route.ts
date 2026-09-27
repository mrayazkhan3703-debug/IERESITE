import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const user = await currentUser();
  return NextResponse.json({ user });
});
