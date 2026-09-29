# Execution State

- Source baseline commit: `fb6ae2208d108d7cb57d8b52826201e85c608a61`
- Current branch: `codex/production-recovery-wave1`
- Current source checkpoint: `72b849ae9d367ba35629af7425d3f3b669e44f03`
- Deployment environment: Render staging at `https://ieresite.onrender.com`
- Last completed phase: Phase 00 (`9389a1afd4c533776fbcd63a002874df4fd09bb3`)
- Current phase status: Phase 01 BLOCKED — the owner explicitly deferred the paid Render background worker on 2026-09-28.
- Last verified migration: `20260928000100_worker_heartbeat` (32/32 applied)
- Last verified implementation deployment: `72b849ae9d367ba35629af7425d3f3b669e44f03` (web only)

## Completed phase evidence

- Phase 00: baseline, topology, source map, design reference, phase checklist and CMS gap matrix recorded.
- Files changed: `docs/agent/{EXECUTION_STATE,VERIFICATION_LOG,SOURCE_MAP,DESIGN_REFERENCE,PHASE_CHECKLIST,CMS_GAP_MATRIX}.md`.
- Migrations: none.
- Commands/checks: remote Git comparison; route/API/test/migration inventory; Render service/deploy/log inspection; Supabase migration/extensions/count reconciliation; Cloudflare R2 bucket inspection; live health/search/map requests; browser console capture; 32-image contact-sheet review.
- Browser/manual checks: live home exposes 3 demo listings but logs the Leaflet `iconUrl` and `_leaflet_events` failures recorded for Phase 02.
- Phase 01 implemented checkpoint: `3f1ee8ca347329143416d9dc2193409c9202832e`; CI fixture follow-ups: `9701e13cbc78f1a86c0c33fcc1f39749a372a8e7`, `7b34dd6544bce3eeeb12ffb77a8193cd0cd130bf`, `95702b9a2240ad38b830ec4bf393c17c47ef4a90`, `81e17f060f4ade979f486ac6a4416d7a75b39db6`, `335ca81486c736c30331890358e1de6e5c34903d`, `72b849ae9d367ba35629af7425d3f3b669e44f03`.
- Phase 01 completed work: two-service Blueprint contract, guarded web/worker startup scripts, database-visible worker heartbeat, health/Admin diagnostics, separate private `iere-staging-media` R2 bucket, copied and verified media objects, Render web env separation, migration deploy, cross-platform build asset copy and deployment/capability documentation.

## In-progress work

- Exact task: provision `iere-staging-worker` on Render Starter and verify its heartbeat, same-revision contract and bounded outbox drain.
- Exact files/symbols involved: no source change is currently required; deploy `render.yaml` worker contract using `/bin/sh scripts/start-staging-worker.sh` and the existing Render secrets.
- Remaining checklist: owner authorizes the recurring worker cost; create the worker; verify live heartbeat; verify web/worker revision parity; drain the 16 baseline pending outbox events; record job/DLQ counts.
- Known blocker: the only available Render background-worker plan shown by the dashboard is Starter at USD 7/month. The owner instructed the agent to skip it for now. Live `/api/health` therefore truthfully reports `worker-heartbeat-stale-or-missing`; no queue-drain claim is made.

## Next phase

- Phase 02: P0 browser/runtime repair.
- Phase 03: Admin 2.0 shell.
- Read first: `src/views/communities-view.tsx`, `src/views/community-detail-view.tsx`, `src/components/home/community-intelligence.tsx`, `src/views/map-view.tsx`, `src/app/admin/page.tsx`, `src/views/admin/admin-view.tsx`, `src/app/globals.css`, `docs/agent/DESIGN_REFERENCE.md`.

## Rollback

- Safe source tag: `iere-wave1-baseline-20260928` -> `fb6ae2208d108d7cb57d8b52826201e85c608a61`.
- DB note: Phase 01 applied `20260928000100_worker_heartbeat`; use forward fixes and never reset the shared Supabase database.
- Workspace note: the original `F:\\IERE Website` checkout remains dirty and untouched. Wave 1 runs in the managed worktree at `C:\\Users\\mraya\\.codex\\worktrees\\production-recovery-wave1\\IERE Website`.
