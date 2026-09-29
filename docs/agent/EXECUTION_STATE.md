# Execution State

- Source baseline commit: `fb6ae2208d108d7cb57d8b52826201e85c608a61`
- Current branch: `codex/production-recovery-wave1`
- Current source checkpoint: `94190061a1eae85a943c5f542793c61d96c7007f`
- Deployment environment: Render staging at `https://ieresite.onrender.com`
- Last completed phase: Phase 05 (`768d447e73c5af0c40564aa9fa749c6addb799f9`)
- Current phase status: Phases 02–07 COMPLETE; Phase 01 remains BLOCKED because the owner explicitly deferred the paid Render background worker on 2026-09-28.
- Last verified migration: `20260929000200_project_unit_studio_provenance` (34/34 applied in hosted CI)
- Last verified implementation deployment: `94190061a1eae85a943c5f542793c61d96c7007f` / Render deploy `dep-datv7fgu01pc73fr2c7g` (live; Phases 06–07)

## Completed phase evidence

- Phase 00: baseline, topology, source map, design reference, phase checklist and CMS gap matrix recorded.
- Files changed: `docs/agent/{EXECUTION_STATE,VERIFICATION_LOG,SOURCE_MAP,DESIGN_REFERENCE,PHASE_CHECKLIST,CMS_GAP_MATRIX}.md`.
- Migrations: none.
- Commands/checks: remote Git comparison; route/API/test/migration inventory; Render service/deploy/log inspection; Supabase migration/extensions/count reconciliation; Cloudflare R2 bucket inspection; live health/search/map requests; browser console capture; 32-image contact-sheet review.
- Browser/manual checks: live home exposes 3 demo listings but logs the Leaflet `iconUrl` and `_leaflet_events` failures recorded for Phase 02.
- Phase 01 implemented checkpoint: `3f1ee8ca347329143416d9dc2193409c9202832e`; CI fixture follow-ups: `9701e13cbc78f1a86c0c33fcc1f39749a372a8e7`, `7b34dd6544bce3eeeb12ffb77a8193cd0cd130bf`, `95702b9a2240ad38b830ec4bf393c17c47ef4a90`, `81e17f060f4ade979f486ac6a4416d7a75b39db6`, `335ca81486c736c30331890358e1de6e5c34903d`, `72b849ae9d367ba35629af7425d3f3b669e44f03`.
- Phase 01 completed work: two-service Blueprint contract, guarded web/worker startup scripts, database-visible worker heartbeat, health/Admin diagnostics, separate private `iere-staging-media` R2 bucket, copied and verified media objects, Render web env separation, migration deploy, cross-platform build asset copy and deployment/capability documentation.

## Deferred Wave 1 item

- Exact task: provision `iere-staging-worker` on Render Starter and verify its heartbeat, same-revision contract and bounded outbox drain.
- Exact files/symbols involved: no source change is currently required; deploy `render.yaml` worker contract using `/bin/sh scripts/start-staging-worker.sh` and the existing Render secrets.
- Remaining checklist: owner authorizes the recurring worker cost; create the worker; verify live heartbeat; verify web/worker revision parity; drain the 16 baseline pending outbox events; record job/DLQ counts.
- Known blocker: the only available Render background-worker plan shown by the dashboard is Starter at USD 7/month. The owner instructed the agent to skip it for now. Live `/api/health` therefore truthfully reports `worker-heartbeat-stale-or-missing`; no queue-drain claim is made.

## Completed phases 04 and 05

