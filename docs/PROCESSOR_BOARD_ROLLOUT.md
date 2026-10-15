# Processor Board

## Scope and behavior

- CRM route: `/processor-board`, Work → Processor Board. Fixed Admin/Processor
  access in the route, AuthContext, permission helper, server handler and database.
  Navigation grants cannot enable it for CS or Operator roles. Feature Access
  describes the fixed gate rather than offering an ineffective switch.
- Default queue: saved `scheduled`, `job_in_progress`, `job_done`,
  `payment_pending` and `partial_paid` jobs with a schedule. Undated `scheduled`
  jobs are included and explicitly marked missing date/time. Include closed/history
  shows other previously dated records, including paid/cancelled, read-only.
  This is the **current saved appointment**, not reconstructed historical visits.
- The four main advisory labels are **Take Job Update**, **Job In Progress**,
  **Payment Pending** and **Send Dose**. Scheduled, Needs Review and Unavailable
  prevent missing information from being presented as a passed AI check.
- A passed appointment start produces Take Job Update. The displayed timezone is
  explicitly selected (Eastern initially, matching existing CRM conventions).
  No timezone is inferred from a state spanning multiple zones. Missing structured
  dates/times are not guessed from free text, and customer schedule requirements
  remain visible and unchanged in the drawer.
- Job In Progress and Payment Pending require a verified technician quote about
  this job, unless the saved lead already has the equivalent state. They are board
  labels, **not automatic lead mutations**. Review and act through the existing
  saved-lead, payment and approval workflows. Paid is never editable here.
- Send Dose means **manual follow-up recommended**, not an outbound message. It
  requires an overdue appointment, explicit job acceptance/progress, a later
  job-specific **delivered** outbound update request on/after the appointment date, at least
  60 minutes elapsed, and no subsequent inbound event in verified current Quo
  text history. Any later generic/media reply prevents a non-response inference.
  Missing/direct-history failures never establish silence.

## Job isolation and history

1. Read the saved lead under the caller's JWT and existing lead RLS; honor
   per-user/role status visibility separately from status-change permissions.
2. Resolve the assigned technician's normalized number to a **unique saved Quo
   line/conversation pair**. Reject conflicting links and mirror phone mismatches;
   never choose a chat by technician/customer name alone. With a valid saved link
   and direct Quo access, a missing mirror does not block current-history review.
3. Read every available Quo text-history page for that saved chat, using the documented
   `createdAfter`/`createdBefore` filters (not deprecated `since`). Examine events
   since the lead was created; reject unknown identities/times and repeated tokens.
   The 100-page safety ceiling is an explicit unavailable outcome, not a shortened
   review. Media replies count as replies but cannot prove job completion.
4. Without `QUO_API_KEY`, paginate the CRM mirror with a 10,000-event safety
   ceiling. Label this fallback as incomplete; it cannot produce Send Dose.
   Current Quo failure does not silently fall back to an older successful review.
5. Explicit job ID, full saved street/unit address, unique full customer name, or
   unique customer phone must identify the target. Compare identities with other
   saved jobs assigned to that technician. Another job mentioned in the same
   message makes it ambiguous. Generic “done”, a first name alone, a shared name,
   another apartment, or a prior visit's completion cannot advance this job.
6. Only job-anchored messages are sent to AI, as untrusted data. The model extracts
   events, not authorization. Verify exact quote, message ID, sender, time and job
   identity server-side. Never accept outbound allegations as technician reports.
   Oversized AI input/output is rejected rather than silently truncating evidence.
   Calls/voicemails are not transcribed by this feature and require manual review.

## Refresh, storage and efficiency

- One caller-token list RPC returns an exact total and at most 25 projected rows.
  The new route is lazy-loaded, so other screens do not download its UI module.
  Search is literal, server-side and debounced 350ms. Action cards/filter counts
  deliberately say **on this page**, not misleading global totals.
- Count/filter matching runs before joining assessment/conversation evidence, so
  only the displayed 25 jobs need those joins. Existing lead date/status and
  conversation/message indexes are reused; no speculative indexes or RLS widening.
  Read-only production EXPLAIN confirmed the existing `leads_scheduled_date_idx`
  can support scheduled-date reads. No production SQL tuning is claimed.
