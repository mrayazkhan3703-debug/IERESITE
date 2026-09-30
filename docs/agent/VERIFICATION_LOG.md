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

## 2026-09-29 — Phases 02 and 03 complete

- PASS — Phase 02 source repair maps only known community slugs to local images and falls through a designed SVG placeholder; public list, detail and home cards share the fallback. Leaflet now uses explicit icon options, native marker click events, and idempotent cleanup for the map, layer refs and viewport timer.
- PASS — Repeated community/map client navigation, map mounting, image delivery and page-error coverage pass in hosted run `36563171372`; all 66 browser accessibility journeys pass.
- PASS — `/buy` mobile layout reserves space for asynchronously loaded community chips and the listings region, with a visible empty state. Fixed candidate thresholds pass at LCP 2,276 ms and CLS 0.0162 (run `36561572276`); this is lab evidence, not field Core Web Vitals.
- PASS — Phase 03 extracts the responsive Admin navigation shell, canonical section registry/role visibility, Operations overview, and public MediaPicker from `admin-view.tsx`. Nested `/admin/{section}` links work while legacy `?section=` routes remain supported; server authorization remains authoritative.
- PASS — Content editor discard protection covers dialog close, internal link navigation and browser unload; the property/project/community editor location fields now include map preview links. Existing CMS draft journey passes at `/admin/content`.
- PASS — Local production build, TypeScript check and ESLint pass. Hosted run `36563171372` (commit `9964a870d6f413b48d2cb810d0f09dbb8b0224d2`) passes Docker setup, migration checks, lint, typecheck, unit/contract, PostgreSQL/HTTP integration, worker shutdown/retry, SMTP recovery, object/archive and encrypted backup verification, all browser checks and candidate performance budgets.
- PASS — Render deployed commit `9964a870d6f413b48d2cb810d0f09dbb8b0224d2`; `/api/health`, `/communities`, `/properties/map`, and `/admin/content` respond HTTP 200. Health remains degraded because the owner-deferred worker has no heartbeat.
- BLOCKED — Phase 01 remains blocked by the owner’s instruction to skip the USD 7/month Render worker. No worker was provisioned and no queue-drain claim is made.

## 2026-09-29 — Phases 04 and 05 complete

- PASS — Hosted GitHub Actions run `36595810822` on source checkpoint `768d447e73c5af0c40564aa9fa749c6addb799f9` completed successfully. Both workflow jobs passed, including static checks, 33/33 migration verification, database/HTTP integration, worker/container recovery, media object and backup recovery, browser accessibility/responsive-image journeys, local browser delivery measurement and candidate performance budgets.
- PASS — Arabic property-detail hydration journey passes after stabilizing server/client date formatting. Property Studio create/edit/preview/publish and media/property attachment journeys pass in the browser suite.
- PASS — Render deployment `dep-datu623bc2fs73buvun0` is live at `https://ieresite.onrender.com` on the same source checkpoint.
- PASS — Live route smoke returned HTTP 200 for `/`, `/properties`, `/properties/map`, `/admin`, `/admin/media`, `/admin/properties`, `/api/health` and `/api/search?limit=9`; no server exception page surfaced.
- PASS — Live `/api/health`: database `ok=true`, PostgreSQL search index `ok=true` and built with size 3. Live search returns 3 demo-labelled listings.
- BLOCKED — Health reports `worker-heartbeat-stale-or-missing`. Phase 01 remains blocked by the owner’s deferral of the USD 7/month Render worker; no worker was provisioned and no outbox drain is claimed.
- LIMITATION — This staging site still contains demo inventory. Automated storage journeys pass, but no manual live upload to the production R2 bucket was performed; real property content and a separate storage production-readiness review remain outstanding.

## 2026-09-29 — Phases 06 and 07 local implementation checkpoint

