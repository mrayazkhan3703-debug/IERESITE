import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession, type SessionUser } from "@/server/auth";
import { createAgentProfileCommand, updateAgentCommand } from "@/server/domain/agent-command";

const prefix = `agent-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const ids = { organization: `${prefix}-org`, otherOrganization: `${prefix}-other-org`, user: `${prefix}-user`, candidateUser: `${prefix}-candidate`, outsideCandidate: `${prefix}-outside-candidate`, apiCandidate: `${prefix}-api-candidate`, unverifiedCandidate: `${prefix}-unverified-candidate`, contentEditor: `${prefix}-content-editor`, agent: `${prefix}-agent`, createdAgent: `${prefix}-created-agent`, apiAgent: `${prefix}-api-agent`, publicMedia: `${prefix}-public-media`, privateMedia: `${prefix}-private-media` };
const beforeSlug = `${prefix}-old`;
const afterSlug = `${prefix}-new`;
let createdAgentId: string | null = null;
let apiAgentId: string | null = null;
let managerCookie = "";
let editorCookie = "";
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: ids.user, email: "agent-command@example.invalid", name: "Agent command integration",
  organizationId: ids.organization, roles: ["MANAGER"], permissions: ["agent:update", "agent:create"], mfaVerified: true,
};

async function cleanup() {
  const agentIds = [ids.agent, createdAgentId ?? ids.createdAgent, apiAgentId ?? ids.apiAgent];
  await db.auditLog.deleteMany({ where: { resourceId: { in: agentIds } } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: { in: agentIds } } });
  await db.redirect.deleteMany({ where: { fromPath: `/agents/${beforeSlug}` } });
  await db.agent.deleteMany({ where: { id: { in: agentIds } } });
  await db.mediaAsset.deleteMany({ where: { id: { in: [ids.publicMedia, ids.privateMedia] } } });
  await db.user.deleteMany({ where: { id: { in: [ids.user, ids.candidateUser, ids.outsideCandidate, ids.apiCandidate, ids.unverifiedCandidate, ids.contentEditor] } } });
  await db.organization.deleteMany({ where: { id: { in: [ids.organization, ids.otherOrganization] } } });
}

beforeAll(async () => {
  await cleanup();
  await db.organization.createMany({ data: [
    { id: ids.organization, name: "Agent Command Org", slug: `${prefix}-org` },
    { id: ids.otherOrganization, name: "Other Agent Command Org", slug: `${prefix}-other-org` },
  ] });
  const roles = await db.role.findMany({ where: { key: { in: ["AGENT", "MANAGER", "CONTENT_EDITOR"] } }, select: { key: true, id: true } });
  const roleIds = new Map(roles.map((role) => [role.key, role.id]));
  await db.user.create({ data: { id: ids.user, email: actor.email, emailVerified: new Date(), organizationId: ids.organization, roles: { create: { roleId: roleIds.get("MANAGER")! } } } });
  await db.user.createMany({ data: [
    { id: ids.candidateUser, email: `${ids.candidateUser}@example.invalid`, name: "Authorized AGENT", organizationId: ids.organization, emailVerified: new Date() },
    { id: ids.outsideCandidate, email: `${ids.outsideCandidate}@example.invalid`, name: "Other AGENT", organizationId: ids.otherOrganization, emailVerified: new Date() },
    { id: ids.apiCandidate, email: `${ids.apiCandidate}@example.invalid`, name: "HTTP AGENT", organizationId: ids.organization, emailVerified: new Date() },
    { id: ids.unverifiedCandidate, email: `${ids.unverifiedCandidate}@example.invalid`, name: "Unverified AGENT", organizationId: ids.organization },
    { id: ids.contentEditor, email: `${ids.contentEditor}@example.invalid`, name: "Content editor", organizationId: ids.organization },
  ] });
  await db.userRole.createMany({ data: [
    { userId: ids.candidateUser, roleId: roleIds.get("AGENT")! },
    { userId: ids.outsideCandidate, roleId: roleIds.get("AGENT")! },
    { userId: ids.apiCandidate, roleId: roleIds.get("AGENT")! },
    { userId: ids.unverifiedCandidate, roleId: roleIds.get("AGENT")! },
    { userId: ids.user, roleId: roleIds.get("AGENT")! },
    { userId: ids.contentEditor, roleId: roleIds.get("CONTENT_EDITOR")! },
  ] });
  await db.mediaAsset.createMany({ data: [
    { id: ids.publicMedia, storageKey: `${prefix}/public.jpg`, url: "/api/media/public/content", mimeType: "image/jpeg", sizeBytes: 256, kind: "IMAGE", isPrivate: false },
    { id: ids.privateMedia, storageKey: `${prefix}/private.jpg`, url: "private-object://test", mimeType: "image/jpeg", sizeBytes: 256, kind: "IMAGE", isPrivate: true },
  ] });
  await db.agent.create({ data: { id: ids.agent, userId: ids.user, name: "Org Team Member", slug: beforeSlug, bio: "Existing internal biography" } });
  managerCookie = `ie_session=${await createSession(ids.user, { mfaVerified: true })}`;
  editorCookie = `ie_session=${await createSession(ids.contentEditor, { mfaVerified: true })}`;
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("organization-scoped team command", () => {
  test("creates only an inactive private profile for an eligible in-organization AGENT account", async () => {
    const result = await createAgentProfileCommand(actor, {
      userId: ids.candidateUser, name: "Authorized AGENT", slug: `${prefix}-created`, jobTitle: "Property Consultant",
      bio: "", department: "sales", yearsExperience: 3,
    }, "127.0.0.1");
    createdAgentId = result.agentId;
    const [profile, audit, event] = await Promise.all([
      db.agent.findUniqueOrThrow({ where: { id: result.agentId } }),
      db.auditLog.findFirstOrThrow({ where: { resourceId: result.agentId, action: "agent.create" } }),
      db.outboxEvent.findFirstOrThrow({ where: { aggregateId: result.agentId, eventType: "agent.created" } }),
    ]);
    expect(profile.userId).toBe(ids.candidateUser);
    expect(profile.active).toBe(false);
    expect(profile.publicAdvisor).toBe(false);
    expect(audit.actorId).toBe(actor.id);
    expect(event.eventType).toBe("agent.created");
    await expect(createAgentProfileCommand(actor, {
      userId: ids.outsideCandidate, name: "Other AGENT", slug: `${prefix}-outside`, jobTitle: "Property Consultant",
    }, null)).rejects.toMatchObject({ status: 422, code: "INVALID_AGENT_ACCOUNT" });
    await expect(createAgentProfileCommand({ ...actor, permissions: ["agent:update"] }, {
      userId: ids.outsideCandidate, name: "No permission", slug: `${prefix}-denied`, jobTitle: "Property Consultant",
    }, null)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(createAgentProfileCommand(actor, {
      userId: ids.unverifiedCandidate, name: "Unverified AGENT", slug: `${prefix}-unverified`, jobTitle: "Property Consultant",
    }, null)).rejects.toMatchObject({ status: 422, code: "INVALID_AGENT_ACCOUNT" });
  });

  test("Admin API scopes linkable AGENT accounts and creates only through the command", async () => {
    const managerList = await fetch(`${baseUrl}/api/admin/agents`, { headers: { cookie: managerCookie } });
    expect(managerList.status).toBe(200);
    const listed = await managerList.json() as { linkableUsers: { id: string }[] };
    expect(listed.linkableUsers.map((user) => user.id)).toContain(ids.apiCandidate);
    expect(listed.linkableUsers.map((user) => user.id)).not.toContain(ids.unverifiedCandidate);
    expect(listed.linkableUsers.map((user) => user.id)).not.toContain(ids.outsideCandidate);

    const editorList = await fetch(`${baseUrl}/api/admin/agents`, { headers: { cookie: editorCookie } });
    expect(editorList.status).toBe(200);
    const editorBody = await editorList.json() as Record<string, unknown>;
    expect(editorBody).not.toHaveProperty("linkableUsers");
    const editorCreate = await fetch(`${baseUrl}/api/admin/agents`, {
      method: "POST",
      headers: { cookie: editorCookie, "content-type": "application/json", "x-requested-with": "fetch" },
      body: JSON.stringify({ userId: ids.apiCandidate, name: "Denied", slug: `${prefix}-denied`, jobTitle: "Property Consultant" }),
    });
    expect(editorCreate.status).toBe(403);

    const response = await fetch(`${baseUrl}/api/admin/agents`, {
      method: "POST",
      headers: { cookie: managerCookie, "content-type": "application/json", "x-requested-with": "fetch" },
      body: JSON.stringify({ userId: ids.apiCandidate, name: "HTTP AGENT", slug: `${prefix}-http`, jobTitle: "Property Consultant", bio: "" }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { agentId: string };
    apiAgentId = body.agentId;
    const created = await db.agent.findUniqueOrThrow({ where: { id: apiAgentId } });
    expect(created.active).toBe(false);
    expect(created.publicAdvisor).toBe(false);
    expect((await db.auditLog.findFirstOrThrow({ where: { resourceId: apiAgentId, action: "agent.create" } })).actorId).toBe(ids.user);
  });

  test("publishes an active profile with redirect, audit, and sitemap event", async () => {
    const initial = await db.agent.findUniqueOrThrow({ where: { id: ids.agent }, select: { updatedAt: true } });
    const result = await updateAgentCommand(actor, {
      agentId: ids.agent,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      slug: afterSlug,
      bio: "Profile content provided by the authorized editor.",
      publicAdvisor: true,
      photoMediaId: ids.publicMedia,
    }, "127.0.0.1");
    expect(result.ok).toBe(true);
    const [agent, redirect, audit, event] = await Promise.all([
      db.agent.findUniqueOrThrow({ where: { id: ids.agent } }),
      db.redirect.findUnique({ where: { fromPath: `/agents/${beforeSlug}` } }),
      db.auditLog.findFirst({ where: { resourceId: ids.agent }, orderBy: { createdAt: "desc" } }),
      db.outboxEvent.findFirst({ where: { aggregateId: ids.agent }, orderBy: { createdAt: "desc" } }),
    ]);
    expect(agent.publicAdvisor).toBe(true);
    expect(agent.photoMediaId).toBe(ids.publicMedia);
    expect(redirect?.toPath).toBe(`/agents/${afterSlug}`);
    expect(audit?.action).toBe("agent.update");
    expect(event?.eventType).toBe("agent.updated");
    await expect(updateAgentCommand(actor, {
      agentId: ids.agent, expectedUpdatedAt: initial.updatedAt.toISOString(), name: "Stale profile save",
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });

  test("rejects cross-organization writes and public inactive profiles", async () => {
    const current = await db.agent.findUniqueOrThrow({ where: { id: ids.agent }, select: { updatedAt: true } });
    await expect(updateAgentCommand({ ...actor, organizationId: `${prefix}-other-org` }, {
      agentId: ids.agent, expectedUpdatedAt: current.updatedAt.toISOString(), name: "Cross-org edit",
    }, null)).rejects.toMatchObject({ status: 403, code: "RESOURCE_FORBIDDEN" });
    await expect(updateAgentCommand(actor, {
      agentId: ids.agent, expectedUpdatedAt: current.updatedAt.toISOString(), active: false,
    }, null)).rejects.toMatchObject({ status: 422, code: "PUBLICATION_VALIDATION" });
    await expect(updateAgentCommand(actor, {
      agentId: ids.agent, expectedUpdatedAt: current.updatedAt.toISOString(), photoMediaId: ids.privateMedia,
    }, null)).rejects.toMatchObject({ status: 422, code: "MEDIA_NOT_AVAILABLE" });
    expect((await db.agent.findUniqueOrThrow({ where: { id: ids.agent } })).active).toBe(true);
  });
});
