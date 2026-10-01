# IERESITE release and production cutover report

Updated: 1 October 2026. Deployment: https://ieresite.onrender.com (staging).
Admin: https://ieresite.onrender.com/admin (existing OWNER account).

## Verified live releases

| Release | Exact source commit | Full CI | Render deployment |
|---|---|---|---|
| Shared inline CMS media | `2e68ec80ec2e5b517b1031372cc86129f5764537` | 36834016725, success | dep-dav1hmg473hc73a9ntf0 |
| Advisor diagnostics and local leads | `ba3326f70ac6f618537566df0d2c88a905b7555e` | 36835040693, success | dep-dav1nepsrm7s73bjibq0 |
| SEO and measured operations | `7131fe2aa75bc15735a257425fc61c2b01fd08bf` | 36838547634, success | dep-dav259a1a91c739ss8gg |
| Security, public UX and remote media saves | `7046b0217a5b94f1076f5f2a149c8cef6c67bb2f` | 36845307784, success | dep-dav32p3ncjis73d5hqn0, live |

## CMS media

All applicable create/edit forms share the existing authenticated Media Library/R2 pipeline. Upload New and Choose Existing attach files inside the entity form. Files are limited to 25 MB; image, PDF, MP4 and WebM modes enforce server validation. Videos use bounded ffprobe validation, without transcoding. Gallery ordering, captions, alt text, cover selection, replacement, detachment, duplicate reuse and optional posters are supported. Detachment preserves reusable assets; retained revisions and other uses protect deletion.

Live image verification completed: upload in an abandoned Property form persisted in Media Library; an unpublished PAGE draft selected it, saved/reloaded, then replaced it inline and saved/reloaded. The previous image remains referenced by a retained revision. Both images decoded at 1344x768 and returned HTTP 200. The PAGE draft remains DRAFT and its anonymous public route returns 404.

Live MP4/WebM/PDF uploads completed inside the Property create form. Both videos decode at 320x180 with a one-second duration; the MP4 poster reference is persisted. Both video deliveries return correct 206 byte ranges, and an invalid range returns 416. Entity create/edit/reload passed after the remote transaction fix. The private rendering preview decodes both videos with the persisted MP4 poster. Gallery order, cover and caption/alt overrides survived reload. The authorized 628-byte gated PDF download matches its upload hash; anonymous delivery returns 401. The property remains DRAFT/WITHDRAWN and its public/API routes return 404. No synthetic inventory facts were published.

Verification assets:

- Initial image: `9c855736-d1b7-4474-8558-0113ef869d50`.
- Replacement image/poster: `e14dc899-a9a7-4e1a-b744-f1784ed1881f`.
- MP4: `1b3f8912-1940-4437-bb70-67f351619b26`.
- WebM: `dbd355d3-e343-44da-a400-4e0c5c9ccc4c`.
- PDF: `8fcfcec7-84c2-4e9a-8fa3-51da3cadc11b`.

R2 `iere-staging-media` exists; managed public delivery is disabled and no custom public bucket domains exist. Delivery goes through the application's privacy checks. Credentials remain server-side.

## Advisor and leads

Gemini remains selected with `gemini-3.8-flash`; the confirmed request timeout is 60 seconds. First live probe timed out at 20 seconds; the second returned an upstream `PROVIDER_UNAVAILABLE` after 2342 ms. After the bounded retry/default-sampling release, an actual selected-provider probe succeeded in 6175 ms. Subsequent public CHAT/NL_SEARCH attempts still failed with upstream PROVIDER_UNAVAILABLE after bounded retry. Basic generation success does not certify reliable conversations. Static configuration readiness is not generation evidence. No approved current knowledge sources/documents exist on the live service; fact-grounded RAG acceptance remains outstanding.

The durable Advisor release (`63b88e119ed643dec81b94d033120fa42a9e50d8`, CI 36880675041 passed, PR 11, Render `dep-dav7pv0473hc73aj5iv0`) creates conversations before generation, preserves request IDs and saved replies across reloads, bounds generation/tool turns to 60 seconds and supports browser cancellation with a 130-second request deadline. Optional natural-language search runs separately after displaying the answer. An actual ADVISOR prompt diagnostic succeeded at 15:39 UTC after one HTTP 503 retry: HTTP 200, total 41,195 ms. Subsequent actual public CHAT attempts returned HTTP 503 `UNAVAILABLE`. Two saved fallback replies reloaded correctly; those replies do not count toward the ten successful actual conversational turns required for acceptance. Logs also demonstrated a Prisma five-second reservation transaction expiry during retry preparation; its separately tested fix requires its own exact release gate.

CRM synchronization remains Deferred. GHL connection and external delivery are disabled; pending work is retained. Local capture, attribution, consent, ownership and assignment are covered by integration and bilingual create/edit journeys. The live OWNER CRM page displays Deferred.

## SEO and operational data

Native sitemap: HTTP 200, 84 canonical URLs, English/Arabic alternates, no account/admin URLs. Staging robots correctly blocks all crawling. OWNER Analytics shows UTC measurements, consent limits and organization scope. Data Quality explicitly shows NO_RECORDS: zero market rent/transaction rows, with bounded evaluation and full stored totals. Validation is not proof of source facts.

Live public home, Arabic home, property list/map, Advisor shells and opportunities return HTTP 200 without an application-exception page; Arabic home has RTL markup. Anonymous Media Library policy access returns 401. The public unpublished PAGE and verification Property routes return 404.

## Security and recovery

