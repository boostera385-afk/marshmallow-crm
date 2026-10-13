# Marshmallow Copilot rollout

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
