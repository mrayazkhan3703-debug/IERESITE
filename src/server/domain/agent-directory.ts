import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/server/auth";
import { agentProfileScope } from "./resource-policy";
import { PUBLIC_AGENT_WHERE, PUBLIC_PROFILE_WHERE } from "./visibility";

export const PEOPLE_FILTERS = ["all", "advisors", "team", "leadership", "sales", "marketing", "hr", "admin", "inactive"] as const;
export type PeopleFilter = typeof PEOPLE_FILTERS[number];

export function peopleFilter(value: string | null): PeopleFilter {
  return PEOPLE_FILTERS.includes(value as PeopleFilter) ? value as PeopleFilter : "all";
}

export function peopleAdminWhere(actor: SessionUser, q: string, filter: PeopleFilter): Prisma.AgentWhereInput {
  const category: Prisma.AgentWhereInput = filter === "advisors" ? PUBLIC_AGENT_WHERE
    : filter === "team" ? { NOT: PUBLIC_AGENT_WHERE }
    : filter === "inactive" ? { active: false }
    : filter === "all" ? {} : { department: filter };
  return { AND: [agentProfileScope(actor), category, q ? { OR: ["name", "slug", "jobTitle", "email", "department"].map(field => ({ [field]: { contains: q.slice(0, 200), mode: "insensitive" } })) } : {}] };
}

/** Same predicate in options and commands: browser-submitted IDs are never trusted. */
export function assignableAdvisorWhere(actor: SessionUser, id?: string): Prisma.AgentWhereInput {
  return { AND: [agentProfileScope(actor), PUBLIC_AGENT_WHERE, id ? { id } : {}] };
}

export function isPublicPersonWhere(id: string): Prisma.AgentWhereInput {
  return { AND: [{ id }, PUBLIC_PROFILE_WHERE] };
}
