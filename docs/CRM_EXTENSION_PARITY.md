# CRM / Donut parity contract

Every shared fix must update both clients, use the same authenticated backend,
and include behavior tests. `AGENTS.md` and `GEMINI.md` make this mandatory.

| Flow | CRM | Donut | Shared authority / verification |
| --- | --- | --- | --- |
| Technician intelligence | Technicians → Processing Workflow; map selection up to 8 | Native Technician Intelligence panel for the captured phone, reviewed-label saving, full-workflow link for batch selection/flag approvals/chat actions | `technician-chat-assessment`: Admin/Processor only; identical AI prompt, evidence checks, counts and labels. Missing history is unavailable, not misconduct. |
| Processor Board | `/processor-board`: assigned-job radar, newest schedules first, four advisory actions, saved-status filters, exact check date/time, explicit AI-versus-rule labels and timezone-confirmed open-board tracking; job-dispatch context attribution and a pinned read-only internal CRM chat viewer | No native scheduled-job board/job-specific assessment action; existing technician-wide intelligence is separate. Donut sources and v1.7.0 artifacts unchanged | Authenticated `processor-board` **v6 ACTIVE**, JWT verification retained and all nine source files read back exactly. Caller-token scope, leases, revision-checked advisory save and atomic audit preserved. No new migration, lead/status/approval writes or messages. New internal-chat UI still needs CRM Publish; signed-in/provider QA is separate. See `docs/PROCESSOR_BOARD_ROLLOUT.md`. |
| Technician flags | Admin applies; Processor requests review | Opens full workflow for the same reviewed actions | Existing `request_technician_change` approval RPC and technician flag trigger; never write flags directly in Donut. |
| Urgent lead review | Latest customer agreement, corrections and missing details | Same check; displays issues, corrections and flags; opens saved-lead review for confirmed corrections/approval | `check-urgent-lead`, urgent verification/review RPCs and database status gate. No duplicate prompt or approval bypass. |
| Address lookup / map coordinates | Authenticated Census-only lookup and preserved units | Same function for Find Address, coverage preview and submission coordinates | `geocode-lead-address`: only Census coordinates may be cached/persisted for the free map. Google or unlabelled points are rejected by both clients. Preserve Apt/Suite/Unit/#. |
| Lead submission | Saves stored record before AI follow-up; mutation errors distinguished from follow-up errors | In-flight guard, reserved job ID through acknowledgement, uncertain retries reuse ID; draft cleanup does not redefine a saved lead as failed | Existing unique lead job ID and RLS. Selected photo-upload failures are reported explicitly. |
| Coverage | Admin coverage/source analytics; map and lead coverage badges | Intake coverage preview; Admin link to the full coverage analytics report | Existing coverage RPC/lead columns/trigger. Technician phone and status counts use actual stored data. |
| Photos | Explicit View N photos beside combined-image copy on saved cards/details, with the existing image viewer and original-file technician handoff | Intake thumbnails already open the native previous/next/close photo preview; original-file attachment handoff to exact technician chat | Authenticated signed storage URLs for saved CRM photos; view never copies or sends. Donut's existing native preview is unchanged (no ZIP release needed). User's Quo Send action completes delivery. |
| Complete lead details copy | Lead cards, OPR cards, tables and both detail views; one Admin-managed per-user Copy Details switch after Manual Lead in Feature Access, with no duplicate role/default panel or override dropdown. Original default-enabled behavior (including both Operator roles) and all saved role/user grants are preserved until that user is toggled | No equivalent clipboard action or Admin permission editor in native intake panel; no extension source change required | `get_lead_copy_access` resolves the authenticated caller; each switch calls admin-only `set_lead_copy_permission(NULL,user_id,boolean)`, never navigation/profile writes. Existing RLS, audit and Admin-always-allowed rules remain unchanged. Copies only loaded, visible details; hidden OPR quotes stay blank. No migration or backend deployment is required. |
| Feature Access settings usability | Full desktop per-user table with contained scrolling, sticky user identity/headings and user/role/feature filters; Copy Details is the last switch immediately after Manual Lead and is searchable by Copy All Details or Copy Complete Details. Narrow screens use the same labelled switch; Copilot controls stay removed | No native admin permission editor in Donut; no extension source change required | Existing navigation/profile writes and copy permission RPCs remain the authority. Fixed gates and failure/retry handling remain; permission-read failures disable the copy switch rather than advertise an unverified default. Duplicate-save guard and existing query-key invalidations synchronize both layouts. No bulk grants, data repair or new subscriptions. |
| Marshmallow Copilot | Paused pending testing: header, command-menu, provider and Feature Access mounts removed locally; full per-user feature table restored | No native Copilot or Admin permission editor in Donut; extension source and v1.7.0 artifacts unchanged. Existing technician intelligence and urgent review remain distinct | Database pause installed via approved MCP as `20261019113029 / pause_marshmallow_copilot`; nine production-safe checks pass and six-role lead visibility plus existing grants/budgets are unchanged. The constraint prevents stale Admin re-enablement. Local function release gate (`503 copilot_paused` before CRM/budget/provider work) is **awaiting approved deployment**; CRM Publish remains separate. See the current section in `docs/COPILOT_ROLLOUT.md`. |
| Operator hold alerts | All OPR/OPR Admin users receive a Marshmallow-themed, expandable read-only card and persistent bell history when an urgent job becomes Ready to Schedule, Waiting for CX for schedule confirmation, Scheduled or Cancelled. Newer hold cards stack above older cards instead of overlapping; pending urgent cancellations are remembered until final cancellation | No native Operator notification inbox or map filter controls in Donut; no extension source change required | One database trigger handles saved transitions from any client; recipient-only `lead_hold_alerts` RLS, server-owned field-whitelisted snapshots with hidden quotes redacted, revision-checked acknowledgement RPC. Existing lead/status approval gates remain unchanged. See `docs/OPERATOR_WORKFLOW_ROLLOUT.md`. |
| CX / Tech Updates | Processor/Admin request CX updates; assigned CS (creator only when unassigned) and CS Admin see every pending CX request. CS/CS Admin request Tech updates; Admin/Processor see the queue and Processor records the reply. Both update queues stay visible to all four participating roles, with role-scoped unresolved counts, so CS/CS Admin can review returned Tech answers just as Processor/Admin review returned CX answers. Returned answers support Acknowledge or Question More with preserved thread history. Buttons are aligned on saved cards, full details and the lead drawer. | No native saved-lead request/completion queue in Donut; intake/status submission is not a counterpart. Extension source and v1.7.0 ZIP remain unchanged. | Authenticated `cx-update-requests` function proxies caller-JWT `update_requests`; request-table RLS, fixed role gates, whitelisted projections, per-kind pending uniqueness, stable retry IDs, atomic audit/notifications. No lead status, schedule, full-lead RLS or approval changes. Apply `20261121001000_fix_update_request_notification_uuid.sql` after the Tech Update migration to repair reported SQLSTATE 42804; shared-project application remains a separate approved operation. |
| Map service/state filters | Responsive paired filters, non-shrinking grid widths, clipped long labels, collision-aware menus; Leaflet stays in its own stacking context | No equivalent map toolbar in native intake panel | UI-only layout change. No coordinate-provider, coverage, permission or storage changes. |
| Release updates | Latest/installed version, date/time, automatic notice and ZIP instructions | Installed version/date, update notice in panel/settings | `extension-release.json`, bundled `release.json`, manifest and version-correlated bridge. |
| Notification refresh efficiency | Bell and eligible urgent, job-in-progress, incomplete-details and quote-updated popups share one recipient-filtered channel through `realtimeBus`; same-turn refreshes coalesce and in-flight changes get a trailing read | No native notification bell or these popup consumers in Donut; no extension source change required | Existing notification RLS, recipient filters, OPR assignment scope, exact bell counts, per-popup 100-row limits, quote cutoff, sounds, priority, acknowledgement writes and 15/20/25-second polling are preserved. Late retired subscriptions/results cannot affect a replacement scope. No new RPC or production configuration. |
| Request resolution / notification center / schedule monitor (2026-10-20; not installed) | Requester-owned Mark Resolved, audited Admin reassignment, revision-safe follow-ups/history; recipient notification history, sound controls and five-second notices. Off-by-default, shadow-first schedule monitor with Admin-verified bindings and trusted service-ingestion snapshots | No native saved-request queue, notification center or monitor. Extension source/manifest/ZIP unchanged; shared server ingestion and lead triggers cover both clients | Caller-authenticated request authority, server-owned event metadata and current-access notification RLS; separate cron-secret worker with SQL evidence/authorization guards. Both migrations are held at the user's coordinated-release decision: applying the revision-required legacy wrapper alone breaks old clients. Generated types, three function deployments, secrets/cron setup, CRM Publish, signed-in/provider QA and automatic activation remain pending. See `docs/WORKFLOW_INBOX_ROLLOUT.md`. |

