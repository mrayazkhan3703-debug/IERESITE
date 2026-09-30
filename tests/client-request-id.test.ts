import { expect, test, spyOn } from "bun:test";
import { clientRequestId } from "@/lib/client-request-id";
import { DEFAULT_SITE_SETTINGS, parseSiteSettings } from "@/lib/site-settings";

test("request IDs use random bytes without the secure-context-only UUID API", () => {
  const uuid = spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => { throw new Error("Unavailable on the HTTP fixture host"); });
  try {
    const ids = Array.from({ length: 100 }, () => clientRequestId());
    expect(ids.every((id) => /^[a-f0-9]{32}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(uuid).not.toHaveBeenCalled();
  } finally { uuid.mockRestore(); }
});

test("navigation request IDs fit the existing bounded settings contract", () => {
  const settings = structuredClone(DEFAULT_SITE_SETTINGS);
  settings.headerGroups.push({ id: `group-${clientRequestId().slice(0, 24)}`, labelEn: "New group", labelAr: "مجموعة جديدة", items: [] });
  settings.footerColumns.push({ id: `footer-${clientRequestId().slice(0, 24)}`, labelEn: "New column", labelAr: "عمود جديد", links: [] });
  expect(parseSiteSettings(settings)).not.toBeNull();
});
