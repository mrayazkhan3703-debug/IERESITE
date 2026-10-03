# Railway company launch checkpoint

Updated 2026-10-03. Railway remains a staging, noindex company testing site. Customer launch is not accepted yet. External CRM synchronization and company SMTP remain explicitly deferred at the owner's latest request.

## Preserve and release

- Keep the labelled demo inventory during owner testing. This release performs no cleanup. Later read-only reconciliation observed an existing audited `property.demo.archive` at 14:10 UTC; preserve that owner-side change rather than restoring an older checkpoint.
- Preserve company profiles, uploaded media, owner changes and original relationships. Ayaz's audited wording correction is retained.
- Web and Worker deployment startup must never seed demos. Release only an exact passing commit; retain the enabled dedicated Worker and deferred external CRM sync.
- R2 `railway-main` is active on Web and Worker at exact `9802eaa15a7d432606a4e6ddca2e98d0498551ed`, full CI `37125345657`. Final unpaused deployments are Web `a220db20-9985-4e71-9f15-754ede0d9835` and Worker `cc799a3c-62ca-47a0-b2db-839c4ca9636e`. All 43 migrations are applied. Keep the temporary media service and its source bytes until actual backup/recovery acceptance.
- During the deployed write pause, 56 objects / 24,419,947 bytes passed full source/R2 SHA-256 readback; before/after reference inventories were identical. All 48 original media records, 27 people and 23 properties remain unchanged. No demo archival or company publication occurred.
- All 88 delivery checks passed, including derivatives, bundled images, video ranges and private-route denial. Writes reopened, and labelled unattached technical JPEG `f391ced7-187c-42df-8b8d-b1f7595eab13` passed upload, Exif stripping, distinct source/stored hashes, direct R2 readback, Media Library and duplicate reuse. It is the only new media record from this checkpoint.
- Private technical preview `cmusgl5oc005sw1014jgzju10` was never committed; Worker completed DRY_RUN/SKIPPED_INVALID from its R2 snapshot and replay reused the same run. Direct unsigned S3 access returned 400 InvalidArgument/Authorization with no object bytes. This verifies the S3 endpoint's authorization rejection, not a dashboard inspection of r2.dev/custom-domain settings; that policy review remains outstanding because the Cloudflare management connector is unavailable.
- Thirteen legacy sanitized images have no historic stored-hash baseline. Actual source/destination hashes and recorded sizes match; source upload hashes were preserved. Media copies are not a database backup or restore drill.

## Hosting measurement and estimate

The explicit **12:18–13:18 UTC** Railway sample on 2026-10-03 contains 60 points per service at one-minute spacing. Calculated sample means across five services are **0.8503 GB memory** and **0.01041 vCPU**. This is a quiet testing interval, not customer traffic or a load test. The earlier returned 10:03–11:02 interval is historical and is not substituted for this current sample.

