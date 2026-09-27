# Local Docker

The local stack is production-shaped and does not use SQLite. It includes the Next.js web app, a dedicated worker, PostgreSQL 16 with PostGIS/`pg_trgm`/pgvector, Redis, private S3-compatible MinIO storage, and Mailpit.

## Clean-machine start

Prerequisite: Docker Desktop (or Docker Engine with Compose v2) is running. Bun is not required on the host.

```bash
git clone <repository-url>
cd <repository-directory>
docker compose up -d --build
docker compose ps
```

Wait until `web`, `worker`, `postgres`, `redis`, `object-storage`, and `mail-catcher` show `healthy`. The one-shot `migrate` and `object-storage-init` services should show successful completion.

Open:

- Web: http://localhost:3000
- Web health: http://localhost:3000/api/health
- MinIO console: http://localhost:9001
- Mailpit: http://localhost:8025

All committed Compose credentials are explicitly local-development defaults. To override ports or local credentials, copy `.env.docker.example` to `.env.docker`, fill it locally, and invoke Compose with `--env-file .env.docker`.

Gemini is opt-in for local runs. Keep `AI_PROVIDER=mock` for an offline-safe stack. To use Gemini, first rotate any key previously pasted into chat, put the new key only in ignored `.env.docker` as `GEMINI_API_KEY=...`, set `AI_PROVIDER=gemini`, then run `docker compose --env-file .env.docker up -d --build`. OpenAI is not implemented or used as a fallback yet. Adapter tests use mocked HTTP responses and never call Google.

## Routine commands

```bash
bun run docker:up
bun run docker:logs
bun run docker:test
bun run docker:down
```

Without host Bun, use the underlying commands:

```bash
docker compose up -d --build
docker compose logs -f --tail=200
docker compose exec -T web bun run typecheck
docker compose down --remove-orphans
```

Apply committed migrations without destructive reset:

```bash
docker compose run --rm migrate bun run db:migrate:deploy
```

Exercise the rolled-back Phase B query-plan corpus (PowerShell):

```powershell
Get-Content -Raw -Encoding utf8 tests/sql/phase-b-query-plans.sql |
  docker compose exec -T postgres psql -U iere -d iere
```

The script inserts synthetic rows only inside a transaction and always rolls it
back. Its output should use the public browse, live-property GiST, market
time-series, and due-job claim indexes documented in the verification log.

Reset only the disposable local Docker volumes and rebuild:

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```

This deletes only the named local Compose volumes. Never use the reset workflow against staging or production.

## Optional development seed

The application starts with a clean database. The fixture seed is deliberately not automatic. If fixtures are needed, provide an explicit local bootstrap email and password at execution time; no default owner credential exists in source control.

## Troubleshooting

```bash
docker compose ps
docker compose logs postgres migrate web worker
docker compose exec -T postgres psql -U iere -d iere -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis','pg_trgm','vector') ORDER BY extname;"
```

If a configured host port is occupied, set a different value in `.env.docker` and run Compose with `--env-file .env.docker`.
