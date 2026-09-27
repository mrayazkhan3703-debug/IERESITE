import { describe, expect, it } from "bun:test";
import { JOB_HANDLERS, mapOutboxEventToJob } from "@/server/jobs/outbox";
import { shouldSkipLeadAssignmentSync, shouldSkipLeadStatusSync } from "@/server/crm/adapter";
import { mapIereLeadStatusToGhl } from "@/server/crm/ghl-adapter";

describe("CRM assignment outbox contract", () => {
  it("routes explicit lead owner changes to a retryable, idempotent CRM assignment job", () => {
    expect(mapOutboxEventToJob("event-1", "lead.assignment_changed", "lead", "lead-1", {})).toEqual({
      key: "crm.lead.assignment.sync",
      payload: { leadId: "lead-1" },
      idempotencyKey: "outbox:event-1:crm.lead.assignment.sync",
    });
    expect(JOB_HANDLERS.some((handler) => handler.key === "crm.lead.assignment.sync")).toBe(true);
    expect(mapOutboxEventToJob("event-2", "lead.updated", "lead", "lead-1", {})).toBeNull();
  });

  it("does not suppress a failed assignment retry just because the pending payload has the new owner", () => {
    expect(shouldSkipLeadAssignmentSync("agent-1", "agent-1", "DELIVERED")).toBe(true);
    expect(shouldSkipLeadAssignmentSync("agent-1", "agent-1", "RETRYING")).toBe(false);
    expect(shouldSkipLeadAssignmentSync("agent-1", "agent-1", "FAILED")).toBe(false);
  });

  it("routes lead status changes to an idempotent worker and uses only explicit GHL mappings", () => {
    expect(mapOutboxEventToJob("event-3", "lead.status_changed", "lead", "lead-1", {})).toEqual({
      key: "crm.lead.status.sync",
      payload: { leadId: "lead-1" },
      idempotencyKey: "outbox:event-3:crm.lead.status.sync",
    });
    expect(JOB_HANDLERS.some((handler) => handler.key === "crm.lead.status.sync")).toBe(true);
    expect(mapIereLeadStatusToGhl("WON")).toBe("won");
    expect(mapIereLeadStatusToGhl("LOST")).toBe("lost");
    expect(mapIereLeadStatusToGhl("QUALIFIED")).toBe("open");
    expect(mapIereLeadStatusToGhl("SPAM")).toBeNull();
    expect(mapIereLeadStatusToGhl("UNRECOGNIZED")).toBeNull();
    expect(shouldSkipLeadStatusSync("won", "won", "DELIVERED")).toBe(true);
    expect(shouldSkipLeadStatusSync("won", "open", "DELIVERED")).toBe(false);
    expect(shouldSkipLeadStatusSync("open", "open", "RETRYING")).toBe(false);
  });
});