Historical pilot notes (superseded locally by the 2026-10-19 pause below):
Copilot Admin AI controls are CRM-only. Global AI applies to all allowed Copilot
users; there is no separate per-user AI permission. The 2026-10-13 audit fixed
unsaved AI/configuration drafts resetting after permission refreshes and verified
Admin authorization and AI limits with isolated regression tests. No extension
source/release change is required; see `docs/COPILOT_ROLLOUT.md` for publication
and live-provider verification boundaries.

The `pilot` enhancement remains CRM-only: saved-vs-draft AI state, checked config
saves, Admin readiness/confirmed provider test, conversational search refinements,
saved lead/daily work briefs, consented message drafting and expanded workspace.
Minimize/restore is also CRM-only and preserves the in-memory session while exposing
the underlying CRM page; closing still clears it. No native Donut assistant exists.
It never executes urgent/technician assessments in a parallel implementation:
existing authorized workflows are opened for those actions. No Donut source,
prompt, manifest or ZIP changed. With user approval, the pilot RPC migration and
Copilot function v2 were installed via MCP on 2026-10-14; generated types were
refreshed. CRM publication and real signed-in/provider QA remain separate pending
steps; see the latest audit in `docs/COPILOT_ROLLOUT.md` before publishing.

## Processor Board internal CRM chat (2026-10-22; frontend publication pending)

