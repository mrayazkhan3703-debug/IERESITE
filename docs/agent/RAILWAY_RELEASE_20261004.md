# Railway release — 4 October 2026

## Superseding release at 13:08 UTC

The later exact passing application `33ace798` / CI `37201990279` completes unlimited website Advisor quotas, ten semantically successful actual Mercury turns, durable replay/reload, authorized scoped backup retention, preserved recovery pins and fresh hosted recovery. All original company fingerprints and media hashes pass. [RAILWAY_UNLIMITED_RETENTION_20261004.md](RAILWAY_UNLIMITED_RETENTION_20261004.md) is the current report; quota-reset and pending-retention statements below describe the earlier release. CRM/company SMTP remain skipped, owner content/domain/privacy dependencies remain outstanding, and customer launch is not declared complete.

## Scope

Company testing on Railway continues. CRM sync, company SMTP and unnecessary bulk adapters remain deferred. Demo inventory labels, real profiles, owner changes and media are preserved. Customer launch is not accepted.

## Release gate

Application commit: `19476d9b0498601446a594766328eb983289de44`.

[Full CI 37192779736](https://github.com/mrayazkhan3703-debug/IERESITE/actions/runs/37192779736) passed. Its tested merge `ae0266b9b8a2fa067b116bb1e1069fbbbc4a665e` and release commit have the identical tree `b8ff528199a741d87814d968c6ca9aa63367eea7`.

Observed results: optimized build, lint, typecheck, credential scan, Windows recovery policy, 427 unit/contract tests, 163 PostgreSQL/HTTP integration tests, 75 encrypted backup adapter contracts, 121 browser accessibility/responsive journeys and 16 delivery measurements pass. All eight candidate local performance cases have no budget failures; these are not field Core Web Vitals. Worker shutdown/retry and isolated object recovery also pass. Browser screenshots and receipts are retained in ignored `test-results/ci-37192779736`.

The earlier candidate `d66bfa2` failed the new unknown-community integration check and was never deployed. The intermediate `81b9f43` run was cancelled to finish the bilingual short-term UI contract; it is not counted as a complete passing release. The standalone Windows-wide suite lacked DATABASE_URL; full database-backed acceptance comes from the passing disposable CI stack.

## Advisor corrections

- Unspecified transaction preference searches SALE, RENT and SHORT_TERM together, using the existing bounded search pipeline. Explicit preferences and the public search default remain unchanged.
- Unicode community resolution preserves unknown and ambiguous criteria instead of silently matching an unrelated area.
- Property attachments and English/Arabic intent chips distinguish short-term rental from sale. Rental frequency is displayed only when recorded; a missing period is not invented.
- Source guidance distinguishes recorded inventory, labelled demos and independently verified facts. Approved knowledge claims require returned approved citations.
- Concord Tower remains published with the owner's no-expiry choice and recorded price/location/type. No company facts were corrected or invented.

Ten earlier actual Mercury requests returned HTTP 200 without fallback, with durable replay/reload. Semantic review rejected several replies, including a false no-match for Concord Tower. Transport success alone does not meet full conversational acceptance.

Four actual post-release turns returned HTTP 200 without fallback (2.7–4.3 seconds). The named lookup now returns Concord Tower with SHORT_TERM, AED 5,454 and a null rental period; it explicitly says recorded facts are not independently verified. Arabic follow-up retains the recorded price/type without inventing a rental period, but does not confidently recover the demo flag from the previous answer. Capability wording still describes approved knowledge hypothetically; approved-source acceptance remains unavailable. Arabic sale search identifies demo records separately; its first invalid tool request is BLOCKED and the corrected call succeeds. This is not ten clean final-release turns. Identical replay and durable reload pass. Further generation stops at 57,589/60,000 reserved daily tokens rather than raising/resetting the budget. Receipts: `test-results/advisor-listing-release-20261004.json`.

## Deployment and live checks

Deployments requested from the exact passing application commit:

- Web: `f127c364-c0f6-4a64-8e5b-04c3e39fb5a0`.
- Worker: `2f6da1c4-21c4-4124-9926-79df1b131f7e`.

Both deployments are SUCCESS from the exact passing commit. Startup reports 44 migrations and none pending; the predecessor Worker is REMOVED. Worker heartbeat reports the release revision, zero outbox pending and zero dead letters. Ten checked English/Arabic/public/login routes return 200 without the reported server-side exception. Staging noindex remains. Startup commands, database, R2 references, no-seed settings, scheduled backups, disabled deletion and deferred integrations are preserved. Autodeploy remains disabled.

Read-only before/after fingerprints match for every one of 29 profiles, 24 properties and 58 media records: no changed, missing or new records. All five transferred company media objects match persisted stored hashes and R2/public bytes; private media returns anonymous 404. Concord Tower remains PUBLISHED with no expiry. Imran remains visible in both locales; the owner's later hidden Hammad profile remains hidden. No login accounts or company records were created by this release verification.

The first backup after deployment reached ENCRYPT_UPLOAD and completed only its database archive. Its incomplete run `d84f43161de64eaba6d79e39fdf0c9d4` has no receipt and is unusable; it never replaced the last verified pointer. At 10:19 UTC the Worker was restarted once after six minutes without progress; interrupted capture cleanup PASS. Backup implementation/configuration is unchanged from the earlier successful version; no precise underlying stall cause is claimed from available logs.

Fresh capture `98348fdb393b434687d7f9effb8ae8e0`, snapshot 10:19:38.348 UTC, verified 10:20:10.905 UTC, completes at 10:20:16 UTC with ciphertext readback/cleanup PASS and stale-prior false. The latest R2 pointer independently reads back this run. Post-restart worker heartbeat remains fresh at release revision, zero pending/dead-letter jobs and all ten routes pass again. No incomplete or historic remote objects are automatically deleted.

Live CMS inspection shows empty creation fields, inline Gallery/Floor plans/Documents/Cover uploads and existing-library selection, plus Save draft / Save & publish. The untouched form was cancelled; no records/uploads were added. Screenshot: `test-results/railway-inline-media-publish-20261004.jpg`.

## Hosted recovery and observed schedule

Actual Railway capture `a43857db13d74050936bc7f4a9f90e61` passed encrypted readback/download/decryption and isolated restoration: 119 tables, 44 migrations, 123 referenced R2/static objects (40,110,279 bytes), application permissions, public images/video/ranges and an actual owner-private Portfolio PDF with anonymous/other-user denial. Isolated probes were removed, post-delivery counts pass, outbound jobs were disabled and owned resources cleaned. The 18.445-second scripted restore is not an incident RTO.

The existing Worker performs hosted capture independently of Windows, sharing its service lifecycle and resource budget. The private age identity remains local; only public recipients are hosted. The owner confirmed a separate key copy.

| Capture | Source snapshot UTC | Completed UTC | Readback/cleanup | Prior stale |
| --- | --- | --- | --- | --- |
| `0a2633008ab9417d8b45c0ef16624d4c` | 08:52:52.723 | 08:53:31.851 | PASS | Yes, overnight gap |
| `379832849efc4eb890aa405055e78dcd` | 09:22:52.618 | 09:23:32.516 | PASS | No |
| `2ec60d1ed2394420a27044a60c3d1739` | 09:52:52.677 | 09:53:31.836 | PASS | No |
| `98348fdb393b434687d7f9effb8ae8e0` | 10:19:38.348 | 10:20:16 | PASS | No |

Observed intervals are 1799.895 and 1800.059 seconds. This verifies these intervals, not uninterrupted long-term cadence or achieved incident RPO/RTO.

The whole private backup bucket remains capped at 1 GiB and automatic deletion stays disabled. At 10:22:28 UTC it contains 752,111,257 bytes, leaving 321,630,567 bytes. Captures use approximately 40 MB each: roughly eight additional half-hour points/four hours, less if legacy captures add bytes. Finite headroom needs a reviewed capacity/retention decision; the owner has been asked to choose a reviewed retention policy or a storage review. No archives are deleted and no cap/billing change is made without that decision. At capacity the existing gate refuses another upload; the application worker remains operational and the previous verified backup stays usable. Ongoing long-term protection is not accepted.

## Remaining dependencies

- Complete ten clean final-release Advisor semantic turns after the existing daily budget resets. Four new transport successes and a corrected named lookup do not complete this acceptance.
- Owner-supplied real inventory/approved knowledge, final company wording and reviewed demo archival remain necessary before customer launch.
- Verify Cloudflare managed/custom public-domain policy. Application private-route denial and unsigned S3 rejection pass, but the dashboard requires an authenticated Cloudflare session; the management connector is unavailable.
- Resolve ongoing backup capacity/retention. Keep legacy Render/Supabase exports until transition acceptance; no accounts/databases are deleted.
- Company domain and hosting plan review remain owner actions when launching. Staging noindex remains enabled.

CRM and company SMTP remain skipped as requested; no customer email delivery is claimed.
