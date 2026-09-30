import { expect, test } from "bun:test";
import type { DivIcon, DivIconOptions } from "leaflet";
import { propertyPinIcon } from "@/lib/leaflet-icons";

test("branded property pins have deterministic vector markup without external icon assets", () => {
  let options: DivIconOptions | undefined;
  const icon = {} as DivIcon;
  expect(propertyPinIcon({ divIcon: (value) => { options = value; return icon; } })).toBe(icon);
  expect(options?.html).toContain('<svg aria-hidden="true"');
  expect(options?.html).not.toMatch(/(?:src=|href=|<img|<script)/);
  expect(options?.iconSize).toEqual([28, 36]);
  expect(options?.iconAnchor).toEqual([14, 36]);
  expect(options).not.toHaveProperty("iconUrl");
});
