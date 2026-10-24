# Request resolution, notifications and schedule monitoring

## October 24 backend efficiency follow-up — awaiting application/deployment

This follow-up used **read-only Supabase MCP** on `kxiqholnmhkwhdkhtopp`.
The request/inbox/monitor RPCs already exist in that project's current schema;
the older local-only release notes below are historical, not instructions to
reapply those migrations. No remote schema, customer data, secrets, cron,
ingestion, deployment or publication was changed during this follow-up.

### Evidence and scoped fixes

- Project status: ACTIVE_HEALTHY, Postgres 17.6.1.084. At inspection there were
  16,036 notifications, 2,217 unread rows and 20 workflow metadata rows.
- Cumulative `pg_stat_statements` recorded 66,993 notification RPC calls averaging
  1,184.07 ms (statistics reset August 7; this is **not** a daily workload/bill).
  The inspected 24-hour logs contained 678 inbox HTTP 503 responses; a subsequent
  snapshot counted 679 SQLSTATE 57014 query cancellations for this RPC. The
  windows differ slightly and do not establish a one-to-one error correlation.
- A bounded read-only authenticated Admin alert EXPLAIN ANALYZE took 448.676 ms
  with 24,330 shared-buffer hits. The existing `(user_id, read, created_at DESC)`
  index supports recipient/unread/date restriction; no new index is justified
  for this change. The original multiply-referenced `visible` CTE materializes
  full recipient history, blocking those downstream filters from pushing down.
- New migration
  `supabase/migrations/20261024095119_optimize_workflow_notification_reads.sql`
  inlines that read CTE and resolves caller/role once per RPC. Page filters can
  narrow their own reads; the separate unread aggregate retains its **exact,
  globally visible unread count**, without computing unused action expressions.
  The RPC remains SECURITY INVOKER with the same fixed search path, signature,
  grants, RLS, customer/technician projections and mutation behavior.
- The schedule worker counted one job twice when both assessment and persistence
  failed. It now reports one failed job while still reporting the failure as
  HTTP 503, processing remaining work, and preserving leases/retries/cooldown.

### Verification and reproduction

```sh
node scripts/test-workflow-inbox-db.mjs <external-PGlite-installation-directory>
node scripts/test-workflow-inbox-db.mjs <external-PGlite-installation-directory> --benchmark
```

The runner has no remote connection. It preserves the previous actual function
definition only in a disposable database, applies the new migration twice, and
executes the exact harness files. Latest behavior run: **286 PASS** (32 requests,
31 schedule guards, 12 installation, 211 notification equivalence/access checks).
It covers all four permitted roles, both excluded Operator roles, missing
identity, another recipient/job, revoked participation, status overrides,
search/date/category/action/unread filters, tied ordering, empty/deep pages,
exact counts, snapshot reads and bursts beyond the 100-alert page limit.

Focused Vitest: **40 tests passed**, including simultaneous provider/database
failure and unchanged provider/RPC call counts. Final `npm run validate` passed:
lint (zero errors, 28 existing warnings), app/Node typecheck, **103 files / 889
tests**, and build with unchanged Donut v1.7.0 integrity. Existing Browserslist,
mixed-import and large-chunk warnings remain. An earlier full run during the SQL
benchmark had an Admin sidebar timeout followed by a cleanup-related failure
(887/889 passed); a focused sidebar rerun also timed out (3/4 passed). All four
sidebar tests passed in the final full run after the benchmark finished. No
assertions, timeout settings or production behavior were changed to mask those
failures. Deno is not available on PATH.
The earlier baseline full gate passed 888 tests and build before this follow-up.

The opt-in benchmark uses 16,000 legacy rows (15% unread) plus 20 workflow events,
the same synthetic Admin and connection, seven alternating warm executions per
version/workload, exact JSON equality and median timings. Its first foreground
attempt exceeded 120 seconds; the background rerun completed successfully:

| Workload | Before (ms) | After (ms) | JSON identical |
| --- | ---: | ---: | --- |
| History | 6,472 | 1,577 | Yes |
| Unread history | 7,278 | 440 | Yes |
| Action-required history | 6,379 | 1,531 | Yes |
| Search | 5,963 | 889 | Yes |
| Recent history | 4,289 | 141 | Yes |
| Recent alerts | 4,195 | 912 | Yes |
| Empty future alert window | 3,850 | 955 | Yes |

