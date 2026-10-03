import { expect, test } from "bun:test";
import { requireDisposableEnvironment } from "./disposable-environment";

test("unit contracts and explicit isolated local databases are allowed", () => {
  expect(() => requireDisposableEnvironment({})).not.toThrow();
  for (const hostname of ["localhost", "127.0.0.1", "[::1]", "postgres", "db", "restored-db"]) {
    expect(() => requireDisposableEnvironment({ APP_ENV: "development", DATABASE_URL: `postgresql://fixture:fixture@${hostname}:5432/iere_test` })).not.toThrow();
  }
});

test("hosted settings, internet databases and production names fail before fixtures load", () => {
  for (const configuration of [{ APP_ENV: "staging" }, { APP_ENV: "production" }, { DATABASE_URL: "not-a-url" },
    { DATABASE_URL: "postgresql://fixture:fixture@postgres.railway.internal:5432/iere_test" },
    { DATABASE_URL: "postgresql://fixture:fixture@db.fixture.supabase.co:5432/postgres" },
    { DATABASE_URL: "postgresql://fixture:fixture@localhost:5432/iere_live" }]) {
    expect(() => requireDisposableEnvironment(configuration)).toThrow("TESTS_REQUIRE_DISPOSABLE_ENVIRONMENT");
  }
});
