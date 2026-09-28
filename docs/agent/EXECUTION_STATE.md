# Execution State

- Source baseline commit: `fb6ae2208d108d7cb57d8b52826201e85c608a61`
- Current branch: `codex/production-recovery-wave1`
- Current HEAD at phase start: `fb6ae2208d108d7cb57d8b52826201e85c608a61`
- Deployment environment: Render staging at `https://ieresite.onrender.com`
- Last completed phase: Phase 00
- Current phase status: COMPLETE
- Last verified migration: `20260925000400_ghl_webhook_payload_hash_removal` (31/31 applied)
- Last deployed revision: `fb6ae2208d108d7cb57d8b52826201e85c608a61`

## Completed phase evidence

- Phase 00: baseline, topology, source map, design reference, phase checklist and CMS gap matrix recorded.
- Files changed: `docs/agent/{EXECUTION_STATE,VERIFICATION_LOG,SOURCE_MAP,DESIGN_REFERENCE,PHASE_CHECKLIST,CMS_GAP_MATRIX}.md`.
- Migrations: none.
- Commands/checks: remote Git comparison; route/API/test/migration inventory; Render service/deploy/log inspection; Supabase migration/extensions/count reconciliation; Cloudflare R2 bucket inspection; live health/search/map requests; browser console capture; 32-image contact-sheet review.
- Browser/manual checks: live home exposes 3 demo listings but logs the Leaflet `iconUrl` and `_leaflet_events` failures recorded for Phase 02.

## In-progress work

- Exact task: none; Phase 00 is checkpointed before Phase 01 begins.
- Exact files/symbols being edited: none.
- Remaining checklist: execute Phase 01 only.
- Known failing condition: one Render web service only; 16 unpublished outbox events, zero job runs; application media objects are stored in backup bucket `iere`.

## Next phase

- Phase 01: online web + worker topology, migration gate, worker/queue health, separate application media bucket, deployment verification.
- Read first: `render.yaml`, `scripts/start-staging-web.sh`, `src/worker.ts`, `src/server/jobs/outbox.ts`, `src/app/api/health/route.ts`, `src/app/api/admin/jobs/route.ts`, `src/server/storage/object-store.ts`, `docs/STAGING_DEPLOYMENT.md`.

## Rollback

- Safe source tag: `iere-wave1-baseline-20260928` -> `fb6ae2208d108d7cb57d8b52826201e85c608a61`.
- DB note: Phase 00 adds no migration and performs no write. Phase 01 must use forward fixes; never reset the shared Supabase database.
- Workspace note: the original `F:\\IERE Website` checkout remains dirty and untouched. Wave 1 runs in the managed worktree at `C:\\Users\\mraya\\.codex\\worktrees\\production-recovery-wave1\\IERE Website`.
