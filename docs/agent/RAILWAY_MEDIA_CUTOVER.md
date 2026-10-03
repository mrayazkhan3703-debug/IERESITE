# Railway media cutover

This procedure moves storage delivery into Cloudflare R2 `railway-main` while preserving logical database keys. It does not delete the temporary service, source objects, unused assets, import history, or company records. A verified media copy is not a database backup or recovery drill.

## Preconditions

- Release the exact passing commit on Web and Worker; check revision parity and health.
- Retain the protected source/destination configurations and before-manifest outside Git. Never put credentials or the recovery identity in this report.
- Obtain the OWNER-only `/api/admin/media/storage-inventory` response. Anonymous requests must return 401 and responses must be `private, no-store`.
- Copy every temporary storage object using `scripts/migrate-media-namespace.mjs`, with the dedicated R2 prefix and full SHA-256 readback. Keep source objects intact.
- Compare complete references, including private media, derivatives and retained import snapshots, using `scripts/reconcile-media-inventory.mjs`. Any unsupported, missing, size-conflicting or checksum-conflicting reference blocks the switch. Static image references require verification against the matching application bundle.
- The original `checksum` is the upload-source hash before image sanitization. Preserve it for duplicate reuse. Nullable `storageChecksum` records the sanitized stored bytes for new uploads. Legacy sanitized images have no prior stored-hash baseline; compare their actual source bytes with full destination readback and recorded size, and report that limit explicitly. Never overwrite their source hash to make reconciliation pass.

## Pause writes and refresh

`STORAGE_MUTATIONS_PAUSED=true` must be deployed on both Web and Worker before the final copy. Confirm both deployments succeed and old replicas have stopped. Do not rely on an environment edit alone. Public and authenticated reads continue; uploads, object writes, media processing and deletion receive a specific 503 error. The media deletion guard runs before the database transaction so the asset remains registered. Worker processing retries after the pause. This setting defaults to false.

With writers paused, take a fresh complete inventory, refresh the full source copy, then take another inventory. All original and derivative keys and retained snapshot references must remain accounted for. Keep both receipts and reject differences that cannot be reconciled. Do not silently remove database references to make the check pass.

Worker storage-maintenance errors use the existing durable deferral path: preserve the work, release the worker lease, return the claimed attempt, and reschedule after 30 seconds. This must not consume the normal failure budget or create dead-letter entries. Other storage/provider errors retain their ordinary retry/failure handling.

## Switch and verify

Configure both services to the approved R2 endpoint, media bucket, region `auto`, path-style access, and `S3_KEY_PREFIX=railway-main`. Transfer credentials from their protected local configuration through the connector without printing them. Retain the write pause during deployment. Preserve all unrelated configuration and do not enable automatic deployment or seeding.

After both deployments succeed, verify full-byte original and derivative delivery against the copied SHA-256 hashes. Check bundled images, video ranges and protected document denial as well as authenticated reads. Check retained private import snapshots through the existing worker/import workflow. Verify revision parity, worker heartbeat and preservation of all original people/property identities.

If verification fails while writes remain paused, deploy the protected, verified source configuration on both services. The source's authenticated public endpoint was byte-verified; masked connector variables prevent claiming recovery of the previous private endpoint's exact configuration. No callable atomic Railway rollback was available. Keep both copies and receipts. If any new R2 upload has been accepted, do not return to the stale source without reconciling those new bytes first.

After verification, disable the pause on both services and verify a clearly identified, unattached technical upload through the existing secure pipeline. It must appear in Media Library and survive reload/delivery. Retain it for recovery acceptance; do not publish synthetic property facts. Confirm source and destination bucket privacy with anonymous requests.

## Recovery and launch

Keep the temporary service until an actual Railway database/R2 encrypted backup has been restored successfully. Independent scheduled capture currently requires additional available infrastructure; the free-plan service cap blocked provisioning. Customer email, approved company facts, ten clean actual Advisor turns and owner-reviewed demo cleanup remain separate launch gates. This cutover does not certify them.

## Observed 2026-10-03 cutover

Exact CI 37125345657 passed release 9802eaa. Both source writers paused on that revision and old replicas stopped. The final full-byte copy contains 56 objects, 24,419,947 bytes, zero missing/size/hash issues and stable reference inventories. Paused HTTP upload/nonexistent deletion returned 503 with the maintenance code; reads remained available. R2 deployments passed 88 delivery checks. Both writers reopened on R2; a new labelled unattached technical JPEG passed direct R2 readback and duplicate reuse. The Worker processed an invalid private preview without canonical changes. All 27 people and 23 properties, and every pre-existing media identity/hash, were preserved.

Evidence is under test-results/railway-r2-final-paused-copy-20261003.json, railway-paused-final-reconciliation-20261003.json, railway-r2-delivery-20261003.json, railway-r2-new-upload-20261003.json, railway-r2-private-worker-preview-20261003.json and railway-records-after-r2-cutover-20261003.json. Unsigned S3 rejected missing authorization (400 InvalidArgument/Authorization); r2.dev/custom-domain policy inspection is still required. Full database recovery remains unverified.
