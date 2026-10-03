# Railway hosted backup and recovery

Status on 2026-10-03: the owner requested necessary work only, retaining CRM/company SMTP deferral. A supervised backup child is under verification alongside the existing Railway Worker. No actual Railway snapshot, encrypted roundtrip, hosted schedule, or achieved recovery objective is claimed by the candidate.

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
