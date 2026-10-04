# Railway unlimited Advisor and scoped backup retention

## Release status

Corrective application `33ace7980f2bee1849fb17f86e41318b1d707b1e` passed full CI `37201990279`: optimized build, lint/typecheck, 444 unit, 167 integration, 83 backup contracts, 121 browser journeys, 16 delivery measurements, eight performance cases with zero budget failures, credential scanning and recovery checks. Railway Web `2406f57a-623c-403d-a3d7-f600b37ea21c` and Worker `396e2803-90f8-4621-8b86-adda06f46a29` are SUCCESS on that exact commit; predecessors are REMOVED. Final live acceptance below passes at 13:08 UTC. This supersedes initial unlimited application `196b36c` / passing CI `37199685985`, whose live checks exposed the two defects documented below.

## Website usage policy

`AI_USAGE_LIMIT_MODE=capped|unlimited` defaults to capped. Unlimited mode bypasses website daily request/token, hourly message, and conversation-length quotas for Advisor and natural-language search. Usage receipts and conservative token accounting remain enabled. Daily Admin totals aggregate in PostgreSQL; recent diagnostic rows are a bounded history, not an accounting total. Disabled quota ceilings are null and Admin displays **No website usage quota**.

The existing twelve-per-minute burst throttle, one active turn per conversation, server-owned bounded history, prompt/output bounds, sixty-second processing budget, cancellation, durable replay, ownership checks and emergency switch remain enforced. Provider rate, credit and billing limits remain external constraints. No provider purchase or billing-limit increase is performed.

Saved property cards supply references only. Follow-ups reread current public inventory and active listings, preserving demo status, listing type, recorded rental period and update dates. Non-demo does not mean independently verified. The prompt measures approved current indexed knowledge in each language; the existing methodology source/document remain private drafts and are excluded from retrieval.

## Authorized archive policy

The Railway Worker uses the existing encrypted adapter and the existing private `iere` bucket. With explicit `BACKUP_RETENTION_ENABLED=true`, only `live-backups/railway-main` and `private/iere-live` are managed. This authorization supersedes the previous no-deletion policy for these two namespaces only. Windows capture scripts retain their existing no-deletion behavior.

Each namespace retains the newest four verified captures, its latest verified capture per UTC day for seven days, its latest pointer, and its proven restoration baseline. Pins are `a43857db13d74050936bc7f4a9f90e61` and `e8c17022e7e14416b4c68b9d8a4854f1`.

The runner validates receipts and retained ciphertext hashes before any removal, writes a deletion manifest with IDs, dates, sizes and reasons, then rechecks pointers, active multipart uploads, candidate hashes and object metadata. Archive members are removed before receipts. Interrupted deletion is resumable behind four intact newer captures. Malformed/unknown objects are excluded; incomplete recognized captures require twenty-four hours and inactivity. A database advisory lock prevents overlapping cleanup. Cleanup runs before capture/capacity checks and after verified captures. The whole-bucket cap remains **1,073,741,824 bytes**.

Company media, unrelated bucket namespaces, recovery identities, local receipts and latest pointers are preserved. No public age identity is mistaken for the private recovery key: the private identity remains outside Git and hosted configuration.

## Evidence collected before rollout

- Local typecheck, lint, optimized build and scoped working-source/full-history credential scan passed.
- Route contracts exercised seventy paced English/Arabic requests beyond a configured hourly quota in unlimited mode, capped compatibility, natural-language search and twelve-per-minute throttling. Replay did not regenerate.
- A disposable database passed accounting over 10,003 current-day rows, a 1,000-message counter with bounded history, updated/expired/private follow-up references, and approved-index revision/freshness gates.
- Retention contracts passed rolling/daily/pinned boundaries, malformed/tampered/changed objects, interrupted deletion, inactivity and active upload protection.
- Actual disposable S3 cleanup preserved pins and restored an unrelated encrypted archive; wrong-key and tampered-archive rejection and resource cleanup passed.
- Live pre-release fingerprints: **29 profiles, 24 properties, 58 media records**.
- Read-only live retention preview validated retained archive hashes, produced a manifest and removed nothing. Capacity at 11:52:33 UTC was 923,138,183 bytes; automatic deletion was still disabled then.

## Live acceptance

### Final passing release

