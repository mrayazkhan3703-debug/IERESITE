import { describe, expect, test } from "bun:test";
import { routeLocation, routeHref } from "@/lib/route-location";
describe("native route compatibility", () => {
  test("EN/AR paths, root and queries retain canonical identity", () => {
    expect(routeLocation("/ar")).toEqual({ rawPath: "/ar", path: "/", query: {}, locale: "ar" });
    expect(routeLocation("/ar/market/rents/", "?name=Dubai+Marina&c=one&c=two")).toEqual({ rawPath: "/ar/market/rents", path: "/market/rents", query: { name: "Dubai Marina", c: "two" }, locale: "ar" });
    expect(routeLocation("/en/buy").path).toBe("/buy");
    expect(routeLocation("/market").locale).toBe("en");
    expect(routeLocation("/arabic").path).toBe("/arabic");
    expect(routeLocation("/arbitrary").locale).toBe("en");
  });
  test("locale prefix, embedded query and fragment are preserved once", () => {
    expect(routeHref("/", undefined, "ar")).toBe("/ar");
    expect(routeHref("/buy", { q: "Dubai Marina", page: 2 }, "ar")).toBe("/ar/buy?q=Dubai+Marina&page=2");
    expect(routeHref("/ar/buy", undefined, "ar")).toBe("/ar/buy");
    expect(routeHref("/calculators/roi?investment=7#chart", { investment: 8, empty: null })).toBe("/calculators/roi?investment=8#chart");
    expect(routeHref("/ar/buy", undefined, "en")).toBe("/ar/buy");
    expect(routeHref("/buy", { removed: "", zero: 0, flag: false })).toBe("/buy?zero=0&flag=false");
  });
  test("invalid internal navigation and locales fail closed", () => {
    for (const path of ["//other.invalid", "https://other.invalid", "/\\\\other.invalid", "/bad\u0020path", "/bad\npath"]) {
      expect(() => routeHref(path)).toThrow();
    }
    expect(() => routeHref("/buy", undefined, "fr")).toThrow();
  });
  test("query protocol keys do not mutate prototypes", () => {
    const parsed = routeLocation("/buy", "__proto__=value&constructor=fixture");
    expect(parsed.query.__proto__).toBe("value");
    expect(Object.getPrototypeOf(parsed.query)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(parsed.query, "__proto__")).toBe(true);
  });
});