The live security release constrains current parent publication, revoked advisor accounts, public search/facets/autocomplete, media posters, audit/monitoring output, CSV formulas and private responses. Live database audit found exposed browser-role schema access and a mutable geography trigger lookup path. A forward migration denies anonymous/authenticated schema access and fixes the trigger path, preserving vendor-owned extensions. Live acceptance confirms 41 completed migrations, no anon/authenticated schema USAGE and the fixed pg_catalog trigger search path. There are 119 public tables, with RLS on 118; vendor-owned PostGIS placement is preserved. The application uses server authorization and does not grant browser roles schema access. This does not claim all vendor advisory warnings are eliminated.

Full CI checks optimized build, typecheck/lint, unit/integration, bilingual desktop/mobile accessibility, local performance budgets, credential history/source scans, migrations, worker/SMTP recovery, object restores and encrypted S3 adapter recovery. These isolated recovery tests do not prove live incident recovery.

Hosted recovery release (`f6e7e965d3b73224e17f4e302db0effcd6b536e7`, CI 36884868448 passed, PR 12, Render `dep-dav83cff3r2c739uh9eg`) now captures the hosted application PostgreSQL schema and referenced R2 media consistently, encrypts through the existing age adapter and fully reads back the private `iere` bucket archives. The new identity is outside Git and restricted to this Windows account; the owner confirmed a separate secure key copy. A fresh 41-migration backup passed actual download, decryption and isolated PostgreSQL/object restoration, all table/migration counts and 54 object hashes, public image/video/range delivery and protected-document denial/authenticated delivery. Disposable restore resources used an internal Docker network and outbound jobs were disabled; cleanup passed. See `HOSTED_RECOVERY.md` for scope and extension compatibility limits. The approximately 13-second scripted restore is not an incident RTO measurement.

The first direct-PowerShell scheduled attempts were interrupted with `0xC000013A` and produced no usable upload receipts. Evidence was retained. A hidden GUI-host scheduled test completed with full encrypted readback and exit code zero at 16:11 UTC. Recurring activation requires the exact passing launcher release. The 1 GiB whole-backup-bucket growth cap fails closed without deleting old evidence. Docker availability, the interactive Windows session, computer downtime, prior cadence gaps and incomplete attempts remain operational limitations. One-hour RPO and two-hour RTO remain targets, not achieved measurements.

## Cutover dependencies

1. Paid worker remains owner-deferred; its heartbeat is MISSING. Database and PostgreSQL search are healthy. No outbox drain or worker-dependent acceptance is claimed.
2. Selected Gemini must pass reliable actual public conversations; its probe succeeded but real chat still failed upstream. Approved source-current knowledge must be supplied/reviewed before RAG fact acceptance.
3. The live inventory has three previously published demo properties, the owner's published `concord Tower`, and two unpublished verification/demo drafts. Real inventory, documents and editorial/market facts require owner-supplied records and source review. No additional fabricated facts were published. Import-compatible templates are in `docs/content-templates`.
4. Hosted encryption and actual isolated restoration passed. Continuous scheduled cadence and incident RPO/RTO remain unverified; this Windows computer must remain signed in with Docker running.

## Recovery procedure

For an application-only regression, deploy the last exact tested compatible Render commit and verify health plus public/Admin routes. Keep forward migrations; do not reset shared tables or roll back their data blindly. Confirm schema compatibility before selecting an older application revision. Preserve uploaded assets and verification drafts.

For data loss, preserve incident evidence and use a verified encrypted database/media backup in an isolated destination. Verify archive hashes, decrypt with the recoverable identity, restore database and objects, reconcile MediaAsset references/privacy, apply compatible forward migrations, rebuild search, then verify permissions, unpublished visibility, R2 reads, live AI and worker parity before directing traffic. Local archive tests alone do not establish production RPO/RTO.

## Acceptance decision

**The staged media, SEO, operations, security and public UX releases are deployed and verified. Actual Advisor conversations remain degraded. Production cutover is blocked while the dependencies above remain outstanding.** CRM sync and the paid worker remain intentionally deferred. The original dirty workspace is preserved.


## Exact release gate and final acceptance additions

Security release CI 36845307784 verifies exact `7046b0217a5b94f1076f5f2a149c8cef6c67bb2f`: 288 unit/contract, 130 integration, 96 browser and 16 performance checks, plus all build, credential and isolated recovery gates. Mobile home LCP measured 2172 ms EN / 2192 ms AR in the test environment; these are candidate budgets, not field Core Web Vitals.

CMS publication and Team release (`3ced481bbe0cd8dc2a186ea462295c7cdc1af39c`, CI 36877843112 attempt 2 passed on the identical commit, PR 10) is deployed. Property create/edit forms expose Save draft and Save & publish, share server readiness checks, preserve submitted coordinates/uploads on errors and save publication, listing, attachments, audit and outbox entries atomically. Website Team creation supports draft/publication without a login or email verification; organization ownership and Admin permissions remain required. Website publication is independent of Advisor-directory eligibility and creates no login.

Live Admin verification saved `DEMO DRAFT — Marina apartment example` with its inline cover, caption and alt text. Save/reload retained them; attempting to publish the withdrawn example returned the specific listing requirement and retained the form. Its public route returns 404. `DEMO DRAFT — Team profile example` saved without an account and remains private. The owner's published Hammad profile appears on English and Arabic Team pages without a linked account; it is not eligible for the Advisor directory. These drafts illustrate the forms and are not approved knowledge or real inventory.

For CMS access, sign in with the existing OWNER account at `/account/login?next=%2Fadmin`, then use `/admin/properties` or `/admin/projects`. Enter verified entity facts, upload/select media in the same form, save the private draft, use its authenticated preview, then satisfy publishing/source review requirements. Media uploads persist in the Library if you discard a form; removing an association does not delete the asset.
