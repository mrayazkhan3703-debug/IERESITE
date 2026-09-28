# Online staging deployment

Status: **STAGING ONLINE — TESTABLE** only after both Render services report the same Git revision, /api/health reports a current worker heartbeat, and the outbox drain check passes. This environment remains outside production certification until the later browser, security, accessibility and full journey phases pass.

## Runtime topology

| Capability | Staging runtime | State and boundary |
| --- | --- | --- |
| Web | Render Docker web service IERESITE | JOB_SCHEDULER_ENABLED=false; HTTP health at /api/health; startup runs prisma migrate deploy before binding |
| Worker | Render Docker background worker iere-staging-worker | Same repository/branch/image contract as web; JOB_SCHEDULER_ENABLED=true; graceful shutdown allowance 120 seconds |
| Database | Supabase PostgreSQL | Canonical records, transactional outbox, queue and worker heartbeat; migrations only, never reset/seed during deploy |
| Storage | Private Cloudflare R2 bucket iere-staging-media | Application originals and derivatives; served through application routes; r2.dev remains disabled |
| Backups | Private Cloudflare R2 bucket iere | Backup boundary; no new application-media writes |
| Search | PostgreSQL projection | Worker drains outbox and maintains SearchDocument; Typesense is not required for this phase |
| AI | Gemini adapter and feature flag | May run only when configured; provider success is verified separately and never inferred from topology |
| CRM | Local adapter, live delivery off | Intentionally deferred; no GHL delivery claim |
| Email | Local adapter | Intentionally deferred; no delivery or recovery-email claim |

The web process reads the worker's database heartbeat. A missing, stopped or older-than-60-second heartbeat produces status degraded with worker-heartbeat-stale-or-missing. Queue counts and the same worker state are available to authorized operators at /api/admin/jobs.

## Source-controlled Render contract

render.yaml defines the two services in Oregon. Both follow main, build from the same Dockerfile and use automatic deploys for the same commit. The web service runs scripts/start-staging-web.sh; the worker runs scripts/start-staging-worker.sh. Each script validates its role, applies pending migrations with Prisma's deploy command, and then starts only its assigned process.

Set deployment secrets in Render. Keep their values out of Git and operational notes:

| Variable | Web | Worker | Source / condition |
| --- | --- | --- | --- |
| DATABASE_URL | required | required | Same approved Supabase connection |
| APP_URL | required | optional | Exact https://ieresite.onrender.com origin |
| S3_ENDPOINT, S3_PUBLIC_ENDPOINT | required | required | Cloudflare R2 S3 endpoint |
| S3_REGION | auto | auto | Required R2 signing region |
| S3_BUCKET | iere-staging-media | iere-staging-media | Must differ from backup bucket iere |
| S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY | required | required | Existing restricted R2 application credentials |
| GEMINI_API_KEY | when live AI is enabled | when AI jobs run | Existing provider secret |
| IP_PSEUDONYM_KEY | required | required | At least 32 characters |

Role-specific values are fixed in the Blueprint:

- Web: APP_ENV=staging, STAGING_WEB_ONLY=false, JOB_SCHEDULER_ENABLED=false.
- Worker: APP_ENV=staging, STAGING_WEB_ONLY=false, JOB_SCHEDULER_ENABLED=true, JOB_INTERVAL_MS=15000, WORKER_HEALTH_PORT=3001.

## Migration and release gate

1. Run bun install --frozen-lockfile, bun run db:generate, typecheck, lint, unit tests, integration tests and build against the candidate revision.
2. Push the reviewed revision. Both services must resolve to the same RENDER_GIT_COMMIT.
3. Confirm prisma migrate deploy reports all migrations applied. Do not use prisma migrate reset or db:seed.
4. Confirm /api/health returns HTTP 200, env staging, checks.jobRunner.mode dedicated-worker, checks.jobRunner.worker.ok true, and no worker degradation reason.
5. Confirm Admin jobs data reports the same live heartbeat and exposes pending outbox, recent events, job runs and unreplayed dead letters.
6. Create or identify a bounded, idempotent test outbox event. Confirm the worker publishes it, creates the expected job when applicable, and reduces pending work to the expected low or zero state without replaying unrelated dead letters.
7. Confirm the web and worker revisions match and record counts for canonical published properties, active listings, coordinates, search documents and the public API total.
8. Fetch one application media item through /api/media/{id}/content; confirm its object and derivatives exist in iere-staging-media with matching sizes/checksums.

## Rollback

Use Render's last verified deploy for source rollback. Migrations use forward fixes on the shared database and are never automatically reversed. If the worker causes unexpected processing, suspend the worker service first, preserve queue rows and logs, then fix forward. The source baseline tag is recorded in docs/agent/EXECUTION_STATE.md.
