import { describe, expect, test } from "bun:test";
import { findHygieneViolations, findMissingRequiredSources, requiredSourcePaths } from "../scripts/check-repository-hygiene.mjs";

const policy = ".env\n.env.*\n**/.env\n**/.env.*\n!.env.example\n!.env.docker.example\n.git\ndb/*.db\ndb/*.sqlite*\n";

describe("filename-only repository hygiene", () => {
  test("requires every protected runtime/test source in the published index", () => {
    expect(findMissingRequiredSources(requiredSourcePaths)).toEqual([]);
    for (const path of requiredSourcePaths) {
      expect(findMissingRequiredSources(requiredSourcePaths.filter((entry) => entry !== path)))
        .toEqual([`Required source missing from Git index: ${path}`]);
    }
  });
  test("allows only root example env filenames and source files", () => {
    expect(findHygieneViolations([".env.example", ".env.docker.example", "prisma/schema.prisma"], policy)).toEqual([]);
  });
  test("rejects environment filenames without opening them", () => {
    for (const path of [".env", ".env.local", "nested/.env", "nested/.env.example", ".ENV.production"]) {
      expect(findHygieneViolations([path], policy)).toContain("Git index contains a non-allowlisted environment filename.");
    }
  });
  test("rejects runtime database and journal filenames", () => {
    for (const path of ["db/custom.db", "db/custom.db-wal", "scratch.sqlite", "scratch.sqlite3-shm"]) {
      expect(findHygieneViolations([path], policy)).toContain("Git index contains a runtime database filename.");
    }
  });
  test("fails closed on missing exclusions and broad unignore patterns", () => {
    expect(findHygieneViolations([], policy.replace("**/.env.*\n", ""))).toContain("Docker context exclusion missing: **/.env.*");
    expect(findHygieneViolations([], `${policy}!**\n`)).toContain("Docker context has a non-allowlisted exception.");
    expect(findHygieneViolations([], `${policy}!nested/.env.example\n`)).toContain("Docker context has a non-allowlisted exception.");
  });
});
