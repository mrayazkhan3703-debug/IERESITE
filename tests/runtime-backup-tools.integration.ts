import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative, isAbsolute } from "node:path";
import { db } from "@/lib/db";
import { requireDisposableEnvironment } from "./disposable-environment";

test("application runtime PostgreSQL 16 tools capture and inspect a disposable schema", async () => {
  requireDisposableEnvironment(process.env);
  const schema = `backup_tools_${randomUUID().replaceAll("-", "")}`;
  const root = await mkdtemp(resolve(tmpdir(), "iere-runtime-tools-"));
  const database = new URL(process.env.DATABASE_URL!);
  const env = { ...process.env, LD_LIBRARY_PATH: "/opt/iere-postgres/lib", PGHOST: database.hostname, PGPORT: database.port || "5432",
    PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password), PGDATABASE: database.pathname.slice(1), PGSSLMODE: "disable" };
  const run = (args: string[]) => { const result = Bun.spawnSync(args, { env, stdout: "pipe", stderr: "ignore" }); expect(result.exitCode).toBe(0); return Buffer.from(result.stdout).toString(); };
  try {
    expect(run(["pg_dump", "--version"])).toMatch(/PostgreSQL\) 16\./);
    expect(run(["pg_restore", "--version"])).toMatch(/PostgreSQL\) 16\./);
    expect(run(["age", "--version"]).trim()).toBe("v1.3.2");
    run([process.execPath, "--no-env-file", "-e", "import {hostedTool} from './scripts/backup-hosted.mjs'; await hostedTool('pg_dump',['--version']); await hostedTool('pg_restore',['--version']);"]);
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await db.$executeRawUnsafe(`CREATE TABLE "${schema}".fixture (id integer PRIMARY KEY)`);
    await db.$executeRawUnsafe(`INSERT INTO "${schema}".fixture VALUES (1)`);
    run(["pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--schema", schema, "--file", resolve(root, "fixture.dump")]);
    expect(run(["pg_restore", "--list", resolve(root, "fixture.dump")])).toContain("TABLE DATA");
  } finally {
    if (!/^backup_tools_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid fixture schema");
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    const parent = await realpath(tmpdir()), actual = await realpath(root), distance = relative(parent, actual);
    if (distance.startsWith("..") || isAbsolute(distance) || !/^iere-runtime-tools-[^/\\]+$/.test(distance)) throw new Error("Invalid fixture path");
    await rm(actual, { recursive: true, force: true });
  }
}, 30000);