The board now reuses CRM Tech Quick Chat in pinned read-only mode instead of
launching the external Quo site. It reads only the verified CRM UUID and exact
technician/line, retains the separate chat grant and existing authenticated RLS,
and fails visibly rather than choosing a customer/newest chat. No extension
prepare/send/schedule or outbound write occurs. One viewer mounts on click;
hidden-trigger unread work is skipped, paginated history is complete up to an
explicit 10,000-row error boundary, and scope/identity/permission changes retire it.
General lead Quick Chat sending behavior is unchanged. No Donut board/viewer
counterpart exists, so no extension source, version or ZIP release is required.
The user explicitly approved backend deployment; v6 is now ACTIVE with JWT enabled
and all nine files verified against local source. Local gates passed 998 unit tests,
29 mocked browser tests, typecheck, lint (0 errors/28 existing warnings) and build.
See the newest rollout section for remaining CRM Publish/live QA steps.

## Processor Board saved-chat context attribution (2026-10-22; Edge v6 installed)

CRM-only: source audit reconfirmed no Donut Processor Board/job-specific assessment
counterpart. The separate `technician-chat-assessment` intelligence flow is unchanged;
no extension source, prompt, manifest, release metadata or ZIP was modified.

The board reads the same verified technician conversation opened by the lead's
Tech Quick Chat (current Quo text history when configured; the webhook mirror
otherwise). It does not use the separate CX chat as technician evidence or invent
a per-lead technician thread: several jobs share one technician's 1:1 conversation.

Directly identified replies remain supported. Unnamed replies are context-attributed
only after this job's delivered, job-identifying dispatch in the same conversation,
strictly later than the dispatch and within seven days. A peer/unknown dispatch or
a technician switching to another identified job ends that context. The drawer
labels `thread_context` evidence and requires human verification in Quo; call events,
transcripts, reactions and media are excluded as text evidence even if selected by
the model. Short replies must be quoted in full inside verified context. Acceptance
alone is not progress/completion; context-only acceptance cannot enable Send Dose.

