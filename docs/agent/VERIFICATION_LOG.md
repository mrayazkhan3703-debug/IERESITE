# Verification Log

Concise, append-only evidence. No secret values are recorded here.

## 2026-09-28 — Phase 00

- PASS — GitHub `main`, Render live revision and isolated source baseline all resolve to `fb6ae2208d108d7cb57d8b52826201e85c608a61` after refreshing the stale local remote reference.
- PASS — Recovery tag `iere-wave1-baseline-20260928` created at the source baseline. The original dirty checkout was not modified.
- PASS — Source inventory: 594 TypeScript/TSX files under `src`, 114 App Router pages, 117 API routes, 136 test files, 31 Prisma migration directories and the 3,085-line Admin monolith anchors from the forensic prompt.
- PASS — Supabase project `IE Website` is `ACTIVE_HEALTHY`, PostgreSQL 17 in `ap-southeast-2`; `postgis 3.3.7`, `pg_trgm 1.6` and `vector 0.8.2` are installed.
- PASS — Database migration table reports 31 completed migrations; latest is `20260925000400_ghl_webhook_payload_hash_removal`.
- FINDING — Queue state: 16 unpublished outbox events; zero queued/running/retrying/succeeded/failed/dead job runs; zero unreplayed dead letters.
- PASS — Canonical/public projection count: 3 published properties, 3 active listings, 3 coordinate-valid listings, 3 search documents and public search total 3. All 3 are explicitly demo data. No published property has assigned media.
- FINDING — Render workspace `My Workspace` has one Free Docker web service only (`srv-dasgjugjo6nc73bmlkk0`, Oregon). No worker service exists. Actual service drift: auto deploy is enabled and health path is unset even though the repository Blueprint declares the opposite.
- PASS — Live `/api/health` returned HTTP 200, database OK, Postgres search index built with size 3, and truthful degraded reason `worker-disabled-web-only-preview`.
- FINDING — Cloudflare account has one R2 bucket, `iere`. The only application media original and its three derivatives are under `public/media/` in that bucket, proving application/backup storage separation is not yet achieved.
- FINDING — Browser console records `iconUrl not set in Icon options` followed by `_leaflet_events` cleanup errors. Deferred to Phase 02 by the mandated two-phase order.
- PASS — Historical screenshot ZIP hash `bc02f6ad8136c7082dda69333840ccae9dba4ec94f98150601d880d60582bbcc`; 32 images reviewed as four contact sheets and summarized in `DESIGN_REFERENCE.md`.
- FINDING — Available blueprint file hash is `13c39a705fe5a523798172969622c39314a8dd599c8871b0dfc95eea7ae06a57`; it differs from the `(2)` blueprint hash named in the recovery brief. No `(2)` file was present, so the available blueprint plus source-anchored V4 brief were used and the mismatch is preserved as evidence.

## 2026-09-28 — Phase 01 blocked checkpoint

- PASS — Source checkpoint `72b849ae9d367ba35629af7425d3f3b669e44f03` contains the two-service Render contract, guarded role-specific startup, `WorkerHeartbeat` runtime/health reporting, Admin job diagnostics, deployment docs and the hosted-CI fixture fixes discovered while exercising the full gate.
- PASS — Supabase migration `20260928000100_worker_heartbeat` is applied; `_prisma_migrations` reports 32 completed migrations and the new RLS-enabled table/index exist.
- PASS — Cloudflare R2 bucket `iere-staging-media` is private and distinct from backup bucket `iere`. The media original plus card, hero and thumb derivatives were copied and verified by size, ETag and content type; the old bucket was not modified.
- PASS — Render web service `IERESITE` is live on revision `72b849ae9d367ba35629af7425d3f3b669e44f03` with `APP_ENV=staging`, `STAGING_WEB_ONLY=false`, `JOB_SCHEDULER_ENABLED=false` and S3 storage pointed at `iere-staging-media`.
- PASS — Live `/api/health` returns HTTP 200, database/search checks pass, PostgreSQL search size is 3 and runtime mode is `dedicated-worker`. The missing heartbeat is reported as degraded rather than hidden.
- PASS — Live `/api/search?q=&type=sale` returns 3 explicitly demo-labelled listings, matching the recorded 3 canonical published properties, 3 active listings, 3 coordinate-valid listings and 3 search documents.
- PASS — Live application media proxy returns HTTP 200 `image/png` with 429,228 bytes from the separated application-media bucket.
- PASS — Local focused gates: worker heartbeat/container contracts 6/6; backup adapter/policy tests 41/41; TypeScript typecheck and ESLint pass. Full local database/Docker execution remains unavailable on this Windows host, so hosted CI is the authoritative integration gate.
- PASS — Hosted CI run `36430334607` passes the Windows recovery policy, migrations, local-provider enforcement, lint, typecheck, unit and PostgreSQL/HTTP integration suites, active worker shutdown/retry, SMTP recovery, object archive reads, encrypted S3 backup recovery, deterministic browser seeding, all 65 accessibility journeys and the browser delivery measurement run.
- FINDING — The candidate local performance evaluator reports `/buy` mobile LCP 2,512 ms against 2,500 ms and CLS 0.1068 against 0.10. The candidate policy remains unchanged; these browser/layout findings are recorded for Phase 02.
- BLOCKED — Render offered the required background worker only on Starter at USD 7/month. The owner explicitly instructed the agent to skip it. No worker service was created, the heartbeat remains missing, and the 16 baseline pending outbox events were not claimed or represented as drained.
- NEXT SAFE ACTION — When the owner elects the recurring plan, create `iere-staging-worker` from `main` in Oregon with `/bin/sh scripts/start-staging-worker.sh`, the existing approved secrets, `JOB_SCHEDULER_ENABLED=true`, and the same revision as web; then verify heartbeat, queue drain, job runs and DLQ counts before marking Phase 01 complete.
