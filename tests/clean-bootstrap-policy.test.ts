import { describe, expect, test } from "bun:test";
import { CLEAN_BOOTSTRAP_TABLES, evaluateCleanBootstrap } from "@/server/release/clean-bootstrap-policy";

const emptyCounts = () => Object.fromEntries(CLEAN_BOOTSTRAP_TABLES.map((key) => [key, 0])) as
  Record<(typeof CLEAN_BOOTSTRAP_TABLES)[number], number>;

const cleanInput = () => ({
  expectedMigrations: 31, appliedMigrations: 31, failedMigrations: 0,
  roles: 8, permissions: 30, extensions: ["postgis", "pg_trgm", "vector"], counts: emptyCounts(),
});

describe("clean staging bootstrap policy", () => {
  test("accepts migrated foundations with zero operational, demo or self-test rows", () => {
    expect(evaluateCleanBootstrap(cleanInput())).toEqual({ status: "PASS_CLEAN_BOOTSTRAP", reasons: [] });
  });

  test("rejects partial migrations, missing RBAC and missing extensions", () => {
    const input = cleanInput();
    input.appliedMigrations = 30;
    input.roles = 7;
    input.extensions = ["postgis"];
    expect(evaluateCleanBootstrap(input).reasons).toEqual([
      "MIGRATIONS_INCOMPLETE", "RBAC_FOUNDATION_MISSING", "EXTENSION_MISSING_PG_TRGM", "EXTENSION_MISSING_VECTOR",
    ]);
  });

  test("rejects every nonempty operational scope without exposing row contents", () => {
    for (const table of CLEAN_BOOTSTRAP_TABLES) {
      const input = cleanInput();
      input.counts[table] = 1;
      const result = evaluateCleanBootstrap(input);
      expect(result.status).toBe("FAIL_CLEAN_BOOTSTRAP");
      expect(result.reasons).toEqual([`NONEMPTY_${table}`]);
    }
  });

  test("invalid counts fail closed", () => {
    const input = cleanInput();
    input.counts.properties = -1;
    expect(evaluateCleanBootstrap(input).reasons).toContain("INVALID_COUNT_properties");
  });
});
