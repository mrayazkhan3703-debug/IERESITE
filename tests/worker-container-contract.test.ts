import { describe, expect, test } from "bun:test";
import { assertFixtureId, assertReleasedRows, assertStoppedCleanly, assertWorkerContract } from "../scripts/verify-worker-container-shutdown.mjs";

describe("container shutdown evidence guards", () => {
  test("requires the currently scoped Compose/package wrapper", () => {
    expect(() => assertWorkerContract(["bun", "run", "worker"], "bun src/worker.ts")).not.toThrow();
    expect(() => assertWorkerContract(["bun", "src/worker.ts"], "bun src/worker.ts")).toThrow();
    expect(() => assertWorkerContract(["bun", "run", "worker"], "different-worker")).toThrow();
  });
  test("refuses killed, failed, running or OOM container success", () => {
    expect(() => assertStoppedCleanly({ Status: "exited", ExitCode: 0, OOMKilled: false })).not.toThrow();
    for (const state of [
      { Status: "exited", ExitCode: 137, OOMKilled: false },
      { Status: "exited", ExitCode: 1, OOMKilled: false },
      { Status: "running", ExitCode: 0, OOMKilled: false },
      { Status: "exited", ExitCode: 0, OOMKilled: true },
    ]) expect(() => assertStoppedCleanly(state)).toThrow();
  });
  test("requires rollback, empty lease and untouched following work", () => {
    const active = { id: "fixture-active", status: "RETRYING", attempts: 0, lockedBy: null, lockedAt: null, leaseExpiresAt: null };
    const next = { id: "fixture-next", status: "QUEUED", attempts: 0 };
    expect(() => assertReleasedRows([active, next])).not.toThrow();
    for (const changed of [{ ...active, attempts: 1 }, { ...active, lockedBy: "worker" }, { ...active, status: "RUNNING" }]) {
      expect(() => assertReleasedRows([changed, next])).toThrow();
    }
    expect(() => assertReleasedRows([active, { ...next, status: "RUNNING" }])).toThrow();
    expect(() => assertReleasedRows([])).toThrow();
  });
  test("cleanup accepts only returned Docker IDs, never broad names/paths", () => {
    expect(() => assertFixtureId("a".repeat(64))).not.toThrow();
    for (const id of ["iere-local-worker-1", "", "../", "abc", "a".repeat(64) + " anything"]) expect(() => assertFixtureId(id)).toThrow();
  });
});
