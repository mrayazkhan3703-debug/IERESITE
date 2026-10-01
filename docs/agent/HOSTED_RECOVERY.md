# Hosted recovery and Windows operations

## Scope

The hosted mode backs up the application `public` schema from PostgreSQL and every MediaAsset original/known derivative, including private assets, poster assets, retained revision references and private import snapshots. It does not restore Supabase managed authentication/storage schemas, account settings, external service configuration, or an independent hosting account.

The capture reserves a repeatable-read, read-only transaction. Inventory, counts, migration checksums and `pg_dump` use the same exported snapshot. Missing or interrupted objects leave the capture incomplete and ineligible for encryption/upload. Files are SHA-256 content addressed; references retain their original keys and access classification.

Database credentials use an explicit session-pooler connection with verified TLS and the official CA. R2 credentials are read only from an explicitly selected private source file. No application `.env` or default cloud credential chain is read. Capture tooling uses PostgreSQL 17 for the hosted PostgreSQL 17 source. The separate local Docker workflow keeps PostgreSQL 16.

## Actual recovery evidence, 2026-10-01

The first hosted capture beginning 14:38 UTC contained 39 migration checksums, 54 referenced objects/derivatives and 17,221,367 object bytes. Its operations run was `78ec1907093d4b91b16732a902915878`; the corresponding encrypted R2 run was `2ad4bb27cfae4fd1a5bb3578bb013212`. It was uploaded to private R2 bucket `iere` under `private/iere-live`, then fully read back and verified. Download and decryption reproduced all three original archive hashes.

A fresh capture at 15:38:56 UTC included all 41 current migrations. Operations run `2c77bc99d962414c889f74cf4434eb5b`, encrypted R2 run `0bf2f703bf3e4f12990981f11b488eb7`, passed complete readback. Recovery `1b0bf4cfc8a24f5ab65bbb082fcbf706` passed actual download, decryption, table/migration reconciliation, all 54 object hashes and application delivery checks using the application compatible with those migrations.

The isolated restore matched all table counts and migration checksums and verified every object hash before and after rehydration. The exact deployed application image served an image, a full video, a video byte range and an authenticated protected PDF; anonymous protected-PDF access was denied. Outbound jobs were disabled. Disposable resources used an internal Docker network and ownership labels, and cleanup passed.

The source had PostGIS 3.3.7; the isolated image had PostGIS 3.6.4. pg_trgm 1.6 and vector 0.8.2 matched. Bounded geometry, trigram and vector compatibility queries passed. This is not a claim of exhaustive PostGIS compatibility. The isolated application role was a non-superuser with source-compatible RLS bypass; application authorization remained enforced.

The observed scripted restore was approximately 13 seconds. It is not an incident RTO measurement. Continuous one-hour RPO and two-hour RTO targets remain unverified.

## Private setup

All live source credentials, operation state, recipient configuration and recovery identity are outside Git in a directory restricted to the current Windows account. Keep the private age identity off Render, R2 and logs. The owner confirmed a separate secure identity copy on 2026-10-01.

Use `new-live-backup-identity.ps1` only for a new identity; it refuses to overwrite an existing identity. `backup-hosted.ps1` requires an explicit source configuration, pinned tool image and output directory. `run-backup-operations.ps1` accepts an explicit `-OperationsConfig` and preserves existing local receipts and configurations.

`verify-backup-roundtrip.ps1` downloads and decrypts an existing encrypted run into a new private directory, verifies all source byte hashes and uses `restore-hosted.mjs` for a real isolated restore. The restore requires pinned database, storage, tooling and application images. Use the application image compatible with the captured migrations. No shared database is reset or seeded.

## Schedule and failure reporting

Enable the 30-minute Windows schedule only through `enable-hosted-backup-schedule.ps1`, with a recent passing hosted roundtrip result for the configured source and `-OwnerKeyCopyConfirmed`. Registration starts disabled; activation is recorded separately. Existing tasks are preserved. The task uses the current interactive Windows account, ignores overlapping runs and requires Docker. No dedicated paid Render worker is created.

The task runs `run-backup-scheduled.vbs` through the built-in Windows Script Host. That GUI host launches the PowerShell runner hidden, waits for completion and propagates its exit code. Invalid or missing runner/config paths are rejected before execution. This avoids tying the task to a closable interactive console. Windows Script Host must be available; a disabled host is an operational failure, not a successful backup.

The initial direct-PowerShell scheduled attempts exited with `0xC000013A`, without upload receipts. Their captures and incomplete operation records were preserved. The GUI-host scheduled test at 16:11 UTC completed operations run `4e8945535fa94c43aba6cb2c44730d6b` with `VERIFIED_CIPHERTEXT_RUN`, full encrypted readback and task exit code zero. The recurring task must use the exact passing launcher release before reactivation. That successful single run does not certify continuous cadence.

Use `run-backup-operations.ps1 -Report -OperationsConfig <private-path>` to check the latest verified capture age. A missing success, stale receipt, Docker failure, capture failure or upload failure must be treated as an operational failure. Each attempt writes a stage/result file. Computer downtime or a signed-out account prevents execution; no process can emit an alert from a powered-off computer.

The live adapter configuration uses a 1 GiB whole-backup-bucket cap. It checks existing object sizes plus a conservative encrypted-upload bound before sending archives. Reaching the cap pauses new uploads and leaves older backups intact. This cap controls this runner's storage growth, not account-wide Cloudflare billing or concurrent writers. Automatic deletion remains disabled. Resolve a full bucket deliberately; never silently prune recovery evidence.

## Incident procedure

Preserve the affected environment and logs. Select a verified encrypted receipt and recoverable owner-held key. Download/decrypt into a new private directory. Verify archive hashes, source identity, all database counts/migrations and every media object. Restore into isolated storage/database with outbound jobs disabled. Verify protected-document denial, authenticated access, public images/videos and byte ranges. Reconcile service configuration and extension compatibility. Apply compatible forward migrations and validate permissions and inventory visibility before redirecting traffic. Record elapsed incident time and data loss from evidence.

CRM external synchronization and the paid dedicated worker remain deferred. Worker configuration, shutdown and retry checks run in CI; those checks do not establish a live dedicated-worker heartbeat.
