\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL max_parallel_workers_per_gather = 0;

INSERT INTO "Community" (
  id, name, slug, lat, lng, "publicationStatus", "sourceType", "locationPrecision",
  "createdAt", "updatedAt"
) VALUES (
  'query-plan-community', 'Synthetic query-plan community', 'query-plan-community',
  25.2048, 55.2708, 'PUBLISHED', 'INTERNAL', 'EXACT', NOW(), NOW()
);

INSERT INTO "Property" (
  id, "communityId", title, slug, "propertyType", bedrooms, bathrooms, lat, lng,
  "publicationStatus", "sourceType", "locationPrecision", "createdAt", "updatedAt"
)
SELECT
  'query-plan-property-' || n,
  'query-plan-community',
  'Synthetic query-plan property ' || n,
  'query-plan-property-' || n,
  CASE WHEN n % 5 = 0 THEN 'VILLA' ELSE 'APARTMENT' END,
  (n % 5)::double precision,
  ((n % 4) + 1)::double precision,
  25.2048 + ((n % 200) - 100) * 0.0001,
  55.2708 + ((n % 200) - 100) * 0.0001,
  CASE WHEN n % 10 = 0 THEN 'DRAFT' ELSE 'PUBLISHED' END,
  'INTERNAL',
  'EXACT',
  NOW() - (n || ' seconds')::interval,
  NOW()
FROM generate_series(1, 25000) AS n;

INSERT INTO "Listing" (
  id, "propertyId", "listingType", "priceMinor", currency,
  "availabilityStatus", "publishedAt", "createdAt", "updatedAt"
)
SELECT
  'query-plan-listing-' || n,
  'query-plan-property-' || n,
  CASE WHEN n % 4 = 0 THEN 'RENT' ELSE 'SALE' END,
  (50000000 + (n % 1000) * 100000)::bigint,
  'AED',
  CASE WHEN n % 20 = 0 THEN 'WITHDRAWN' ELSE 'AVAILABLE' END,
  NOW() - (n || ' seconds')::interval,
  NOW() - (n || ' seconds')::interval,
  NOW()
FROM generate_series(1, 25000) AS n;

INSERT INTO "MarketTransaction" (
  id, source, "sourceRecordKey", "transactionDate", "areaName", "communityId",
  "propertyType", "amountMinor", currency, "isIllustrative", "createdAt"
)
SELECT
  'query-plan-transaction-' || n,
  'SYNTHETIC_QUERY_PLAN',
  'query-plan-transaction-' || n,
  DATE '2024-01-01' + (n % 900),
  'Synthetic query-plan community',
  'query-plan-community',
  CASE WHEN n % 5 = 0 THEN 'VILLA' ELSE 'APARTMENT' END,
  (50000000 + n * 1000)::bigint,
  'AED',
  TRUE,
  NOW()
FROM generate_series(1, 25000) AS n;

INSERT INTO "JobRun" (
  id, "jobKey", "payloadJson", "idempotencyKey", status, attempts, "maxAttempts",
  "scheduledAt", "createdAt", "updatedAt"
)
SELECT
  'query-plan-job-' || n,
  'query.plan.synthetic',
  jsonb_build_object('sequence', n),
  'query-plan-job-' || n,
  CASE WHEN n % 20 = 0 THEN 'QUEUED' ELSE 'SUCCEEDED' END,
  CASE WHEN n % 20 = 0 THEN 0 ELSE 1 END,
  3,
  NOW() - (n || ' seconds')::interval,
  NOW(),
  NOW()
FROM generate_series(1, 25000) AS n;

ANALYZE "Property";
ANALYZE "Listing";
ANALYZE "MarketTransaction";
ANALYZE "JobRun";

\echo 'PLAN public listing browse'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT l.id
FROM "Listing" l
JOIN "Property" p ON p.id = l."propertyId"
WHERE l."listingType" = 'SALE'
  AND l."availabilityStatus" = 'AVAILABLE'
  AND l."priceMinor" BETWEEN 60000000 AND 90000000
  AND p."publicationStatus" = 'PUBLISHED'
  AND p."deletedAt" IS NULL
ORDER BY l."publishedAt" DESC
LIMIT 24;

\echo 'PLAN PostGIS radius lookup'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT count(*)
FROM "Property" p
WHERE p."publicationStatus" = 'PUBLISHED'
  AND p."deletedAt" IS NULL
  AND ST_DWithin(
    p.geo,
    ST_SetSRID(ST_MakePoint(55.2708, 25.2048), 4326)::geography,
    200
  );

\echo 'PLAN market time series'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT t."transactionDate", t."amountMinor"
FROM "MarketTransaction" t
WHERE t."communityId" = 'query-plan-community'
  AND t."transactionDate" BETWEEN DATE '2025-01-01' AND DATE '2025-12-31'
ORDER BY t."transactionDate" DESC
LIMIT 100;

\echo 'PLAN due job claim candidates'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT j.id
FROM "JobRun" j
WHERE j.status IN ('QUEUED', 'RETRYING')
  AND j."scheduledAt" <= NOW()
ORDER BY j."scheduledAt" ASC
FOR UPDATE SKIP LOCKED
LIMIT 10;

ROLLBACK;
