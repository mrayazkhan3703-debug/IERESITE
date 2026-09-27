-- Existing timestamp-without-time-zone values were written by the application as UTC.
-- Make that assumption explicit while moving real instants to timestamptz(3).

-- Calendar-only business dates do not carry a timezone.
ALTER TABLE "Project"
  ALTER COLUMN "launchDate" TYPE DATE USING "launchDate"::date,
  ALTER COLUMN "handoverDate" TYPE DATE USING "handoverDate"::date;

ALTER TABLE "PaymentPlan"
  ALTER COLUMN "validFrom" TYPE DATE USING "validFrom"::date,
  ALTER COLUMN "validTo" TYPE DATE USING "validTo"::date;

ALTER TABLE "PortfolioHolding"
  ALTER COLUMN "purchaseDate" TYPE DATE USING "purchaseDate"::date;

ALTER TABLE "MarketMetric"
  ALTER COLUMN "periodStart" TYPE DATE USING "periodStart"::date,
  ALTER COLUMN "periodEnd" TYPE DATE USING "periodEnd"::date;

ALTER TABLE "MarketTransaction"
  ALTER COLUMN "transactionDate" TYPE DATE USING "transactionDate"::date;

ALTER TABLE "MarketRent"
  ALTER COLUMN "contractDate" TYPE DATE USING "contractDate"::date;

-- Convert every remaining application timestamp consistently. The schema contains
-- only real instants after the date-only columns above have been converted.
DO $$
DECLARE
  column_record record;
BEGIN
  FOR column_record IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
    ORDER BY table_name, ordinal_position
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE TIMESTAMPTZ(3) USING %I AT TIME ZONE ''UTC''',
      column_record.table_schema,
      column_record.table_name,
      column_record.column_name,
      column_record.column_name
    );
  END LOOP;
END $$;

-- Operational envelopes need native JSON semantics and indexability. USING casts
-- preserve valid existing payloads instead of Prisma's destructive drop/add diff.
ALTER TABLE "CrmSyncRecord"
  ALTER COLUMN "payloadJson" TYPE JSONB USING "payloadJson"::jsonb;

ALTER TABLE "WebhookEvent"
  ALTER COLUMN "payloadJson" TYPE JSONB USING "payloadJson"::jsonb;

ALTER TABLE "OutboxEvent"
  ALTER COLUMN "payloadJson" TYPE JSONB USING "payloadJson"::jsonb;

ALTER TABLE "JobRun"
  ALTER COLUMN "payloadJson" TYPE JSONB USING "payloadJson"::jsonb;

ALTER TABLE "DeadLetterEvent"
  ALTER COLUMN "payloadJson" TYPE JSONB USING "payloadJson"::jsonb;
