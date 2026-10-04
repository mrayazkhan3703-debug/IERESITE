# Railway hosted backup and recovery

## Current accepted archive policy — 4 October 2026, 13:08 UTC

Owner-authorized Worker retention now manages only `live-backups/railway-main` and `private/iere-live`, keeping four recent verified points, seven UTC daily representatives, latest pointers and both restoration pins. It removed 32 obsolete runs / 658,951,396 bytes; the whole-bucket 1 GiB cap is unchanged. Fresh capture `51124b1a5a7b48a999afb39eb82d7d7a` and its actual isolated restoration pass (119 tables, 44 migrations, 123 R2/static assets, protected-document denial, outbound jobs disabled, cleanup PASS). One stalled read recovered through one controlled Worker restart; a one-hour RPO is not claimed for the maintenance gap. Scripted restoration was 17.173 seconds, not incident RTO. R2 conditional-delete limitations and cooperating-writer safeguards are documented in [current evidence](RAILWAY_UNLIMITED_RETENTION_20261004.md), which supersedes older no-deletion and capacity statements here. Company media and private recovery identities are preserved.

## Verified hosted status — 4 October 2026, 10:22 UTC

Actual Railway encrypted restoration is PASS, and source snapshots at 08:52, 09:22 and 09:52 verify two successive 30-minute intervals. The current exact passing `19476d9` Worker is scheduled; its first upload stalls, interrupted cleanup passes, and one restart completes verified capture `98348fdb393b434687d7f9effb8ae8e0` at 10:20 UTC. Latest pointer readback and normal worker/routes pass. Storage has 321,630,567 bytes left under the unchanged 1 GiB whole-bucket cap, about four hours at the current cadence. Retention/storage review remains required, deletion is disabled, and achieved long-term RPO/RTO is not claimed. See [release evidence](RAILWAY_RELEASE_20261004.md). Older blocked/pending observations below are historical.

Status on 2026-10-04: actual Railway capture `a43857db13d74050936bc7f4a9f90e61` has passed complete encrypted readback/download/decryption and isolated database/media/private-document recovery. Recovery checks restored 119 tables, 44 migrations and 123 R2/static assets (40,110,279 bytes), checked application permissions and post-delivery counts, disabled outbound jobs and cleaned the owned environment. A roleless/passwordless other-user principal existed only in the isolated restore and was removed. The 18.445-second scripted restore is not an incident RTO measurement.

The existing Worker now runs `scheduled` alongside its normal scheduler, using accepted actual-source evidence and the already-confirmed owner key copy. First scheduled capture `0a2633008ab9417d8b45c0ef16624d4c` completed at 08:53:31 UTC on 4 October; ciphertext readback and cleanup PASS. Cadence needs successive observed points. Cap stays 1 GiB and deletion stays disabled: observed headroom before this capture was about 499 MB, approximately six hours at ~40 MB per half hour. Ongoing protection is capacity-limited until the owner reviews retention/storage. CRM/company SMTP remain deferred.

Live provisioning on 2026-10-03 was rejected with "Free plan resource provision limit exceeded" when creating `Encrypted-backup`. No new service exists. Five existing services remain operational. Do not remove or repurpose database/media/worker/email services automatically to bypass the cap, and do not claim independent scheduled protection. Purchasing remains the owner's action.

## Existing Worker option

The optional `RAILWAY_BACKUP_MODE` is `off` by default. `capture` runs one encrypted capture alongside the application's unchanged worker scheduler; it does not create or replace a service. `scheduled` runs immediately and every 30 minutes, refuses overlap and retains the same actual-source recovery/owner-key-copy gates as the separate runner. Enable scheduling only after downloading/decrypting/restoring an actual Railway capture. The private age key is never configured on Railway.

`start-railway-worker.sh` still deploys forward migrations, then executes `railway-worker-supervisor.mjs`. The normal worker child receives application variables without backup destination keys. The backup child receives only an explicit backup variable allowlist, PATH, a fixed PostgreSQL-library path and an owned private temporary directory. Runtime PostgreSQL 16 clients and age 1.3.2 are built from pinned sources. Missing dependencies are checked using a real disposable database dump in CI. Neither child exposes backup credentials through a browser API.

