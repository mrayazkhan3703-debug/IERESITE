# Targeted Team, property assignment and Mercury release

Date: 2 October 2026. Branch: `codex/people-advisor-inception`. PR: [15](https://github.com/mrayazkhan3703-debug/IERESITE/pull/15).

## Scope and data

The existing `Agent` record represents both staff and advisors. `publicTeam` controls website profile publication, `publicAdvisor` enables public property advisory, and `Listing.agentId` remains the assignment reference. No duplicate person table or new migration is introduced. Publishing a profile does not create an account or grant login access. Existing records, real inventory, unpublished examples and media are preserved.

Admin `/admin/agents` is labelled **Team & Advisors**. Create/edit retains the shared inline media field and adds editable optional AGENT account links. Standalone advisors require active status and a bio; linked accounts must remain active, email verified and hold the AGENT role. Organization scope and version conflicts are enforced in transactional commands.

Property forms offer a searchable visual **Assigned advisor** field and an explicit advisory-desk fallback. Options and commands share the same scope/eligibility predicate. Assign, change and clear operate on the listing; audit before/after and synchronous indexing remain in place. Public property enquiries prefer the current eligible listing advisor and retain property/listing/agent context in the existing lead event, with existing page/session attribution. CRM synchronization is not enabled.

`/agents` uses the established premium cards for the unified directory with English/Arabic filters. `/about/team` shares that component and data with a locale-correct `/agents` canonical. Existing profile routes and slug redirects remain valid. The sitemap excludes the duplicate Team directory alias. Media Library photo replacements take precedence over an older static portrait.

## Inception adapter

The selected live provider is Inception Mercury 2.5, using the [official REST contract](https://docs.inceptionlabs.ai/api-reference/chat/create-a-chat-completion). The existing `ChatProvider` interface and JSON tool orchestrator remain unchanged. Internal tool results are sent as clearly identified untrusted user-message data; no native tool-call IDs are fabricated.

The adapter uses Bearer authorization only on `https://api.inceptionlabs.ai/v1/chat/completions`, disables redirects, limits response reads to 1 MiB, and aborts at the existing shared deadline. `max_completion_tokens` bounds visible output plus reasoning, low reasoning effort is selected, and temperature is clamped to the documented 0.5–1 range. Raw errors, messages, prompts and credentials are not logged. Failure diagnostics retain only HTTP status, allowlisted error codes and safe request identifiers.

Reported usage is used when complete; missing usage keeps the conservative reservation. Failures consume their reservation, and one bounded transient retry reserves separately. `costMicros` stays null. Kill switches, feature rollout, rate limits, request/token budgets, durable turns, cancellation, RAG and search retain their existing paths. Gemini and all other legacy provider selections fail closed. The local mock calls no external model and uses provider-neutral copy.

Required Render web configuration:

```dotenv
AI_PROVIDER=inception
INCEPTION_MODEL=mercury-2.5
INCEPTION_BASE_URL=https://api.inceptionlabs.ai/v1
AI_LIVE_ENABLED=true
INCEPTION_API_KEY=<add the secret in Render; never commit it>
```

The adapter also requires the existing enabled `ai_advisor` feature flag and available daily budget. The dedicated Render worker configuration and CRM settings are unchanged. Only the web service's provider fields in `render.yaml` are updated.

## Files

Checkpoint A:

- `src/server/domain/agent-directory.ts`, `agent-command.ts`, `property-command.ts`, `lead-service.ts`, `read-models.ts`
- `src/app/api/admin/agents/route.ts`, `admin/properties/options/route.ts`, `api/agents/route.ts`
- `src/components/media/assigned-advisor-field.tsx`, `src/components/entity/agent-avatar.tsx`
- `src/features/admin/admin-sections.ts`, `src/views/admin/admin-view.tsx`, `src/views/agents-view.tsx`, `src/views/team-view.tsx`, `src/lib/i18n.ts`
- `src/server/seo/route-contract.ts`, `sitemap.ts`
- `tests/agent-directory.test.ts`, `people-assignment.integration.ts`, `native-route.integration.ts`, `tests/accessibility/people-advisor-assignment.spec.ts`, `static-assets.spec.ts`

Checkpoint B:

- `src/server/ai/inception-provider.ts`, `provider-error.ts`, `gateway.ts`, `controls.ts`, `readiness.ts`, `turn-budget.ts`, `reservation-budget.ts`
- `src/lib/config.ts`, `src/app/api/admin/ai/readiness/route.ts`, `src/views/admin/shared/advisor-operations.tsx`
- `.env.example`, `.env.docker.example`, `render.yaml`
- `tests/inception-provider.test.ts`, `inception-gateway.test.ts`, `tests/fixtures/inception-gateway.ts`, `tests/ai-controls.test.ts`, `staging-blueprint.test.ts`, `tests/accessibility/ai-advisor-journey.spec.ts`

Execution evidence is appended to `EXECUTION_STATE.md`. No migration files changed.

## Verification status

Checkpoint A commits: `6ac5022f2bee0ae66f5bef607ce17d31c4b9028e`, canonical-test correction `f757a98e32e41d6e4dc7d9e1f7d6ea63161c2078`, and relation-audit correction `1326920` (final CI will include its added regression test). Checkpoint B implementation: `ab5fd91`.

First exact CI 36992106263 passed Docker build, lint, typecheck, 320 unit/contract tests and all five new assignment/profile/lead integration cases. The complete integration run had 145 passing tests and one stale canonical assertion failure, corrected in the second commit. CI 36992902090 passed build, lint, typecheck and the complete integration gate. Its browser suite passed 108 journeys, including all four new bilingual/responsive profile-assignment journeys; one older Property Studio journey still targeted the replaced dropdown and seeded an ineligible private advisor. That fixture and locator are updated to the public advisor policy and visual picker. The final combined exact commit requires a fresh complete gate before release.

Mercury local checks: typecheck and lint pass; an optimized webpack production build passes. The adapter's 19 network-mocked tests and gateway's 16 isolated database/network-mocked tests exercise configuration, headers, message mapping, usage, timeout, response validation, safe errors, retries, provider selection, feature gates, prompt/request/token caps, NL search and RAG routing. No paid API request is used in automated tests. The offline combined suite passed 346 tests. Full hosted generation acceptance is pending.

Initial Render inspection found no `INCEPTION_API_KEY`; a later inspection found that entry supplied while verification continued. Its value was kept masked. The web provider/model/base settings were saved as Inception/Mercury 2.5/official endpoint. Live server diagnostics exposed an invalid nonnumeric `AI_MAX_TOOL_TURNS`; its documented bound was restored to `6` and confirmed saved. No credential value is included in this report.

Release `6e914eb0737a8ca2cfe0e9a856431124a44627bb` is live. Its Git tree matches tested head `03399630569a3f8ad6a6e6a7890a282b8da294cb`. Exact CI 36995706328 passed build, lint, typecheck, credential/history scans, 355 unit/contract tests, 147 integration tests, 109 browser journeys and 16 performance measurements/budget checks. Render deployment `dep-davp0a67bikc73etharg` includes the repaired environment. Health confirms database/search readiness and truthfully reports the missing dedicated worker heartbeat; worker activation remains skipped.

Live Admin roster/profile editing and public English/Arabic directory/canonical routes are observed. Owner authentication works after the invalid environment is repaired. Hammad remains website Team-only; his empty bio and existing capability flags are preserved. Current catalog search returned existing demo records and labelled them illustrative. A Mercury greeting, actual inventory tool exchange and deterministic 6% yield scenario succeeded; Admin shows `inception · mercury-2.5 · RECENT_SUCCESS`. These observed conversations do not establish knowledge acceptance: zero approved knowledge sources/documents are registered.

Live testing also revealed two optional parsing issues: calculator scenarios unnecessarily produced search chips, and the criteria parser made an incorrect capability statement. A follow-up isolates the bilingual intent gate in `src/lib/advisor-search-intent.ts`, scopes the existing NL prompt using `src/server/ai/nl-interpretation-scope.ts`, and adds six unit cases plus four desktop/mobile EN/AR browser cases. It preserves the existing schema, tools, generation and budget paths and requires its own exact CI before deployment. Complete conversational acceptance and this follow-up gate are still pending.

## Completion limits

Do not merge or deploy a failing exact commit. Record the final build, unit/integration/browser/performance results and live screenshots before claiming software release completion. If the Inception key remains absent, publish the tested CMS/provider code with a clearly blocked AI readiness state rather than claiming working live generation. CRM and paid background processing remain skipped by the current request.