- Phase 04: Media Library 2.0. Phase 05: Property Studio. Source checkpoint `768d447e73c5af0c40564aa9fa749c6addb799f9`.
- Hosted CI run `36595810822` passes both workflow jobs, including 33/33 migrations, lint, typecheck, unit/contract and PostgreSQL/HTTP integration, worker shutdown/retry, SMTP recovery, object archive restore, encrypted S3 adapter recovery, all browser accessibility/responsive-image journeys, Arabic property-detail hydration, and candidate local performance budgets.
- Render deploy `dep-datu623bc2fs73buvun0` is live on the same source checkpoint. Live HTTP 200 smoke: `/`, `/properties`, `/properties/map`, `/admin`, `/admin/media`, `/admin/properties`, `/api/health`, `/api/search?limit=9`.
- Live database and search-index checks pass; the public search returns 3 clearly demo-labelled listings. Health remains degraded only for `worker-heartbeat-stale-or-missing`; the USD 7/month background worker remains owner-deferred and no queue-drain claim is made.
- Media workflows include upload, filtering/search, usage graph, picker, gallery ordering/cover, property floor plans/documents and guarded unused-media deletion. Automated storage journeys pass; a manual upload against the production R2 bucket was not performed.
- Property Studio supports create/edit/preview/publish lifecycle, metadata/SEO, audited price history, media assets, and synchronous search projection refresh without relying on the unavailable worker.
- This is a staging service and its demo inventory is not real owner-approved listing data. Project, unit, community, developer and advisor records still need owner-provided, sourced inventory before they can represent live facts.

## Phases 06 and 07 implementation checkpoint

- Scope: Project Studio, payment plans, project documents and galleries, unit CRUD/import provenance, communities, developer verification, and private-to-public advisor onboarding.
- A forward-only migration adds imported-unit provenance and availability history, plus developer verification evidence. No shared database was reset or modified from this workspace.
- Local checks passed: TypeScript, ESLint, Prisma schema validation, repository filename/build-context hygiene, and `git diff --check`.
- Hosted Docker CI run `36604426460` passes both jobs, including the full-history/source credential scan, 34/34 migration verification, lint, typecheck, unit tests, PostgreSQL/HTTP integration, worker recovery, SMTP, storage/backup, all browser accessibility journeys, delivery measurements and performance budgets. Bun and Docker Engine were unavailable locally; hosted CI provided those full gates.
- The first CI attempt `36603681508` found two integration fixtures that did not meet the new community/project publishing requirements. The fixtures were corrected without weakening the publishing gates, then all suites passed in run `36604426460`.
- Render deploy `dep-datv7fgu01pc73fr2c7g` is live on the verified checkpoint. Smoke returned HTTP 200 for `/`, `/properties`, `/properties/map`, `/advisor`, and `/api/health`.
- Live health reports database and search index OK. It remains `degraded` only for `worker-heartbeat-stale-or-missing`; the worker status is `MISSING` because its USD 7/month service remains deferred.
- The advisor public-profile gate requires an active, email-verified AGENT account; new profiles remain private. Developer verification requires an owner/admin and a source URL; payment-plan VERIFIED status requires an owner/admin and a source document.
- Test and source evidence establishes CMS readiness, but the staging site still uses demo inventory. Do not represent demo or unsourced values as owner-approved real estate facts.
- Phases 08 onward have not been started.

## Next phase

- Phase 08: Page/Content Studio and settings, after Phases 06–07 pass hosted verification.
- Read first: `docs/agent/PHASE_CHECKLIST.md`, `docs/agent/CMS_GAP_MATRIX.md`, `docs/agent/DESIGN_REFERENCE.md`, `src/features/admin/`, and the relevant project and unit APIs.

## Rollback

- Safe source tag: `iere-wave1-baseline-20260928` -> `fb6ae2208d108d7cb57d8b52826201e85c608a61`.
- DB note: Phase 01 applied `20260928000100_worker_heartbeat`; Phase 06 applied `20260929000200_project_unit_studio_provenance` in the verified CI database. Use forward fixes and never reset the shared Supabase database.
- Workspace note: the original `F:\\IERE Website` checkout remains dirty and untouched. Wave 1 runs in the managed worktree at `C:\\Users\\mraya\\.codex\\worktrees\\production-recovery-wave1\\IERE Website`.