The supervisor caps captures at 25 minutes, stops the owned process group (including pg_dump/age/tar descendants), and removes interrupted plaintext/credential files from its validated temporary directory. Raw subprocess output is withheld; only validated success fields and an explicit error-code allowlist enter logs. Startup/configuration failures, overlapping attempts, stale prior receipts, interrupted captures and cleanup failures remain visible. Backup failure leaves the application scheduler running. Existing public and worker configuration stays unchanged; no demo seeding or database reset is introduced.

This option runs independently of the owner's Windows computer but shares the Railway Worker's service lifecycle and resource budget. It is not an independently provisioned runner and does not prove continuous cadence or incident RPO/RTO. Keep backup receipt-age reporting and observe successive actual captures. Do not increase the reviewed whole-bucket cap or enable automatic deletion to hide capacity failures. A separate runner can be considered later when resource limits permit.

## Service configuration

### Temporary migration safeguard

`capture-railway-transition.mjs` provides a one-time encrypted capture before media cutover. It uses the existing Web service's private database URL and current S3 credentials, with only the owner's public age recipient supplied. It accepts the explicitly named temporary `media-production-51c3.up.railway.app` endpoint and `iere-railway-test` bucket, with no prefix. It does not upload new credentials or a private age identity to Railway. This transitional profile is rejected by the scheduled production runner.

The tool requires PostgreSQL 16 `pg_dump`/`pg_restore`, `tar` and `age`, and a fresh absolute ciphertext destination outside the public directory. Its exported database snapshot, object inventory, complete object bytes and bundled images reuse the existing hosted capture checks. Plaintext remains in an owned private temporary directory and is removed on completion/failure. Only the encrypted `.tar.gz.age` capsule and sanitized receipt are retained for download. Missing objects invalidate the capture; an incomplete ciphertext has no success receipt and must not be used. Neither an encrypted capture nor its receipt proves recovery.

After download, validate the complete ciphertext hash against the receipt, decrypt locally with the existing owner-held identity, and pass the three captured members through the normal encrypted R2 adapter and isolated hosted restore workflow. The forward manifest source `hosted-postgres-s3` explicitly records `railway-temporary-seaweed`; older `hosted-postgres-r2` archives remain valid. A transitional restore cannot satisfy the production R2 schedule gate. Repeat capture and recovery after R2 cutover before enabling the independent schedule.

Current state: tools prepared; Railway browser file-transfer failure prevented upload/execution. No transitional capture is claimed.

Use a dedicated service in the same Railway project/environment as PostgreSQL. Build the exact passing commit with `docker/backup-tools.Dockerfile`. Disable auto deploy; retain the accepted commit. It has no public domain, health endpoint, attached media/database volume, or application worker. The image includes the pinned release's public bundle for existing `static/images/...` MediaAsset references.

Start with `bun --no-env-file scripts/backup-railway.mjs plan`. This validates explicit configuration and prints sanitized metadata without network calls. Run `capture` manually for the first real snapshot; this exits after completing capture, encryption, upload, and full ciphertext readback. Never pass a private age identity to Railway.

Configure these variables in the backup service, using Railway service references for the database and existing media settings:

- `BACKUP_SOURCE_ID=railway-main`
- `BACKUP_DATABASE_URL`: reference the PostgreSQL private URL. Its hostname must end in `.railway.internal`, with port 5432.
- `BACKUP_DATABASE_TRANSPORT=railway-private`: deliberate private WireGuard transport; internet database endpoints continue to require `verify-full` and a trusted CA.
- `BACKUP_MEDIA_ENDPOINT`, `BACKUP_MEDIA_BUCKET`, `BACKUP_MEDIA_ACCESS_KEY_ID`, `BACKUP_MEDIA_SECRET_ACCESS_KEY`: the accepted production R2 media configuration. Never use the temporary Seaweed profile here.
- `BACKUP_MEDIA_KEY_PREFIX=railway-main`: same prefix as Web/Worker's `S3_KEY_PREFIX` after R2 cutover.
- `BACKUP_ENDPOINT`, `BACKUP_BUCKET`, `BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY`: private R2 backup destination, existing backup bucket `iere`. This must be a different bucket from media. Restrict credentials to necessary buckets through the provider's supported permissions.
- `BACKUP_AGE_RECIPIENT`: only the public age recipient from the owner-held recovery identity.
- `BACKUP_MAX_STORED_BYTES`: explicit reviewed whole-bucket storage cap in bytes. A cap failure stops upload and never deletes an older backup. Account for other sources already using the bucket.