Page/batch reply counts use attribution, not the number of extracted outcomes, so
an acknowledgement is not misleadingly reported as zero replies. Pure dispatches
still skip AI; changed context invalidates extraction reuse. Existing authorization,
status/approval gates, schedules, serial requests, realtime, freshness and retries
remain. No additional reads, feeds, workers or schema changes were introduced;
more legitimate replies can now qualify for the existing single extraction call.
No production usage or bill savings are claimed.

The user separately approved backend deployment after committing/pushing the
attribution follow-up. See the newest rollout section for installed release state.
CRM merge/Publish, confirmed schedule
timezone, verified correction of three malformed technician numbers and live
signed-in/provider accuracy checks are separate. See the newest section of
`docs/PROCESSOR_BOARD_ROLLOUT.md` for the actual test results and remaining limits.
Publish the matching frontend before deploying the new Edge source: old frontends
may reject `thread_context` or mislabel contextual completion as directly verified.
Do not treat approval to push a branch as approval or proof of CRM publication.

## Processor Board evidence accuracy follow-up (2026-10-22; Edge v5 installed)

CRM-only; no native Donut job board/job-specific assessment counterpart was found.
No extension source, prompt, metadata or ZIP changed. The new follow-up separates
successful checks from verified technician updates, surfaces unassigned reply counts
and opens only the exact verified chat for manual review. Equivalent complete
street/unit spellings and exact factual spans from the same uniquely identified
source message are supported; generic replies never inherit a neighboring job's
identity. Dispatch-only history avoids pointless extraction while all history still
checks silence timing. Tracking state is explicit; both manual and automatic checks
require timezone confirmation, and unconfirmed schedule rules remain Needs Review.
The existing Schedule page has no authoritative saved-job timezone to adopt.

No schema/type/RLS/grant/worker change. The user approved deployment/push; the
nine-file function bundle is **v5 ACTIVE** (JWT verification preserved, all deployed
files verified against tested source; prior v4 backed up outside the repo), and the
branch `fix/processor-board-evidence-accuracy-2026-10-22` is pushed. CRM publication
and merging are the user's next steps. Three malformed phone numbers and ambiguous
real replies still need verified human information. See the rollout's newest section
for the measured read-only diagnostic, synthetic tests, release status and
efficiency boundaries.

## Processor Board open-board tracking (2026-10-22; Edge v4 installed, CRM pending)

No native Donut board/job-specific assessment was found; its technician-wide
intelligence is not this flow. No extension source, prompt, manifest, metadata or
ZIP changed. After explicit timezone confirmation, the CRM automatically reviews
the loaded page (up to 25 jobs), pauses when hidden/closed and reuses five-minute
freshness with retry backoff. A missing directory link can use one exact-number
saved Technician Communications conversation; conflicting identity remains blocked.
Active approval/customer/reschedule jobs can be checked for advisory evidence, never
approved or mutated. Labels distinguish AI findings from saved status/schedule rules.
The backend adds batched readiness metadata and reuses extraction when only another
job's messages change, while rereading current history for silence timing.

No new migration/type/grant/worker is needed. With explicit user approval, the
changed function, including new `_shared/processor-chat.ts`, is **v4 ACTIVE** with
JWT verification preserved; all eight files match and six non-mutating auth/runtime
checks passed. Local gates passed: 950 unit tests, 21 browser tests, lint (28 existing
warnings), typechecks and build. CRM publication and live-provider/real-job accuracy checks remain
separate. Three malformed technician numbers need verified corrections. See the
rollout's newest section for scope, resource comparisons and remaining checks.

## Processor Board active-radar audit (2026-10-22; database/Edge installed)

