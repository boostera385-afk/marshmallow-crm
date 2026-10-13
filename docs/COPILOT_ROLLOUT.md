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
