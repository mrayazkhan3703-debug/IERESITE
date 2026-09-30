# Phase Checklist

| Phase | Status | Checkpoint | Verification |
|---|---|---|---|
| 00 Baseline and forensic state | COMPLETE | `9389a1afd4c533776fbcd63a002874df4fd09bb3` | `VERIFICATION_LOG.md` 2026-09-28 |
| 01 Online web + worker topology | BLOCKED | `72b849ae9d367ba35629af7425d3f3b669e44f03` | `VERIFICATION_LOG.md` 2026-09-28; owner deferred USD 7/month worker |
| 02 P0 browser/runtime repair | COMPLETE | `9964a870d6f413b48d2cb810d0f09dbb8b0224d2` | Run 17; map/community route, static assets, accessibility and `/buy` budget pass |
| 03 Admin 2.0 shell | COMPLETE | `9964a870d6f413b48d2cb810d0f09dbb8b0224d2` | Run 17; modular shell, role-filtered paths, editor discard guard and CMS regression pass |
| 04 Media Library 2.0 | COMPLETE | `768d447e73c5af0c40564aa9fa749c6addb799f9` | Run 36; upload/search/usage/gallery/property asset journeys pass; deployed and route-smoked 2026-09-29 |
| 05 Property Studio | COMPLETE | `768d447e73c5af0c40564aa9fa749c6addb799f9` | Run 36; create/edit/preview/publish, price history, SEO, search/map and Arabic property journeys pass; deployed and route-smoked 2026-09-29 |
| 06 Project/payment plan/units Studio | COMPLETE | `94190061a1eae85a943c5f542793c61d96c7007f` | Run 39 passes; 34/34 migrations; Render deploy `dep-datv7fgu01pc73fr2c7g` live and route-smoked |
| 07 Communities/developers/advisors | COMPLETE | `94190061a1eae85a943c5f542793c61d96c7007f` | Run 39 passes; publish/verification/account gates covered; Render deploy `dep-datv7fgu01pc73fr2c7g` live |
| 08 Page/Content Studio + settings | COMPLETE | `d07444ae0b188599c831a4010600a5f8309d3133` | CI runs 43/45 pass; 36 migrations applied; live OWNER settings/content access and saved-scenario hydration verified; Render `dep-daueu27f3r2c73ernrg0` live |
| 09 Careers + International governance | COMPLETE | `d07444ae0b188599c831a4010600a5f8309d3133` | Independent approval/publication, private restore, scheduling/source expiry and bilingual browser checks pass; live Admin/public routes verified |
| 10 Market Intelligence operations | COMPLETE | `e9c189cc2e229ffa8e12800b1fb7191527f55cc7` | CI 54/56, 37 migrations; registry/file mapping/private validation/review/apply/metrics/report embeds; live OWNER imports verified |
| 11 Search + map production upgrade | COMPLETE | `e9c189cc2e229ffa8e12800b1fb7191527f55cc7` | CI 56 passes 79 browser checks including EN/AR singleton pins; Render `dep-dauj52gu01pc738jhml0` live; direct rebuild, default pins, selection/reload and price/pin switching verified |
| 12 AI Advisor + RAG | NOT_STARTED | — | — |
| 13 Leads/CRM operations | NOT_STARTED | — | — |
| 14 SEO/routing/multilingual | NOT_STARTED | — | — |
| 15 Analytics/data quality/observability | NOT_STARTED | — | — |
| 16 Security/RBAC/privacy | NOT_STARTED | — | — |
| 17 Public UX restoration | NOT_STARTED | — | — |
| 18 Performance/accessibility/full QA | NOT_STARTED | — | — |
| 19 Production cleanup/cutover | NOT_STARTED | — | — |

Exactly two phases are handled per normal run. A later run resumes the first `IN_PROGRESS` phase or takes the next two `NOT_STARTED` phases only.
