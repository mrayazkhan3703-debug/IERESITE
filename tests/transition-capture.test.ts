import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

async function scratch(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(resolve(tmpdir(), "iere-transition-contract-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
function launch(recipient: string, output: string) {
  return spawnSync(process.execPath, ["--no-env-file", "scripts/capture-railway-transition.mjs", recipient, output], {
    cwd: resolve(import.meta.dir, ".."), timeout: 10000, encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH, DATABASE_URL: "postgresql://fixture:fixture@internet.example.invalid:5432/iere_test",
      S3_BUCKET: "iere-railway-test", S3_ACCESS_KEY_ID: "synthetic-only", S3_SECRET_ACCESS_KEY: "synthetic-secret-never-output" },
  });
}

test("transition capture rejects private identities and preserves existing ciphertext", async () => {
  await scratch(async directory => {
    const recipient = resolve(directory, "recipients.txt"), output = resolve(directory, "capture.tar.gz.age");
    await writeFile(recipient, "AGE-SECRET-KEY-SYNTHETIC-INVALID");
    expect(launch(recipient, output).status).toBe(1);
    expect(await readdir(directory)).toEqual(["recipients.txt"]);
    await writeFile(recipient, "age1" + "a".repeat(58));
    await writeFile(output, "previous-encrypted-capture");
    const result = launch(recipient, output);
    expect(result.status).toBe(1);
    expect(await readFile(output, "utf8")).toBe("previous-encrypted-capture");
  });
});

test("transition capture rejects internet database configuration without disclosing credentials or generating a receipt", async () => {
  await scratch(async directory => {
    const recipient = resolve(directory, "recipients.txt"), output = resolve(directory, "capture.tar.gz.age");
    await writeFile(recipient, "age1" + "a".repeat(58));
    const result = launch(recipient, output);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAILED_TRANSITION_CAPTURE");
    expect(result.stdout + result.stderr).not.toContain("synthetic-secret-never-output");
    expect(result.stdout + result.stderr).not.toContain("postgresql://");
    expect(await readdir(directory)).toEqual(["recipients.txt"]);
  });
});

test("Bun preload blocks hosted fixture execution before test discovery", () => {
  const result = spawnSync(process.execPath, ["--no-env-file", "test", "./tests/disposable-environment.test.ts"], {
    cwd: resolve(import.meta.dir, ".."), timeout: 10000, encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH, APP_ENV: "staging",
      DATABASE_URL: "postgresql://fixture:synthetic-secret@postgres.railway.internal:5432/iere_test" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("TESTS_REQUIRE_DISPOSABLE_ENVIRONMENT");
  expect(result.stdout + result.stderr).not.toContain("synthetic-secret");
  expect(result.stdout + result.stderr).not.toContain("(pass)");
});