- PASS — TypeScript `tsc --noEmit`, ESLint on `src` and `tests`, Prisma schema validation, repository filename/build-context hygiene, and `git diff --check` pass.
- FINDING — The local repository secret scan could not run because Docker Desktop's Linux engine is not available. The scanner emitted no report, so this is not recorded as a clean scan; hosted CI remains required before sign-off.
- LIMITATION — Bun is not installed on this Windows host. The new unit test and existing integration suites have not run locally; hosted CI is the test gate.
- PENDING — Hosted CI, migration `20260929000200_project_unit_studio_provenance`, and Render deployment verification after the authorized push. Phases remain IN_PROGRESS until those checks pass.

## 2026-09-29 — Phases 06 and 07 complete

- PASS — Hosted GitHub Actions run `36604426460` (run 39) passes both jobs: repository secret scan, schema/migration verification (34/34), lint, typecheck, unit and contract tests, PostgreSQL/HTTP integration, worker shutdown/retry, SMTP recovery, storage/backup checks, browser accessibility/responsive-image journeys, browser delivery measurements, and candidate performance budgets.
- PASS — The first run `36603681508` exposed two existing integration fixtures that lacked the new community/project publication requirements. The test records were corrected in `94190061a1eae85a943c5f542793c61d96c7007f`; the application publication gates remain in place and run 39 passes.
- PASS — Render deploy `dep-datv7fgu01pc73fr2c7g` is live on commit `94190061a1eae85a943c5f542793c61d96c7007f`.
- PASS — Live GET smoke returned HTTP 200 for `/`, `/properties`, `/properties/map`, `/advisor`, and `/api/health`; no server exception was returned by those routes.
- PASS — Live `/api/health` reports database and search index healthy. It truthfully reports `degraded` solely for `worker-heartbeat-stale-or-missing`; worker status is `MISSING` because the owner-deferred USD 7/month worker was not created.
- PASS — Project/payment-plan/unit Studio and community/developer/advisor workflows are implemented with audited, version-checked edits, evidence/provenance handling, publication checks, and account verification gates. Phase 06/07 CMS records need owner-supplied real facts before representing actual listings.
- UPDATE — The earlier local implementation checkpoint above is superseded by this hosted verification. The local secret scanner remained unavailable without Docker Engine; the hosted full-history credential scan passed.

## 2026-09-29 — Admin MFA sign-in requirement update

- PASS — At the owner's earlier request, Render service `IERESITE` was updated with `AUTH_MFA_REQUIRED=false`; deployment `dep-datvi0rncjis73a6iq60` is live. The login route uses this flag to skip MFA challenges for privileged accounts.
- PASS — `/admin`, `/account/login?next=%2Fadmin`, `/`, `/properties`, `/properties/map`, `/advisor` and `/api/health` all returned HTTP 200 after the deployment.
- LIMITATION — This disables the sign-in requirement; it does not erase the account's encrypted authenticator enrollment. An owner-specific authenticated login was not performed because no password was available in the workspace.

## 2026-09-30 — Phases 08 and 09 local implementation checkpoint

- PASS — Prisma schema validates with a local placeholder connection string; Prisma Client generation succeeds for the new settings/career models.
- PASS — `tsc --noEmit` passes after adding the Site Settings, public CMS page, international provenance, career workflow, sitemap, and localized routes.
- PASS — ESLint completes without diagnostics.
- PASS — Next.js optimized production build compiles and generates all 122 static pages; route inventory includes `/pages/[slug]`, `/ar/pages/[slug]`, `/careers/[slug]`, `/ar/careers/[slug]`, the career public/admin APIs, and settings APIs.
- LIMITATION — The Bun test suites and Docker-backed hosted checks have not yet run. The migration has not yet been applied to Render; hosted CI and the Render deployment/route smoke are pending.
- PENDING — Phases 08–09 remain IN_PROGRESS until hosted CI, forward migration, production deployment and public/admin route smoke all pass. Phase 01 remains owner-deferred at USD 7/month; no worker was created and no queue-drain claim is made.
