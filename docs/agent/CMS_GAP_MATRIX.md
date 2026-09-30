# CMS / Admin Gap Matrix

Baseline API/editor coverage compared with the canonical Prisma domain.

| Domain | Existing baseline | Production gap | Target phase |
|---|---|---|---|
| Properties | Admin Studio create/edit/preview/publish/unpublish, property fields, price history/audit, SEO metadata, galleries, floor plans and documents | Production inventory is still demo data; worker-backed outbox processing remains blocked in Phase 01 | 05 |
| Projects | GET/POST/PATCH plus advanced Project Studio fields | Editor supports launch/handover/construction evidence, amenities, galleries, progress media, documents and source-backed payment plans; real project facts and evidence still need owner input | 06 |
| Communities | GET/POST/PATCH plus extended location, boundary, amenities, market and source fields | Validated geo facts, media, provenance and publication gates; real sourced community data still needs owner input | 07 |
| Developers | GET/POST/PATCH plus evidence-backed verification | Owner/admin verification requires an evidence URL and is audited; confirmed developer identity and source material still need owner input | 07 |
| Advisors | GET/POST/PATCH plus invitation entry point and linked account profile | Profiles start private; public activation requires an active, email-verified AGENT account and profile; real agent invitations and details remain owner-managed | 07 |
| Units | GET plus audited manual CRUD and source-preserving CSV/JSON import diff/apply | Imported facts and editorial overrides are stored separately with availability history; an owner-approved inventory feed remains to be supplied | 06 |
| Content | Revision-aware Page Studio with PAGE/editorial types, typed interactive modules, validated entity/media blocks, translations, preview and independent publication | Owner-managed real editorial content is still to be supplied; brand/system/legal constraints remain enforced | 08–09 |
| Site settings/nav | Audited/versioned visual bilingual navigation/footer, core-page copy, contact, CTA/social/default media and constrained home ordering | Built-in defaults remain active until the owner saves verified public settings | 08 |
| Careers | Dedicated role model/editor, requirements/application/salary/date/SEO fields, independent approve/publish, close/archive/private restore and public details | No real vacancies have been supplied; published inventory remains empty rather than illustrative | 09 |
| International | Source-current reviewed CMS guides, source dates/links, locale-aware hub and homepage entry | No current verified guidance has been published; regulatory material requires evidence and freshness review | 09 |
| Media | Upload, searchable/filterable library, metadata, public picker, usage graph, gallery attach/reorder/cover, property floor plans/documents, protected unused-asset deletion | Bulk upload and replace/archive workflows remain; live manual upload was not separately exercised | 04 |
| Market | Reports/import/data-quality pieces | Source registry, actual file mapping/validation/apply, freshness and metric rebuild | 10 |
| Search/map | Provider APIs and public views | Operational reindex diagnostics, stable map, URL/list sync and exclusion reasons | 02/11/15 |
| AI/RAG | Gateway/chat/tools and partial RAG Admin | Provider readiness, bounded test, retrieval/index health and usage/error diagnostics | 12 |
| Leads/CRM/email | Local-first leads, CRM scaffolding, SMTP-only real transport | Truthful provider state, retry/reconciliation and no false delivery claims | 13 |
| SEO/redirects | Strong existing CRUD/revisions | Integrate new entity/page lifecycle, canonical/hreflang and sitemap gates | 14 |
| Jobs/DLQ | Strong backend and Admin read view | Online worker, accurate runtime health and controlled replay diagnostics | 01/15 |
| Analytics/quality | Existing endpoints and evidence screens | Measured operational status, freshness and published-vs-public exclusion reasons | 15 |
