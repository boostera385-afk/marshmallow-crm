# Marshmallow Copilot rollout

## Current feature / role catalogue audit — 2026-10-15

### Outcome and authorization boundaries

- The catalogue covers all **21 current navigation sections**, with regression
  coverage against `ALL_NAV_ITEMS` and the existing six-role frontend defaults.
  Added Processor Board, separate Get CX Update / Get Tech Update guides,
  independently granted CX/Tech Quickchat, and a Donut manual-install/version guide.
  Map/Settings guidance now reflects existing filters and fixed role gates.
- Processor Board remains **Admin/Processor only**. CX/Tech Updates remain
  **Admin/Processor/Customer Service/CS Admin**. Quickchat uses its own existing
  navigation grant. Manage CS and Quotation Master still control their respective
  tools. No new role, user grant, AI consent or permission bypass was introduced.
- Exact workflow names such as `Get Tech Update`, `Quotes to Send` and
  `update Donut` resolve to read-only help, not mutation errors or paid AI.
  Requests to update a job, send Dose or approve payment remain blocked.
  Word-aware matching avoids false `map` results from `roadmap`.
- Copilot opens existing routes; it does **not** query Processor Board evidence,
  start a review, complete/acknowledge updates, send messages, or change records.
  Saved-brief/attention answers offer only caller-permitted workflow links.
  No lead/status/approval policies or workflow endpoints were changed.
- Settings Feature Access search now recognizes `Get Tech Update`, `Get CX Update`,
  `Dispatch Board` and `Job Update Board`. Fixed-role cells remain labelled read-only,
  not ineffective grant switches.
- Donut has no native Copilot, scheduled-job board or saved-lead update queue.
  Its existing native intake, urgent checks, technician intelligence and photo/chat
  handoff remain separate. No extension sources or release artifacts changed;
  no ZIP installation is required for this Copilot-only update.

### Approved MCP application and deployment

Target: existing shared project **`kxiqholnmhkwhdkhtopp`**. Only the user's approved
Copilot migration/function rollout was performed; no data repair, role grants,
secret changes, messages, ingestion changes, CRM Publish, commits or pushes.

1. Applied exact local file
   `supabase/migrations/20261015060558_copilot_current_feature_access.sql` through
   MCP. Recorded version: **`20261015063130`**, name
   **`copilot_current_feature_access`**. It replaces only `copilot_nav_allowed(text)`
   and `copilot_get_access()`, preserving SECURITY INVOKER, fixed empty search paths,
   authenticated-only execute and existing caller-token RLS.
2. Deployed **`marshmallow-copilot` v6**, ACTIVE. Diagnostics backend version is
   `pilot-3`; model/prompt stay `gpt-4o-mini` / `2026-10-14.1`. All five retrieved
   deployment files matched local source (line-ending normalized).
3. Live preflight found **v5**, not the historical v2 documented below. Its five
   source files matched the committed baseline. Its **`verify_jwt=false`** was
   preserved; this rollout did not disable gateway JWT checking. The entrypoint
   still validates the supplied token with `auth.getUser()` before any caller RPC
   or provider request. Four live non-customer probes passed: OPTIONS 200, GET 405,
   missing bearer 401, invalid synthetic bearer 401.
4. All **26 production-safe checks** in
   `supabase/tests/115_copilot_current_features_readonly.sql` passed. The exact
   `40_leads_rls_baseline.sql` six-role matrix matched before/after, cell for cell.
   Role grants, user grants, global config and lead-policy fingerprints also matched.
5. No function signatures, table columns, enums or generated-type contracts changed;
   `src/integrations/supabase/types.ts` was not hand-edited or regenerated.

**Manual migration handling:** already installed on this project; do not rerun,
rename applied history, replay the original Copilot migration, or use `db push`.
For a separately approved target with existing Copilot dependencies, manually apply
only the new migration after review, then run `115_copilot_current_features_readonly.sql`.
`114_copilot_current_features.sql` is **write-based and isolated-fixture only**.
Rollback requires separate approval: restore only the two function definitions
from `20261013045711_marshmallow_copilot.sql` with their authenticated-only grants,
then redeploy the reviewed pre-rollout v5 source. Do not replay the full old migration
or remove users' grants. CRM role access itself is unchanged by that rollback.

### Verification and efficiency review

- `npm test -- --maxWorkers=1`: **796 tests / 94 files passed**. An earlier run hit
  the shell's 300-second timeout; the standalone longer-timeout run completed green.
- Focused catalogue/API/handler tests: **98 passed**, including denied/stale sections,
  backend failure, zero provider/budget work and preserved mutation denial.
- Network-isolated Chromium: **27 tests passed** in the final complete suite;
  six-role feature visibility, Processor-to-board
  navigation without assessment, desktop/mobile layout, denied users, saved settings,
  failures and feature-search aliases tested using synthetic users only. Initial
  new-test failures were locator mistakes (duplicate history answers and expecting
  switches where fixed-role labels exist); selectors were corrected without
  weakening product assertions.
- `node scripts/test-copilot-db.mjs <PGlite installation>`: **92 behavioral + 68
  read-only checks passed**; migrations applied twice; isolated six-role lead
  visibility baseline unchanged. The new harness contributes 19 override/opt-in
  checks plus 26 metadata/role checks. Shared production was not used for write tests.
