import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireDisposableEnvironment } from "./disposable-environment";

test("actual worker retains paused storage jobs beyond their retry budget and resumes them", async () => {
  requireDisposableEnvironment(process.env);
  const schema = `storage_pause_${randomUUID().replaceAll("-", "")}`;
  if (!/^storage_pause_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid owned schema");
  const scopedUrl = new URL(process.env.DATABASE_URL!);
  scopedUrl.searchParams.set("schema", schema);
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of ["JobRun", "DeadLetterEvent", "MediaAsset"]) {
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const script = `
      import { db } from "@/lib/db";
      import { enqueueJob, processJobQueue } from "@/server/jobs/outbox";
      const paused = process.env.STORAGE_MUTATIONS_PAUSED === "true";
      if (paused) await enqueueJob("media.process", { mediaId: "missing-disposable-verification-only" }, "storage-pause-owned");
      const samples = [];
      for (let cycle=0; cycle<(paused ? 6 : 1); cycle++) {
        await db.jobRun.updateMany({data:{scheduledAt:new Date(Date.now()-1000)}});
        await processJobQueue();
        const job=await db.jobRun.findUniqueOrThrow({where:{idempotencyKey:"storage-pause-owned"}});
        samples.push({id:job.id,status:job.status,attempts:job.attempts,error:job.error,lockedBy:job.lockedBy});
      }
      console.log("STORAGE_PAUSE_WORKER_EVIDENCE="+JSON.stringify({samples,dead:await db.deadLetterEvent.count()}));
      await db.$disconnect();
    `;
    let retainedId = "";
    for (const paused of [true, false]) {
      const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], {
        env: { ...process.env, DATABASE_URL: scopedUrl.toString(), APP_ENV: "development",
          STORAGE_MUTATIONS_PAUSED: String(paused), JOB_SCHEDULER_ENABLED: "false" },
        stdout: "pipe", stderr: "pipe", timeout: 15000,
      });
      expect(child.exitCode).toBe(0);
      const line = child.stdout.toString().split("\n").find(value => value.startsWith("STORAGE_PAUSE_WORKER_EVIDENCE="));
      expect(line).toBeDefined();
      const evidence = JSON.parse(line!.slice("STORAGE_PAUSE_WORKER_EVIDENCE=".length)) as {
        samples: { id: string; status: string; attempts: number; error: string | null; lockedBy: string | null }[]; dead: number };
      expect(evidence.dead).toBe(0);
      expect(evidence.samples).toHaveLength(paused ? 6 : 1);
      for (const sample of evidence.samples) {
        if (!retainedId) retainedId = sample.id;
        expect(sample.id).toBe(retainedId);
        expect(sample).toMatchObject(paused ? { status: "RETRYING", attempts: 0,
          error: "STORAGE_MUTATIONS_PAUSED", lockedBy: null } : { status: "SUCCEEDED", attempts: 1, lockedBy: null });
      }
    }
  } finally {
    // Only the validated schema created by this test; no shared tables/records.
    await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await db.$disconnect();
  }
}, 35000);
