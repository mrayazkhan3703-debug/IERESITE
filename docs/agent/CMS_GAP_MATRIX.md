# CMS / Admin Gap Matrix

Baseline API/editor coverage compared with the canonical Prisma domain.

| Domain | Existing baseline | Production gap | Target phase |
|---|---|---|---|
| Properties | Admin Studio create/edit/preview/publish/unpublish, property fields, price history/audit, SEO metadata, galleries, floor plans and documents | Production inventory is still demo data; worker-backed outbox processing remains blocked in Phase 01 | 05 |
| Projects | GET/POST/PATCH basics | Launch/handover/progress evidence, plans/installments, documents, galleries and units | 06 |
| Communities | GET/POST/PATCH | Lifestyle/geo/media/market/provenance editor and publish quality gates | 07 |
| Developers | GET/POST/PATCH | Verified identity/source, logo/media, relations and lifecycle | 07 |
| Advisors | GET/POST/PATCH | Integrated account invitation/activation, profile relations, routing and publish flow | 07 |
| Units | GET only | Manual-source audited CRUD/overrides plus import diff/apply | 06 |
| Content | GET/POST/PATCH; constrained create types | Pages/landing/legal/team, typed blocks, translations, preview/revisions and publishing | 08–09 |
| Site settings/nav | Mostly source constants | Audited contact presentation, menus, CTA/social/default media and safe module ordering | 08 |
| Careers | Hard-coded illustrative roles | Job-opening model/editor, review/publish/close and public read model | 09 |
| International | Large source-controlled editorial blocks | Sourced, date-reviewed CMS sections and curated guide references | 09 |
| Media | Upload, searchable/filterable library, metadata, public picker, usage graph, gallery attach/reorder/cover, property floor plans/documents, protected unused-asset deletion | Bulk upload and replace/archive workflows remain; live manual upload was not separately exercised | 04 |
| Market | Reports/import/data-quality pieces | Source registry, actual file mapping/validation/apply, freshness and metric rebuild | 10 |
| Search/map | Provider APIs and public views | Operational reindex diagnostics, stable map, URL/list sync and exclusion reasons | 02/11/15 |
| AI/RAG | Gateway/chat/tools and partial RAG Admin | Provider readiness, bounded test, retrieval/index health and usage/error diagnostics | 12 |
| Leads/CRM/email | Local-first leads, CRM scaffolding, SMTP-only real transport | Truthful provider state, retry/reconciliation and no false delivery claims | 13 |
| SEO/redirects | Strong existing CRUD/revisions | Integrate new entity/page lifecycle, canonical/hreflang and sitemap gates | 14 |
| Jobs/DLQ | Strong backend and Admin read view | Online worker, accurate runtime health and controlled replay diagnostics | 01/15 |
| Analytics/quality | Existing endpoints and evidence screens | Measured operational status, freshness and published-vs-public exclusion reasons | 15 |
