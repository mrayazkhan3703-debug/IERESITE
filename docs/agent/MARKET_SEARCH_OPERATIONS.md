# Market and search operations

## Access

Sign in with the existing OWNER account at `/account/login?next=%2Fadmin`.
Use `/admin/properties` for property creation, media, preview and publication; `/admin/media` for the persistent media library; `/admin/imports` for market datasets; and `/admin/search` for search diagnostics.

## Market datasets

1. Register a source with a publisher HTTPS URL, meaningful provenance notes, dataset kind, freshness window and illustrative disclosure. URLs cannot contain credentials, query strings or fragments. Do not mark illustrative facts as verified real data.
2. Choose a CSV or JSON object-array file: maximum 2 MiB, 500 rows and 40 columns. Inspect the file and map `externalId`, `date`, `areaName`, `propertyType` and `amountAed`. Optional mappings include community slug, size, bedrooms, transaction type and project name.
3. Preserve external IDs as strings, including leading zeros. Use real, nonfuture `YYYY-MM-DD` dates and positive AED amounts with at most two decimal places. Rent amounts represent annual rent. Community references must resolve to canonical records; missing optional values are omitted.
4. Validate to create an immutable private object-storage snapshot. Inspect rejected rows and the proposed changes before applying. Validation does not publish or mutate canonical market records.
5. Review and apply the exact validated run. Source version and file checksum conflicts require a fresh review. The application records the source, retrieval timestamp, run and applying account.
6. Rebuild metrics after application. This synchronous operation processes at most 10,000 transactions and 10,000 rents from current applied sources with community links. Actual and illustrative records remain separate; missing size data cannot create fabricated price-per-square-foot or yield values. Curated metric keys remain preserved.

Reviewed reports can embed only the fixed Markdown tokens `[[market-data:transactions]]`, `[[market-data:rents]]` and `[[market-data:metrics]]`, optionally followed by `:community-slug` before the closing brackets. Maximum three embeds. These read current explorer data, not a frozen report snapshot. Existing report review and publication rules still apply.

## Search and maps

The Search & map Admin view shows canonical eligibility, projection counts, exclusion reasons, configured provider, worker health and operation history. **Rebuild search now** synchronously rebuilds at most 1,000 eligible listings and records audited completion without creating an outbox event. It is the available maintenance path while the paid worker remains deferred.

Queued maintenance remains disabled when the dedicated worker heartbeat is missing. Creating a queued request is not evidence of processing, completion or delivery. This run did not create the paid worker or drain the queue.

Public maps distinguish the current viewport from the applied search area. Pan, then choose **Search this area** to apply the new bbox. Selected listing, filters, marker style, zoom and center use the URL. Pins and price pills represent the same canonical listings; selected previews can resolve independently of the paginated result rail. Coincident listings have an explicit chooser.

If the primary search projection fails, a bounded fresh canonical fallback is disclosed as degraded. If both paths fail, the API returns 503 and the UI offers Retry. A failed request is not reported as an empty inventory. Only healthy results use the existing short cache.

## Release limits

The public staging inventory contains three clearly labelled demo properties. Verified real inventory and source exports still need to be supplied. Provider-backed AI chat and CRM activation belong to later phases. The dedicated Render worker remains owner-deferred at USD 7/month; its missing heartbeat is truthfully reported by health and Admin.
