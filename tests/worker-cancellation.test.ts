import { expect, test } from "bun:test";
import { runCancellableJob } from "@/server/jobs/cancellation";

test("worker shutdown aborts a handler and waits for its cooperative cleanup", async () => {
  const parent = new AbortController();
  let settled = false;
  const running = runCancellableJob(async (signal) => {
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => setTimeout(resolve, 5), { once: true });
    });
    settled = true;
  }, { timeoutMs: 1_000, parentSignal: parent.signal });

  parent.abort();
  await expect(running).rejects.toMatchObject({ name: "JobCancellationError", kind: "shutdown" });
  expect(settled).toBe(true);
});

test("job timeout aborts and awaits the handler instead of abandoning its promise", async () => {
  let settled = false;
  const running = runCancellableJob(async (signal) => {
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => setTimeout(resolve, 5), { once: true });
    });
    settled = true;
  }, { timeoutMs: 1 });

  await expect(running).rejects.toMatchObject({ name: "JobCancellationError", kind: "timeout" });
  expect(settled).toBe(true);
});

test("an already-stopping worker does not start a newly claimed handler", async () => {
  const parent = new AbortController();
  parent.abort();
  let started = false;

  await expect(runCancellableJob(async () => { started = true; }, {
    timeoutMs: 100,
    parentSignal: parent.signal,
  })).rejects.toMatchObject({ name: "JobCancellationError", kind: "shutdown" });
  expect(started).toBe(false);
});
