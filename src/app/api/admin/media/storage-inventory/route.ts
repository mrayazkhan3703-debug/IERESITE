import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { storageReferenceInventory } from "@/server/media/storage-inventory";

export const dynamic = "force-dynamic";
export const GET = apiHandler(async () => {
  const owner = await requirePermission("media:read");
  return NextResponse.json(await storageReferenceInventory(owner), { headers: { "Cache-Control": "private, no-store" } });
}, { rateLimit: { limit: 6, windowMs: 60000, key: "owner-storage-inventory" } });
