# Phase Checklist

## Railway main-site transition: current acceptance overrides historical Render status

- [x] Preserve existing people/property identities; compare private before/after manifests.
- [x] Correct public Ayaz wording through audited updates and preserve media/publication.
- [x] Remove automatic demo seed from Railway Web startup.
- [x] Keep dedicated Worker running; disable unverified automatic releases.
- [x] Copy temporary storage objects into an isolated R2 namespace and verify hashes.
- [ ] Refresh and reconcile every referenced object, then switch Web/Worker delivery to R2.
- [ ] Release durable import preview/commit, templates, demo filter and reviewed archival after exact gates pass.
- [ ] Finish column mapping, publication-eligibility preview and missing bulk content adapters.
- [ ] Complete ten clean actual Mercury turns and approved company-document citations/freshness.
- [ ] Capture/restore an actual Railway encrypted backup; enable independent hosted scheduling.
- [x] Start Docker through supported tooling; restoration engine is available again.
- [ ] Reconcile/export unique legacy company records before stopping Render workloads.
- [ ] Owner completes testing, supplies real content and reviews demo archival.
- [ ] Company SMTP (owner deferred); customer enquiry notification acceptance.
- [ ] Review launch contacts/privacy/permissions/bilingual content and paid hosting usage.
- [ ] Customer launch and later domain/canonical/cookie transition.

Historical phase completion below does not constitute Railway customer-launch acceptance.

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
| 12 AI Advisor + RAG | IN_PROGRESS | `ba3326f` | CI 36835040693 passes; live probe generated successfully in 6175 ms; subsequent actual CHAT/NL_SEARCH still failed upstream after bounded retry. Approved-source facts remain pending |
| 13 Leads/CRM operations | COMPLETE_LOCAL_SCOPE | `ba3326f` | CI 36835040693 full gate; live OWNER Deferred banner and disabled GHL connection; external sync intentionally deferred |
| 14 SEO/routing/multilingual | COMPLETE | `7131fe2` | CI 36838547634 full gate; exact Render deployment live; native sitemap 84 canonical URLs, bilingual alternates and private exclusions; staging crawl block |
| 15 Analytics/data quality/observability | COMPLETE | `7131fe2` | CI 36838547634 full gate; live OWNER analytics UTC measurement/consent limits and NO_RECORDS market coverage verified |
| 16 Security/RBAC/privacy | COMPLETE | `7046b02` | CI 36845307784 full gate; exact live release, 39 migrations, browser-role schema denial and fixed geography lookup verified |
| 17 Public UX restoration | COMPLETE | `7046b02` | Full EN/AR desktop/mobile journeys, posters, current parent/account search revocation and independently degraded feeds pass |
| 18 Performance/accessibility/full QA | COMPLETE_RELEASE_SCOPE | `7046b02` | 288 unit/contract, 130 integration, 96 browser, 16 performance checks and build/security/recovery gates pass. Final acceptance additions require their own exact gate |
| 19 Production cleanup/cutover | REPORT_PREPARED_CUTOVER_BLOCKED | `7046b02` | Live private media reconciliation and security acceptance complete; report names deferred worker, unreliable actual Gemini chat, missing approved facts and live backup-key/restore dependencies |

Owner-approved 2026-10-01 scope: finish inline media first, then Phases 12–19 in verified staged releases. External CRM synchronization and the paid worker remain deferred.

## Final acceptance checkpoint (1 October 2026)

Shared inline media is live and verified: image replacement/revision retention, MP4/WebM playback, persistent poster, reordered gallery and attachment-specific metadata survived create/edit/reload in an unpublished fixture. Gated PDF downloaded through the OWNER form matches the uploaded file; anonymous delivery is 401 and private entity routes are 404.

Property creation/publication and account-optional website Team passed exact full CI 36877843112 on `3ced481` and are deployed through PR 10. Live unpublished demo creation, retained inline metadata, specific rejected-publication errors and public exclusion passed. The owner's account-free published Hammad profile appears on English and Arabic Team pages independently of the Advisor directory.

Durable Advisor recovery passed exact full CI 36880675041 on `63b88e1` and is deployed through PR 11. An actual ADVISOR diagnostic succeeded; actual CHAT still returned Gemini 503 errors. Reload recovered the existing saved fallback replies. Ten successful actual conversational turns and approved-source knowledge remain outstanding; durable turn completion alone is not generation acceptance.

Hosted recovery passed exact full CI 36884868448 on `f6e7e96` and is deployed through PR 12. A fresh 41-migration hosted database/media backup passed encrypted upload/readback and actual isolated restoration, record/migration reconciliation, all 54 object hashes, public image/video/ranges and protected documents. The owner confirmed a separate key copy. The direct-PowerShell schedule was interrupted; a hidden GUI-host scheduled test passed with exit code zero. Continuous cadence, incident RPO/RTO and the launcher's exact full release gate remain outstanding. Paid worker and external CRM sync remain intentionally deferred. See `PRODUCTION_CUTOVER_REPORT.md` and `HOSTED_RECOVERY.md`.