- Full lint: **0 errors / 28 existing warnings**. App/node typecheck, production
  build (including extension integrity), and diff whitespace checks passed.
  Existing chunk-size/Browserslist warnings remain. Native Deno typecheck and a real
  signed-in/provider end-to-end workflow were not run.

Efficiency scope: UI adds catalogue entries/search aliases only; hooks, existing
caller/role-scoped cache, polling and shared realtime bus are unchanged. API help
continues to perform the **two existing access RPCs** (initial + late revocation
check), with **zero** board/queue reads, assessments, budget reservations, or AI
requests. No background jobs, storage objects/downloads or extension listeners are
added. Database work adds four bounded navigation sections, preserving indexed
permission lookups and all record queries/RLS; no index changes were justified.

Reproducible local comparison: on the same synthetic Admin/Processor/CS fixtures,
`open Processor Board` previously returned no matching feature and `Get Tech Update`
was treated as a mutation; both now return the permitted guide. The new handler
tests assert unchanged two-access-read safety and zero additional resource calls.
The full Admin AI guide is 5,073 characters, below its existing 8,000-character
context limit. This is functional/resource-test evidence, **not measured production
latency or billing savings**. Prior 24-hour Copilot logs showed 6,595 HTTP 200s and
one 503; no comparable post-rollout user workload, active-user normalization or
invoice evidence has been collected.

