import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function assertWorkerContract(command, script) {
  if (JSON.stringify(command) !== JSON.stringify(["bun", "run", "worker"]) || script !== "bun src/worker.ts") {
    throw new Error("Worker command changed; review the fixture before claiming wrapper coverage.");
  }
}

export function assertStoppedCleanly(state) {
  if (state.Status !== "exited" || state.ExitCode !== 0 || state.OOMKilled !== false) {
    throw new Error("Container did not exit cleanly before Docker's kill deadline.");
  }
}

export function assertReleasedRows(rows) {
  const active = rows.find((row) => row.id === "fixture-active");
  const next = rows.find((row) => row.id === "fixture-next");
  if (!active || active.status !== "RETRYING" || active.attempts !== 0 ||
      active.lockedBy !== null || active.lockedAt !== null || active.leaseExpiresAt !== null ||
      !next || next.status !== "QUEUED" || next.attempts !== 0) {
    throw new Error("Active lease/attempt was not released or the following job was claimed during shutdown.");
  }
}

export function assertFixtureId(id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid owned Docker resource ID; cleanup refused.");
}

async function verify() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const token = randomUUID().replaceAll("-", "");
  const prefix = `iere-shutdown-${token}`;
  const owned = [];
  const checks = [];
  let stage = "source metadata";
  console.log("Checking worker wrapper using disposable queue-only Docker resources.");
  const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  const docker = (args, input) => {
    const result = spawnSync("docker", args, { cwd: root, input, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    // Do not dump CLI arguments, environment, DB rows or stderr on failure.
    if (result.error || result.status !== 0) throw new Error(`Docker ${args[0]} failed during ${stage}; inspect only the disposable fixture resources.`);
    return result.stdout.trim();
  };
  const own = (kind, args) => {
    const id = docker(args);
    assertFixtureId(id);
    owned.push({ kind, id });
    return id;
  };
  const until = async (predicate, description) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try { if (predicate()) return; } catch { /* readiness/claim may still be pending */ }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`Timed out waiting for ${description}.`);
  };
  const publicSql = (sql) => docker(["compose", "exec", "-T", "postgres", "psql", "-U", "iere", "-d", "iere", "-At", "-v", "ON_ERROR_STOP=1"], sql);
  const snapshot = () => publicSql(`SELECT jsonb_build_object(
    'jobs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'status', status, 'attempts', attempts, 'updatedAt', "updatedAt") ORDER BY id), '[]'::jsonb) FROM "JobRun" WHERE status = 'DEAD'),
    'letters', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'attempts', attempts, 'replayedAt', "replayedAt") ORDER BY id), '[]'::jsonb) FROM "DeadLetterEvent"));`);
  const preserved = snapshot();
  const pgId = docker(["compose", "ps", "-q", "postgres"]);
  const workerId = docker(["compose", "ps", "-q", "worker"]);
  assertFixtureId(pgId);
  assertFixtureId(workerId);
  let pgImage = docker(["inspect", "-f", "{{.Image}}", pgId]);
  try { docker(["image", "inspect", "-f", "{{.Id}}", pgImage]); }
  catch {
    const reference = docker(["inspect", "-f", "{{.Config.Image}}", pgId]);
    pgImage = docker(["image", "inspect", "-f", "{{.Id}}", reference]);
  }
  const sourceVersion = docker(["exec", pgId, "postgres", "--version"]).match(/PostgreSQL\) (\d+)\./)?.[1];
  const restoreVersion = docker(["run", "--rm", "--network", "none", "--entrypoint", "postgres", pgImage, "--version"]).match(/PostgreSQL\) (\d+)\./)?.[1];
  check(Boolean(sourceVersion) && sourceVersion === restoreVersion, "Disposable PostgreSQL major matches running source");
  const workerImage = docker(["inspect", "-f", "{{.Image}}", workerId]);
  const command = JSON.parse(docker(["inspect", "-f", "{{json .Config.Cmd}}", workerId]));
  const packageScript = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts.worker;
  assertWorkerContract(command, packageScript);
  check(docker(["exec", workerId, "bun", "--no-env-file", "-e", "console.log(JSON.parse(await Bun.file('package.json').text()).scripts.worker)"]) === packageScript, "Running worker image script matches checked repository wrapper");
  const entrypoint = docker(["inspect", "-f", "{{json .Config.Entrypoint}}", workerId]);
  check(entrypoint === docker(["image", "inspect", "-f", "{{json .Config.Entrypoint}}", workerImage]), "Default image entrypoint matches Compose worker");
  const definitions = docker(["compose", "exec", "-T", "postgres", "pg_dump", "-U", "iere", "-d", "iere", "--schema-only", "--no-owner", "--no-privileges",
    '--table=public."JobRun"', '--table=public."OutboxEvent"', '--table=public."DeadLetterEvent"', '--table=public."WorkerHeartbeat"']);
  let evidence;
  const cleanupErrors = [];
  try {
    stage = "isolated database setup";
    console.log("Source metadata validated; creating isolated database/network.");
    const network = own("network", ["network", "create", "--internal", "--label", `iere.fixture=${token}`, prefix]);
    check(JSON.parse(docker(["network", "inspect", "-f", "{{json .Internal}}", network])) === true, "Disposable network has no external route");
    const postgres = own("container", ["create", "--name", `${prefix}-db`, "--label", `iere.fixture=${token}`, "--network", network, "--network-alias", "queue-db",
      "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,noexec,size=512m", "-e", "POSTGRES_USER=iere_fixture_admin", "-e", "POSTGRES_DB=iere_shutdown", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", pgImage]);
    docker(["start", postgres]);
    // TCP readiness excludes the temporary Unix-only server during initdb.
    await until(() => Boolean(docker(["exec", postgres, "pg_isready", "-h", "127.0.0.1", "-U", "iere_fixture_admin", "-d", "iere_shutdown"])), "isolated PostgreSQL");
    const sql = (query) => docker(["exec", "-i", postgres, "psql", "-U", "iere_fixture_admin", "-d", "iere_shutdown", "-At", "-v", "ON_ERROR_STOP=1"], query);
    stage = "queue definition import";
    sql(definitions);
    check(sql('SELECT count(*) FROM "JobRun";') === "0", "Only queue definitions copied; no operational rows");
    stage = "queue-only role and synthetic jobs";
    sql(`CREATE ROLE iere_shutdown LOGIN;
      GRANT CONNECT ON DATABASE iere_shutdown TO iere_shutdown;
      GRANT USAGE ON SCHEMA public TO iere_shutdown;
      GRANT SELECT, INSERT, UPDATE ON "JobRun", "OutboxEvent", "DeadLetterEvent", "WorkerHeartbeat" TO iere_shutdown;
      INSERT INTO "JobRun" (id, "jobKey", "payloadJson", "idempotencyKey", status, "finishedAt", "updatedAt") VALUES
        ('fixture-sentinel', 'alerts.savedSearch.match', '{}', 'fixture-sentinel', 'SUCCEEDED', NOW(), NOW());
      INSERT INTO "JobRun" (id, "jobKey", "payloadJson", "idempotencyKey", "scheduledAt", "updatedAt") VALUES
        ('fixture-active', 'alerts.savedSearch.match', '{}', 'fixture-active', NOW() - INTERVAL '1 second', NOW()),
        ('fixture-next', 'alerts.savedSearch.match', '{}', 'fixture-next', NOW(), NOW());`);
    check(sql("SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname = 'iere_shutdown';") === "f", "Worker role has no elevated privileges");
    check(sql("SELECT has_schema_privilege('iere_shutdown', 'public', 'CREATE');") === "f", "Worker role cannot create public-schema objects");
    check(sql(`SELECT has_table_privilege('iere_shutdown', 'public."JobRun"', 'DELETE')
      OR has_table_privilege('iere_shutdown', 'public."OutboxEvent"', 'DELETE')
      OR has_table_privilege('iere_shutdown', 'public."DeadLetterEvent"', 'DELETE');`) === "f", "Worker role cannot delete queue records");
    const rows = () => JSON.parse(sql('SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM (SELECT id, status, attempts, "lockedBy", "lockedAt", "leaseExpiresAt" FROM "JobRun") j;'));
    const start = (mode) => {
      const id = own("container", ["create", "--name", `${prefix}-${mode}`, "--label", `iere.fixture=${token}`, "--network", network,
        "--mount", `type=bind,source=${resolve(root, "tests/fixtures/worker-container.bunfig.toml")},target=/app/bunfig.toml,readonly`,
        "--mount", `type=bind,source=${resolve(root, "tests/fixtures/worker-sigterm-preload.ts")},target=/app/tests/fixtures/worker-sigterm-preload.ts,readonly`,
        "-e", "DATABASE_URL=postgresql://iere_shutdown@queue-db:5432/iere_shutdown?schema=public", "-e", "NODE_ENV=test", "-e", "APP_ENV=development",
        "-e", "JOB_SCHEDULER_ENABLED=true", "-e", "JOB_INTERVAL_MS=100", "-e", "WORKER_HEALTH_PORT=3001", "-e", `WORKER_SIGTERM_FIXTURE=${mode}`,
        "-e", "AI_PROVIDER=mock", "-e", "AI_LIVE_ENABLED=false", "-e", "CRM_PROVIDER=localdev", "-e", "CRM_LIVE_ENABLED=false", "-e", "EMAIL_PROVIDER=localdev",
        "-e", "NEXT_TELEMETRY_DISABLED=1", "-e", "DO_NOT_TRACK=1", workerImage, ...command]);
      docker(["start", id]);
      return id;
    };
    const first = start("block");
    stage = "active handler readiness";
    await until(() => docker(["logs", first]).includes("fixture.handler.started"), "active synthetic handler");
    check(rows().find((row) => row.id === "fixture-active")?.status === "RUNNING", "Job is RUNNING before docker stop");
    const stopStarted = Date.now();
    stage = "active container stop";
    console.log("Synthetic job is RUNNING; stopping disposable Bun wrapper.");
    docker(["stop", "--time", "10", first]);
    const stopElapsedMs = Date.now() - stopStarted;
    assertStoppedCleanly(JSON.parse(docker(["inspect", "-f", "{{json .State}}", first])));
    checks.push("Docker stop exits zero without OOM or SIGKILL");
    const log = docker(["logs", first]);
    const order = ["fixture.handler.aborted", "fixture.handler.cleaned", '"event":"job.cancelled"', '"event":"jobs.scheduler_stopped"'].map((marker) => log.indexOf(marker));
    check(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])), "Abort, awaited cleanup, lease release and scheduler stop are ordered");
    assertReleasedRows(rows());
    checks.push("Lease/attempt rolled back and following job unclaimed");
    stage = "recovery wrapper";
    const second = start("recover");
    await until(() => rows().filter((row) => ["fixture-active", "fixture-next"].includes(row.id) && row.status === "SUCCEEDED").length === 2, "retry completion");
    docker(["stop", "--time", "10", second]);
    assertStoppedCleanly(JSON.parse(docker(["inspect", "-f", "{{json .State}}", second])));
    check(rows().filter((row) => ["fixture-active", "fixture-next"].includes(row.id)).every((row) => row.attempts === 1), "Both synthetic jobs finish at one attempt");
    check((docker(["logs", second]).match(/fixture.handler.recovered/g) ?? []).length === 2, "Recovery handler runs once for each job");
    check(sql('SELECT count(*) FROM "DeadLetterEvent";') === "0", "No fixture dead letters");
    check(snapshot() === preserved, "Working DEAD job versions and dead-letter identities/replay markers remain unchanged");
    evidence = { status: "PASS", capturedAtUtc: new Date().toISOString(), scope: "Disposable Docker container stop with real Compose Bun wrapper, test-only handler and queue definitions; no domain rows copied.", command, entrypoint: JSON.parse(entrypoint), workerImage, postgresImage: pgImage, stopDeadlineSeconds: 10, stopElapsedMs, checks };
  } finally {
    stage = "owned-resource cleanup";
    for (const resource of owned.reverse()) {
      try {
        assertFixtureId(resource.id);
        const label = docker(resource.kind === "container"
          ? ["inspect", "-f", '{{index .Config.Labels "iere.fixture"}}', resource.id]
          : ["network", "inspect", "-f", '{{index .Labels "iere.fixture"}}', resource.id]);
        if (label !== token) throw new Error("Ownership mismatch");
        docker(resource.kind === "container" ? ["rm", "--force", resource.id] : ["network", "rm", resource.id]);
      } catch { cleanupErrors.push(`${resource.kind}:${resource.id}`); }
    }
    if (cleanupErrors.length) throw new Error(`Disposable cleanup needs review: ${cleanupErrors.join(", ")}`);
  }
  const output = resolve(root, "test-results/worker-container-shutdown", token);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "result.json"), JSON.stringify({ ...evidence, cleanup: "PASS" }, null, 2));
  console.log(`PASS: active-container shutdown/retry; ${checks.length} checks; disposable containers/network removed. Evidence: ${resolve(output, "result.json")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verify().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
