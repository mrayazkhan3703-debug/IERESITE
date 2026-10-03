# Railway company launch checkpoint

Updated 2026-10-03. Railway remains a staging, noindex company testing site. Customer launch is not accepted yet.

## Preserve and release

- Keep the labelled demo inventory during owner testing. No cleanup has been committed.
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
- Legacy company-record reconciliation/transfer; retain the protected Concord Tower/Hammad/Imran export and source system until acceptance.
- Owner-supplied facts/content, completed testing, and reviewed archival of demo inventory.
- Company transactional email and notification acceptance: explicitly deferred by the owner. Private Mailpit is test capture only.
- Reviewed company contacts, privacy/consent, permissions and bilingual publishing; later domain/canonical/cookie transition.
- Cloudflare bucket managed/custom public-domain policy inspection; application private routes and unsigned S3 authorization are checked, but these do not prove dashboard public-domain settings.

Current read-only operations checks show a running Worker, zero pending outbox events and zero unreplayed dead-letter entries. On 2026-10-03 at 12:58 UTC, Mercury had 40111 reserved tokens against the configured 60000 daily limit and remained UNVERIFIED. No budget increase or provider switch is authorized by this checkpoint.
