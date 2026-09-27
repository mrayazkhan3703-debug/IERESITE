# Temporary online staging (free web-only preview)

Status: **NOT DEPLOYED** until a real URL, hosted CI and online checks are recorded. This is a deliberately limited preview, **not production certification**. The owner selected free-only hosting and explicitly allowed a temporary web-only preview. Render Free does not support background workers or pre-deploy commands, so `render.yaml` defines one web service, with `JOB_SCHEDULER_ENABLED=false`; database-backed jobs queue but do not run. Do not exercise or claim async media/CRM/email/alert workflows. The separate local Docker worker and ten preserved local DEAD jobs are untouched.

## Preconditions and source publication

1. Use the secret-free `staging-safe-*` orphan root commit, not the existing local `main` history: the latter tracked `.env` in an earlier commit. Confirm `git ls-remote --heads origin` is empty before first push, inspect the candidate tree, run repository hygiene and secret checks, then push the candidate ref to `main`. Never force-push an existing remote branch or publish the old history.
2. GitHub authentication and a connected Render account are required. `render.yaml` has `autoDeployTrigger: "off"`; connecting it does not authorize automatic releases. Hosted GitHub CI must finish before manually deploying. The existing public GitHub repository is `https://github.com/mrayazkhan3703-debug/IERESITE.git`.
3. Do not use the dedicated private backup R2 bucket `iere` for application media. Provide a distinct staging application bucket and separate S3-compatible application credentials. No real property/DLD data or demo seed is deployed automatically.
4. Before creating any staging account or importing content, run the read-only clean-bootstrap check below against the **separate staging database** after migrations. It verifies the checked-out revision's migration count, RBAC foundations, required extensions and zero rows in 27 operational/demo-sensitive tables. It neither seeds nor deletes data. A pass is not provenance approval for later imports. Do not put it in recurring web startup: once legitimate data exists, it must fail.

```powershell
# In a secure staging operator shell with APP_ENV=staging and the separate PostgreSQL DATABASE_URL set:
bun --no-env-file scripts/check-clean-bootstrap.ts
# Exit 0: PASS_CLEAN_BOOTSTRAP. Exit 2: FAIL_CLEAN_BOOTSTRAP with reason codes, no row values.
```

## Render setup

The Blueprint defines a Free Docker web service only. It uses the existing pinned Bun Dockerfile, binds `0.0.0.0:3000`, runs pending Prisma migrations before listening, and fails closed if migrations fail. Render's Free plan may sleep after inactivity, has an ephemeral filesystem and limited memory; these are accepted only for preview, not SLO or queue verification. The migration command is in `scripts/start-staging-web.sh` because the Free plan lacks a pre-deploy hook. Do not add a paid worker/service without a new owner decision.

Set each `sync: false` field in the Render dashboard, never in Git, a public issue or a chat message:

| Variable | Required source / condition |
| --- | --- |
| `APP_URL` | Actual `https://…onrender.com` URL after service name is assigned; set the same exact origin. |
| `DATABASE_URL` | PostgreSQL connection for a **separate staging database** with approved PostGIS, `pg_trgm` and `vector` migration privileges; use the actual Supabase dashboard connection string if Supabase is selected. A local SQLite URL is not usable. |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Staging **application-media** S3-compatible store, publicly reachable HTTPS endpoint for presigned links, private bucket, limited application credentials. Bucket must differ from backup bucket `iere`. |
| `GEMINI_API_KEY` | Existing Gemini key; verify model entitlement and budget with an explicit limited staging request. |
| `IP_PSEUDONYM_KEY` | Existing restricted key of at least 32 characters for IP pseudonyms; keep outside Git. |

`NODE_ENV=production` and `APP_ENV=staging` are intentional: Next runs its production build while sessions use Secure cookies. CRM is localdev/live-off, outbound email has no SMTP transport, and no GHL/email tests are required for this preview. `SEARCH_PROVIDER=postgres`; Redis is not necessary for the current DB-backed outbox but async work is deliberately paused. `TRUSTED_PROXY_HOPS` defaults to zero (fail-closed `unknown` IP); set it only after observing and validating Render's trusted forwarding chain. Admin account setup must be authorized separately; do not run the broad demo/property seed on an unreviewed database.

Without an email transport, registration/verification and password recovery cannot be certified in this preview. Privileged Admin sign-in also requires its separate MFA encryption secret and a deliberately provisioned account; do not claim an authenticated/Admin journey from anonymous smoke tests. Configure those only through the host's secret settings when that journey is approved.

## Online verification (record actual results)

After CI is green and manual deploy succeeds, record the assigned URL and revision in `docs/agent/VERIFICATION_LOG.md` without secrets. Check `/api/health` returns HTTP 200 with `env: staging`, `status: degraded` and `checks.jobRunner.mode: disabled-web-only-preview`; verify EN `/`, AR `/ar`, at least one public property/404 route, image and font assets, HTTPS redirect and certificate, CSP/security headers, robots/noindex staging policy, browser console/network failures, mobile viewport and RTL. Test unauthenticated auth/API responses first. Authenticated and admin writes require a deliberately created staging account and database isolation. Verify storage with a disposable object in the **application** bucket and remove only that fixture. Verify Gemini only with a bounded approved staging prompt; no fabricated answer or provider success. Monitor server logs for errors while testing. Preserve all ten local DEAD records; do not replay/delete them.

If web-only preview is online, label it **STAGING ONLINE — TESTABLE (WEB-ONLY)**, with async/worker flows unverified. Never label it **PRODUCTION CERTIFIED**. A full staging topology later needs a dedicated worker, queue operation and secure operational hosting; final human/legal/security, source, provider, backup cadence/retention and incident gates remain open.

## Rollback

Render manual deploys should target only a reviewed source revision. If startup or health fails, stop the attempt and restore the last verified deployment revision via the host's deploy rollback. Database migrations are not automatically rolled back; review the failed migration and restore from a verified staging-specific backup if necessary. The source-only checkpoint and candidate Git ref are recorded in `docs/agent/EXECUTION_STATE.md`; local working containers and backups are not part of this staging preview.
