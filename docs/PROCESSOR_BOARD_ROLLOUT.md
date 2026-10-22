# Processor Board

## Compact simplified board, assigned-schedules-only queue and latest-message AI filter (2026-10-22; migration + Edge v7 APPLIED, CRM publication pending)

Applied live on 2026-10-22 with explicit user approval via MCP: migration
`processor_board_assigned_schedules_only` (recorded in remote history as
`20261022113108`, matching the local file
`20261022111039_processor_board_assigned_schedules_only.sql`; the active-radar
base had been applied earlier as `20261022044310`) and the Edge `processor-board`
bundle as **v7 ACTIVE** (`ezbr_sha256 2dae24fe…50b82bb`, `verify_jwt: true`, all
nine files read back byte-exact against local source; no-auth/invalid-token
probes return 401). Verified in the shared project read-only: with an Admin
caller impersonated in a rolled-back transaction, the active total is 695 and
equals the exact expected assigned-scheduled count; zero returned rows lack
technician name/number, date or start time; Security Advisors report no
findings. Rollback: restore `list_processor_jobs` from the active-radar
migration and redeploy the v6 bundle (`processor-board-v6-verified-20261022`);
v7 source copy is saved at `processor-board-v7-verified-20261022`.

- Simplified panel per the requested screenshot look: slim title bar with the total
  badge, exact latest check and the one "Refresh AI · this page" action; search
  directly under the header; timezone confirmation and tracking state compacted onto
  one summary line; all filters, timezone picker, tracking controls and page counts
  moved into a collapsed-by-default "Filters & tracking" disclosure. The job table
  gained a dedicated **Technician** column (name + number), customer/job and
  schedule columns keep their width, and AI status cells are one-line with a
  title tooltip. Mobile cards show technician identity and job time directly.
- Queue correctness: only jobs with **both** a saved technician name and number
  plus an appointment date and start time appear on the radar. Incomplete jobs
  (previously shown with "Not assigned/manual" placeholders) stay in All Jobs for
  repair; any EXPLAIN-era placeholder rows were display-only and are now excluded
  at the source. `supabase/migrations/20261022111039_processor_board_assigned_schedules_only.sql`
  updates `list_processor_jobs` (idempotent, no lead writes, RLS/authorization
  unchanged) and must be applied manually after `20261022041621_processor_board_active_radar.sql`.
  Rollback: restore only `list_processor_jobs` from the earlier migration.
- AI input filter (user request): the provider prompt receives only up to the last
  20 job-linked messages **plus** older job-linked messages matching update
  keywords ("done", "on my way", "completed", "payment", "reschedule", …). Job
  attribution happens before selection, another job's keyword match is never sent,
  negated/future wording ("not done yet") is kept intact for AI to reject, and
  latest non-English replies are always included without keyword guessing. The
  server still reads full available history for identity and non-response timing;
  only the AI payload is narrowed. The result reports `ai_scope`,
  `ai_recent_limit` and `ai_messages_omitted`; the drawer and rows label
  "AI · latest job updates + keywords" when a check used the filtered scope, and a
  banner appears while the deployed backend is still below evidence policy 6.
  The new Edge bundle is committed locally and **awaiting approved deployment**.

Gates run so far: **99/99 focused tests** across `ProcessorBoardPage.test.tsx`,
`ProcessorBoardPage.auto.test.tsx`, `processor-review-diagnostics.test.ts` and
`processor-board-handler.test.ts` (new: closed-by-default filters with technician
column, latest/keyword selection keeping peer wording out, handler payload pruning
with evidence rejected from omitted messages, provider budget counts), and the
PGlite fixture run of `scripts/test-processor-board-db.mjs` covering migration
`20261022111039…` applied twice idempotently plus **all 154 harness checks PASS**
(assigned-only totals, missing name/number/date/time exclusions in history,
newest-schedule ordering ties, complete pagination, retained reschedule/approval
statuses, per-user status deny and role denial matrix). Final round: typecheck
clean, full lint 0 errors/28 pre-existing warnings, build with Donut v1.7.0
integrity OK, and **29/29 mocked browser cases pass** (the two zero-evidence
cases now assert the unverified-reply note in the review drawer, matching the
updated UI contract where rows show the one-line origin and the drawer holds the
full attribution breakdown). No assertion, timeout or configuration was weakened.

## Tracking startup and manual controls (2026-10-22; CRM publication pending)

The next screenshot exposed three UI defects: timezone confirmation was lost on
every board mount, an automatic batch disabled the manual page/job controls, and
explicit page refresh silently skipped all fresh evidence. A recovery list read
was also awaited while keeping completed AI controls locked, and an assessment
request had no client deadline.

- `src/lib/processor-tracking.ts` remembers only explicit timezone confirmation,
  selected timezone and tracking pause in same-tab `sessionStorage`, scoped by
  caller, role and sign-in timestamp. Another caller/login/role starts unconfirmed;
  changing timezone clears confirmation. Invalid or blocked storage falls back
  safely to usable in-memory controls. No timezone is inferred from browser/state.
- The top AI action now explains/focuses confirmation when needed rather than
  appearing inert. Once confirmed, reopening the board resumes tracking without
  another checkbox click (unless deliberately paused). Drawer checks explain why
  first-time confirmation is required.
- During automatic work, manual page/job/failed-only actions queue after the active
  job and pause automatic tracking. There is still one review in flight. Jobs just
  attempted are not duplicated; removed/reassigned jobs are retired from the queue.
  Stop, unmount and hidden-tab transitions prevent queued work from starting.
- Explicit manual refresh re-reads history even for fresh results. Automatic work
  still reuses five-minute freshness/backoff; server extraction hashes/leases remain
  authoritative. Recovery invalidation no longer holds the UI batch open. Each
  assessment has a cleaned-up 120-second abort deadline and an honest timeout error:
  the server may still finish, so refresh before retrying. No fake successful result.

Five permission layers are unchanged: fixed Admin/Processor UI/helper access,
authenticated server checks, existing caller/table RLS and generated types/enums.
No migration, Edge source/deployment, grants, status, schedule, approval or outbound
message changed. This is CRM-only; Donut has no native job-board tracking controls.
No extension release is required. CRM Publish remains separate from committing.

Efficiency review: existing query keys/cache, shared realtime, serial processing,
loaded-page limit and background-free design remain. Only tiny non-customer UI
preferences enter session storage; no new payload, database query/index/RLS, worker,
storage upload or channel. The one in-flight request deadline is cleared on settle.
Windows/Vitest synthetic two-job auto-to-manual takeover makes two total sequential
assessment calls, not three (no repeat of the active job). Fresh explicit page
refresh changes from zero calls to one per eligible job intentionally, while
automatic fresh re-render remains zero additional calls. This fixes the requested
action, not a measured billing reduction; live usage/accuracy are unverified.

Pre-commit checks: **75/75 focused tests across four files**, **6/6 targeted mocked
desktop/mobile browser cases**, typecheck and full lint (0 errors/28 existing
warnings). Test contracts now assert explicit manual rechecks, unchanged automatic
freshness, confirmation recovery, caller isolation, queued takeover/cancellation,
backend failures and timeout cleanup. Repository-wide post-commit gates are
reported separately; no assertion, timeout or configuration was weakened.

## Internal CRM technician chat (2026-10-22; Edge v6 installed, frontend publication pending)

The board's external Quo link was incorrect for operators who read the webhook
mirror inside CRM without a separate Quo login. The board now opens the existing
`QuoPhoneTrigger` as one root-level, read-only Tech Quick Chat, pinned to the
backend-verified CRM conversation UUID, technician number and Technician
Communications line. It never guesses a newer/customer conversation, launches an
external tab, composes, queues, schedules or sends. The review Sheet closes while
chat is open and returns on Close/Escape; desktop and mobile stay on-screen.
The existing saved-lead Quick Chat sending workflow is unchanged.

