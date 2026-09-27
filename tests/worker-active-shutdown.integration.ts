import { expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";
import { db } from "@/lib/db";

async function until(check: () => Promise<boolean>, description: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(25);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function startWorker(databaseUrl: string, mode: "block" | "recover") {
  const child = Bun.spawn([
    process.execPath, "--no-env-file", "--preload", resolve(import.meta.dir, "fixtures/worker-sigterm-preload.ts"),
    resolve(import.meta.dir, "../src/worker.ts"),
  ], {
    cwd: resolve(import.meta.dir, ".."),
    // An allowlist avoids inheriting API keys or live-provider configuration.
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      APP_ENV: "development",
      JOB_SCHEDULER_ENABLED: "true",
      JOB_INTERVAL_MS: "100",
      WORKER_HEALTH_PORT: "31301",
      WORKER_SIGTERM_FIXTURE: mode,
      AI_PROVIDER: "mock",
      AI_LIVE_ENABLED: "false",
      CRM_PROVIDER: "localdev",
      CRM_LIVE_ENABLED: "false",
      EMAIL_PROVIDER: "localdev",
      SERVICE_NAME: "worker-sigterm-test",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  let stdout = "";
  let stderr = "";
  const read = async (stream: ReadableStream<Uint8Array>, append: (value: string) => void) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      append(decoder.decode(chunk.value, { stream: true }));
    }
  };
  const output = Promise.all([
    read(child.stdout, (value) => { stdout += value; }),
    read(child.stderr, (value) => { stderr += value; }),
  ]);
  return { child, output, logs: () => ({ stdout, stderr }) };
}

test("SIGTERM drains an active worker handler, releases its lease, and permits one retry", async () => {
  const schema = `iere_sigterm_${crypto.randomUUID().replaceAll("-", "")}`;
  if (!/^iere_sigterm_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid isolated schema name");
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  databaseUrl.searchParams.set("schema", schema);
  const isolated = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
  const workers: ReturnType<typeof startWorker>[] = [];
  let schemaCreated = false;
  const preservedDeadJobs = await db.jobRun.findMany({
    where: { status: "DEAD" }, select: { id: true, status: true, attempts: true, updatedAt: true }, orderBy: { id: "asc" },
  });

  try {
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    // Copy table definitions only. No operational rows enter the test schema.
    for (const table of ["JobRun", "OutboxEvent", "DeadLetterEvent"]) {
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const [scope] = await isolated.$queryRaw<Array<{ name: string }>>`SELECT current_schema() AS name`;
    expect(scope.name).toBe(schema);
    expect(await isolated.jobRun.count()).toBe(0);

    // A recent completed match prevents the scheduler from adding its periodic job.
    await isolated.jobRun.create({ data: {
      jobKey: "alerts.savedSearch.match", payloadJson: {}, idempotencyKey: "sigterm-schedule-sentinel",
      status: "SUCCEEDED", finishedAt: new Date(),
    } });
    const active = await isolated.jobRun.create({ data: {
      jobKey: "alerts.savedSearch.match", payloadJson: {}, idempotencyKey: "sigterm-active",
      scheduledAt: new Date(Date.now() - 1_000), maxAttempts: 2,
    } });
    const following = await isolated.jobRun.create({ data: {
      jobKey: "alerts.savedSearch.match", payloadJson: {}, idempotencyKey: "sigterm-following", maxAttempts: 2,
    } });

    const first = startWorker(databaseUrl.toString(), "block");
    workers.push(first);
    await until(async () => first.logs().stdout.includes("fixture.handler.started"), "active handler");
    const claimed = await isolated.jobRun.findUniqueOrThrow({ where: { id: active.id } });
    expect(claimed.status).toBe("RUNNING");
    expect(claimed.attempts).toBe(1);
    expect(claimed.lockedBy).not.toBeNull();
    const health = await (await fetch("http://127.0.0.1:31301/health")).json();
    expect(health.scheduler.activeJob.jobId).toBe(active.id);

    first.child.kill("SIGTERM");
    await until(async () => first.child.exitCode !== null, "graceful worker exit");
    expect(await first.child.exited).toBe(0);
    await first.output;
    expect(first.logs().stderr).toBe("");
    const log = first.logs().stdout;
    expect(log).toContain("fixture.handler.aborted");
    expect(log.indexOf("fixture.handler.cleaned")).toBeGreaterThan(log.indexOf("fixture.handler.aborted"));
    expect(log.indexOf('"event":"job.cancelled"')).toBeGreaterThan(log.indexOf("fixture.handler.cleaned"));
    expect(log.indexOf('"event":"jobs.scheduler_stopped"')).toBeGreaterThan(log.indexOf('"event":"job.cancelled"'));

    const released = await isolated.jobRun.findUniqueOrThrow({ where: { id: active.id } });
    expect(released.status).toBe("RETRYING");
    expect(released.attempts).toBe(0);
    expect(released.lockedBy).toBeNull();
    expect(released.lockedAt).toBeNull();
    expect(released.leaseExpiresAt).toBeNull();
    const untouched = await isolated.jobRun.findUniqueOrThrow({ where: { id: following.id } });
    expect(untouched.status).toBe("QUEUED");
    expect(untouched.attempts).toBe(0);
    expect(await isolated.deadLetterEvent.count()).toBe(0);

    const resumed = startWorker(databaseUrl.toString(), "recover");
    workers.push(resumed);
    await until(async () => await isolated.jobRun.count({ where: { id: { in: [active.id, following.id] }, status: "SUCCEEDED" } }) === 2, "retry success");
    resumed.child.kill("SIGTERM");
    await until(async () => resumed.child.exitCode !== null, "resumed worker exit");
    expect(await resumed.child.exited).toBe(0);
    await resumed.output;
    expect(resumed.logs().stderr).toBe("");
    expect(resumed.logs().stdout.match(/fixture.handler.recovered/g)?.length).toBe(2);
    const recovered = await isolated.jobRun.findUniqueOrThrow({ where: { id: active.id } });
    expect(recovered.status).toBe("SUCCEEDED");
    expect(recovered.attempts).toBe(1);
    expect(await isolated.jobRun.count({ where: { idempotencyKey: "sigterm-active" } })).toBe(1);
    expect(await isolated.deadLetterEvent.count()).toBe(0);
    expect(await db.jobRun.findMany({
      where: { status: "DEAD" }, select: { id: true, status: true, attempts: true, updatedAt: true }, orderBy: { id: "asc" },
    })).toEqual(preservedDeadJobs);
  } finally {
    for (const worker of workers) {
      if (worker.child.exitCode === null) worker.child.kill("SIGKILL");
      await worker.child.exited;
      await worker.output;
    }
    await isolated.$disconnect();
    if (schemaCreated) await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  }
}, 30_000);
