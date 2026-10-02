import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { catalogReadFilter } from "@/server/domain/resource-policy";
import { assignableAdvisorWhere } from "@/server/domain/agent-directory";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const actor = await requirePermission("property:read");
  const scope = catalogReadFilter(actor);
  const [projects, developers, agents, amenities] = await Promise.all([
    db.project.findMany({ where: { deletedAt: null, AND: [scope] }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, communityId: true, developerId: true, publicationStatus: true, community: { select: { publicationStatus: true } } } }),
    db.developer.findMany({ where: scope, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }),
    db.agent.findMany({ where: assignableAdvisorWhere(actor), orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, slug: true, jobTitle: true, department: true, photoMediaId: true, photoUrl: true } }),
    db.amenity.findMany({ orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, category: true } }),
  ]);
  return NextResponse.json({ projects, developers, agents, amenities });
});
