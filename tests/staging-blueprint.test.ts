import { describe, expect, test } from "bun:test";

type EnvVar = { key: string; value?: string; sync?: boolean };
type Service = {
  name: string;
  type: string;
  runtime: string;
  region: string;
  plan: string;
  autoDeployTrigger: string;
  dockerCommand: string;
  healthCheckPath?: string;
  maxShutdownDelaySeconds?: number;
  envVars: EnvVar[];
};

const blueprint = Bun.YAML.parse(await Bun.file("render.yaml").text()) as { services: Service[] };

function env(service: Service, key: string): EnvVar | undefined {
  return service.envVars.find((entry) => entry.key === key);
}

describe("online staging Blueprint", () => {
  const web = blueprint.services.find((service) => service.type === "web")!;
  const worker = blueprint.services.find((service) => service.type === "worker")!;

  test("deploys one web service and one dedicated background worker", () => {
    expect(blueprint.services).toHaveLength(2);
    expect(web.name).toBe("IERESITE");
    expect(web.runtime).toBe("docker");
    expect(web.region).toBe("oregon");
    expect(web.plan).toBe("free");
    expect(web.autoDeployTrigger).toBe("commit");
    expect(web.healthCheckPath).toBe("/api/health");
    expect(web.dockerCommand).toBe("/bin/sh scripts/start-staging-web.sh");
    expect(worker.name).toBe("iere-staging-worker");
    expect(worker.runtime).toBe("docker");
    expect(worker.region).toBe(web.region);
    expect(worker.plan).toBe("starter");
    expect(worker.autoDeployTrigger).toBe("commit");
    expect(worker.dockerCommand).toBe("/bin/sh scripts/start-staging-worker.sh");
    expect(worker.maxShutdownDelaySeconds).toBe(120);
  });

  test("enforces exclusive scheduler ownership and the separate media bucket", () => {
    for (const service of [web, worker]) {
      expect(env(service, "APP_ENV")?.value).toBe("staging");
      expect(env(service, "STAGING_WEB_ONLY")?.value).toBe("false");
      expect(env(service, "NODE_ENV")?.value).toBe("production");
      expect(env(service, "STORAGE_PROVIDER")?.value).toBe("s3");
      expect(env(service, "S3_REGION")?.value).toBe("auto");
      expect(env(service, "S3_BUCKET")?.value).toBe("iere-staging-media");
    }
    expect(env(web, "JOB_SCHEDULER_ENABLED")?.value).toBe("false");
    expect(env(worker, "JOB_SCHEDULER_ENABLED")?.value).toBe("true");
  });

  test("keeps deployment secrets outside source", () => {
    for (const service of [web, worker]) {
      for (const key of [
        "DATABASE_URL", "S3_ENDPOINT", "S3_PUBLIC_ENDPOINT", "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY", "GEMINI_API_KEY", "IP_PSEUDONYM_KEY",
      ]) {
        expect(env(service, key)?.sync).toBe(false);
        expect(env(service, key)?.value).toBeUndefined();
      }
    }
    expect(env(web, "APP_URL")?.sync).toBe(false);
  });

  test("web and worker startup fail closed and migrate before serving work", async () => {
    const webScript = await Bun.file("scripts/start-staging-web.sh").text();
    const workerScript = await Bun.file("scripts/start-staging-worker.sh").text();
    for (const script of [webScript, workerScript]) {
      expect(script).toContain("set -eu");
      expect(script).toContain("STAGING_WEB_ONLY");
      expect(script).toContain("JOB_SCHEDULER_ENABLED");
      expect(script.indexOf("exit 1")).toBeLessThan(script.indexOf("bun run db:migrate:deploy"));
    }
    expect(webScript.indexOf("bun run db:migrate:deploy")).toBeLessThan(webScript.indexOf("exec bun .next/standalone/server.js"));
    expect(workerScript.indexOf("bun run db:migrate:deploy")).toBeLessThan(workerScript.indexOf("exec bun run worker"));
  });
});