- The mounted board shares one leads realtime transport through `realtimeBus`.
  It is removed with the last consumer, ignores retired callbacks, coalesces
  bursts, and preserves one trailing read for in-flight changes. Thirty-second
  read polling plus reconnect refresh provides recovery. Other screens/roles do
  not create a board transport. Queries are keyed by caller, role and filters.
- AI checks are **on demand**, for one job or eligible jobs on this page, serialized
  in the browser. No unattended AI cron/worker is installed. Merely opening the
  board/polling does not incur provider calls. Per-job database leases prevent
  concurrent browser sessions from invoking the provider for the same job.
- Hash saved job, peer identities, timezone, source and complete retrieved events.
  Unchanged inputs reuse verified evidence without another AI call; recompute
  time-based actions after the short result cooldown. Current history is still
  checked on an explicit refresh. Direct mode avoids downloading the mirror too.
- Results are keyed by lead, never just technician. Atomic service-only save
  checks lease ownership and saved-lead revision; audit metadata is saved in the
  same transaction. Lead changes during review fail instead of attaching stale
  evidence to a reassigned/rescheduled job. No transcripts enter audit logs.
- Evidence expires from the actionable UI after five minutes, a lead revision,
  timezone change or changed mirrored latest-activity timestamp. Failed checks
  retain previous persisted evidence but show Unavailable in the active session.
- No background jobs, storage uploads, customer messages, ingestion changes,
  status/approval writes, secret changes, or Donut asset downloads are added.

### Reproducible resource comparison

Environment: local Vitest mocks + isolated PGlite, synthetic jobs, no live customer
data/provider/billing access. There was no previous Processor Board to benchmark.
For the same two unchanged explicit checks, the backend regression verifies **one
AI call rather than two uncached calls**, while both checks still fetch current
history. Direct mode makes **zero mirror-message reads**. The hook regression
verifies 40 realtime events across one in-flight refresh become **two refresh
reads**, preserving the initial read and trailing changes. History regression
retrieves 251 distinct events across pages rather than the older technician report's
250-event cap; that report is not changed. These are local request/work comparisons,
**not verified production usage, latency or invoice savings**. Health/billing and
normalized active-user/work-volume evidence are not available.

## Database and Edge Function installed — CRM publication pending

With the user's explicit approval on 2026-10-15, the exact reviewed Processor Board
migration was applied through Supabase MCP to `kxiqholnmhkwhdkhtopp`.

1. Installed file:
   `supabase/migrations/20261015045700_processor_board_job_assessments.sql`.
   MCP recorded version `20261015045700`, name `processor_board_job_assessments`;
   the previously uncommitted local filename was aligned with that recorded version
   without changing database migration history. **Do not reapply or run `db push`,
   `sb:push` or `db reset`.** For another environment, manually apply this exact
   idempotent file only after review/approval. It adds advisory/lease tables and
   restricted RPCs, not lead data/policy/trigger/enum changes.
2. `src/integrations/supabase/types.ts` was regenerated through MCP from the
   installed schema. Its 86 added lines describe only the two new tables and
   four new RPCs. The frontend retains runtime-validated Edge transport contracts.
3. With the user's additional approval, **processor-board v1** was deployed through
   MCP on 2026-10-15 and is **ACTIVE**, with JWT verification enabled. All six
   deployed files, including the pinned `deno.json` dependency map, exactly match
   the committed source. It independently verifies `auth.getUser()` and role membership. Server secrets
   are `OPENAI_API_KEY`, `QUO_API_KEY` (raw key), and existing Supabase service-role
   environment configuration. No key belongs in VITE variables or Donut.
4. Execute `supabase/tests/150_processor_board.sql` only on an isolated database
   and inspect every PASS/FAIL. It writes synthetic jobs and is **not production
   safe**, even though it rolls back. Local reproducible command with an external
   PGlite installation:

   ```powershell
   node scripts/test-processor-board-db.mjs "C:\path\to\pglite-installation"
   ```

   The script applies the exact migration twice, then the exact fixture/harness.
   Existing lead SELECT policies are unchanged. The exact six-role
   `supabase/tests/40_leads_rls_baseline.sql` was run before and after installation;
   every matrix cell matched. All 18 checks in
   `supabase/tests/151_processor_board_readonly.sql` passed on the shared project.
   That second harness only reads data and uses rollback-only temporary checks;
   it does not create customer jobs, leases, assessments or audit rows.
