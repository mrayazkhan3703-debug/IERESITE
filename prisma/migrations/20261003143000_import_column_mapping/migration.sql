-- Optional run metadata, no table rewrite/default/backfill and no reset.
ALTER TABLE "ImportRun" ADD COLUMN "mappingJson" TEXT;