No source or destination credentials are written into Git, printed, or included in the archive inventory. Plaintext capture/configuration files exist only in an owned private temporary directory in the backup container, removed on exit. Source capture is read-only. All encrypted runs remain under `live-backups/railway-main/<run-id>/`. A conditional `latest.json` pointer identifies the newest verified capture; failed or older concurrent runs do not replace it.

## First recovery and schedule acceptance

1. Run `capture` on Railway and retain its run identifier. This proves capture and encrypted readback only.
2. Download the run receipt through the existing authenticated backup adapter. Use an explicit destination configuration with prefix `live-backups/railway-main` and the same public recipient.
3. On a recovery computer, decrypt with the owner-held private age key into a new private directory, using `backup-adapter.mjs restore-to-new-directory`. The key remains outside Git, Railway and R2.
4. Run `restore-hosted.mjs` with explicit digest-pinned tools, PostgreSQL, storage and application images. Its isolated internal Docker network has no published ports; outbound jobs and live providers are disabled. It checks database counts/migrations/extensions, application role privileges, object hashes, bundled static images, public media/video ranges, and protected document delivery. A missing required image/video/document acceptance sample fails rather than fabricating evidence.
5. After an actual successful encrypted roundtrip and restore, copy the resulting sanitized `restore-drill-result.json` to `BACKUP_RECOVERY_EVIDENCE`. Set `BACKUP_OWNER_KEY_COPY_CONFIRMED=true` only for the already-confirmed owner copy. Synthetic results, another source, incomplete checks or a future timestamp are rejected.
6. Change the start command to `bun --no-env-file scripts/backup-railway.mjs scheduled` and enable the Railway cron schedule `*/30 * * * *`. Do this only after the exact hosted recovery evidence is reviewed. Each process must exit; the runner has a 25-minute container deadline. A completed drill does not expire and silently halt ongoing backups.

`report` reads the latest authenticated receipt and fails when it is missing or more than one hour old. Successful capture logs record whether the previous point was stale, so missed execution remains visible. Scheduling alone does not prove cadence, notification delivery, RPO or RTO. Wire the report into the existing operations monitoring after hosted credentials/configuration are accepted; real email notifications remain deferred with company SMTP.

Automatic remote deletion is disabled. Trial expiry, storage caps, source connectivity, missing immutable objects, or a failed deployment can stop captures. Observe multiple scheduled points and perform periodic restoration before claiming continuous protection.

## Media and restore compatibility

- PostgreSQL inventory and `pg_dump` share one exported repeatable-read snapshot.
- Original images, supported derivatives, videos, posters, library/private documents, and retained import snapshots are captured from logical keys. R2 requests apply the source namespace; restored database keys remain unchanged.
- `static/images/...` media is copied from the matching release bundle into the content-addressed archive. The restore creates a disposable public volume from the pinned application image and overlays the captured static files after checking hashes and rejecting linked paths. Other release assets remain present.
- Missing objects, malformed keys, linked static paths, excessive sizes, interrupted bodies, mismatched hashes and incomplete capture markers prevent usable backup acceptance.
- Keep the temporary Railway media service and legacy Render/Supabase exports until media cutover, record reconciliation and actual recovery acceptance are complete.

Provider references: [Railway private networking](https://docs.railway.com/networking/private-networking) and [Railway cron lifecycle](https://docs.railway.com/cron-jobs).
