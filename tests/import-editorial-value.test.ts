import { expect, test } from "bun:test";
import { editorialValue } from "@/server/ingestion/editorial-value";
test("source refresh preserves recorded editorial values without treating false, zero or null as absent", () => {
  expect(editorialValue({ lat: 0 }, "lat", 25)).toBe(0);
  expect(editorialValue({ offPlan: false }, "offPlan", true)).toBe(false);
  expect(editorialValue({ furnishing: null }, "furnishing", "FURNISHED")).toBeNull();
  expect(editorialValue({}, "view", "SEA")).toBe("SEA");
  expect(editorialValue(Object.create({ lat: 1 }), "lat", 25)).toBe(25);
});
