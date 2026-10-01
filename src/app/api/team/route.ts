import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { listTeam } from "@/server/domain/read-models";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async () => NextResponse.json({ agents: await listTeam() }));