The independent `tech_quick_chat` grant is retained alongside the Admin/Processor
board gate. Reads still use the authenticated CRM client and existing table RLS;
no role, grant, schema, RPC, generated enum/type or migration changed. Missing or
mismatched mirror/line/participant fails visibly without a fallback. Changes to
the job's technician, conversation, permission or loaded scope retire the viewer.
Pinned history is paginated in stable 500-row pages; over 10,000 rows is an
explicit error, not a silently truncated conversation. Unpinned lead Quick Chat
keeps its existing lookup and 500-row viewport.

Backend list metadata now reports `monitoring.evidence_policy: 5`; older backends
produce a visible attribution-update warning rather than silently implying the
new rules are installed. Unconfirmed-timezone saved progress/payment labels are
explicitly described as saved status, not a fresh AI finding. AI still requires
timezone confirmation; no schedule, status, approval or outbound message changed.

The user explicitly approved backend deployment with “deploy it”. The function is
now **v6 ACTIVE**, `verify_jwt: true`, on `kxiqholnmhkwhdkhtopp`, bundle SHA
`f93ed4a57916bf8beebf1381070e418ae4773d98038af7323931d1db121df939`.
All nine deployed files were downloaded again and match local source byte for
byte. Post-deployment no-credential and invalid-bearer probes both returned 401;
CORS preflight returned 200, matching the v5 baseline. No authenticated assessment
or paid provider call was made. These probes verify the boundary, not AI accuracy.
The supplied screenshots
already show provenance-capable UI; this newest internal-chat button still needs
CRM publication. No native Donut job-board/viewer counterpart exists; the separate
technician-wide intelligence flow and Donut v1.7.0 artifacts are unchanged.

Before deployment, all nine live v5 files were downloaded to
`C:\Users\User 1\AppData\Local\Temp\opencode\processor-board-v5-rollback-20261022`
and compared with `ea68547`; all matched. Its `ROLLBACK.md` records metadata and
the approved-target-only redeployment procedure. Rollback is a separate production
operation requiring approval, not automatic cleanup.

### Efficiency / verification boundaries

- Local validation so far: typecheck passed; full lint passed with 0 errors and
  28 existing warnings; all 29 mocked Chromium browser cases passed, including
  internal chat, desktop/mobile bounds, permission denial, failed reads, no
  external navigation and no AI calls on open. The initial failure fixture used
  a retryable 503 and remained loading during SDK retries; the browser denial
  case now uses a realistic 403 without changing any timeout/assertion. Unit
  coverage separately verifies propagated read failures. A concurrent focused
  run hit two 5-second page-test timeouts under load (95/97 passed). The first
  full one-worker run overlapped Chromium and passed 996/998 across 109 files;
  only the same two page tests timed out. The entire page file then passed 34/34
  alone, unchanged. The final full run, without overlapping browser/build work,
  passed **998/998 across 109 files**. No timeout, assertion or test configuration
  was relaxed. `npm run build` passed, including unchanged Donut v1.7.0 source/ZIP
  integrity. Board JS is now 45.01 kB / 14.09 kB gzip versus 44.05 / 13.83 before
  this chat fix; board CSS remains 3.82 / 0.98 kB. Existing bundle/import warnings
  and outdated Browserslist data were not hidden or fixed through unrelated changes.
- UI/hooks/cache: one chat mounts only after an explicit click, not one per row;
  no AI check is triggered by chat opening and no hidden-trigger unread watcher
  is registered. Existing board query keys, freshness and automatic-check limits
  remain unchanged. The viewer uses the existing chat recovery/realtime transport.
- API/database/bandwidth: for a synthetic 501-message pinned chat on Windows/Vitest,
  the old reader used one conversation + one message request but hid message 501;
  the new reader uses one exact conversation + two message requests and returns
  all 501. General Quick Chat still makes one message request/500-row viewport.
  No schema/RLS/index changes, N+1 board lookup or provider calls were added.
  History pagination deliberately increases reads to preserve complete review.
- Realtime/background/storage: existing mounted-chat realtime and fallback polling
  are reused, with cleanup on close/scope retirement; no new worker, cron, upload,
  storage object or extension download. This is not a measured invoice saving.
- Production billing/usage, signed-in RLS behavior, current mirror completeness and
  real-model accuracy remain unverified. Mocked browser tests cannot establish them.

## Verified Tech Quick Chat attribution (2026-10-22) — Edge v6 installed

This section records the follow-up to the live complaint that the board said
“0 technician messages identify this job” while the saved Tech Quick Chat on the
lead clearly contained technician replies. Commit `b92ae0b` is pushed on
`boostera/processor-fix`; the final serial run passed 980/980 tests across 108 files.
The latest complaint separately approved backend deployment. No CRM publication,
migration, provider call, assessment, lead/status write, schedule edit or outbound
message occurred during this fix. See the newest section for its release state.

### Live read-only diagnosis

- `LD-7RL3L3` current Quo text history had **9 text events**: one
  outbound customer-details dispatch that uniquely identified the job, and three
  real technician texts (acknowledgements and a cancellation complaint).
  The old rule required the technician text itself to repeat a job ID, complete
  address, full name or exact customer phone; none did, so all three were counted
  as “not assigned”. Call rows were not in the current-history text feed.
- `LD-HJ83ZO` showed the same defect in the visible saved chat: technician
  acknowledgements and appointment discussion followed this job's customer-details
  dispatch, but were unassigned because they did not repeat its identifiers.
  `LD-RORBQD` also had acknowledgements and a technician reschedule request.
  These observations do not establish work started or finished.
- The webhook mirror also stores call recordings, call transcripts, call summaries
  and reactions as inbound `customer` rows. The current-history API feed is
  text-only, so mirror diagnostics could count those artifacts as “technician
  messages”. They are not technician replies and may contain both speakers.

### Attribution rule and limits

- A technician text that names this job in the same message remains **direct**
  evidence under the existing unique-ID/address/full-name/exact-phone and
  peer-exclusion checks.
- A technician text that does **not** name the job is **context-attributed** only
  when it follows this job's own delivered, job-identifying dispatch in the same 1:1
  technician thread, before any other saved or unknown job's dispatch, and within
  **7 days** of that dispatch. The reply must be strictly later (a tied timestamp
  cannot establish order); failed/unknown delivery and another conversation cannot
  anchor it. The reply itself is still the only quoted source.
- Any peer dispatch, any unknown “Customer Name/Number/Address” dispatch, any
  technician message that mentions another saved job, or the expiry of the window
  closes/blocks the episode, including generic replies after a technician changes
  topics to another job. Generic chatter does not re-open an episode.
- Call recordings, transcripts, summaries, media and reactions never count as
  technician text replies and are never sent to the AI as replies; server evidence
  verification rejects them even if a model returns such an ID. All received rows
  still participate in silence timing when present in the chosen feed; current
  Quo text history does not independently prove whether a phone call occurred.
- AI input is still limited to the target job's attributable replies plus this
  job's delivered agent messages. Each message is labelled `names_job` or
  `follows_job_dispatch`; server verification still requires the exact quote from
  that same message, the correct sender, a non-future timestamp, the appointment
  date guard and the peer checks. An unnamed reply after another job's dispatch is
  rejected even if the model returns it. Short replies (synthetic examples: `Ok`,
  `Done`) must be quoted in full, inside the verified episode; a short substring
  from a longer or negated message is rejected. Acknowledgement alone is neither
  progress nor completion.
- Context-attributed evidence carries `identity_basis: thread_context` and is
  shown as **context-attributed · verify in Quo**. It can establish acceptance,
  progress or completion admissibly, but **Send Dose still requires a directly
  identified acceptance** plus a delivered, unanswered, job-specific update
  request and the existing 60-minute wait. Context-only evidence cannot accuse a
  technician of silence.
- The result now reports direct replies, context-attributed replies, real
  technician texts, unassigned replies and excluded call/system rows separately.
  Page/batch reply counts use attribution rather than outcome extraction: a reply
  with no verified progress/completion is no longer misleadingly counted as zero.
  Unassigned replies remain separately counted. The drawer names the same saved Tech
  Quick Chat conversation as the source (current Quo history or webhook mirror).
- No lead status, schedule, approval, quote, payment or conversation link is
  changed. The board remains advisory and still requires schedule-timezone
  confirmation. `policy: 5` invalidates prior extraction hashes.

### Remaining limits and release state