Existing CRM interface retained. New migration sorts newest appointments before
pagination, excludes unassigned jobs before counts and keeps assigned dated
unfinished statuses on radar; terminal jobs are history-only. Saved-status filters
are page-local. Exact check date/time/timezone and explicit AI-used versus rule-only
labels replace ambiguity without new polling/provider work. Missing target-job
updates cannot regress saved progress/payment states. Approval workflows remain
read-only; AI remains advisory and on demand. No NSS status/tag was found, so none
was fabricated. See the newest `docs/PROCESSOR_BOARD_ROLLOUT.md` section for tests,
efficiency review, diagnostics and rollback.

Donut has no native board/job assessment counterpart; extension sources/release/ZIP
unchanged. With explicit user approval, MCP installed the exact
`20261022041621_processor_board_active_radar.sql` on `kxiqholnmhkwhdkhtopp`, recording
`20261022044310 / processor_board_active_radar`. All 28 read-only production checks
passed, the installed RPC body matches the file and the six-role lead visibility
baseline is unchanged. Do not reapply or repair history. With additional explicit
approval, MCP deployed `processor-board` **v3 ACTIVE** with JWT verification kept
enabled. All seven source files match and six live non-mutating auth/runtime smoke
checks passed. No secrets, ingestion settings, customer data or messages changed.
CRM merge/Publish and signed-in/provider QA remain **separate pending release
steps**. Existing grants, lead RLS, API signatures and generated types are unchanged.

## Processor Board reliability follow-up (2026-10-15; local only)

CRM-only: compiled per-review job matching, shared UI/backend readiness checks,
actionable row errors, failed-only retry, page-local setup/status filters, fresh
evidence skipping and stoppable progress. No native Donut job board or job-level
assessment exists; technician-wide intelligence remains separate. No extension
source, prompt, manifest, release metadata or ZIP changed. Existing authorization,
approvals, schedules and job attribution rules remain intact. The changed
`processor-board` backend (including new `_shared/processor-review.ts`) is **awaiting
approved deployment**; CRM publication and live-provider QA are separate steps.
The installed migration/types are unchanged. See `docs/PROCESSOR_BOARD_ROLLOUT.md`
for read-only findings, synthetic before/after measurements and verification.

### Compact Processor Board view (2026-10-19; local only)

The CRM board now follows the compact urgent-leads table pattern: one panel with
inline refresh controls, page-local action-count chips, separate Service/Area
columns, and technician identity grouped with the customer/job. Last-check time
appears above each advisory status on desktop, mobile and the evidence drawer;
stale/invalidated evidence and failed retries say Previous check. The header's
latest check is explicitly scoped to the loaded page, not the whole queue. Exact
totals, pagination, saved status, error recovery and the role gates are unchanged.

No native Processor Board exists in Donut (confirmed by source search), so no
extension source, manifest, metadata or ZIP changed. This is presentation-only:
no SQL, RPC, function, generated-type or production change is needed. The earlier
local backend reliability follow-up still requires its separately approved
deployment; this UI change does not deploy it. See the rollout document for
verification and efficiency boundaries.

The subsequent Leads-style color/motion polish is also CRM-only: gradient/glass
header and toolbar, tinted advisory chips, matching row/card accents, a single
short page entrance and hover feedback. Text labels and selected-state rings are
retained; reduced-motion mode disables board/drawer motion. Existing data reads,
AI requests, check freshness, role gates and workflows are unchanged. No native
Donut board was found; no extension source/release asset or backend schema/function
changed. The scoped stylesheet, synthetic light/dark/mobile checks and resource
comparison are recorded in `docs/PROCESSOR_BOARD_ROLLOUT.md`. This follow-up is
local, not a claim of publication or backend deployment.

The follow-up **Rows in view** selector defaults to five rows (10/15/25 optional),
with internal desktop/mobile scrolling and sticky desktop headings. It changes
viewport height only, not the existing 25-job page, exact totals, filtered matches
or page-level AI scope. Later jobs remain reachable with keyboard scrolling and
their evidence drawers; refresh preserves scroll while explicit scope changes
reset it. Mobile height is capped to the screen. This is also CRM-only with no
native Donut counterpart; no backend, schema, extension source/release asset,
permission or schedule change is needed. See the rollout document's synthetic
resource comparison and verification boundaries.

