import { expect, test } from "bun:test";
import { savedPropertySlugs } from "@/server/ai/followup-context";

test("saved context extracts bounded references, never trusts saved property facts", () => {
  expect(savedPropertySlugs([null, "invalid", JSON.stringify({ attachments: [{ kind: "property_card", slug: "concord-tower", isDemoData: false, priceAed: 1 }] })])).toEqual(["concord-tower"]);
  expect(savedPropertySlugs([JSON.stringify({ attachments: [{ kind: "property_card", slug: "../private" }, { kind: "source", slug: "concord-tower" }] })])).toEqual([]);
  expect(savedPropertySlugs(["x".repeat(65537)])).toEqual([]);
  expect(savedPropertySlugs([JSON.stringify({ attachments: Array.from({ length: 20 }, (_, i) => ({ kind: "property_card", slug: `property-${i}` })) })])).toHaveLength(5);
  expect(savedPropertySlugs(Array.from({ length: 8 }, (_, i) => i === 7 ? JSON.stringify({ attachments: [{ kind: "property_card", slug: "too-old" }] }) : "{}"))).toEqual([]);
});
