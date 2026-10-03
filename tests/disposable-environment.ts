/** Fixture suites must never write to a hosted company database. */
export function requireDisposableEnvironment(env: Record<string, string | undefined>): void {
  if (env.APP_ENV && !["development", "test", "local"].includes(env.APP_ENV)) {
    throw new Error("TESTS_REQUIRE_DISPOSABLE_ENVIRONMENT: hosted application settings are forbidden");
  }
  if (!env.DATABASE_URL) return; // Unit contracts can run without a database.
  let database: URL;
  try { database = new URL(env.DATABASE_URL); }
  catch { throw new Error("TESTS_REQUIRE_DISPOSABLE_ENVIRONMENT: invalid database configuration"); }
  if (!["postgres:", "postgresql:"].includes(database.protocol) ||
    !["localhost", "127.0.0.1", "[::1]", "postgres", "db", "restored-db"].includes(database.hostname) ||
    !/^\/[A-Za-z0-9_-]+$/.test(database.pathname) || /(?:production|company|live)/i.test(database.pathname)) {
    throw new Error("TESTS_REQUIRE_DISPOSABLE_ENVIRONMENT: use the isolated local database");
  }
}