## Copilot feature/role catalogue audit (2026-10-15)

Copilot now describes all 21 current CRM navigation sections, including Processor
Board (Admin/Processor), both CX/Tech queues (Admin/Processor/CS Admin/Customer
Service), and independently granted customer/technician Quickchat. It also explains
the header's Donut version/ZIP controls and manual installation; it never assumes
an installed version, sends photos/messages, or runs assessments. Fixed gates cannot
be widened by a navigation switch. Existing Copilot opt-in grants are unchanged.
Settings feature search recognizes the queue names and Processor Board aliases.

No native Copilot, Processor Board, or saved-lead update queue exists in Donut.
Existing Quickchat/photo handoff is only explained, not changed. There is no shared
runtime change to port: extension sources, manifest, metadata and ZIP are unchanged.
The Copilot-only migration was applied by approved MCP as
`20261015063130 / copilot_current_feature_access`; `marshmallow-copilot` v6 is
ACTIVE and all five deployed files matched local source. Existing function-level
`auth.getUser()` authentication and gateway `verify_jwt=false` were preserved from
live v5. CRM publication/signed-in QA remain separate. This does not deploy the
earlier local Processor Board reliability changes. See `docs/COPILOT_ROLLOUT.md`.

## Release verification checklist

The 2026-10-17 access/attention patch is also CRM-only: explicit global-disable
confirmation, unsaved-toggle guidance, visible individual Allow overrides,
cross-tab invalidation/shorter access polling, and persistent Needs attention for
authorized Admin/CS Admin callers. Existing RPC/RLS semantics and the newer live
backend are unchanged. There is no Donut counterpart and no extension release is
needed. See the latest entry in `docs/COPILOT_ROLLOUT.md` for verification limits.

1. Test each changed flow on both surfaces and an excluded role.
2. Run Vitest, changed-file lint, app typecheck and the production build.
3. Verify backend source against deployed versions, and deploy changed functions.
4. If a schema migration is required, write idempotent SQL with rollback and ask
   the user to apply it manually; never push/reset the shared database.
5. Run `npm run extension:release -- <higher-version> "Release notes"`, commit
   generated metadata/manifest/ZIP, then run `npm run extension:check`.
6. State what still needs API credentials, live QA, CRM Publish, or manual ZIP reload.
    A test/build/HTTP 200 is not proof that every reported business task works.

## Get CX Update rollout (2026-10-13)

### Tech Update / Question More extension (awaiting installation)

- `20261120001000_tech_update_requests_and_followups.sql` extends the existing
  request table without changing `leads`. CS/CS Admin create Tech requests;
  Processor completes them; Admin monitors pending work. The original CX direction
  remains intact and CS Admin continues to receive every pending CX request.
- Completed CX and Tech answers can be acknowledged or returned with **Question
  More**. The same request ID reopens and its JSON thread preserves earlier turns.
- `20261121001000_fix_update_request_notification_uuid.sql` fixes SQLSTATE 42804
  without changing request or lead rows. PostgreSQL resolves the untyped `NULL`
  in a `SELECT DISTINCT` notification insert as text; the notification column is
  UUID. The replacement private RPC uses `NULL::uuid` for all queue notifications.
- Run `supabase/tests/140_update_requests_and_urgent_notification_scope.sql` and
  `supabase/tests/145_update_request_type_repair.sql` only on an isolated database.
  The latter reproduces 42804 before the repair and verifies CS, CS Admin, excluded
  OPR, notifications, schema types, and unchanged leads after it. Applying the
  repair to the shared project remains a separate approval step; no Edge Function
  redeployment is required for this database-only correction.
- Donut has no saved-lead queue, notification inbox, or matching request lifecycle,
  so no extension source, manifest, release metadata, or ZIP change is required.

### Confirmed workflow

- `CS Updated` is a **request status**, not a new job status. It never replaces
  `paid`, `scheduled`, approval-pending or any other lead status.
- Processor/Admin enter the requested customer update on a **saved** lead.
  Unsaved form values are not copied into the request or customer projection.