Pre/post advisors reported no findings on the two changed functions. Existing
project-wide notices remain out of scope: mutable search paths, public `pg_net`,
anonymous/authenticated definer execution, leaked-password protection, RLS initplans,
multiple policies and index notices. Review the
[database linter remediation guide](https://supabase.com/docs/guides/database/database-linter)
and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
separately; this task did not loosen or silently repair unrelated security settings.

**Still separate:** publish the latest CRM and verify a real signed-in permitted and
excluded role. The earlier uncommitted Processor Board reliability backend was
not redeployed by this Copilot-only rollout; see `PROCESSOR_BOARD_ROLLOUT.md`.
No production assessments or paid AI test was triggered.

Changed implementation files: `_shared/copilot-core.ts`, `copilot-handler.ts` and
`copilot-provider.ts` under `supabase/functions/`; `src/pages/Settings.tsx`; the new
migration above; `scripts/test-copilot-db.mjs`; SQL harnesses 114/115; catalogue,
API and handler tests under `src/lib/`; and `tests/operator-workflow/copilot.spec.ts`.
This section and `docs/CRM_EXTENSION_PARITY.md` record the rollout. Earlier local
Processor Board changes and unrelated untracked files were preserved.

## Authorized pilot backend rollout — 2026-10-14

With explicit user approval, the pilot backend was installed via Supabase MCP on
the existing **Marshmallow** project `kxiqholnmhkwhdkhtopp` (`ACTIVE_HEALTHY`).
This audit supersedes the pending backend/type-generation statements in the
implementation record below. **CRM publication and a real signed-in end-to-end
provider test remain pending.** No push/publication was requested or performed.

- Applied the exact committed file
  `supabase/migrations/20261014034546_copilot_pilot_readiness_and_briefs.sql`.
  MCP recorded version **`20261014050703`**, name
  `copilot_pilot_readiness_and_briefs`. Do not rerun it, rename applied local
  history, use `db push`, or replay the already installed Copilot migrations.
- Deployed **`marshmallow-copilot` version 2**, ACTIVE, with **JWT verification
  enabled**. Read-back matched all five committed files exactly: entrypoint,
  core, handler, conversation and provider. Backend/prompt remain `pilot-2` /
  `2026-10-14.1`; model remains pinned to `gpt-4o-mini`.
- Regenerated `src/integrations/supabase/types.ts` via MCP from the actual migrated
  public schema. The reviewed artifact adds the three pilot RPCs and already
  installed CX-update types; nothing was hand-edited, removed or cast around.
- Executed exact `40_leads_rls_baseline.sql` before and after application. All
  six role matrices match cell-for-cell. No lead policy, approval trigger or
  customer record was changed by this rollout.
- Live read-only smoke: **31/31 PASS** in `111_copilot_readonly_smoke.sql` and
  **11/11 PASS** in `113_copilot_pilot_readonly_smoke.sql`. Admin saved-lead data
  matches its source, missing IDs are unavailable, non-Admin diagnostics/config
  calls are denied, excluded callers cannot request briefs, stale expected config
  is rejected before any save, and browser roles cannot read the private AI ledger.
  The positive configuration-save/permission/AI-ledger write harnesses were run
  **only in isolated embedded Postgres**, never on this shared project.
- The older smoke initially assumed no authenticated USAGE on the entire private
  schema. The installed CX-update workflow legitimately uses that shared schema;
  all Copilot ledger table grants still deny browser roles. The corrected smoke
  asserts no table privileges, including writes, plus actual denied anonymous and
  authenticated SELECT actions. Local regression reproduces shared schema USAGE.
  No remote grant was altered to obtain a passing result.
- Live function checks: CORS OPTIONS returned 200, missing auth was rejected by
  the gateway with 401, and a valid legacy anonymous key reached the deployed
  handler and returned **401, “Sign in to use Copilot.”** Runtime logs show version
  2 and the expected denied invocation, without recorded errors in the inspected
  post-deployment window. This verifies boot/auth rejection, **not** an authenticated
  CRM workflow or successful paid provider call.
- Saved configuration is unchanged: Copilot on, **AI off**, $10 monthly allowance,
  20 requests/user/day, `America/New_York`. The last configuration audit remains
  `2026-10-13 08:56:26.81426+00`; the private ledger still contains one request.
  No secrets, AI enablement, ingestion controls, external messages or user grants
  were changed, and no new paid provider request was made.

### Advisor review

Security/performance advisors were inspected before and after. The only new
security finding is the expected authenticated-executable `SECURITY DEFINER`
diagnostics RPC. It is intentionally callable but checks `auth.uid()` and the
Admin role before reading aggregate usage; anonymous execute is revoked and
non-Admin denial passed. The existing private-ledger “RLS without policies” INFO
is intentional deny-by-default, with direct read denial verified. Do not grant
ledger access or disable RLS to silence these notices.

Other pre-existing findings remain out of scope and are **not** claimed fixed:

| Notice | Review/remediation |
| --- | --- |
| Mutable search paths (7) | [Function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) |
| `pg_net` in public (1) | [Extension schema](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) |
| Anonymous-definer execution (4), authenticated-definer execution (65 including the reviewed diagnostics RPC) | [Anonymous execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| Leaked-password protection disabled | [Password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
| Unindexed foreign keys (3), RLS initplans (24), multiple permissive policies (16), duplicate index (1) | [Foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [initplans](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), [indexes](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index) |
| RLS without policies (4 INFO), unused indexes (25 INFO), absolute Auth connection allocation (1 INFO) | [Deny-by-default RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [production checks](https://supabase.com/docs/guides/deployment/going-into-prod) |

### Post-deployment local frontend verification

All checks were rerun after replacing generated types:

| Check | Result |
| --- | --- |
| `npm run lint` | Passed: no errors; 29 pre-existing warnings. |
| `npm run typecheck` | Passed for app and node configurations. |
| `npm test -- --maxWorkers=2` | 615 tests passed across 71 files. |
| `npx playwright test --config playwright.operator-workflow.config.ts` | 45 isolated browser tests passed, including 20 Copilot cases and desktop/mobile minimize/restore. |
| `npm run build` | Passed, including unchanged Donut v1.7.0 source/ZIP verification. Existing build notices remain. |
| `npx deno check --no-lock supabase/functions/marshmallow-copilot/index.ts scripts/benchmark-copilot.ts` | Passed. |
| `node scripts/test-copilot-db.mjs <PGlite installation directory>` | 73 behavioral and 42 read-only smoke checks passed with shared-schema USAGE reproduced; migrations applied twice; all six role matrices unchanged. |
| `git diff --check` | Passed. |

Frontend browser traffic remains completely intercepted with synthetic records;
the separate live SQL and HTTP checks above are the deployed-backend evidence.
The revised smoke files and this rollout record are committed with the exact
MCP-generated database types. Donut source/artifacts and shared AI endpoints are
unchanged; no manual Donut reinstall is required for this CRM-only feature.

### Remaining release checks

Publish the reviewed `pilot` frontend separately, refresh CRM tabs, then verify
a real signed-in permitted Admin and excluded user through the deployed function.
Check minimize/restore while using another work page. AI remains deliberately off;
enable/save it and confirm the allowance-consuming Admin provider test only with
separate approval. No real signed-in browser session was available to this task,
and network-isolated browser tests do not replace that final check.

Rollback remains the migration's documented sequence: disable Copilot, restore
the prior frontend/function, and optionally remove only the three pilot RPCs after
review. Retain configuration, audit history and the ledger. The previous deployed
function source was retained locally for recovery; no rollback was executed.

## Pilot enhancement — 2026-10-14 (implementation record)

Implemented on `pilot`, based on `copilot` commit `61560f2`. This section supersedes
the older UI/provider descriptions below, not their historical deployment record.
**No production settings, secrets, migrations, Edge Functions or CRM publication
were changed during the pilot implementation. No paid provider calls were made.**

### What changed

- Admin shows verified saved AI/Copilot state separately from draft switches,
  marks unsaved edits, offers discard/reload, and preserves dirty edits when another
  session changes configuration. New UI saves include the exact previously saved
  config; the checked RPC locks and compares it before saving or returns a conflict.
  The old configure RPC remains for existing clients; refresh all Admin tabs after
  publication. This protection is not a claim that the reported disable was caused
  by a race: the read-only audit showed AI enabled, one success, then a later disable.
- Readiness checks are Admin-only, explicit and zero-spend: credential presence,
  remaining shared allowance, the current Admin's daily attempts remaining, last
  configuration change, last successful request and backend/model/prompt versions.
  Presence is not provider validation. A separate confirmation discloses $0.02 and
  daily quota consumption before one nonsensitive provider test. It cannot enable AI.
- Provider adapter uses Responses API with strict structured output, `store:false`,
  600 output tokens, 20-second timeout and no retries/fallback. Auth/access, billing,
  rate limiting, model/request config, timeout, network, refusal, incomplete and
  invalid outputs have safe distinct categories; raw provider bodies are not logged.
  Unknown usage remains NULL. A failed accounting follow-up keeps the successful
  answer and the conservative reservation instead of claiming the AI call failed.
- Validated, bounded search context supports area/service/status/active/date
  refinements and exact ISO report ranges. Unknown refinements request clarification
  without spending. Explain preserves the original range and personal/team scope;
  the existing caller-scoped RPC still rejects non-Admin team reports.
- AI-assisted consent is off on each newly opened panel. When consent is on, up to
  three prior AI-only question/answer pairs (500/1,000 characters each) may be sent
  as untrusted context. CRM cards, phones, addresses, quotes and transcripts are
  never automatically included. Explain excludes conversation history and forwards
  only fresh scoped aggregates. User-entered sensitive content is not redacted by
  magic: do not put it in questions, and review provider processing/retention terms.
- Exact saved-lead brief rechecks ID, record RLS, status visibility and field gates;
  inaccessible/missing IDs are indistinguishable. It flags missing saved service
  details/address/schedule requirements, not a passed urgent check. A draft action
  prepares editable text and requires AI-assisted consent; only fresh saved
  service/status are forwarded, with placeholders for unknown schedule or price.
  There is no customer message sending, direct status write or approval action.
- Daily work brief combines scoped current work metrics with the attention worklist.
  Historical transitions/revenue remain unsupported. Technician cards deep-link to
  the existing directory/workflow, not a duplicate assessment prompt or AI endpoint.
  The curated feature guide uses reviewed descriptions and permitted workflow links.
- Compact panel plus expanded workspace with a role-filtered workflow sidebar,
  multiline Enter/Shift+Enter composer, editable interpreted filters, expandable
  saved details, timestamps, AI/report copying and explicitly session-only feedback.
  Failed questions stay editable; retry is manual with a new ID. Stop waiting
  discards late results but explicitly does not promise to cancel provider spending.
  Permission-scope changes clear session results; close clears all session context.
- Minimize (`−`) hides the panel so the CRM work page stays usable, with a small
  restore/close bar. Restore or the normal header launcher brings back the same
  session, unsent draft, filters and expanded mode, including across route navigation.
  In-flight requests continue while minimized; restore never resubmits them. Close
  remains distinct and clears the session. Access polling continues while minimized,
  and revoked access removes the session/restore bar through the existing provider.
- Metadata-only `copilot_request` logs contain request UUID, duration, safe result
  code, AI-attempt flag, model and prompt version. Never question/answer text,
  customer fields, user IDs, keys or transcripts. Ledger accounting remains private.

### Original rollout checklist (backend/type steps now completed above)

1. Review and manually apply **only the new migration**:
   `supabase/migrations/20261014034546_copilot_pilot_readiness_and_briefs.sql`.
   It adds three RPCs and no tables or customer writes. Do not rerun the two already
   installed Copilot migrations or use `db push` to reconcile MCP timestamps.
2. On an isolated test target, run exact `40_leads_rls_baseline.sql` before/after
   the migration and compare all six role matrices. Run `110_copilot.sql` and
   `112_copilot_pilot.sql` only with the disposable synthetic fixture. They write
   config/permissions/usage and are **not production smoke queries**. The local
   embedded PostgreSQL runner verifies these exact files and applies migrations twice.
3. Regenerate `src/integrations/supabase/types.ts` from the intended **complete**
   migrated schema, using Supabase CLI or MCP, review and rerun gates. Docker/local
   Supabase is unavailable here, and production is deliberately unmigrated, so type
   regeneration is blocked. No generated types were hand-edited; new frontend
   requests use the validated Edge envelope, not invented typed RPC casts.
4. With separate approval, deploy `marshmallow-copilot` plus all its `_shared`
   imports, keeping JWT verification. The new backend is **awaiting deployment**.
   Readiness should then report `pilot-2` and prompt `2026-10-14.1`. Existing old
   deterministic requests remain compatible; new pilot RPC actions fail closed when
   missing. Verify deployed source, caller authorization and advisor findings.
5. Publish CRM separately, refresh every Admin/user tab, then inspect the **saved**
   AI switch and explicitly enable/save it if approved. Never silently enable it
   during deployment. Start Admin-only; verify mobile/desktop, denied roles and
   out-of-scope IDs, hidden fields, source navigation and real sign-in sessions.
6. After approving provider spend, confirm one Admin connection test, then pilot
   nonsensitive drafting and report explanations. Confirm latency, output quality,
   real failure categories and multi-connection quota/concurrency behavior. Embedded
   PostgreSQL cannot prove concurrent requests against deployed Postgres.

Rollback: disable Copilot via Admin, restore the previous frontend/function, then
optionally remove only the three pilot RPCs listed in the migration's rollback
section after dependency review. Keep config, audit history and the usage ledger.
No lead policy, agreed schedule, paid-terminal rule or approval trigger is changed.

### Model quality and cost gate

The live model stays pinned to `gpt-4o-mini`; a newer/more expensive model is not
automatically better for this workflow. Compare models with the optional synthetic
benchmark, only after verifying current availability/prices and obtaining spend
approval. It makes at most five requests, outside CRM allowance accounting, and
stops on the first failure without retries. It never connects to Supabase or Quo.

```sh
# Safe dry run: no environment key or network permission, and no provider call
npx deno run scripts/benchmark-copilot.ts

# Live benchmark ONLY after explicit approval; set a server-side environment key
# securely, never in source, a VITE_ variable or a command argument.
npx deno run --allow-env=OPENAI_API_KEY --allow-net=api.openai.com scripts/benchmark-copilot.ts --confirm-provider-spend --model=<reviewed-model-id>
```

Review every scenario for factuality, correct routing, draft-only behavior, prompt
injection resistance, unavailable-vs-zero and date/scope fidelity; compare latency
and actual token counts using current provider prices. Kind matches alone are not
a quality score. Record evidence before changing the production model, token ceiling
or reservation accounting. Live comparison, production QA and provider success-rate
measurements remain approval-gated, not simulated by local test results.

### Pilot local verification

Final local checks on 2026-10-14:

| Check | Result |
| --- | --- |
| `npm run lint` | Passed: 0 errors, 29 warnings outside changed Copilot files. |
| ESLint on all changed/new supported TypeScript files | Passed: no warnings or errors. |
| `npm run typecheck` | Passed for app and node configurations. |
| `npm test -- --maxWorkers=2` | 615 tests passed across 71 files. |
| `npm run build` | Passed, including unchanged Donut v1.7.0 integrity check; existing Browserslist, mixed-import and large-chunk notices remain. |
| `npx playwright test --config playwright.operator-workflow.config.ts` | 45 tests passed, including 20 Copilot browser tests with synthetic records and all external requests intercepted. |
| `node scripts/test-copilot-db.mjs <PGlite installation directory>` | 73 behavioral and 29 read-only smoke checks passed; migrations applied twice; exact six-role `40_leads_rls_baseline.sql` matrices unchanged. |
| `npx deno check --no-lock supabase/functions/marshmallow-copilot/index.ts scripts/benchmark-copilot.ts` | Passed. |
| `npx deno run scripts/benchmark-copilot.ts` | Safe dry run refused live calls without explicit spend confirmation. |
| `git diff --check` | Passed. |

Browser checks cover compact/expanded layouts, desktop/mobile minimize/restore,
usable underlying CRM controls, session preservation across work pages, close/clear,
focus restoration, denied callers, hidden OPR quotes, drafting consent, readiness
confirmation and no automatic provider retry. Provider behavior is network-mocked;
these checks are not real provider availability, deployed RLS, concurrent production
requests or CRM publication evidence. Live QA and complete-schema type regeneration
remain blocked/approval-gated as described above.

Donut has no native Copilot counterpart; its sources, ZIP and v1.7.0 artifacts are
unchanged. Existing shared urgent checks and technician assessment endpoints are
not modified or redeployed.

## State and safe defaults

Implemented on `copilot`, based on merged main `f99142a`. With explicit user
approval on 2026-10-13, the Copilot migrations and Edge Function were deployed via
Supabase MCP to `kxiqholnmhkwhdkhtopp` (Marshmallow). **The CRM frontend is not yet
published.** No secrets, external messages or customer records were changed.
Existing approval triggers and lead/technician RLS are untouched. There is no
native Copilot counterpart in Donut; its sources and v1.7.0 artifacts are unchanged.

Verified installed defaults: enabled for Admin only, AI off, Eastern Time
(`America/New_York`, matching existing shift reports), $10/month Copilot allowance
and 20 attempted AI requests/user/day. Admin must choose pilot users and explicitly
enable AI. Those defaults do not authorise CRM publication or any OpenAI expenditure.

## Interface and deterministic tools

- Original lightweight SVG mascot, header button, existing Ctrl+K assistant entry;
  no automatically opened panel or floating launcher. The existing CRM logo remains.
- Approximately 480px non-modal desktop panel, expandable to 880px; full-width on
  narrow screens. Keyboard focus, Escape/close focus restoration, reduced motion,
  bounded session-only turns, loading states and explicit unavailable/error states.
- Feature catalogue is reviewed against current routes and permission rules, not
  generated from stale documentation. It does not replace existing navigation.
- Leads: saved job ID, customer/phone/address search; explicit status, service,
  city/state and schedule filters. Ten cards per page, bounded pagination, saved
  record links. Hidden Operator quotes and CS Admin technician fields are redacted.
- Technicians: saved name/phone/service/area search, active filter and scoped saved
  ID deep link. Operator own-code and OPR Admin coded visibility still apply.
  Active and Good Tech are recorded flags, not live availability or AI assessments.
- Reports: explicit business-date ranges (maximum 31 inclusive days); personal
  scope is accessible records created by, assigned to, or last edited by the caller.
  Team scope is Admin-only. Creation, most recent personal edit and explicit schedule
  dates are range measurements; workload counts are **current snapshots**.
  These are not historical transition totals, total actions, payment totals or revenue.
- Attention: saved incomplete/Need Tech/follow-up/reschedule statuses and due explicit
  schedule dates. It does not infer due dates from free-text schedules. Links to
  permitted review queues and the existing CS missed-call worklist are offered.
- Health: successful database read, existing Sheets health measurements, observed
  Quo webhooks/errors and ingestion pause state. Idle is not an outage; missing
  monitoring is unavailable, not healthy. Key configuration is not a provider probe.

All of these use zero OpenAI calls. No client receives a service-role key. Core
auth, lead statuses, schedules, quoting, payments, cancellation and technician
approval workflows are unchanged; Copilot cannot execute them on the user's behalf.

## Optional AI and privacy

AI requires the Admin global AI switch, caller Copilot permission, a server-side
`OPENAI_API_KEY`, and explicit user AI fallback or an Explain with AI action.
The existing economical `gpt-4o-mini` family is used; no premium fallback, web
search, tool execution loops, streaming retries or conversation-history resubmission.
The provider call times out after 20 seconds and caps output at 600 tokens.
Prompts are bounded (1,200 question characters; report context contains only fixed
aggregate metrics/definitions). Ambiguous CRM wording can be classified once and
then executed through the caller-scoped deterministic RPC, never a privileged read.
AI routing is labelled honestly even when the final data comes from CRM.

Only the explicit question and, for explanations, whitelisted aggregate metrics
go to OpenAI. Saved lead cards, technician phone data and conversation transcripts
are not automatically forwarded. Users should not put sensitive personal data in
their questions. Answers are advisory plain text; internal links are allowlisted.
`store: false` disables response storage for that API feature, **not all provider
retention**. Review provider retention/data-processing terms before enabling AI.

The private usage ledger stores request ID, user ID, timestamp, status and token
counts, **not prompts or answers**. Successful/unknown failed requests consume a
conservative two-cent allowance reservation. Unknown token counts remain NULL.
The monthly config row is locked while checking/inserting reservations, keeping
simultaneous users from overspending this Copilot allowance. Duplicate IDs, daily
quotas and a five-second per-user cooldown are enforced before a provider call.
There is no automatic paid retry or refund for an uncertain provider outcome.
Exhausting AI allowance never disables deterministic CRM tools.

The displayed allowance is not an OpenAI invoice and does not include existing AI
review endpoints. Independently set provider-project spending/rate controls and
verify current model prices before enabling AI. Re-benchmark if the model, prompt
ceiling or provider pricing changes; adjust reservation accounting before switching.
No live provider quality/latency/cost benchmark has been run during local development.

## Approved backend deployment — 2026-10-13

| Local migration source | Recorded remote version |
| --- | --- |
| `supabase/migrations/20261013045711_marshmallow_copilot.sql` | `20261013062708` — `marshmallow_copilot` |
| `supabase/migrations/20261013062924_copilot_rls_policy_efficiency.sql` | `20261013063123` — `copilot_rls_policy_efficiency` |

MCP assigns its own remote timestamps. These source files are already applied;
do not apply them again or run `db push` to reconcile those timestamp differences.
The follow-up splits Admin write policies by command and caches caller checks;
it fixes Copilot-only initplan/duplicate-policy warnings without changing access.
The original migration was not rewritten after application.

`marshmallow-copilot` is ACTIVE, version 1, with `verify_jwt=true`. Its entrypoint
and both shared imports were retrieved through MCP and match local UTF-8 source
exactly. CORS preflight returned 200; an unauthenticated POST returned 401 at the
gateway. A POST with the existing public anon JWT reached the deployed handler
and also returned 401 ("Sign in to use Copilot."). Signed-in end-to-end HTTP/browser verification remains a pilot check;
no user sessions were forged or credentials retrieved for testing.

`src/integrations/supabase/types.ts` was regenerated through MCP from the complete
installed schema, not hand-edited. The only non-Copilot difference is the generator's
PostgREST version marker (`14.5` to target-reported `14.4`). Full typecheck, 527 unit
tests, lint (zero errors, 29 existing warnings), production build, Donut integrity
and Deno checks passed again with the regenerated types after deployment.

Production checks ran the exact `40_leads_rls_baseline.sql` before/after **both**
migrations: all six role matrices are unchanged. Its result order now puts the
matrix last because MCP exposes only the final result grid; count queries are
unchanged. `111_copilot_readonly_smoke.sql` returned **29 PASS, zero FAIL**. It only
creates temporary test-result tables, forbids persistent writes during checks,
and rolls back. `110_copilot.sql` and its synthetic fixture were **not** run on the
shared project. Local testing passed 37 behavioral checks plus the same 29 smoke
checks, including applying each migration twice.

The first production smoke query accidentally contained four digits, activating
the intended normalized phone lookup. Its unmatched-search assertion was corrected
to use an alphabetic-only marker; all 29 checks then passed without backend changes.

Remaining Copilot advisor findings are intentional and reviewed:
- [RLS with no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy):
  the private ledger denies all browser reads; service-only functions access it.
- [Authenticated SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable):
  `copilot_usage_summary` needs private aggregate access and explicitly rejects non-Admin callers.
- [Unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index):
  the new private usage ledger is empty while AI is off. Retain its accounting indexes.

Pre-existing project advisories were not modified. No AI/provider calls were made;
the AI switch and ledger remain off/empty. CRM publication, first-visit toast
overlap, signed-in pilot checks and real multi-connection AI quota testing remain
separate tasks. This deployment does not install or update Donut.

## Installation reference — backend steps already completed

1. Review the exact new migration:
   `supabase/migrations/20261013045711_marshmallow_copilot.sql`.
   Apply the follow-up `supabase/migrations/20261013062924_copilot_rls_policy_efficiency.sql`
   after it on a fresh approved target. Confirm the target and take a normal schema backup. It adds only Copilot config,
   role/user permissions, RPCs and a private usage ledger; it never updates leads.
2. On an approved isolated target, run the exact
   `supabase/tests/40_leads_rls_baseline.sql` **before and after** manually applying
   this migration and compare all six role matrices. Do not run `db push` or reset
   the linked shared project. The fixture runner already performs this comparison
   locally, but a partial fixture is not deployed-policy verification.
3. Run `supabase/tests/110_copilot.sql` with
   `supabase/tests/fixtures/copilot.sql` only in a disposable database. This is a
   **write-based synthetic harness**, not a production smoke test. Inspect every
   PASS/FAIL; never load the fixture into an existing project.
4. Regenerate `src/integrations/supabase/types.ts` using supported Supabase tooling
   **from the intended complete migrated schema**, review the diff, and rerun gates.
   Do not hand-edit generated types. Local generation is blocked here: Docker/local
   Supabase is unavailable; remote MCP generation resolved this blocker after deployment.
   No new schema is hidden behind a frontend RPC cast: frontend requests use the
   validated Edge Function envelope. Generated database types now include the installed schema.
5. With separate approval, deploy only `marshmallow-copilot` and its `_shared`
   imports. Keep JWT verification enabled; the function independently calls
   `auth.getUser()`. Existing OpenAI secret can be reused server-side; do not put
   any key in `VITE_` variables, Donut or committed files. No other functions need
   deployment. Inspect security/performance advisors on the approved migrated target.
6. Publish the CRM separately. If backend/migration is absent, the launcher fails
   closed and Settings displays an installation error; other CRM features remain
   available. No new database subscriptions are installed before migration, so the
   existing realtime bus cannot be broken by missing Copilot tables.
7. Start with Admin and deterministic tools. Verify permitted, excluded and
   out-of-scope records; hidden quote/technician fields; actual report boundaries;
   saved technician/lead links; approval workflow navigation; notepad/notifications;
   desktop/narrow screens; and access revocation. Only then grant pilot users.
8. After approval and provider limits are set, enable AI and safely benchmark with
   nonsensitive prompts. Check disabled AI, duplicate IDs, quota/budget rejection,
   provider timeout, honest usage labels and late revocation. Concurrent budget
   load testing against a real multi-connection PostgreSQL target remains required.

Access is rechecked server-side on every request and before releasing late results.
Browser access refreshes on focus/reconnect and every 15 seconds while open (60
seconds while closed); revocation can therefore take that long to hide an already
rendered card, but cannot authorise a fresh backend request. Closing the panel,
losing access or changing identity clears the in-memory conversation.

## Admin AI control audit — 2026-10-13

The Admin flow is implemented across Settings UI, frontend access, database RLS,
authenticated Edge Function/RPC checks, and generated types. After frontend
publication, go to **Settings → Feature Access → Marshmallow Copilot**:
1. Keep **Enable Copilot** on.
2. Turn on **Enable optional AI**.
3. Choose **Monthly AI allowance (USD)** and **AI requests per user / day**.
4. Click **Save Copilot configuration**. The global switches and limits are drafts
   until this explicit save; role defaults and user overrides save immediately.

AI has no separate role/user permission: global AI enablement applies to every
allowed Copilot user, including individual Allow overrides. A user Deny or global
Copilot disable also blocks AI. Admin retains access while Copilot is globally on
and can use Settings to re-enable it while globally off. Non-Admin callers cannot
change configuration through the Edge endpoint, RPC, or direct RLS-protected writes.
Successful RPC changes are audited; provider/client secrets are never returned.

The monthly allowance is shared across users ($0–$1,000); daily attempted-request
limits are per user (0–100). Setting either limit to zero blocks new AI reservations
without disabling deterministic tools. Budget reservation takes a row lock and
rechecks current settings/access before spending. Turning AI off does not cancel
a provider call already underway, but its late result is discarded and any prior
reservation remains accounted for. AI answers also require explicit user opt-in.

Copilot reads the existing server-side `OPENAI_API_KEY` secret. Adding a key does
not enable the AI switch. Admin **System health** reports configured/not configured
without probing the provider or exposing the key; a configured key is not proof of
valid provider credentials, billing, model access or successful AI output. No key
values were inspected and no paid provider test was run during this audit.

Fixed a reproduced frontend defect in `CopilotAccessSettings.tsx`: refreshing role
permissions or usage could reset unsaved AI/budget edits. Draft synchronization now
depends on the saved configuration, not the entire settings envelope. The UI also
states the global AI scope, shared allowance and zero-limit behavior explicitly.
Regression coverage exercises successful/failed/invalid configuration saves,
permission refreshes with unsaved edits, denied Admin endpoints and direct writes,
all six allowed roles, individual Allow/Deny/Inherit, missing key, explicit consent,
global/AI disable, caps and in-flight AI revocation.

The audit only read production metadata/configuration. Current production remains
Copilot on, Admin-only, AI off, $10/month, 20 requests/user/day, zero AI requests.
No migration or Edge Function changes/deployment are needed for this frontend fix.
There is no Donut counterpart; extension source/artifacts remain untouched. These
changes await frontend publication; signed-in production QA, live AI testing
and real multi-connection quota load testing remain unverified.

## PR #128 integration with main

[PR #128](https://github.com/pastry-marketing/Marshmallow/pull/128) targets `main`.
After the initial conflict-free check, PR #127 advanced main to `087276c`, causing
conflicts in `src/pages/Settings.tsx`,
`src/components/settings/FeatureAccessMatrix.tsx` and
`docs/CRM_EXTENSION_PARITY.md`. Resolution preserves the new searchable Copy All
Details matrix controls and Copilot controls together in a single table. The copy
panel retains ownership of its query/mutation and matrix rendering; Copilot global
configuration remains separate above it. No duplicate matrix or permission bypass
was introduced. Both features remain CRM-only, with Donut unchanged.

The updated browser regression searches the same rendered Settings matrix for
Copy Complete Details and Copilot and verifies both editors are available before
exercising the existing Copilot permissions/global-disable flow. All 557 unit
tests and 38 isolated browser tests passed after integration, along with lint,
typecheck, build and extension integrity. No database/function source changed in
this resolution, so SQL harnesses and Deno checks were not rerun for the merge.
Merging the PR and confirming/publishing the live CRM remain separate from this
branch integration. The already-applied Copilot migrations must not be rerun.

## Local verification commands

Verified locally on 2026-10-13:

| Check | Result |
| --- | --- |
| Full lint | Pass: zero errors; 29 existing warnings |
| App and tooling typecheck | Pass |
| Full unit suite (`npm test -- --maxWorkers=2`) | 557 tests / 67 files passed after integrating main, including Admin AI controls and copy-matrix coverage |
| Full network-isolated browser suite | 38 passed after integrating main, including 13 Copilot cases and 25 workflow cases |
| Exact isolated SQL harness | 58 behavioral PASS and 29 read-only smoke PASS; both migrations applied twice; six-role baseline unchanged |
| Deno Edge Function check | Pass |
| Production build and extension integrity | Pass; Donut v1.7.0 source/ZIP unchanged and verified |
| Whitespace check | Pass for tracked changes and all new files |

An initial simultaneous browser/unit run did not complete cleanly; the full unit
suite was rerun with two workers and passed without changing test settings or
skipping assertions. Browser testing caught and fixed the mobile panel width,
then the full 33-test suite passed. Existing build warnings about stale Browserslist
data and large/shared chunks remain outside this scoped change.

During the Admin AI audit, the first full unit run hit the 240-second shell timeout
while build/browser suites ran simultaneously. The unchanged full unit command
passed when rerun alone (550 tests, 67 files); no assertions or settings were weakened.

The final focused browser rerun exposed an unrelated first-visit Donut release
toast covering Send while hover paused its expiry. The synthetic fixture now marks
that current-version notice as already shown; production notification behavior is
unchanged. Toast overlap during first-visit use remains a manual pilot check.

```sh
npm run lint
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npx deno check --no-lock supabase/functions/marshmallow-copilot/index.ts
npx playwright test --config playwright.operator-workflow.config.ts
node scripts/test-copilot-db.mjs <external-PGlite-installation-directory>
git diff --check
```

The last SQL command runs exact fixture/migration/harness files on disposable
embedded PostgreSQL, applies the migration twice and compares the exact existing
six-role baseline. Browser tests intercept all non-local HTTP and Supabase sockets;
synthetic data is passed through the actual shared Copilot handler. No database,
OpenAI, Quo or external message requests reach production. Vitest tests exercise
inputs/actions/outcomes but do not verify deployed RLS or Edge Functions.

## Rollback

Admin can disable Copilot globally without touching CRM workflows. Deploy the prior
frontend/function if needed; existing app policies and data require no rollback.
Keep/back up configuration and the private usage ledger for accounting. If fully
removing the feature, drop only its `copilot_*` functions, the three new public
tables and `marshmallow_private.copilot_usage` after reviewing dependencies. Never
drop `marshmallow_private` itself: Operator workflows use it. This is a reviewed
manual operation, not an automatic cleanup script.

## Source map

- `src/components/copilot/`: mascot, launcher, provider and lazy panel.
- `src/lib/copilot-api.ts`, `src/lib/copilot-context.ts`, `src/hooks/useCopilot*.ts`:
  validated API, scoped server state and fail-closed permission resolution.
- `src/components/settings/Copilot*.tsx`, `src/pages/Settings.tsx`: Admin controls,
  compact role defaults, overrides and Feature Access matrix entry.
- `src/components/layout/{AppLayout,GlobalCommandMenu}.tsx`: existing entry points.
- `src/lib/technicians.ts`, `src/pages/TechniciansPage.tsx`: ID-filtered deep link
  preserving existing RLS and own/coded scope; no native Donut directory counterpart.
- `supabase/functions/_shared/copilot-{core,handler}.ts` and
  `supabase/functions/marshmallow-copilot/index.ts`: shared deterministic contract,
  authenticated request handler and bounded provider adapter.
- New migration, SQL fixture/harness and `scripts/test-copilot-db.mjs`: database
  grants, permissions, caller-scoped reads and atomic usage accounting.
- Co-located Copilot/technician unit tests and
  `tests/operator-workflow/copilot.spec.ts`: behaviour and isolated browser coverage.

Do not call a successful build or HTTP 200 a shipped workflow. Manual migration,
type regeneration, backend deployment, CRM publication, provider benchmarking and
approved-target QA must be recorded separately.