At the [published container rates](https://docs.railway.com/pricing), projecting that sampled compute continuously gives approximately **USD 8.71/month**, before network traffic, persistent storage, the backup runner, Railway Agent use, Mercury, R2, SMTP and taxes. The two configured volumes total 1 GB; actual disk usage was not measured, so their allocated size must not be described as full or as an observed bill.

Railway publishes a **USD 20/month Pro minimum** with included usage for production applications and teams. The subscription counts toward usage, rather than being added to it twice. This is a planning estimate, not a purchase or invoice; future company traffic and recovery jobs require another measurement. See [plans and limits](https://docs.railway.com/pricing/plans).

The account currently enforces a five-service ceiling, and adding a separate backup service was rejected. Effective limits do not establish paid subscription status. Actual remaining trial credit and expiry are unavailable through the connected tools. Purchasing remains the owner's action.

## Outstanding customer launch gates

- Column mapping and missing bulk content adapters, with preview and explicit commit.
- Ten clean actual Mercury turns within the configured usage budget; approved company knowledge and freshness/citations.
- Actual consistent Railway/R2 encrypted capture, isolated restoration and independent scheduling. Local backup contracts and verified media copies do not prove recovery.
- Remaining legacy acceptance: source and target records remain retained. Hammad (`cmusi6el800cbw101dl51g009`, `samm`) and Imran (`cmusi6f3500cqw101m3j1xetz`, `imran`) were transferred through normal audited Admin commands with their recorded facts, photos and website publication settings; no login or privilege was copied. Both English/Arabic profiles and photos return 200. Concord Tower (`cmusi8hkx00dfw10148duwkue`) was transferred into Draft with its gallery, floor plan and PDF. Publication returns specific expiry errors because the source listing has expired; its anonymous route returns 404. Do not fabricate an extension or discard retained uploads. Five media assets were uploaded through the existing pipeline; a protected source-to-target receipt records IDs and source hashes. Six original source files totaling 9,555,448 bytes were captured, after verifying current source record versions. This selected export is not a complete backup. Keep Render/Supabase and exports until actual recovery and owner correction of the expired listing are accepted.
- Owner-supplied facts/content, completed testing, and reviewed archival of demo inventory.
- Company transactional email and notification acceptance: explicitly deferred by the owner. Private Mailpit is test capture only.
- Reviewed company contacts, privacy/consent, permissions and bilingual publishing; later domain/canonical/cookie transition.
- Cloudflare bucket managed/custom public-domain policy inspection; application private routes and unsigned S3 authorization are checked, but these do not prove dashboard public-domain settings.

Current read-only operations checks show a running Worker, zero pending outbox events and zero unreplayed dead-letter entries. On 2026-10-03 at 12:58 UTC, Mercury had 40111 reserved tokens against the configured 60000 daily limit and remained UNVERIFIED. No budget increase or provider switch is authorized by this checkpoint.

## Advisor follow-up candidate

Actual Arabic calculation on 2026-10-03 returned a non-fallback answer with a successful yield tool in 3722 ms. Its follow-up returned `PROVIDER_OUTPUT_EMPTY` in 1360 ms. Duplicate replay reused the result, and reload retained four messages. At that checkpoint the daily reservation was 45510/60000 tokens; ten clean conversation turns are still not accepted. The candidate retries only a completed empty response once within the existing deadline and records measured usage and safe HTTP/request correlation. Both attempts are charged; repeated empty output stops. Timeouts, authentication, rate-limit, malformed and truncated output still do not retry. Focused provider, gateway and deadline tests: 41 pass / 0 fail / 172 assertions. Typecheck and lint pass locally, and credential scanning reports zero findings. Full exact-commit CI and live release remain required.

## Performance measurement correction candidate

Exact mapping commit `744e661` CI `37129343888` passed functional/security/build/recovery-contract/browser gates but failed home mobile LCP: English 2716 ms and Arabic 2676 ms against the unchanged 2500 ms limit. The independent diagnostic in that same CI run reproduced 1624-1726 ms before request start on repeat navigations, with both deprecated and current CDP emulation APIs. Fresh pages in the same context, with reused HTTP connections, identical cache disabling and throttling, instead recorded 2-6 ms before request start and LCP 1388-1444 ms. This supports a fresh-target sampling correction, not a claim that production server performance was repaired. The candidate collects three independent fresh-page samples in the same context and keeps all network/CPU/CLS/script/interaction limits. Original failing evidence remains retained. Full exact-commit quality gate must pass before deployment; do not select favorable reruns or increase budgets.

Local corrected sampling passed all eight cases in 3.5 minutes with zero budget violations: English mobile home 1364 ms and Arabic 1392 ms. Both retained the 2500 ms limit. This is synthetic Docker/Chromium evidence; field CWV remains unmeasured. Typecheck/lint pass after the correction. The superseded intermediate Advisor-only CI is cancelled by the combined passing-candidate push; it is not reported as accepted.
