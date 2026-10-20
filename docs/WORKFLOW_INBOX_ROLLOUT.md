# Request resolution, notifications and schedule monitoring

## Release state — prepared for remote review, production cutover held

The October 20 implementation is on branch
`feat/request-resolution-notifications-2026-10-20`. No production records,
configuration, secrets, ingestion settings, migrations, functions, cron jobs or
CRM publication were changed. The branch starts from the previously remote
Processor Board baseline (`bf4a3e4`), excluding two unrelated unpushed Processor
Board commits and uncommitted Copilot/settings changes in the original worktree.

The user initially authorized MCP migrations and a remote branch, then selected
**Coordinate release** after preflight exposed a breaking request contract.
Both workflow migrations are therefore **held**, not applied. Read-only MCP
confirmed the three new public workflow/monitor RPCs remain absent. Database
types must be generated after the intended schema is installed, not fabricated
from an unchanged production schema.

**Do not apply the first migration in isolation:** it redirects legacy request
mutations into a revision-required authority. The currently deployed function
and old CRM omit revisions, so replies, follow-ups and resolution would fail.
Coordinate the migration, function deployment and CRM publication as one cutover,
with a reviewed maintenance/rollback plan and refreshed clients. None of those
production actions is implied by pushing this branch.

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

Release-branch verification (`bf4a3e4` base; unrelated local changes excluded):

- `npm run lint`: passed, zero errors and 28 existing warnings.
- `npm run typecheck`: passed for app and Node projects.
- `npm test`: **102 files / 859 tests passed**, rerun without the concurrent build.
  The first branch run had 857/859 passes: an Admin sidebar test exceeded its existing
  five-second limit and a later sidebar test failed after overlapping `act()`
  cleanup. No test assertion, timeout or configuration was weakened.
- `npm run build`: passed, including unchanged Donut v1.7.0 source/ZIP integrity.
  Existing Browserslist, mixed-import and large-chunk warnings remain.
- Deno checks: all three changed/new function entry points passed.
- Disposable SQL: 32 request/history checks, 31 schedule checks and 12 read-only
  installation checks passed (75 total); both migrations also applied twice.
- `git diff --check`: passed.
- Earlier original-workspace verification: 103 files / 873 tests passed. Those
  counts included unrelated Processor/Copilot work and do not describe this branch.
- Release-branch network-isolated Playwright: **19/19 passed** in 1.7 minutes,
  using `playwright.operator-workflow.config.ts` and `cx-updates.spec.ts`. The run
  covered 390px/1366px layouts, history paging, read/save failures, requester-owned
  CX/Tech resolution, responders and excluded Operator roles. All external network
  requests were intercepted; no production browser actions occurred. Existing
  react-leaflet prebundle and Browserslist warnings did not fail the run.
- Earlier original-workspace browser runs had intermittent page-load/CS queue
  failures (17/19 and 18/19). The clean release-branch run is green, but one passing
  run does not establish or repair the cause of those earlier intermittent failures.
  Signed-in production QA, real audio delivery, live provider success, full-schema
  integration and cron/Vault invocation remain unverified.

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
