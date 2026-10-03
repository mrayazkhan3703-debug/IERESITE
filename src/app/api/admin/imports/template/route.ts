import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { feedRecordSchema } from "@/server/ingestion/feed-record";

export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req) => {
  await requirePermission("import:read");
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";
  const content = format === "csv" ? `${Object.keys(feedRecordSchema.shape).join(",")}\r\n` : "[]\n";
  return new NextResponse(content, { headers: {
    "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json",
    "Content-Disposition": `attachment; filename="iere-inventory-template.${format}"`,
    "Cache-Control": "private, no-store",
  } });
});