These are local PGlite/WASM timings on Windows, not comparable to the live RPC
timings above and not proof of reduced production usage/cost. The run overlapped
other local validation work, although before/after shared the same process and
alternated order. The expanded 211-check harness ran separately after adding
burst/status-override cases; its results are reflected in the 286 PASS above.
Once the benchmark finished, an unchanged full `npm run validate` was run again
without its CPU load; that final rerun passed all gates as recorded above.

### Efficiency/parity and release boundaries

- UI/rendering and hooks/cache: unchanged; no new fetches, caches or renders.
- API: unchanged endpoints, payloads, exact totals and complete pagination;
  this reduces work **per call**, not the number of client requests.
- Database: predicate pushdown/projection pruning; no RLS or lead/status/index
  changes, no data repair, no new recurring jobs or write amplification.
- Realtime, poll intervals, freshness, audible/visual alerts and recovery: intact.
- Worker: only failure accounting changes; provider budgets, cadence, evidence,
  approval/tag authority and outbound behavior are unchanged.
- Storage/bandwidth: no new stored data, attachments or downloads.
- Donut: searched native extension sources; neither inbox nor schedule worker
  has a native counterpart. No extension source/artifact changes or ZIP needed.

Security/performance advisors were reviewed, not automatically "fixed": private
worker tables intentionally have RLS with no browser policies. Other findings
need separate dependency/caller analysis, including
[mutable function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
[anonymous DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys),
and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
No grants were widened or indexes dropped merely to clear advisories.

After review/approval, manually apply **only the new October 24 migration** in the
intended Supabase SQL Editor; do not run `db push` or replay installed history.
Then run `supabase/tests/151_workflow_inbox_readonly.sql` and safe signed-in inbox
QA; compare deployed query plans, latency/cancellations and normalized workload.
The 152/154 harnesses contain synthetic writes and must stay local. Roll back
only the notification RPC definition from the earlier migration, retaining RLS
and history. No generated-type change is needed (signature/schema unchanged).
The worker fix is **awaiting approved schedule-confirmation-monitor deployment**;
it does not activate monitoring. CRM Publish and live browser/provider QA remain
separate. Billing, normalized active-user-hour savings and deployed improvements
have not been measured. Commits and a branch push publish source only; they do
not apply this migration, deploy functions, register cron, or publish the CRM.

## Release state — local, not installed or published

The October 20 implementation is local. No production records, configuration,
secrets, ingestion settings, migrations, functions, cron jobs or CRM publication
were changed. Existing unrelated Copilot/settings work remains intact.

### Implemented behavior

- CX and Tech requests distinguish waiting for a reply, awaiting requester
  resolution and resolved history. Only the original requester (or an explicitly
  reassigned resolution owner) resolves or follows up. Answering and reading a
  notification never resolve work. Admin reassignment requires a reason, retains
  the original requester and is audited.
- Every request mutation uses a revision. Replies/resolutions retain safe retry
  behavior; stale replies cannot answer a reopened request. Legacy public AND
  private RPC paths delegate to the same authority and cannot retain supervisor
  resolution bypasses. Old clients without a mutation revision must refresh.
- History preserves original threads, dates and recorded resolution actors.
  Older acknowledgements without a known actor say Previously acknowledged;
  no actor is fabricated. CS queue payloads remain customer-field allowlists,
  not access to the full lead or technician fields.
- `/notifications` is fixed to Admin, Processor, CS Admin and Customer Service,
  with recipient/current-access-scoped history, exact totals, paging beyond the
  bell's 20 rows, category/read/action filters, explicit search and date ranges.
  Mark this page read affects only its displayed snapshot. The bell is available
  on Quo screens, links to complete history and checks read failures.
- Server event metadata cannot be forged by editing an ordinary notification.
  The notification SELECT policy applies current workflow access to old previews,
  unread counts and realtime too; non-workflow notification behavior is unchanged.
- New requests/replies get persistent notifications and short, nonblocking notices.
  Schedule-ready notices have a five-second progress bar, pause on hover/focus,
  remain in history and do not auto-read or auto-resolve. Sound is explicitly
  enabled/tested from Notifications; browser autoplay blocking never hides alerts.
  Recipient Web Locks + event claims prevent duplicate cross-tab announcements;
  chimes coalesce within a one-second burst. Without Web Locks only a focused
  document announces. Old scope results/toasts are retired on account/role change.

## Schedule monitor: deliberately narrow initial automatic subset

The worker is **OFF by default**. Admin controls are under Notifications. Shadow
mode records findings without lead changes. Automatic activation requires an
audited reason, shadow mode with the same timezone, accepted examples from five
distinct jobs, no rejected examples and no unreviewed confirmed findings. These
minimums are a release guard, not statistical proof of AI accuracy; representative
human QA is still required before activation.

The live mirror permits authenticated message insertion and conversation updates.
It therefore is not automatically trusted evidence. Admin must verify a job's
exact conversation/customer line and agreed timezone. Only subsequent trusted
service-role ingestion captures the server-owned evidence snapshot. The ordinary
mirror link is not overwritten. Phone matching supplies Admin candidates only.

Both TypeScript and SQL independently require an explicit customer text naming
the exact job ID, one ISO date and one 24-hour start time, matching saved fields.
Bare yes, free-text-only schedules, calls/summaries, multiple appointments,
explicit timezone text, ambiguity and conflicts remain human review. AI is a
bounded additional review/veto, not authorization. SQL alone permits the exact
`waiting_schedule_confirmation` → `ready_to_schedule` tag transition after checking
current eligibility, verified binding/timezone, evidence freshness, lease,
generation, configuration revision and approvals. Already scheduled, terminal,
cancelled, approval-blocked and past appointments are excluded.

No status, agreed schedule, technician, quote, payment or approval is changed.
The tag, audited evidence reference and durable notifications commit together.
Existing Operator hold and Sheets lead triggers still run normally, not via a
second client dispatch. Authorized Admin/Processor/CS Admin/CS recipients honor
ownership/shares and role/user status-visibility overrides.

New trusted messages invalidate in-flight work. Quo pause/resume invalidates saved
evidence and prevents claims/commits; fresh evidence is required after resume.
The worker has a five-job batch, two-minute leases, bounded retries, at most 100
claimed checks/day and a fifteen-minute 429 cooldown. It stops further provider
calls after a 429. Missing configuration, timeout and invalid provider output are
Unavailable, not confirmation. Partial failures return 503 with explicit counts.

## Production observations informing the design

Read-only MCP inspection on October 20 reported ACTIVE_HEALTHY, but the then-current
24-hour urgent-AI logs contained 150 provider HTTP 429 errors. The 48 scheduled
urgent-worker POSTs returned 200 despite partial provider failures. Resolve the
provider rate-limit/quota issue before shadow activation; HTTP status alone does
not establish the underlying provider account problem.

The two jobs then carrying the waiting tag were Scheduled and Cancelled, with no
explicit conversation links. They must NOT be changed merely because the tag is
present. No customer transcripts or records were modified during inspection.
The live Tech Update/UUID correction existed despite stale rollout notes and
different migration-history stamps. Inspect actual schema; do not replay old
migrations or repair migration history just to match filenames.

## Required installation sequence — separate approvals

1. Confirm the intended environment. Shared production is
   `kxiqholnmhkwhdkhtopp`, not a test database. Review and manually apply, in this
   dependency order:
   - `supabase/migrations/20261020065810_workflow_resolution_notifications.sql`
   - `supabase/migrations/20261020070343_schedule_confirmation_monitor.sql`
   Existing Tech Update/thread/UUID repair schema is a prerequisite. These new
   CLI-generated filenames precede some historical future-dated filenames;
   this repository uses manual application, NOT a bulk timestamp-order push.
   Never run `db push`, `sb:push` or `db reset` against the shared project.
2. Regenerate `src/integrations/supabase/types.ts` from that intended installed
   schema with supported CLI/MCP tooling, then typecheck. It is intentionally not
   hand-edited. Production cannot generate the new fields before installation;
   Docker/local full-schema generation is unavailable in this environment.
   Runtime Zod transport validation is implemented, not a blanket database cast.
3. With separate deployment approval, deploy `cx-update-requests`, `workflow-inbox`
   and `schedule-confirmation-monitor`, including their relative shared modules.
   Deno checks validate all three entries locally. Preserve caller `getUser()`
   verification for both browser endpoints. The cron-only worker uses a distinct
   `SCHEDULE_MONITOR_CRON_SECRET`; it accepts no browser user/session bypass.
4. Review/run `supabase/tests/151_workflow_inbox_readonly.sql` after installation.
   It performs no customer writes/provider calls. Do not run the write-based
   150/160 harnesses on production without separate approval.
5. Publish CRM only after backend/type installation. Test signed-in requester,
   responder, supervisor and excluded roles on permitted and out-of-scope jobs.
   Verify real audio/autoplay, multiple tabs, reconnection, mobile and dark mode.
6. Worker setup needs separately approved secrets/cron registration. Provision
   Vault names `schedule_monitor_project_url` (intended Supabase API URL) and
   `schedule_monitor_cron_secret` (same value as the worker's Edge secret). The
   existing `OPENAI_API_KEY` is server-only. Do not expose/print any secret.
   Review/apply `supabase/manual/schedule_monitor_cron.sql` only when approved.
   It registers a one-minute dispatcher but does not enable the OFF monitor.
   The private dispatcher avoids Edge calls while idle/off/paused/limited.
7. Turn on Shadow only after the provider problem is resolved. Verify bindings,
   incoming evidence, decisions and operational latency with approved jobs.
   Automatic activation is a separate business approval, not implied by a build,
   deployment, successful shadow request or migration application.

## Local verification and efficiency

Latest local verification:

- `npm run lint`: passed, zero errors and 28 existing warnings.
- `npm run typecheck`: passed for app and Node projects.
- `npm test`: 103 files / 873 tests passed.
- `npm run build`: passed, including unchanged Donut v1.7.0 source/ZIP integrity.
  Existing Browserslist, mixed-import and large-chunk warnings remain.
- Deno checks: all three changed/new function entry points passed.
- Disposable SQL: 32 request/history checks, 31 schedule checks and 12 read-only
  installation checks passed (75 total); both migrations also applied twice.
- `git diff --check`: passed.
- Network-isolated Playwright: latest complete run **18 passed / 1 failed**.
  The CS returned-Tech page intermittently failed to display its queue. An earlier
  run had a page-load timeout and another CS queue-display failure (17/19 passed).
  Do not call this browser suite green or assume the root cause is resolved.
  Desktop/mobile history paging, read failure, responder saves, supervisor/excluded
  role cases and other requester-resolution cases passed. Screenshots were reviewed
  at 390px and 1366px. Signed-in production QA, real audio delivery, live provider
  success, full-schema integration and cron/Vault invocation remain unverified.

`scripts/test-workflow-inbox-db.mjs <external PGlite installation directory>` loads
only disposable synthetic fixtures, applies BOTH new migrations twice, and runs
the exact behavioral SQL in `supabase/tests/150_workflow_inbox.sql` and
`supabase/tests/160_schedule_confirmation_monitor.sql`, followed by
`supabase/tests/151_workflow_inbox_readonly.sql`. It never connects to
production. This verifies the fixture's Postgres/RLS logic, not the full deployed
trigger stack, provider account, actual extension or production browser sessions.

- UI: paginated 20-row history and monitor views; no attachment fetches. Original
  threads remain complete. The monitor makes no per-card frontend AI calls.
- Cache/API: both sidebar badge counts share one caller/role-scoped query.
  Synthetic mount: **two former kind-count calls → one combined count call**.
  Fifty same-turn request events produce one count refresh in the regression test.
  At the unchanged 15-second interval this changes steady badge reads from
  **480 → 240 per mounted session-hour**, excluding initial/event-triggered work.
  The notification sidebar badge reuses the bell's exact count without a new read.
- Realtime: existing recipient transport/shared bus; coalesced refresh and trailing
  reads, plus unchanged fallback recovery. No per-card channels.
- Database: existing request/message indexes are reused; no speculative lead RLS
  or index rewrite. A read-only live EXPLAIN on the tiny request table selected a
  cheap sequential scan/sort, so adding another queue index was not justified.
- Worker: changed evidence only, bounded batches/cooldown/daily cap, durable leases
  and a no-op dispatcher while idle. No Quo history downloads or customer messages.
- Storage/bandwidth: one latest bounded private evidence snapshot per monitored
  job, evidence IDs in audit/notification metadata, no photo/media duplication.
- Donut: no native saved-request queue, notification center or schedule monitor;
  extension source/manifest/ZIP unchanged. Shared server ingestion and lead-trigger
  behavior covers saves from either client. No new manual ZIP release is needed.

These are local resource comparisons, not production usage/invoice savings.
No billing comparison or production active-user-hour normalization was performed.

## Rollback

Use the audited Admin control to set monitoring OFF, then disable its separate
cron job. Disabling the UI alone does not stop a worker. Retain request, event,
evidence, audit and review history; do not drop the shared private schema. Each
migration contains function/policy rollback considerations. Restoring the old
request authority re-enables supervisor acknowledgement and requires business
approval. Keep notification access restrictions while workflow events exist.
Never bulk revert valid tags or delete customer data as a rollback shortcut.