Conversation position is not proof of intent: a human must verify context-attributed
replies in Quo before acting, especially completions that would suggest Payment
Pending. A technician who discusses a job by phone, or whose job was never sent as
a customer-details dispatch, can still produce no attributable reply. The three
malformed saved numbers (`LD-EFM7FS`, `LD-BLYIQ8`, `LD-SHALGR`), the unconfirmed
schedule-timezone convention and live real-conversation accuracy remain unresolved
data/manual steps. No schema, RLS, generated type, migration or SQL harness change
is needed; no Donut source/version/ZIP changed because Donut has no native board or
job-specific assessment counterpart. Edge v6 is **installed**;
CRM Publish and signed-in/provider QA remain the user's separate steps.

**Release order matters:** publish the new frontend before deploying the new Edge
source, then confirm publication and obtain explicit Edge deployment approval.
The new frontend accepts existing v5 result fields, but an older frontend can
reject the new `thread_context` provenance (or display an unqualified legacy
completion label). Do not deploy v6 ahead of the matching UI. A branch push is
not publication; verify the published UI's provenance support before deployment.

### TODO / manager-message checklist

| Requirement | Current source behavior / remaining check |
| --- | --- |
| Preserve interface; newest schedules first | Existing compact layout unchanged; installed list RPC orders by saved appointment date/time, then job creation, before pagination. |
| Technician name/number, job time, last check | Saved identity/schedule and exact checked date/time are retained; missing/malformed setup remains visible with a repair path. |
| Only assigned unfinished jobs on radar | Existing active radar excludes unassigned and terminal paid/cancelled/done/completed jobs; older unfinished assigned appointments remain accessible through pagination. |
| Take Job Update | Overdue saved schedule rule, only after operator timezone confirmation; no guessed customer timezone. |
| Job In Progress | Technician work/progress evidence for this job, not a bare acknowledgement, future plan or another job's message. |
| Payment Pending | Technician completion evidence for this job; context-based completion explicitly requires manual verification. No approval/status write. |
| Send Dose | Advisory only: direct acceptance, delivered job-specific request, 60-minute wait, current history and no later technician reply; never an automatic send. |
| Do not mix one technician's 2–3 jobs | Direct identifier/peer checks plus bounded dispatch episodes; technician topic switches close the context. Ambiguity remains manual review. |
| Identify AI use | Per-row AI-versus-saved-status/schedule-rule labels, provenance notes, reply diagnostics and successful-check counts remain separate. |
| Automatic tracking | While the board is open/visible and timezone-confirmed, for the loaded page (up to 25 jobs); hiding/unmounting stops new checks. It is not an all-pages/background worker. |
| NSS | No authoritative NSS status/tag was found in the source audit; no invented status mapping/filter was added. Confirm the intended saved status if another exclusion is required. |

After approved release, verify the real saved chat and board side by side for a
multi-job technician, an acknowledgement-only job, a completion, an unanswered
request and a reschedule request. Build/mocked tests do not establish live model
accuracy. Obtain verified phone corrections and a confirmed schedule convention
before calling the production TODO complete.

### Rollback and permissions

All five permission layers were traced: fixed Admin/Processor UI and helper gates,
`AuthContext.canAccess`, caller-token lead/status/chat scope, assessment-table RLS
and service-only lease/save RPCs, plus generated database types. None changed. The
optional JSON diagnostics/provenance do not add a database enum. Tests cover excluded
roles, hidden/status-excluded jobs, provider/save failures and unchanged lead values.
No live RLS write-based harness was run; no database authorization change is proposed.

If approved deployment needs rollback, redeploy the nine-file v5 source from
`ea68547` with its existing JWT verification setting preserved, and restore the
frontend only after a separate compatibility review. Keep the provenance-capable
new UI during backend rollback: stored `thread_context` JSON may remain in list
results even after changing the backend. Do not delete assessment/customer records
or rewrite migration history. New-context cached evidence must not be trusted by
the old policy; input/extraction policy hashes force a fresh review when invoked,
but do not themselves rewrite list results. Any live rechecks require approval.

### Efficiency and verification record

- No additional database read, Quo request, second provider call or timer per check.
  More legitimate replies now qualify for the existing single AI extraction where
  the earlier rule skipped it, so this is not a provider-cost reduction claim. Attribution
  runs in memory over the history already read. It builds **one normalized peer
  identity index per review**, not one full matcher per peer; a synthetic
  Windows/Vitest 60-peer/360-message regression compares **3,660 identity reads** for the initial
  per-peer compilation with **120 identity reads** (target matcher + peer index),
  while retaining 180 contextual replies on that synthetic workload. The evidence hash now
  includes the contextual IDs and policy so a changed episode cannot reuse stale
  provenance; changed target text still forces a fresh extraction.
- UI/cache reuse the existing page, query keys, freshness and retry/backoff; the
  new counts come from the loaded result. No new realtime subscription, upload,
  worker or storage work. The board chunk is 44.05 kB (13.83 kB gzip), up from
  41.65 kB (13.18 kB gzip); CSS is unchanged at 3.82 kB (0.98 kB gzip).
- Gates run locally: focused Processor Board tests **100 passed across 5 files**,
  plus a **65-test** matcher/diagnostics/handler rerun after the peer-index change;
  initial full `npm test` ran **968 tests across 108 files** with **966 passing**.
  The two failures were unrelated `AppSidebar` timing/teardown tests under full
  parallel load; that file passed **4/4** alone. The subsequent complete
  `npm test -- --maxWorkers=1` passed **975/975 across 108 files**, including those
  sidebar tests. After the final shared-identity/unit safeguards, the two-worker
  full run passed **978/980**; only the same sidebar timeout/teardown pair failed.
   The final serial run passed **980/980 across 108 files**. No test timeout,
  assertion or repository configuration was changed to hide these failures.
  `npm run lint` passed with **0 errors / 28 existing warnings**;
  `npm run typecheck` and `npm run build` passed, including unchanged Donut v1.7.0
  source/ZIP integrity. The latest focused safety/automatic-count pass is **79/79**.
  Browser checks passed **25/25** with desktop/mobile context-attribution coverage,
  excluded roles, saved-status preservation, safe failures, keyboard access and
  no horizontal overflow. Reproduce with
  `npx playwright test tests/operator-workflow/processor-board.spec.ts --config playwright.operator-workflow.config.ts --reporter=line`.
  The default Lovable config cannot load its missing local package; a temporary
  default-channel browser attempt timed out before creating a page and was stopped.
  The existing operator-workflow config uses the working Chromium channel; no test
  assertion or repository test setting was relaxed. The temporary config was removed.
  One concurrent lint attempt hit `ENOENT` while Vitest removed a generated config
  module; rerun lint separately from Vitest, without changing ignore rules.