- Assigned CS takes precedence over the creator. If unassigned, the creator is
  the recipient only when they are a Customer Service agent. CS Admin sees all
  pending requests and handles jobs without an eligible agent. The selected
  recipient is fixed at request creation (later lead reassignment does not
  silently transfer an outstanding request).
- The queue returns an explicit customer-field allowlist: contact, service,
  address/unit and agreed schedule. No technician fields, processor notes,
  internal amounts, photos or full-lead links are supplied to either CS role.
  Request and service text remain user-entered content: do not put technician
  information in customer-facing free text; it is not automatically redacted.
- CS records a required response and selects **Save CS Updated**. The request
  leaves their queue and request-table RLS stops exposing the completed row.
  Their normal lead visibility remains unchanged, so ordinarily visible jobs
  are not hidden simply because an update request finishes.
- Processor/Admin review the **CS Updated** tab. The requesting Processor or
  Admin can acknowledge it; other Processors can read it but cannot clear it.
  Acknowledgement removes it from the active queue, not the audit/history table.
- Bell notifications link to the request queue, not an inaccessible full lead.
  A shared realtime-bus listener invalidates caches; 15-second polling also
  handles RLS-filtered completion events and reconnects. This does not send
  customer messages or bypass any existing approval process.

### Release steps and approved installation

1. Review and apply the exact file
   `supabase/migrations/20261013082939_get_cx_update_requests.sql` in the intended
   Supabase SQL Editor. Do not use `db push` or `db reset`. The migration adds
   one RLS-protected request table and authorized RPC; it does not modify leads.
   **Applied through Supabase MCP with explicit user approval on 2026-10-13**
   to `kxiqholnmhkwhdkhtopp`. MCP recorded version `20261013103924`, name
   `get_cx_update_requests`; the repository retains the original CLI-created
   filename above. No manual reapplication is required on this project. Do not
   use CLI migration-history repair or bulk push to reconcile historical stamps.
2. Regenerate `src/integrations/supabase/types.ts` from the intended schema using
   the supported CLI or MCP tooling, then typecheck. **Completed through MCP**
   after migration application; generated changes add only the new table, its
   relationships and the public RPC. Types were not hand-edited. The browser
   additionally validates the customer-only Edge transport contract at runtime.
   Docker remains unavailable for a full local Supabase stack; isolated SQL
   behavior checks use embedded Postgres/PGlite instead.
3. With explicit deployment approval, deploy only the new function. **Completed
   through MCP on 2026-10-13**, version 1, ACTIVE, `verify_jwt=true`. Both deployed
   source files were retrieved through MCP and match the repository exactly.
   For an independently approved future deployment, the equivalent CLI command is:

   ```sh
   npx supabase functions deploy cx-update-requests --project-ref kxiqholnmhkwhdkhtopp --use-api
   ```

   Keep JWT verification enabled. The function additionally validates the user
   with `auth.getUser()` and forwards their JWT; no service-role client or new
   provider/API secret is needed.
4. Run `supabase/tests/130_cx_update_requests.sql` **only on an isolated test
   database** and inspect every PASS/FAIL. It inserts synthetic users and jobs
   and rolls back, but existing lead/auth triggers can still queue external work.
   Running this write-based harness on shared production requires separate approval.
   For a rollout visibility comparison, run the exact read-only
   `supabase/tests/40_leads_rls_baseline.sql` before and after on the intended
   database; the six-role matrix should be unchanged. **Completed on shared
   production through MCP**, with identical matrices for all six existing roles.
   `supabase/tests/131_cx_update_requests_readonly.sql` is the separate
   production-safe harness: reads and count/list RPC calls only, temporary
   checks rolled back. All **33** checks passed on the deployed schema. The
   write-based 130 harness was not run on production.
5. Publish the CRM separately after backend installation. Verify a pending hidden
   job with the assigned CS, unrelated CS, CS Admin, requesting Processor and
   an Operator; verify response, acknowledgement, failed saves and notifications.
   Donut has no counterpart and requires no new ZIP installation.

### Verification boundaries and rollback

