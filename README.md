# Investment Experts — Dubai Real Estate Investment Platform

IERE is under active implementation. It combines property and project discovery, market tools, an AI advisor, visual CMS/Admin, and advisor-led conversion. Public inventory and market facts require approved provenance; local illustrative/demo records are not evidence of live data.

**Blueprint:** `Investment_Experts_NextGen_Master_Blueprint_2026-09-19.md`

**Implementation records:** `docs/` and the durable handoff files in `docs/agent/`.

## Local Docker quick start

Requirements: Docker Desktop (or Docker Engine) with Docker Compose v2. No external AI, CRM, email, or property-data credentials are required for the local mock stack.

On a clean PowerShell machine:

```powershell
docker compose --env-file .env.docker.example up --build -d
docker compose --env-file .env.docker.example ps
(Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health).StatusCode
```

On macOS or Linux:

```bash
docker compose --env-file .env.docker.example up --build -d
docker compose --env-file .env.docker.example ps
curl --fail http://localhost:3000/api/health
```

Compose builds and starts the web app, dedicated worker, PostgreSQL with PostGIS/pg_trgm/pgvector, Redis, the SeaweedFS 4.47 S3-compatible local object store, and Mailpit. Database migrations run before the app services. The local AI provider defaults to a deterministic mock; no live provider calls are made. Open `http://localhost:3000`; Mailpit's local email UI is at `http://localhost:8025`.

To run local checks after startup:

```bash
docker compose --env-file .env.docker.example exec -T web bun run typecheck
docker compose --env-file .env.docker.example exec -T web bun test
```

Stop containers while retaining local database/object data with `docker compose --env-file .env.docker.example down`. Do not treat this production-like local stack as a production deployment or readiness claim.

## Architecture

- **Frontend:** Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4, and shadcn/ui.
- **Database:** Prisma with PostgreSQL 16, PostGIS, pg_trgm, and pgvector.
- **Search and maps:** PostgreSQL-backed search with explicit provider boundaries; Leaflet/OSM behind the map adapter.
- **AI:** Gemini is opt-in behind server-side controls; local Compose defaults to a deterministic mock. No OpenAI fallback is configured.
- **Jobs and storage:** Dedicated worker, transactional outbox/DLQ, Redis, and an S3-compatible local object store.
- **CRM:** GoHighLevel is the production target; local development uses the non-live adapter until OAuth configuration and live metadata are approved.
- **Privacy:** Non-essential analytics default denied and require current server-side consent. Legal-purpose and retention approval remain external gates.

## Environment

See `.env.example` (grouped: app/db/auth/search/maps/AI/CRM/email/analytics/jobs/rate-limits/media). All integrations degrade safely when unconfigured; production-required vars fail fast at boot.

## Data provenance

Development fixtures are clearly labeled (`sourceType: DEMO_SEED`, `isDemoData`, `isIllustrative`) and surfaced in the UI. Production replaces them via the ingestion pipeline (admin → Imports). See ADR-010.
