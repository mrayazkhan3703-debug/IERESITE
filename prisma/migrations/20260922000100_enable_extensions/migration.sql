-- Required platform extensions. These statements are idempotent so the same
-- migration works in local, CI, staging, and production PostgreSQL databases.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