The exact migration was applied **twice** to isolated embedded Postgres/PGlite
with a minimal schema fixture: all **40** behavioral harness checks passed.
The exact six-role baseline file produced identical nonempty synthetic matrices
before/after. This verifies the SQL logic, not production's complete trigger stack.
Final local gates: lint completed with 0 errors / 29 existing warnings; typecheck,
build (including Donut v1.7.0 integrity) and staged diff checks passed. All **590**
unit tests across 71 files and all **9** CX Playwright tests passed. A concurrent
unit/build/browser run initially timed out in the existing ZIP dataset preload;
the unchanged full suite passed on its own, with no skipped tests or timeout edits.
Network-isolated browser tests exercise both CS roles at desktop/mobile sizes,
creation from a paid saved card, completion failures, returned updates and excluded
Operator routes. All external HTTP and Supabase websocket traffic is blocked/mocked.
The user explicitly approved migration application, Edge Function deployment and
remote branch publication on 2026-10-13. Supabase MCP installed the exact reviewed
migration and function; MCP-generated database types passed typecheck. Both deployed
RPC bodies match the migration exactly. All 33 production-safe harness checks pass,
including live permitted-role count/list calls and excluded-role/anonymous denials.
Four live HTTP boundary checks pass: CORS preflight 200 and no authentication,
invalid user JWT and API-key-only calls 401. MCP logs confirm those expected
responses, with no runtime error entries in that function's checked 30-minute window.

Advisors were checked before/after: no new security findings. The only new
performance findings are four [unused foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
on the empty new table; they intentionally protect future history/FK lookups and
are not removed merely to silence the advisor. Existing unrelated warnings,
including [anonymous definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
remain unchanged and need their own review rather than a bundled permissions change.

No test customer/auth/request records or external customer messages were created
on production. CRM publication and a signed-in, real create → CS Updated →
acknowledgement workflow remain unverified: Supabase MCP does not render the
frontend or provide user login sessions. Frontend workflows were verified with
the network-isolated Playwright tests, not a claimed production browser session.

To roll back, remove the UI entry and revoke authenticated execution of **both**
RPC functions as described at the migration's end. Retain request/audit history;
export and approve archival before any table deletion. Do not drop the shared
`marshmallow_private` schema. There are no lead status/schedule repairs to reverse.

## Quo configuration

Open [Marshmallow Edge Function Secrets](https://supabase.com/dashboard/project/kxiqholnmhkwhdkhtopp/functions/secrets).
Add `QUO_API_KEY` with the **raw Quo API key**. Do not prefix it with `Bearer`:
the [Quo API](https://www.quo.com/docs/api-reference/messages/list-messages) uses
the key directly in its server-side Authorization header. Optionally set
`QUO_API_BASE_URL` to `https://api.quo.com/v1` for all Quo sync functions.

`OPENAI_API_KEY` enables AI review. `QUO_WEBHOOK_SECRET` is a separate webhook
signature secret; do not replace it with the Quo API key. Never put these keys in
CRM frontend environment variables, extension Settings or the ZIP. Quo and AI
requests run in authenticated Edge Functions.

Secrets become available without redeploying. Retry a technician with a valid
saved Quo link, then check the returned source, message count and quoted evidence.
If history is still missing, confirm the key can access the saved phone line and
sync the conversation from the CRM. The native Donut panel uses the same endpoint.

## Free address lookup

The free Leaflet/OpenStreetMap uses Census-derived street coordinates. The shared
`geocode-lead-address` endpoint never calls Google, even if Google keys exist.
Both clients reject non-Census coordinate responses rather than treating an unknown
provider as Census. CRM coordinate updates preserve the customer's address and
use an optimistic address guard. Nearby-area generation persists only a Census
match of the saved location; city/ZIP/unsaved-preview fallbacks cannot overwrite
the lead's map point. Apartment/unit details remain intact.

Optional Google address confirmation in the urgent-review service is a separate
flow; its latitude/longitude are not used for this free map. A Google key is not
required for map coordinates or coverage previews. Review Google's content storage
and attribution terms before enabling optional Google-derived address content.
