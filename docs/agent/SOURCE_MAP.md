# Source Map

Baseline: `fb6ae2208d108d7cb57d8b52826201e85c608a61`. Search named symbols after edits instead of relying on line numbers.

## Runtime and delivery

| Concern | Canonical source | Baseline finding |
|---|---|---|
| Render topology | `render.yaml` | Docker web plus dedicated Starter worker; shared revision, role-separated scheduler flags, 120-second worker shutdown |
| Web/worker startup and migration gate | `scripts/start-staging-web.sh`, `scripts/start-staging-worker.sh`, `Dockerfile` | Both validate their role and run `prisma migrate deploy` before accepting traffic or jobs |
| Worker entry | `src/worker.ts` | Requires scheduler enabled; DB probe; database heartbeat; scheduler; `/health`; SIGTERM/SIGINT drain |
| Worker health | `src/server/jobs/worker-health.ts`, `WorkerHeartbeat` | Cross-process heartbeat persisted in PostgreSQL and read by public/admin health surfaces |
| Scheduler/outbox | `src/server/jobs/outbox.ts` (`startScheduler`, `stopScheduler`, `jobQueueMetrics`, `schedulerStatus`) | Postgres-backed polling and durable job/DLQ path already exists |
| Web health | `src/app/api/health/route.ts` | DB, search projection, deployment mode and dedicated-worker heartbeat health |
| Admin queue view | `src/app/api/admin/jobs/route.ts`, `src/server/jobs/admin-read-model.ts`, `src/views/admin/admin-view.tsx` `JobsSection` | Shows worker heartbeat, runs, pending outbox and unreplayed DLQ |
| Runtime config | `src/lib/config.ts` | Typed APP/STAGING/auth/search/AI/CRM/email/job/storage configuration |
| Database connection cap | `src/lib/db.ts` | Adds connection-limit protection for Supabase session pooler |
| Object storage | `src/server/storage/object-store.ts`, `src/server/media/pipeline.ts` | S3-compatible private bucket; public media is proxied by app; R2 region must be `auto` |
| Local production shape | `compose.yaml`, `docs/LOCAL_DOCKER.md` | Separate web, worker, migration, Postgres, Redis, object store, mail catcher |
| CI | `.github/workflows/ci.yml` | Full Docker build, migration, lint, typecheck, unit/integration, worker shutdown, storage, a11y and performance checks |

## Core domain and public projections

| Domain | Canonical source |
|---|---|
| Properties/listings/history | `prisma/schema.prisma` models `Property`, `PropertyUnit`, `Listing`, `PriceHistory`; `src/server/domain/property-command.ts` |
| Projects/payment plans | models `Project`, `PaymentPlan`, `PaymentPlanInstallment`; `src/server/domain/project-command.ts` |
| Communities/developers | models `Community`, `Developer`; matching domain commands |
| Media | models `MediaAsset`, `PropertyMedia`, `ProjectMedia`, `PropertyFloorPlan`, `PropertyDocument`; media pipeline and API routes |
| Content/SEO | models `ContentEntry`, `SeoMetadata`; content/SEO/redirect commands and Admin routes |
| Market | `MarketReport`, `MarketMetric`, `MarketTransaction`, `MarketRent`; market APIs/components |
| AI/RAG | AI conversation/message/tool/usage and RAG models; `src/server/ai/*`, `src/server/rag/*` |
| Durable jobs | `OutboxEvent`, `JobRun`, `DeadLetterEvent`, `MediaProcessingJob`; `src/server/jobs/*` |
| Search | `src/server/search/{service,postgres-provider,local-provider,types}.ts`; `SearchDocument` model |
| Visibility | `src/server/domain/visibility.ts` |

## Admin fast paths

`src/views/admin/admin-view.tsx` contains `SECTIONS` plus Overview, Leads, Properties, Projects, Communities, Developers, Agents, Content, Media, Imports, CRM, Jobs, Analytics, Audit, Flags, Units, Evidence and Data Quality. Existing extracted modules under `src/views/admin/*-section.tsx` prove incremental extraction is viable.

API command gaps are tracked in `CMS_GAP_MATRIX.md`. Preserve database-backed RBAC from `src/server/authz-policy.ts`; new permission grants require a matching migration.

## Phase fast paths

- Phase 01: runtime/delivery files listed above.
- Phase 02: `src/views/{communities,community-detail,map}-view.tsx`, `src/components/home/community-intelligence.tsx`, `src/lib/{leaflet-icons,map-marker-identity}.ts`, `src/app/api/map/route.ts`.
- Phase 03: `src/app/admin/[[...section]]/page.tsx`, Admin monolith and extracted Admin sections, UI primitives and permission policy.
- Later phases: use the V4 brief Section 4B map and update this file when symbols move.

## Authoritative input fingerprints

- V4 recovery brief attachment: `08609a16d75b247b3815b6a72ae8b90c64b2893af7ebb8d9ac632f4f2d9940ad`.
- Available blueprint: `13c39a705fe5a523798172969622c39314a8dd599c8871b0dfc95eea7ae06a57` (filename lacks the requested `(2)` suffix; mismatch recorded).
- Historical reference screenshot ZIP: `bc02f6ad8136c7082dda69333840ccae9dba4ec94f98150601d880d60582bbcc`, 32 PNGs.