Read-only MCP reconfirmed the installed function is v5 ACTIVE with JWT verification
enabled. Security/performance/health advisors were inspected; existing project-wide
notices include mutable function search paths, executable definer functions,
password protection, policy/index tuning and Auth connection information. No
unrelated production change was made. These need their own authorization/grant
review, not blindly revoked access or speculative indexes. See the
[security-definer advisory guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
and [database advisor reference](https://supabase.com/docs/guides/database/database-linter).
The subsequent targeted last-day Processor Board logs query succeeded: 621 responses
were 200, 11 were 422, 12 were 401 and 2 were 405. These counts do not establish
model accuracy, error-free production behavior or complete health/billing evidence.

## Evidence accuracy follow-up (2026-10-22) — Edge v5 installed; CRM publish pending

This section supersedes the earlier manual-check timezone behavior. The user
approved deployment and push, which are now done, on
`fix/processor-board-evidence-accuracy-2026-10-22`, based on merged Boostera `main`
`d8aa85b`. This release does not include CRM publication, migrations, customer-data
repair, outbound messages or running paid/live assessments.

`processor-board` is **v5 ACTIVE** on `kxiqholnmhkwhdkhtopp` with JWT verification
preserved; all nine deployed files were read back and match the tested source
exactly. Unauthenticated/invalid-credential probes returned 401 as configured.
Prior live v4 remains backed up outside the repository for rollback.

### Defects and bounded fixes

- A review completing is not a verified technician outcome. The batch notice and
  page evidence-quality summary now separately count successful checks and checks
  with verified technician acceptance/progress/completion. A delivered outbound
  request alone is not a verified technician update. Saved In Progress / Payment
  Pending remains labelled as saved status, never newly AI-confirmed.
- New result diagnostics count technician source messages that uniquely identify
  the job, other technician text messages that cannot be assigned to it, and text
  submitted for extraction. Zero attributed replies is exposed, not described as
  a confirmed outcome. Unassigned replies may concern other jobs; this is not a
  non-response finding. The drawer offers the exact verified saved Quo chat for
  manual review; opening it sends nothing.
- Equivalent complete address spellings (`Street`/`St`, `Apartment`/`Unit`/`#`)
  now match without dropping house numbers, directionals or unit values. Shared
  canonical addresses remain ambiguous. Missing/different units cannot silently
  become matches, and mentioning another peer address still blocks evidence.
- Exact factual quote spans may omit the identifier when their **same full source
  message** uniquely identifies this job. Source ID, exact substring, sender,
  appointment-date and peer-exclusion checks remain. The drawer identifies this
  provenance. A generic reply never inherits identity from an adjacent dispatch.
  Cache policy version is bumped; prior extraction is not reused under new rules.
- Pure outbound dispatch cannot establish technician acceptance/progress/completion.
  With no uniquely identified technician text there is no possible Send Dose
  outcome, so AI extraction is skipped. If identified technician text exists, ALL
  identified delivered agent messages remain eligible for extraction; update
  questions do not need an English keyword. All history, including generic/media
  replies, still participates in non-response timing; fresh history is never skipped.
- The tracking state now explicitly says **not started**, **paused**, **unavailable**
  or **enabled**, separate from the requested-tracking checkbox. Both manual and
  automatic checks require timezone confirmation. Unconfirmed schedule rules show
  Needs Review rather than an unsupported Scheduled/Take Job Update judgement;
  existing saved progress/payment statuses are preserved. Changing timezone resets
  confirmation. The page remains bounded to the loaded 25 jobs, not every page.

### System timezone investigation and remaining data limits

`src/pages/SchedulePage.tsx` displays the browser's GMT offset (lines 640–641) and
places saved `scheduled_time_start` values directly on its hours grid. Saved lead
date/time fields have no timezone. Copilot's business timezone and the separate
schedule-confirmation monitor configuration are not proof of an individual job's
appointment timezone. The user's instruction to follow the existing system was
investigated; **no authoritative all-job timezone was found**. Do not infer it from
the operator's browser, customer state, ZIP or an unrelated AI setting. The operator
must verify the saved convention before confirming a timezone; mixed conventions
need a separately designed per-job timezone workflow, not a guessed conversion.

The three malformed technician numbers remain blocked pending verified corrections:
`LD-EFM7FS`, `LD-BLYIQ8`, `LD-SHALGR`. The new matching must not be described as
recovering generic replies automatically or as verifying all real job outcomes.

### Read-only evidence and efficiency review

After the screenshots, a caller-independent, privileged diagnostic examined the same
bounded first-page mirrored message workload under old/new pure matching functions
locally (no provider call, assessment save or transcript output): 22 assessed jobs,
914 per-job mirrored message events, **1 identified technician message before and
after**. The new address aliases did not invent any additional live matches.
The old extraction planner selected 22 jobs; the new planner selects 1 on that same
input. This is **prospective extraction eligibility**, not measured production
provider requests or invoice savings. The earlier 524 current-Quo review events and
this 914-event mirror snapshot are different datasets, not before/after usage.
Aggregate diagnostics alone cannot establish what an unanchored reply means.

- UI/cache: bounded existing page, clock and query keys; no new timer, query or
  global state. Evidence counts reuse loaded results. Confirmation does not alter
  saved schedule values or query filters. Manual chat opening downloads nothing.
- API/database: only optional JSON metadata added to the existing result and chat
  setup. No table/column/type/RLS/index/RPC change and no new database read per check.
  No SQL migration or write-based harness is needed. Authorization remains in the
  existing UI/helper/Edge/caller-RLS/service-only advisory-save chain.
- Provider/history: skip extraction that cannot possibly establish a technician
  outcome; retain full current-history reads, delivered-request checks, independent
  failures, audit saves, retry/backoff and evidence-hash reuse. Identity indexes
  compile once per review; canonical matching retains the bounded text scan.
- Realtime/background/storage: existing shared transport, recovery reads, hidden-tab
  pause, cleanup and worker-free design unchanged. No uploads, cron or new feeds.
- Donut: source audit reconfirmed no native board/job-assessment counterpart. Its
  technician-wide intelligence is separate. No extension source/version/ZIP changes.
  No dependency or generated database type changed.

### Verification and release record

Initial focused tests passed **118 tests across 8 files**; initial app/node
typechecking passed. Final `npm run validate` passed: lint (zero errors / 28 existing
warnings), app/node typechecks, **958 tests across 108 files**, and production build
including unchanged Donut v1.7.0 source/ZIP integrity. No assertions/configuration
were weakened or skipped. Existing Browserslist, Router future-flag, unrelated
Quo-dashboard DOM nesting, mixed-import and bundle-size warnings remain. The board
route is 41.65 kB JS (13.18 kB gzip), versus the prior 38.44 kB (12.25 kB gzip); CSS
remains 3.82 kB (0.98 kB gzip). Browser verification passed: **23/23**
Playwright operator-workflow tests, including the new zero-verified-outcome and
timezone-gating cases at 1440px and 390px, with no horizontal overflow and
attribution/chat-link assertions verified in both screenshots.
Deployment used the existing eight files **plus
`supabase/functions/_shared/processor-review-diagnostics.ts`** (nine files total),
with JWT verification preserved and deployed content verified against the tested
source. CRM publication and real signed-in/provider accuracy checks are
separate from deployment/build success. No new live assessment was invoked here.

## Open-board tracking follow-up (2026-10-22) — Edge v4 installed; CRM pending

This section supersedes the on-demand-only and execution-status-only descriptions
below. The earlier active-radar migration and Edge v3 deployment remain installed;
**the follow-up backend is deployed; the CRM is not published by this task**. No new SQL migration,
generated database type, grant or secret is required.

### Behavior and safety

- Automatic AI tracking is selected by default but starts only after the operator
  explicitly confirms the displayed schedule timezone. It covers the **loaded page,
  up to 25 jobs**, independent of page-local filters and the five-row viewport.
  Changing timezone requires confirmation again. It is not an all-pages worker.
- Hiding/unmounting the board stops starting jobs; the current request may finish.
  Pausing tracking or Stop after current job preserves completed evidence. The
  existing manual page/job checks and failed-only retry remain available.
- Five-minute freshness is invalidated by changed saved job/chat metadata. The
  existing 30-second clock plans reviews; transient failures back off at 1, 2, 4,
  then 5 minutes. Nonretryable failures wait for changed setup or explicit recheck.
  Caller/role changes remount the board and reset confirmation/retry state.
- Missing technician-directory entries/links can use **one exact-number saved
  conversation on Technician Communications**. No newest-chat/name guess is used;
  conflicting/invalid links, wrong participants/lines and ambiguous mirrors remain
  blocked. No directory, conversation link or customer record is repaired.
- The read-only first-page audit found ten missing-link/directory failures with a
  unique valid saved technician-line conversation. Three malformed saved numbers
  (`LD-EFM7FS`, `LD-BLYIQ8`, `LD-SHALGR`) still require verified correction. Never
  infer their missing digits. Do not treat the audit snapshot as permanent data.
- Active reschedule/customer/approval workflows may receive advisory evidence
  checks, but keep their saved workflow and explicit guidance. A date alone cannot
  advance those workflows. Terminal jobs remain history-only and unreviewable.
- Status labels distinguish verified AI progress/completion, saved lead status,
  schedule rules, and AI checks with **no verified target-job update**. Generic
  replies cannot identify one job among several. Full current-history verification,
  delivered-request/acceptance/timing guards and manual Send Dose remain intact.
  Mirror-only history cannot establish non-response.
- UI/helper/Edge Admin/Processor gates, caller-token lead/status/chat reads,
  service-only leases/revision-checked advisory save and atomic audit are unchanged.
  No RLS/enums, approvals, lead statuses, schedules or outbound messages are changed.

### Efficiency review and reproducible evidence

- UI/hooks/cache: one bounded page, one existing clock, serial guarded reviews,
  shared query keys and immediate per-job cache updates. No per-row timer. Lead,
  technician-setup and page-conversation changes share a coalesced refresh; in-flight
  bursts retain a trailing read. Reconnect and 30-second polling remain recovery.
- API/database: page readiness adds two batched caller-scoped metadata reads (plus
  additional 500-row pages if required), not two reads per job. Only required
  columns are selected. Exact list totals/pagination/RLS remain unchanged; no new
  indexes or speculative query tuning. No production-after query-plan claim.
- Realtime: one shared board transport adds technician-setup changes; one shared
  activity channel filters to loaded saved conversation UUIDs. Retired scopes cannot
  invoke replacement callbacks; unmount releases consumers. No global message feed.
- Provider/history: current history is still reread for identity and silence timing.
  A target-job evidence hash reuses verified extraction when only another job's
  message changes; it never reuses non-response timing without reading history.
- Local synthetic comparisons (Windows, mocked Vitest backend): a 25-job page adds
  **2 metadata reads** to the prior list path (previously zero), zero provider calls
  or leases for listing. This is two batched reads, not 50 reads from a naive
  two-lookups-per-job implementation. Two reviews with only another job's message
  added use **2 current-history
  reads / 1 AI extraction**, rather than 2 extractions. Ten unchanged 30-second
  planning ticks start only one successful check before five-minute expiry.
  Run `src/lib/processor-board-handler.test.ts`, `processor-chat.test.ts` and
  `processor-auto.test.ts` to reproduce. These are request/resource tests, not
  production usage or invoice savings; normalized billing/health evidence is absent.
- Background jobs and storage: no cron/worker, uploads or release downloads added.
  Donut has no native job board/job-specific assessment counterpart (source search
  reconfirmed); technician-wide intelligence is separate. No extension source,
  manifest, ZIP or release version changed; no Donut installation is needed.

### Release and remaining verification

With the user's explicit **Deploy and push branch** approval, Supabase MCP deployed
`processor-board` **v4 ACTIVE** on `kxiqholnmhkwhdkhtopp`, with JWT verification kept
enabled. All eight retrieved files match the tested LF-normalized source: the
existing seven bundle files **plus `supabase/functions/_shared/processor-chat.ts`**.
Six non-mutating checks passed: preflight 200; missing authorization, invalid JWT,
API-key-only and anonymous-JWT requests 401; gateway-authenticated unsupported method
405. An initial unauthenticated GET returned gateway 401 as expected once gateway
authorization was considered; the anon-JWT retry verified the handler's 405.
These are boot/authentication checks, not signed-in/provider accuracy verification.
The previous v3 bundle is backed up outside the repository for approved rollback.
No migration should be reapplied. Publish CRM separately after review.
Rollback is the prior CRM and the previously deployed v3 function bundle; retain
advisory/audit history. No data repair is required for rollback.

Local verification: **950/950 unit tests across 107 files** and **21/21 isolated
Chromium workflow tests** passed, including desktop/mobile automatic confirmation,
fresh-result reuse, pause/setup handling, excluded roles and the existing viewport.
App/node typechecks passed. Full lint passed with zero errors / 28 existing
warnings; `git diff --check` passed. The first full-unit command hit its 240-second
shell limit without a test failure; the 600-second-limit rerun finished in 282s.
Tests/configuration were not weakened or skipped. The 1440px/390px automatic-check
screenshots were inspected: controls, exact check times, source labels, saved status,
technician identity and schedules are readable without horizontal page overflow.
Production build passed, including unchanged Donut v1.7.0 source/ZIP integrity.
Existing Browserslist, mixed-import and bundle-size warnings remain. The board route
is 38.44 kB JS (12.25 kB gzip), versus 31.65 kB (10.13 kB gzip) in the prior release;
CSS remains 3.82 kB (0.98 kB gzip). No SQL harness rerun was required: schema/RLS and
migrations are unchanged. Native Deno typecheck was not run (Deno unavailable).

Signed-in production/provider checks remain unverified, especially manually confirmed
started/completed/non-response examples across several jobs in one real chat.
No production AI invocation, data correction, secret/ingestion change or outbound
message was performed. Only the approved function was deployed; CRM Publish remains
the user's step after merging the release branch.

Release branch: `feat/processor-board-live-tracking-2026-10-22`, based on merged
Boostera `main` `6aedb99`. The user requested commit/push, but retains merging and
publication. The original dirty workspace remains untouched. Preflight confirmed
the project ACTIVE_HEALTHY; existing security/performance advisor findings remain
outside this scoped release (including private/service-only RLS tables, function
search paths, executable definer functions and query/index advisories). The
15-minute preflight function log query returned no matching events, not proof of
live workflow health. See [function search path guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
and [anonymous definer-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Active radar requirements audit (2026-10-22) — database/Edge installed; CRM pending

This section supersedes the older default-queue description below. The existing
compact interface, viewport controls, permissions and advisory-only workflow remain.

- Fixed server ordering **before pagination**: appointment date/time descending,
  null schedules last, then job creation descending and ID for deterministic ties.
  Both page selection and JSON aggregation use the same order. Newest appointments
  appear first; old appointments remain reachable, not discarded.
- A saved technician name **or** number is required for queue inclusion, including
  history. Both absent/blank means unassigned and is excluded **before exact counts
  and pagination**, not hidden client-side. A name-only assignment still needs its
  number repaired before AI; a number-only assignment is not guessed from a name.
- Assigned dated jobs stay on the active radar across saved status changes until
  `paid`, `cancelled` or `job_done` (also excluding legacy `done`/`completed`). The
  existing undated `scheduled` repair case remains. Needs Reschedule, cancellation
  and payment approval requests remain visible but their workflows cannot be
  advanced by an assessment. Only the existing eligible execution/payment states
  permit checks; `job_done` is now history-only and not assessable.
- Added a **Saved status · this page** filter, independent of advisory-action
  filters. All saved statuses remains the default; counts/filters remain page-local.
  No NSS category was invented: repository search, live saved statuses, visibility
  settings and the four distinct `cs_tag` values contained no `NSS` entry. The user
  also could not define NSS. A new NSS mapping requires a confirmed business meaning.
- Every persisted check displays its **date, time and selected timezone**, not only
  relative time or a hover title. Stale checks still say Previous check. New results
  record `ai_used`: AI-reviewed rows explicitly say so, zero-matching-message checks
  identify the saved-status/schedule rule, and older results honestly say AI usage
  was not recorded. A policy-hash bump prevents reuse of pre-change backend results.
- A complete chat with no new target-job signal no longer regresses saved In
  Progress/Payment Pending/Partial Paid into Take Job Update. Incomplete history and
  provider failure remain unavailable, never a successful AI check.
- Existing four action rules, full paginated text history, exact job-identity and
  quote verification, delivered-request/60-minute Send Dose safeguards, revision
  checks, leases and atomic audit remain. No automatic lead mutation or message
  sending was added. **AI checks remain on demand, not unattended monitoring.**
  Calls/voicemails still need manual review; generic unanchored replies cannot be
  safely attributed among several jobs in the same technician conversation.

### Required release steps

1. **Applied through Supabase MCP with explicit user approval on 2026-10-22** to
   `kxiqholnmhkwhdkhtopp`: exact file
   `supabase/migrations/20261022041621_processor_board_active_radar.sql`.
   MCP recorded `20261022044310 / processor_board_active_radar`; retain the original
   reviewed repository filename and do not repair remote migration history or
   reapply this migration on this project. For another environment, review and
   manually apply the file in its intended SQL Editor. It replaces only the existing
   caller-token `SECURITY INVOKER` list RPC, preserving status visibility and lead
   RLS. No table columns, API signatures, grants expansion or generated-type changes
   are required. Do **not** run `db push`/`db reset` or reapply the original migration.
2. **Deployed through Supabase MCP after separate explicit user approval on
   2026-10-22:** `processor-board` **v3 ACTIVE**, JWT verification preserved (`true`).
   All seven deployed files match the reviewed Git-normalized LF source: entrypoint,
   `deno.json`, shared handler, job-status rules, readiness, history and technician
   Quo-link parser. Preflight v2 already contained the earlier reliability fixes;
   this release adds active-radar rules and explicit AI-use metadata. Function ID:
   `6281626c-9181-4714-b8cf-8956ca98333f`. No other function was redeployed.
3. Publish the CRM separately; verify signed-in Admin/Processor, denied roles,
   reschedules, terminal transitions, technician unassignment/reassignment, several
   jobs in one chat, and live-provider failures. Only the explicitly approved list
   RPC migration was installed remotely: no lead/customer data writes, provider
   invocations, messages or secret changes were performed. Only `processor-board`
   was deployed after the user's additional explicit approval.
4. Run `supabase/tests/153_processor_board_active_radar.sql` **only on an isolated
   test database**; it writes synthetic records and is not production safe. The
   runner below applies each migration twice and checks every PASS/FAIL. Existing
   `150_processor_board.sql` authorization/lease/audit checks still run first.
5. **Live database verification passed:** the updated read-only
   `supabase/tests/151_processor_board_readonly.sql` returned **28 PASS** after
   installation (18 original checks passed beforehand). It verifies caller-scoped
   exact totals, newest-first page order, assigned-only active/history pages,
   terminal exclusion and permitted/excluded roles. The exact
   `supabase/tests/40_leads_rls_baseline.sql` was run before/after; all six role
   matrices matched cell-for-cell. `pg_proc.prosrc` matches the migration body
   exactly. The synthetic write-based 150/153 harnesses were not run on production.
6. **Six non-mutating live Edge smoke checks passed:** preflight 200; missing user
   authorization, invalid JWT, API-key-only and anon-JWT calls 401; unsupported
   method 405. The anon-JWT rejection reaches the handler's `Not signed in.` check.
   v3 logs in the checked 15-minute window contain those six expected HTTP results,
   with no error-severity/runtime-failure entries. This verifies boot/authentication,
   not a real signed-in assessment or Quo/OpenAI credentials. Existing server secrets
   are reused; no new cron, unattended monitor, grants or client/API keys are needed.
   The previous v2 source was saved outside the repository for approved rollback.

```powershell
node scripts/test-processor-board-db.mjs "C:\path\to\pglite-installation"
npm test -- --maxWorkers=1 src/pages/ProcessorBoardPage.test.tsx src/lib/processor-board.test.ts src/lib/processor-board-handler.test.ts src/lib/processor-job-status.test.ts src/hooks/useProcessorBoard.test.tsx src/lib/processor-history.test.ts src/lib/processor-matching.test.ts
npx playwright test --config playwright.operator-workflow.config.ts processor-board.spec.ts
```

Rollback: restore only the `list_processor_jobs` definition/grants from the original
`20261015045700_processor_board_job_assessments.sql` (lines 72–107), redeploy the
previous v2 function and restore the prior CRM. Retain advisory/audit history. There
are no lead writes, schedules or data repairs to reverse.

### Efficiency, diagnostics and verification boundaries

- UI: bounded to the existing 25 rows; dates reuse the existing 30-second clock.
  Saved-status filtering adds no timer, listener, query or provider call. Cache keys,
  fresh skips, failed-only retry, reconnect/polling and the shared realtime bus are
  unchanged. No additional job-history downloads, AI passes or background worker.
- Database/API: exact counts precede the same 25-row evidence join. Assignment and
  unfinished-job filtering occur server-side; creation time is used internally for
  ties and removed from the JSON projection. No speculative index or RLS change.
  Read-only production EXPLAIN of the proposed selection used the existing
  `leads_scheduled_date_idx` and `idx_leads_status`, top-N sort (27 kB), 696 candidate
  rows, no temp writes, 12.132ms execution. This privileged selection-only diagnostic
  is **not** a caller-RLS RPC benchmark or a verified production improvement.
- Before/after workload: Windows local Chromium, same synthetic six-job board,
  mount/filter/drawer actions still require **one list request / zero assessments**;
  the new saved-status filter has the same budget. Explicit repeated unchanged
  checks retain one AI call for two current-history reads. No billing savings or
  production-after performance/health claims; normalized billing evidence unavailable.
- Production read-only diagnostics confirmed the installed RPC still sorts oldest
  first. Last-24-hour logs returned 156 board HTTP 200s and no matching CPU-limit
  events; this is not proof of correct job assessment. Security/performance advisors
  retain unrelated findings (including private/service-only tables without browser
  policies); no authorization was weakened to silence them. Relevant guidance:
  [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
  [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
  [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
- Donut source search found no native board/list RPC/job-level assessment action;
  technician-wide intelligence remains a separate flow. No extension source,
  manifest, release metadata or ZIP changed. Storage/uploads/downloads are not
  affected. No extension release or manual installation is needed for this change.
- Local SQL checks: **45 PASS** (24 original + 21 radar), migrations applied twice.
  Initial focused Vitest run: **87 PASS**. Full lint: zero errors / 28 existing
  warnings. Typechecking and `git diff --check` passed. Initial browser run: 17/18
  passed; the first desktop case timed out in cold `page.goto` before workflow
  assertions. The unchanged full browser rerun passed **18/18**, including desktop,
  mobile, saved-status filtering, failure recovery and all four excluded roles.
  First full-unit run (overlapping build/browser activity): **886 PASS / 2 FAIL**,
  both in the unchanged `AppSidebar.test.tsx` (Admin timeout then missing link).
  All Processor Board tests passed, including the final 15 contract tests. The full
  standalone rerun passed **888/888 tests across 103 files**, including all four
  sidebar tests. No tests/timeouts/configuration were weakened or unrelated sidebar
  work edited.
  Production build passed, including unchanged Donut v1.7.0 source/ZIP integrity;
  existing Browserslist, mixed-import and bundle-size warnings remain. The board
  route is 31.65 kB JS (10.13 kB gzip) and 3.82 kB CSS (0.98 kB gzip).
  The 1440px and 390px checked-job screenshots were inspected: exact check date/time,
  AI-source label, technician identity and schedule are visible without overflow.
  Signed-in production/provider QA and native Deno check remain unverified.

### Boostera release branch verification (2026-10-22)

The user requested a new remote branch and will merge `main` themselves. Release
branch `feat/processor-board-active-radar-2026-10-22` is based on Boostera `main`
`f5a82cb`, not the older dirty development branch. Only 17 Processor Board files
(including its isolated parity section) are included; unrelated original working
changes are preserved. No dependency, extension source or release ZIP changed.

The exact release worktree passed lint (zero errors / 28 existing warnings), app/
node typechecks, **915 unit tests across 104 files**, build including Donut v1.7.0
integrity, and all **18 network-isolated Processor Board browser tests**. The 45
isolated SQL checks also passed from that worktree. These supersede the older
workspace's 888-test count above; Boostera main includes additional existing tests.
Existing Browserslist, mixed-import, large-bundle and optional react-leaflet
prebundle warnings remain. Tests/configuration were not weakened or skipped.

Database migration and Edge v3 are installed as recorded above. Merging the branch
does not constitute signed-in/provider QA or CRM publication; those remain the
user's separate release steps. No Donut installation is needed for this CRM-only
board change.

## Five-row scroll viewport (2026-10-19) — local only

- **Rows in view** defaults to **Show 5**, with 10, 15 and 25 options beside the
  page-status filter. This controls list height, **not** the server page size:
  all matching jobs from the existing 25-job page remain mounted and reachable
  by scrolling. The exact total, pagination, page-local status counts and AI
  refresh scope are unchanged. A matching-job count and scroll hint distinguish
  filtered matches from the footer's source-page range.
- Desktop height measures through the selected last row, including wrapped
  setup/failure explanations; no fixed row height, line clamping or data slicing
  hides details. One scroll owner supports both axes, with opaque sticky headings.
  Mobile cards share the selector and internal scrolling, capped at 70vh so the
  list remains screen-sized. On smaller screens fewer than five cards can fit.
- Each scroll area is labelled and keyboard-focusable. End/Page Down can reach
  later jobs, including their evidence drawer. Filter/search/page/history/timezone
  or row-limit changes reset to the top; ordinary refreshes preserve scroll.
  Resize observation recalculates height for wrapping and viewport changes, and
  every observer/fallback listener is cleaned up on unmount.
- This is CRM-only: Donut still has no native board, and its sources/release/ZIP
  remain unchanged. No SQL, RPC, function, types, lead permissions, approvals,
  schedules, realtime transport or polling changed. No migration or function
  deployment is required; CRM publication and real signed-in QA remain separate.

### Efficiency and verification

Affected layers: UI/rendering and scoped lazy-route CSS. At most 25 existing rows
are inspected, using two geometry reads per mounted viewport measurement (not one
per row), one ResizeObserver per viewport (desktop and mobile, at most two mounted),
no new timer/scroll listener and no redundant identical height-style writes.
The resize-listener fallback and observer cleanup are regression-tested. No
observer is recreated for an unchanged-data refresh. Hooks/cache, API payloads,
database queries/RLS/indexes, realtime, background jobs, storage/bandwidth outside
these small assets, and the Donut counterpart are unchanged/not applicable.

Reproducible comparison: same Windows local Vite build and network-isolated
Chromium workload with six synthetic jobs. Before: all six desktop rows expanded
the page. After: five visible rows, with the sixth reachable by internal keyboard
scroll and Show 10 expanding all six. Both workloads retain **one list request,
zero assessment requests** for mount, filtering, row-count changes and opening
the drawer. A separate unit regression verifies that page AI refresh still checks
**all six eligible jobs**, not only the five in view. No query/billing reduction
is claimed. Route JS is **27.94 → 29.99 kB** (**8.99 → 9.61 kB gzip**); scoped CSS
is **3.21 → 3.82 kB** (**0.80 → 0.98 kB gzip**). Production usage, normalized billing
and health-after evidence remain unavailable.

Focused tests: **42 passed**, including viewport measurement, unchanged-write
avoidance, refresh scroll retention, scope reset, resize recovery and cleanup.
All **16 network-isolated browser tests passed**, including actual five-row bounds,
sticky headings after End, later-job review, selector expansion, filter reset and
bounded mobile scrolling. Desktop/mobile screenshots were inspected. Full lint
passed with zero errors/28 existing warnings; typecheck and build (including Donut
v1.7.0 integrity) passed. Existing Browserslist/bundle warnings remain. The new
full-unit-suite run is in the background and **pending**. The user authorized
committing/pushing this follow-up to `boostera385-afk/marshmallow-crm`, branch
`feat/processor-compact-board`, and will publish the CRM separately. No production
mutation, migration application, backend deployment or CRM publication was
performed by the agent for this follow-up.

```sh
npm test -- --maxWorkers=1 src/components/processor-board/ProcessorJobViewport.test.tsx src/pages/ProcessorBoardPage.test.tsx src/hooks/useProcessorBoard.test.tsx src/lib/processor-board.test.ts
npx playwright test --config playwright.operator-workflow.config.ts processor-board.spec.ts
```

## Leads-style color and motion polish (2026-10-19) — local only

- The compact queue now reuses the Leads page's rounded glass surface, a slim
  blue/cyan gradient titlebar, inset search toolbar and highlighted AI button.
  Page-local action chips have amber/blue/green/red tints, numeric count capsules
  and a distinct selected ring. Advisory badges retain their existing labels and
  palette. Rows/mobile cards add matching left-edge accents and subtle tints;
  text labels remain present so color is never the only indicator.
- Color is derived from the **displayed** advisory state, including Unavailable
  after a failed check and Needs Review for incomplete jobs. It does not change
  saved statuses, severity, schedules, approvals, backend outcomes or visibility.
  Last-check timestamps remain above statuses on both screen sizes and the drawer.
- One entrance animation uses the existing `pageVariants` (250ms); filters lift
  1px on hover and row/review feedback uses short transitions. There are no idle
  loops, staggered row mounts, animated layout measurements, per-row timers or
  animations restarted by polling. OS reduced-motion preference skips the panel
  entrance and disables board/drawer animation, transitions and hover movement.
  Loading/progress text stays available even when spinner motion is disabled.
- Styles live in `src/pages/ProcessorBoardPage.css`, scoped to the board and its
  portalled drawer; shared CSS/components are unchanged. Light/dark text contrast,
  keyboard filter toggling and mobile overflow are covered with synthetic data.
  There is still no native Donut Processor Board (source search reconfirmed), so
  no extension source, manifest, release metadata or ZIP change is required.

### Efficiency review and local verification

Affected: UI/rendering and a small lazy-route stylesheet. Reuses existing Framer
Motion, theme/status tokens and the single UI clock, with no dependency change.
Unchanged/not applicable: hooks/cache, API projections and calls, database queries/
RLS/indexes, generated types, realtime/polling, background jobs, storage/uploads,
and Donut downloads. No backend deployment or database migration is needed for
this presentation change. The earlier reliability deployment remains separate.

Reproducible comparison: Windows local Vite production builds plus the same
network-isolated Chromium board tests. Relative to the preceding compact-view
build, route JS is **26.89 → 27.94 kB** (**8.72 → 8.99 kB gzip**); the scoped lazy
CSS is **3.21 kB / 0.80 kB gzip**. This is a small visual-asset increase, not a
claimed bundle reduction. One mount/filter/hover/review-drawer workload still
performs **one list request and zero assessments**, including six synthetic jobs
in both themes and desktop-to-mobile resize. Existing explicit single review and
failed-only retry/fresh-skip resource assertions still pass. No provider/billing
or normalized production-after health evidence is available; no savings claimed.

Reproduce with the focused Vitest and Playwright commands in the compact-view
section below. **38 focused tests and all 14 network-isolated browser tests passed**;
1366px light/dark and 390px screenshots were inspected. Full lint passed with
zero errors/28 existing warnings; typecheck and production build passed, including
unchanged Donut v1.7.0 ZIP integrity. Existing Browserslist/bundle warnings remain.
The first full unit run had **802 passes and two failures** in the unchanged
sidebar file (an Admin test timeout followed by a missing-link failure); all four
sidebar tests passed in isolation. The subsequent full-suite rerun passed all
**804 tests across 94 files**, including the sidebar file. No timeout,
assertion, skip or configuration was weakened. No production mutation or CRM
publication has been performed for this visual follow-up; real signed-in/provider
QA remains separate. The user subsequently authorized code publication to
`boostera385-afk/marshmallow-crm`, branch `feat/processor-compact-board`, credited
to `kaash0542@gmail.com`. Pushing this branch does not merge or deploy the CRM.

## Compact queue presentation (2026-10-19) — local only

- Replaces the large hero and four standalone count cards with one compact table
  panel and four keyboard-accessible toggle chips. Service and Area are separate
  columns, with technician identity, job ID and saved status grouped under the
  customer. Mobile retains labelled cards and now shows terms as well.
- Each job's saved check time appears **above** its advisory status, also in the
  drawer. A semantic time element exposes the exact timestamp in the selected
  timezone. Relative times reuse the existing 30-second UI clock; there is no new
  timer. Unchecked jobs say Not checked yet. Expired evidence, changed records,
  changed timezone, invalidated history and failed retries show Previous check,
  never a false fresh-success indicator. The header shows the latest persisted
  check **on this page**, separately from the board-read time.
- Setup/failure explanations remain visible. Expanded help explains timezone,
  freshness, page-local filtering and manual call review. Existing exact totals,
  25-job pagination, permissions, approval gates, schedules and review controls
  are unchanged. No database, Edge Function or generated-type changes were made;
  no migration application or function deployment is required for this layout.
  The earlier reliability follow-up below remains a separate deployment item.
- Donut has no native job board/job-assessment flow; its sources, v1.7.0 metadata
  and ZIP remain unchanged. CRM publication and real signed-in/provider QA remain
  separate steps, not outcomes of local mocked browser tests.

### Efficiency and regression review

Comparison: local Windows React/Vitest and network-isolated Chromium, synthetic
scheduled job, the same existing list/review contract. Before: three top-level
sections (hero, four large count cards, queue); after: one queue panel with four
inline chips. This reduces presentation overhead, not queue data or requirements.
Opening the page still makes **zero assessment requests**. Explicit review makes
one assessment request; a failed review, successful retry and fresh page refresh
still make **two**, not three. Reproduce with:

```sh
npm test -- --maxWorkers=1 src/pages/ProcessorBoardPage.test.tsx src/hooks/useProcessorBoard.test.tsx src/lib/processor-board.test.ts
npx playwright test --config playwright.operator-workflow.config.ts processor-board.spec.ts
```

UI/rendering is the affected layer; timestamp calculation is bounded to the
existing maximum 25 loaded jobs and reuses the UI clock. Hooks/cache, API payloads,
database queries/RLS/indexes, realtime/subscriptions and polling are unchanged.
Background jobs, storage/uploads and Donut downloads are not applicable. No new
reads, writes or provider calls are introduced for the timestamps/chips. No
production latency, normalized usage, billing or health-after evidence is
available; no invoice savings are claimed. Regression coverage checks column
order, exact/page counts, timestamp placement, stale/failure states, denied roles,
setup recovery, retries and request counts at desktop/mobile widths.

Final local validation: **803 tests across 94 files passed** with the full suite
run alone, including all 22 page tests and the existing hook/resource tests.
All **11 network-isolated browser tests** passed on the final source, and 1440px/
390px screenshots were inspected; check times sit above statuses with no page
overflow. Full lint passed with zero errors/28 existing warnings; changed-file
lint, app/node typecheck, build (including unchanged Donut ZIP integrity) and
`git diff --check` passed. Existing Browserslist/bundle warnings remain. The first
browser run timed out during cold dev-server navigation; the complete rerun and
final-source run both passed without changing timeouts or test configuration.
An initial new unit assertion queried the background table while the modal had
correctly hidden it from accessibility; the test now closes the modal before
checking the row. No behavior assertion was removed or skipped. Real signed-in
production/provider QA, CRM publication and the earlier backend reliability
deployment remain unverified/unperformed; no production mutation was made.

## Reliability follow-up (2026-10-15) — awaiting deployment/publication

The source changes below are **local only**. The installed migration is unchanged;
the earlier v1 deployment verification is historical and does not verify this
follow-up. Obtain separate approval to redeploy `processor-board` (include the new
`_shared/processor-review.ts` dependency), then publish the CRM separately. Do not
reapply the migration or regenerate unchanged database types for this update.

### Confirmed findings and recovery

- Read-only production logs for the previous 24 hours included three HTTP 546
  responses and five `CPU Time exceeded` events for this function, alongside three
  HTTP 422 setup rejections. These are aggregate observations, not proof of the
  cause of every individual failed row. No transcripts, credentials or provider
  bodies were retrieved/logged, and no real provider assessment was invoked.
- A limited read-only check of the eight reported job IDs found two with invalid
  or missing technician numbers and missing structured schedules; a third also
  lacked its schedule and a matching technician-directory row. The five other
  jobs had valid numbers and linked directory entries. No customer data was repaired
  or guessed. Users must save the agreed schedule/technician details through the
  existing authorized workflow, or verify the directory's saved Quo link.
- The long-chat hot path rebuilt every peer's normalized identity repeatedly per
  message and again for the displayed match count. It now compiles a **per-review**
  identity index, filters history once, reuses the match count and index for quote
  verification, and looks up evidence message IDs through a map. No cross-request
  history/identity cache, shortened history, looser matching or generic-reply inference
  was introduced. Quo/OpenAI still receive independent, job-specific reviews.
- Both UI and backend preflight reject missing technician numbers or agreed date/
  start time before conversation reads, leases or provider requests. Incomplete jobs
  stay visible as Needs Review with the saved status, explanation and saved-lead link.
  Closed/approval-workflow jobs remain read-only. Server preflight is not a replacement
  for caller JWT, role, lead RLS or independent status-visibility checks.
- Rows and the evidence drawer expose failure/recovery details rather than a generic
  “Review failed” caption. Safe structured errors distinguish provider availability,
  credentials, timeouts, invalid/truncated AI output, limits and chat setup; HTTP 546
  gets a specific resource-limit explanation even for a generic gateway body.
- Page filters now include setup, unavailable and remaining advisory states. Counts
  and filters explicitly remain page-local; exact queue totals and full pagination
  are unchanged. Desktop/mobile show saved status separately and readable terms.
- Retry failed checks only retryable failed jobs. Page refresh skips current evidence
  within the existing five-minute freshness window; explicit single-job checks still
  request current history. Successful results update the caller/role/filter cache
  immediately, with a final invalidation scoped to that caller/role. A completely
  skipped batch does not trigger an extra board request. Errors retire on record
  revision/timezone changes, and role/caller changes remount local state.
- Batch progress identifies the current job; Stop after current job preserves its
  result and prevents remaining requests. No unattended or automatic retries were
  added. Existing refresh guards, leases, audited atomic save, revision checks,
  30-second polling and shared realtime reconnect/coalescing behavior remain intact.

### Efficiency review and reproducible verification

- Reproduce the synthetic comparison with
  `npm test -- --maxWorkers=1 src/lib/processor-matching.test.ts`.
  Windows local Vitest/Node, **60 peer jobs / 360 messages**, same target and inputs:
  baseline **718.4ms / 66,960 identity reads**, optimized **4.5ms / 60 identity reads**.
  All outcomes matched; 10,000 additional optimized events also preserve peer
  exclusion without additional identity normalization. Timings are observations,
  not test thresholds or production latency claims. The regression asserts resource
  work and results instead of relying on flaky wall-clock assertions.
- UI/hooks/cache: no added polling/subscriptions; fewer assessments for setup/fresh
  jobs and failed-only retries. Isolated browser checks confirm a failed review,
  successful retry and immediate page refresh make **two**, not three, assess calls.
- API/database: peer reads project six identity columns rather than the complete
  twelve-column review projection. Caller scoping, pagination, hashes, all history
  events, saved evidence and exact totals remain complete. No SQL, indexes, policies,
  grants, enums or generated types changed. No database tuning/cost claim is made.
- Realtime/background jobs/storage/bandwidth: existing bus, polling and recovery
  unchanged; no new worker, upload, transcript log or download artifact. Repeated
  explicit checks for different jobs sharing a technician still retrieve their
  required current history independently; this update does not claim to deduplicate
  those provider-history requests. Donut has no native Processor Board counterpart;
  extension source/release assets remain unchanged.
- Focused verification: **67 Vitest tests** and **11 network-isolated Playwright
  desktop/mobile/denied-role checks** passed, including incomplete jobs, failed-only
  recovery, fresh-result request avoidance, stop behavior and changed-record recovery.
  Typecheck, changed-file lint and build (including extension integrity) passed.
  Full lint passed with zero errors and 28 existing warnings. Screenshots were
  inspected at 1440px and 390px; no horizontal page overflow was observed.
- Full-suite verification: **767 tests across 93 files passed** with
  `npm test -- --maxWorkers=1` run alone. The first run overlapped with the build
  and had 764 passes plus three failures in unchanged sidebar/technician-workflow
  timing/recovery tests; all passed on the standalone full-suite rerun. No assertions,
  timeouts, skips, configuration or unrelated source files were changed to obtain
  that result. The overlapping-run failures remain recorded, not concealed.
- Read-only security/performance advisors were reviewed. Existing warnings are
  outside this change; the service-only refresh-lock table intentionally has no
  browser policy ([advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).
  No schema/authorization changes were made to silence advisors.
- Native Deno check, deployment and signed-in/live-provider QA remain outstanding.
  No production write-based harness, secret change, ingestion change, customer
  message, migration application or CRM publication was performed. Billing and
  production-after health evidence are unavailable; no invoice savings are claimed.
- Rollback: redeploy the previously reviewed v1 function and restore the prior CRM
  release; preserve all advisory/audit rows. No database rollback is necessary.

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