- Ten actual Mercury turns all returned HTTP 200 without fallback or blocked tools. Manual semantic review passed current Concord Tower facts and missing rent frequency, English/Arabic follow-ups, demo distinctions, absent approved knowledge and modeled ROI assumptions. Observed response latency was **1,511–3,691 ms**. Replay was identical, and reload retained all ten successful turns across five conversations. Website usage mode is unlimited with all disabled ceilings null; recorded reservations reached **116,525**, exceeding the former 60,000 ceiling. Admin displays **No website usage quota** and **RECENT_SUCCESS**. This is observed acceptance, not a guarantee against future upstream provider failures.
- Authorized retention completed: manifest `a14d1b60-3070-4e4e-ac2b-3fa549a30b85` removed 31 obsolete runs / 618,991,804 bytes; restart pre-pass `c747b92e-a34d-4f7e-913a-82a0a553f2fc` removed zero; post-capture manifest `9ad2c898-b79e-4c95-8f66-c7a7a53a4fc0` removed one obsolete run / 39,959,592 bytes. Total **32 runs / 658,951,396 bytes**. Both proven recovery pins remain complete. Storage at 13:06:59 UTC is **355,328,130 / 1,073,741,824 bytes**. Audit manifests and latest pointers are preserved.
- The first post-cleanup capture stalled during a media read; one controlled Worker restart on the same passing image recovered it. The incomplete attempt was not promoted. Fresh run **51124b1a5a7b48a999afb39eb82d7d7a**, snapshot **13:05:05 UTC**, verified **13:05:36 UTC**, has three fully read-back encrypted members totaling 39,971,022 bytes. Post-capture retention and child cleanup completed successfully at 13:06:03 UTC. The 30-minute schedule remains configured; the maintenance gap from the prior snapshot at 11:49 means a one-hour RPO is **not** claimed for this interval.
- Download, age decryption and isolated restoration of that fresh run passed using the final application image: **119 tables / 44 migrations / 92 R2 objects + 31 static assets / 40,110,279 media bytes**. Images, videos, byte ranges, owner-private PDF, anonymous/other-user denial, permissions, post-delivery counts and resource cleanup pass. Outbound jobs were disabled and the network had no published ports. Scripted recovery took **17.173 seconds**; this excludes incident response and is not an incident RTO claim.
- Final company fingerprints are identical: **29 profiles / 24 properties / 58 media**, no missing/changed/new records. Five company-media checksums match source R2 and public delivery; private assets deny anonymous requests. Ten public routes return HTTP 200 without server exceptions. Worker heartbeat reports the exact final revision, pending outbox and dead-letter counts are zero. Staging noindex remains enabled.
- Live UI screenshot: `test-results/advisor_unlimited_ready_33ace79.jpg`. Detailed private/local receipts remain outside Git or under ignored test results; recovery identities and credentials are never included in this report.

### Earlier findings and corrective evidence

- First unlimited deployment: daily/hourly ceilings are null and actual requests continue above the former daily reservation budget (76,566 reserved units). Admin renders **No website usage quota**. Three real Concord Tower turns, English/Arabic facts and durable replay/reload passed.
- The fourth turn exposed a blocked search argument and provider timeout; this is a failed acceptance attempt, not ten successful turns. The corrective candidate supplies the full Zod input JSON schema, including argument types, enum casing and bounds, plus field-specific correction errors.
- Initial retention failed closed before deletion: R2 list timestamps include milliseconds while HTTP HeadObject Last-Modified is rounded to seconds. The corrective candidate compares timestamps at the protocol's common precision, retaining hash, ETag and size checks and rechecking immediately before each deletion.
- An isolated temporary object probe showed R2 ignores DeleteObject IfMatch. No company object was touched. Conditional deletion passed on the disposable S3 fixture, but is **not** claimed for R2. The production policy relies on immutable UUID archive keys, cooperating writer locking, hash verification and immediate metadata rechecks; external writes bypassing these rules cannot be atomically guarded by R2's delete API.
- Read-only preservation comparison remains exact: 29 profiles, 24 properties and 58 media, no missing/changed/new records. Ten public routes load without server exceptions; Worker is running with zero pending/dead-letter jobs. Five transferred company media hashes match R2 and public delivery; private media returns 404 anonymously.
- Both pinned recovery runs remain complete. At 12:19 UTC, bucket usage was 940,192,939 bytes under the unchanged 1 GiB cap. No backup archives had yet been deleted. Pending: corrective exact passing release, ten semantically clean Mercury turns, completed cleanup manifest, fresh capture and actual isolated recovery against the final application.
- Actual retained run `98263b660a7d4a6988b9a993d33cac0e`, snapshot 11:49:38 UTC, downloaded/decrypted and restored with candidate app image `sha256:98ae42b58e8c6c4bbfb5c6203b881bb3dc7cebb52df225f61294d6d0775390b6`. At 12:35 UTC: 119 tables, 44 migrations, 92 R2 objects plus 31 static assets; hashes, permissions, public images/videos/ranges, owner-private Portfolio PDF, anonymous/other-user denial and cleanup PASS. Internal Docker network had no published ports and outbound jobs were disabled. Scripted recovery took 17.084 seconds, not incident RTO. A fresh post-cleanup capture and its restoration are still pending.

## Completion limits

CRM synchronization and company SMTP remain skipped. Real approved documents, final demo archival and domain setup remain owner-dependent. Cloudflare management opens at sign-in; public-domain exposure inspection is not claimed. Customer launch is not declared complete while required content/privacy acceptance remains outstanding. Recovery timing from a scripted drill is not an incident RPO/RTO guarantee.
