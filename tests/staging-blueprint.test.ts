import { describe, expect, test } from "bun:test";

type EnvVar = { key: string; value?: string; sync?: boolean };
type Service = {
  name: string;
  type: string;
  runtime: string;
  plan: string;
  autoDeployTrigger: string;
  dockerCommand: string;
  healthCheckPath: string;
  envVars: EnvVar[];
};

const blueprint = Bun.YAML.parse(await Bun.file("render.yaml").text()) as { services: Service[] };

function env(service: Service, key: string): EnvVar | undefined {
  return service.envVars.find((entry) => entry.key === key);
}

describe("temporary free staging Blueprint", () => {
  const web = blueprint.services[0]!;

  test("deploys only a free web service with no automatic release", () => {
    expect(blueprint.services).toHaveLength(1);
    expect(web.type).toBe("web");
    expect(web.runtime).toBe("docker");
    expect(web.plan).toBe("free");
    expect(web.autoDeployTrigger).toBe("off");
    expect(web.healthCheckPath).toBe("/api/health");
    expect(web.dockerCommand).toBe("/bin/sh scripts/start-staging-web.sh");
    expect(env(web, "APP_ENV")?.value).toBe("staging");
    expect(env(web, "STAGING_WEB_ONLY")?.value).toBe("true");
    expect(env(web, "NODE_ENV")?.value).toBe("production");
    expect(env(web, "JOB_SCHEDULER_ENABLED")?.value).toBe("false");
  });

  test("deployment-specific values and secrets remain outside source", () => {
    for (const key of [
      "APP_URL", "DATABASE_URL", "S3_ENDPOINT", "S3_PUBLIC_ENDPOINT", "S3_REGION",
      "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
      "GEMINI_API_KEY", "IP_PSEUDONYM_KEY",
    ]) {
      expect(env(web, key)?.sync).toBe(false);
      expect(env(web, key)?.value).toBeUndefined();
    }
    expect(env(web, "STORAGE_PROVIDER")?.value).toBe("s3");
    expect(env(web, "SEARCH_PROVIDER")?.value).toBe("postgres");
    expect(env(web, "AI_PROVIDER")?.value).toBe("gemini");
    expect(env(web, "CRM_LIVE_ENABLED")?.value).toBe("false");
    expect(env(web, "EMAIL_PROVIDER")?.value).toBe("localdev");
  });

  test("free-plan startup fails closed before migration and serves only after it", async () => {
    const script = await Bun.file("scripts/start-staging-web.sh").text();
    expect(script).toContain("set -eu");
    expect(script).toContain("STAGING_WEB_ONLY");
    expect(script).toContain("JOB_SCHEDULER_ENABLED");
    expect(script.indexOf("exit 1")).toBeLessThan(script.indexOf("bun run db:migrate:deploy"));
    expect(script.indexOf("bun run db:migrate:deploy")).toBeLessThan(script.indexOf("exec bun .next/standalone/server.js"));
  });
});
