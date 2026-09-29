import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@/server/auth";
import { createCommunityCommand } from "@/server/domain/community-command";
import { createProjectPaymentPlan } from "@/server/domain/payment-plan-command";
import { createProjectCommand } from "@/server/domain/project-command";
import { createManualUnitCommand } from "@/server/domain/unit-command";

const owner: SessionUser = {
  sessionId: "cms-validation-session", id: "cms-validation-owner", email: "owner@example.invalid", name: "CMS validation",
  organizationId: null, roles: ["OWNER"], permissions: [], mfaVerified: true,
};
const manager: SessionUser = {
  sessionId: "cms-validation-manager-session", id: "cms-validation-manager", email: "manager@example.invalid", name: "CMS manager",
  organizationId: "cms-validation-org", roles: ["MANAGER"], permissions: [], mfaVerified: true,
};

describe("Project, community, payment plan, and unit CMS validation", () => {
  test("rejects impossible project dates and handover-before-launch before database writes", async () => {
    const base = {
      developerId: "missing-developer", communityId: "missing-community", name: "Example", slug: "example-project",
      projectType: "RESIDENTIAL", status: "OFF_PLAN", lat: 25, lng: 55, locationPrecision: "PROJECT" as const,
    };
    await expect(createProjectCommand(owner, { ...base, launchDate: "2027-02-31" }, null))
      .rejects.toMatchObject({ status: 422, code: "PROJECT_DATE_INVALID" });
    await expect(createProjectCommand(owner, { ...base, launchDate: "2027-06-01", handoverDate: "2027-05-31" }, null))
      .rejects.toMatchObject({ status: 422, code: "PROJECT_DATE_RANGE" });
  });

  test("requires payment installment percentages to total 100 and evidence for Verified plans", async () => {
    await expect(createProjectPaymentPlan(owner, "not-read", {
      name: "Bad total", currency: "AED", postHandover: false, verificationStatus: "PUBLISHED", isDefault: false,
      installments: [{ label: "Booking", percent: 60 }, { label: "Handover", percent: 30 }],
    }, null)).rejects.toMatchObject({ status: 422, code: "PAYMENT_PLAN_TOTAL_INVALID" });
    await expect(createProjectPaymentPlan(owner, "not-read", {
      name: "Missing source", currency: "AED", postHandover: false, verificationStatus: "VERIFIED", isDefault: false,
      installments: [{ label: "Booking", percent: 100 }],
    }, null)).rejects.toMatchObject({ status: 422, code: "PAYMENT_PLAN_SOURCE_REQUIRED" });
    await expect(createProjectPaymentPlan(manager, "not-read", {
      name: "Privileged verification", currency: "AED", postHandover: false, verificationStatus: "VERIFIED", isDefault: false,
      sourceDocumentId: "source-evidence", installments: [{ label: "Booking", percent: 100 }],
    }, null)).rejects.toMatchObject({ status: 403, code: "PAYMENT_PLAN_VERIFICATION_FORBIDDEN" });
  });

  test("rejects malformed community boundaries and unnamed amenity facts", async () => {
    const base = { name: "Example", slug: "example-community", areaType: "RESIDENTIAL", lat: 25, lng: 55, locationPrecision: "COMMUNITY_CENTROID" as const };
    await expect(createCommunityCommand(owner, { ...base, boundaryJson: "not-json" }, null))
      .rejects.toMatchObject({ status: 422, code: "COMMUNITY_BOUNDARY_INVALID" });
    await expect(createCommunityCommand(owner, { ...base, transport: [{ type: "METRO" }] }, null))
      .rejects.toMatchObject({ status: 422, code: "COMMUNITY_FACTS_INVALID" });
  });

  test("rejects non-positive unit prices before project access or writes", async () => {
    await expect(createManualUnitCommand(owner, "not-read", {
      unitType: "APARTMENT", bedrooms: 1, bathrooms: 1, priceMinor: "0", currency: "AED", availabilityStatus: "AVAILABLE",
    }, null, null)).rejects.toMatchObject({ status: 422, code: "UNIT_PRICE_INVALID" });
  });
});
