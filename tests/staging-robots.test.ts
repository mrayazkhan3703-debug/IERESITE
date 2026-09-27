import { describe, expect, test } from "bun:test";
import { robotsForEnvironment, robotsTextForEnvironment } from "@/server/seo/staging-robots";

describe("staging crawler exclusion", () => {
  test("both public robots endpoints disallow the entire staging site", () => {
    expect(robotsForEnvironment("staging", "https://staging.example.test")).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
    expect(robotsTextForEnvironment("staging", "https://staging.example.test"))
      .toBe("User-agent: *\nDisallow: /\n");
  });
});