5. Publish the CRM separately. Verify real signed-in Admin/Processor access,
   excluded roles, missing schedules, multiple jobs in one technician chat,
   rescheduling/reassignment during review, partial history and provider failures.
   Local browser tests block/mock all external HTTP and Supabase websocket traffic;
   they are not a claim of signed-in production or live-provider QA.

### Installation findings

- Live preflight exposed legacy overloads of `has_role(uuid, app_role)` and
  `has_role(uuid, app_role_old)`. Explicit `public.app_role` casts were added before
  application. The isolated fixture now includes the conflicting legacy overload;
  all 24 behavioral checks still pass with the migration applied twice.
- Security advisors were captured before/after. No new warning/error was added.
  The new service-only lease table adds one informational `rls_enabled_no_policy`
  finding: no browser grants/policies are intentional, and service-role access is
  explicit. No client policy was invented merely to silence the advisor.
  See [RLS informational finding](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Existing search-path, exposed-definer, extension-placement and leaked-password
  protection warnings remain outside this task; no unrelated privileges changed.
- Both new tables were empty after installation/verification. No lead statuses,
  schedules, customer messages, AI calls or ingestion settings were changed.

Donut has no native scheduled-job Processor Board or job-level assessment action.
Its technician-wide intelligence panel is a different workflow and remains on
`technician-chat-assessment`. No extension source, prompt, manifest or ZIP changes
are needed; no new extension release is claimed.

### Edge deployment verification

- Function ID: `6281626c-9181-4714-b8cf-8956ca98333f`, version `1`.
- Entrypoint: `processor-board/index.ts`; import map: `processor-board/deno.json`.
- Retrieved the deployed function through MCP and compared all six source files
  byte-for-byte against the reviewed local files; every comparison matched.
- Five live non-mutating smoke checks passed: CORS preflight returned 200,
  missing/invalid authorization returned 401, the legacy public anon key returned
  the handler's `Not signed in.` 401 (not user authorization), and an unsupported
  method returned the handler's 405. These confirm runtime boot and authentication
  boundaries, **not** a completed signed-in review or verified provider credentials.
- No secrets changed, Quo/OpenAI calls made, customer records changed, messages
  sent, or other Edge Functions redeployed. CRM publication remains separate.

## Local verification boundaries

- `npm run typecheck` and `npm run build` passed; build also verified the unchanged
  Donut v1.7.0 source/ZIP integrity. Existing bundle-size/Browserslist warnings remain.
- All 24 checks in the isolated SQL harness passed, with the migration applied
  twice to verify idempotency. No write-based harness ran on the shared project.
- Seven network-isolated Playwright checks passed at desktop/mobile widths,
  including evidence review, provider failure and all four excluded roles.
- The initial targeted Vitest run passed all 59 tests across eight files (board,
  history, handler, hook, realtime and sidebar). Initial full-suite verification
  was incomplete: the two-worker run reported 743 passed and two sidebar failures after
  a timeout; the single-worker retry passed those sidebar tests but exceeded the
  300-second command limit before a final suite summary. No test/configuration
  was weakened or skipped to conceal that limitation. The 2026-10-15 lint follow-up
  subsequently passed the complete suite: **752 tests across 92 files**, using
  `npm test -- --maxWorkers=1` with enough command runtime to finish.
- The 2026-10-15 lint follow-up fixed the preview-auth timer's `prefer-const`
  violation and the Quo analytics memo's missing exact-total dependency.
  Full `npm run lint` now passes with **zero errors and 28 remaining warnings**;
  typecheck and build also pass. Broker origin/timeout/logout behavior and count-only
  analytics refresh are regression-tested, with no extra requests/subscriptions.
  Neither CRM-only fix has a native Donut counterpart or changes database, Edge,
  realtime transport, background-job, storage or bandwidth behavior.
- Deno is not installed locally, so a native Deno typecheck remains unrun. The
  deployed runtime passed the limited live smoke checks above; a real signed-in
  Admin/Processor job review and provider configuration still need verification.
- Real Quo/OpenAI responses, signed-in production flows, production billing and
  CRM publication remain unverified. Manual AI refresh is implemented; no
  unattended AI monitoring is running.

## Rollback

Remove/unpublish the route and undeploy the new function. Revoke authenticated
execution of `list_processor_jobs(integer,text,boolean,text)` and service-role
execution of the new claim/save functions as described in the migration. Retain
assessment/audit history; archive/delete tables only with separate approval.
There are no lead statuses, schedules, notifications or approvals to repair.
