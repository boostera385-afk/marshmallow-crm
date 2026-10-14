# Copy Details, map filters, and Operator hold alerts

## Behavior

- Copy Complete Details is enabled by default for every existing role, including
  Operator (`opr`) and Operator Admin (`opr_admin`). Admin always retains access.
- Settings → Feature Access → Copy Complete Details offers role switches and
  per-user Inherit / Allow / Deny under the expandable **User overrides** row.
  Search by name or filter by role to find a specific teammate. The user override wins. Only Admin may change
  these settings; no profile flag or navigation grant can bypass them.
- Feature & Navigation Access is desktop-first: four columns per page, Previous /
  Next arrows, sticky table headings, user/role filters and feature search, without
  horizontal dragging. Narrow screens use labelled stacked controls. Fixed role
  and profile-flag permissions are labelled rather than offered as ineffective
  switches. Failed permission reads show Unavailable with a retry action; failed
  navigation writes do not show save success or change the displayed grant.
- The same permission gates lead cards, Operator cards, tables, both detail views,
  and the hold snapshot's copy action. Quote visibility remains independent.
- The latest `main` moved the list copy button into an action row hidden from both
  Operator roles. This branch retains its new position/short label, exposes only
  the permission-gated copy action, and preserves edit/delete/assignment restrictions.
  Both detail views now also include complete-details copy.
  The local browser suite confirms the list card works for both Operator roles.
  A missing button in an older published CRM still requires publishing/reloading
  the current build; local source alone cannot establish what version a tab runs.
  This setting governs the named Copy Complete Details action, not manual text
  selection or the separate technician-message and individual-field copy actions.
- The map Service/State pair has responsive grid widths and truncates long selected
  labels. Menus avoid viewport collisions; Leaflet cannot cover them.
- Hold This Job alerts go to **all** users with an Operator role, not just assigned
  Operators. The trigger uses actual database transitions:
  - `urgent_job` → `urgent_job` with a newly applied `ready_to_schedule` tag;
  - `urgent_job` → `urgent_job` with a newly applied `waiting_schedule_confirmation` tag;
  - `urgent_job` → `scheduled` or `cancelled`;
  - an urgent job entering `cancellation_requested`, then finally `cancelled`.
- Booked is a separate tag and does not count as Scheduled. Non-urgent jobs,
  unchanged tags/statuses, and cancellation requests alone do not generate holds.
- A rejected/abandoned cancellation clears its urgent-origin marker. This is not
  a replacement for the existing cancellation approval workflow.
- The Marshmallow-themed card offers Complete card / Hide details and Acknowledge. Up to
  three unread hold cards stack in the top-right notification rail, newest first,
  while the full history remains available from Notifications. CRM announcements
  participate in the shared popup priority slot so they cannot cover hold alerts.
  The card does not
  edit the job, change its status, assign technicians, or alter the agreed schedule.
- One unread card per recipient/job is refreshed with a new revision when needed.
  Acknowledgement matches the displayed revision so a new event cannot be lost.
- The bell counts all unread holds, with up to 100 displayed records, unread first.
  Mark shown read is used for a larger backlog; unseen/new revisions stay unread.
- A server-owned snapshot stays readable when a job leaves the urgent board without
  widening access to scheduled/cancelled leads. Hidden quotes are removed **before
  storage**. Private notes, payment evidence, emails, and photos are not duplicated
  into snapshots. Deleting the lead/user cascades its hold alerts.
- Obsolete Operator Urgent Job notifications are marked read when a hold arrives.
  Other roles' notifications are not cleared. The hold popup gets display priority.

## Manual deployment order

**Applied with user approval on 2026-10-12 via Supabase MCP** to project
`kxiqholnmhkwhdkhtopp` (Marshmallow). The exact reviewed SQL below was recorded
remotely as version `20261012054907`, name
`lead_copy_permissions_and_operator_hold_alerts`. Do not reapply it just because
the MCP-generated version differs from the source filename. No historical lead
updates or backfill were performed. The original rollback section remains valid;
export any new alerts/settings before using it.

Types were regenerated with the command below and reviewed: only the three new
public tables and five RPCs were added. Read-only MCP checks verified RLS,
authenticated-only RPC grants, fixed search paths, default-enabled roles, the
trigger and all four publication entries. Copy access returned true for Admin,
OPR, OPR Admin and CS sample callers, and false without a caller. The inbox had no
historical rows. This does not verify real status transitions or production UI.
The write-based harness has **not** been run against the shared project.

Post-application advisors were inspected. The private cancellation-origin table
intentionally has RLS with no browser policies/grants
([informational advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).
The two small permission tables have overlapping Admin/manage and read SELECT
policies ([performance warning](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies));
this does not widen non-admin write access. The new lead foreign-key index is
currently unused ([informational advisory](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index));
retain it for alert cleanup rather than removing it before traffic exists.
Pre-existing security/performance warnings remain outside this task's scope.

1. Review and manually apply the exact contents of
   `supabase/migrations/20261012041715_lead_copy_permissions_and_operator_hold_alerts.sql`
   in the Marshmallow Supabase SQL Editor. It is idempotent and includes rollback
   instructions. **Do not run db push/reset.** This migration targets the existing
   deployed schema; its CLI-generated timestamp does not imply later prerequisite
   migrations should be skipped or that an automatic migration runner is supported.
2. Verify publication membership for `notifications`, `lead_hold_alerts`,
   `lead_copy_role_permissions`, and `lead_copy_user_permissions`. The migration
   adds these idempotently and makes explicit authenticated grants alongside RLS.
3. Regenerate Supabase types from the schema after application, using:
   `npx supabase gen types --project-id kxiqholnmhkwhdkhtopp --schema public --lang typescript`.
   Save the generator output as UTF-8 to `src/integrations/supabase/types.ts`, review
   the diff, and rerun typecheck/tests. Never hand-edit this generated file.
   `src/lib/operator-workflow.ts` retains runtime JSON validation and explicit
   nullable arguments, now checked against the regenerated client without a cast.
4. Run `supabase/tests/100_copy_permissions_operator_hold.sql` first on isolated
   test data. It is write-based, synthetic, and rolls back; obtain explicit approval
   before running it on the shared project. Read every PASS/FAIL row. Existing paid,
   urgent-review and cancellation gates must also remain intact in live QA.
5. Publish the CRM and refresh logged-in tabs. Verify with an Operator and an
   Operator Admin, including permission denial, hidden quotes, realtime delivery,
   reconnect recovery, grey card acknowledgement, and map layout at laptop/mobile sizes.

No Edge Function changed and no native Donut counterpart exists for these controls;
no Edge Function deployment or Donut version/ZIP change is required. Any qualifying
lead update from Donut still passes through the same database trigger/approval gates.

### Waiting-for-CX follow-up migration

Apply `supabase/migrations/20261121000000_operator_hold_waiting_schedule_confirmation.sql`
manually in the Supabase SQL Editor after the original Operator workflow migration.
It extends only the server-owned alert reason constraint and trigger; it does not
rewrite leads or customer schedules. Run the updated
`supabase/tests/100_copy_permissions_operator_hold.sql` only on isolated/test data
unless shared-project write approval is separately granted. Publish/reload the CRM
afterward for the stacked Marshmallow notification cards. No Edge Function or Donut
release is required.

There is no historical alert backfill. Urgent-origin tracking for pending
cancellations starts when the migration is applied; requests already pending at that
time do not have a marker. Keep the old and new CRM deployments aligned with this
rollout. Before the SQL is applied, non-admin copy actions fail closed and Settings
shows an explicit migration-required error rather than pretending a grant was saved.

## Local verification (no production access)

```sh
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
npm test
npm run build
npx playwright install chromium
npx playwright test --config playwright.operator-workflow.config.ts
```

The browser suite uses synthetic authenticated sessions and intercepts all remote
HTTP/WebSocket traffic, including Supabase, Quo, storage, and map tile servers.
It does not authenticate against or mutate production. The separate config avoids
the unrelated Lovable Playwright configuration.

For disposable Postgres validation without Docker, install pinned PGlite outside
the repository (e.g. the approved OpenCode temp directory), then run:

```sh
npm install --prefix <temporary-directory> --no-save --package-lock=false @electric-sql/pglite@0.5.8
node scripts/test-operator-workflow-db.mjs <temporary-directory>
```

The runner loads only `supabase/tests/fixtures/operator_workflow.sql`, applies the
exact migration twice to check idempotence, and executes the exact behavioral
harness. This is an isolated PostgreSQL test of the new schema/functions/RLS, not
proof that the migration is deployed or a substitute for complete live workflow QA.
Never apply the minimal fixture to an existing Supabase project.

## Changed-file map

- Copy controls: `src/components/leads/CompleteLeadCopyButton.tsx`, `src/components/leads/LeadCard.tsx`,
  `src/components/leads/LeadDetailPanel.tsx`, `src/pages/LeadDetailPage.tsx`,
  and the small copy-input interface in `src/lib/lead-copy.ts`.
- Admin settings: `src/components/settings/LeadCopyAccessSettings.tsx` and
  `src/components/settings/FeatureAccessMatrix.tsx`, integrated in `src/pages/Settings.tsx`.
- Map layout: `src/components/map/MapFilterControls.tsx` and
  `src/pages/MapViewPage.tsx`.
- Shared queries/RPC boundary: `src/hooks/useOperatorWorkflow.ts` and
  `src/lib/operator-workflow.ts`.
- Alerts: `src/components/notifications/HoldJobCard.tsx`, `HoldJobPopup.tsx`,
  `OperatorWorkflowSync.tsx`, `NotificationBell.tsx`, `UrgentLeadPopup.tsx`, and
  `popup-slot.tsx` in that same directory; integration in
  `src/components/layout/AppLayout.tsx` and `src/lib/realtime.ts`.
- Behavioral coverage: co-located tests for the copy button, map controls,
  settings, workflow hooks/RPCs, hold card/popup, refresh cleanup and popup priority;
  `tests/operator-workflow/workflow.spec.ts` and
  `playwright.operator-workflow.config.ts`; the migration/harness/fixture and
  `scripts/test-operator-workflow-db.mjs` described above.
- Parity record: `docs/CRM_EXTENSION_PARITY.md` and this rollout guide.

## Desktop branch verification before main integration

- `npm run lint`: no errors; 29 existing warnings.
- `npm run typecheck`: passed.
- `npm test -- --maxWorkers=2`: 61 files, 466 tests passed. The worker limit avoids
  resource exhaustion on the local Windows machine without changing test timeouts
  or skipping assertions. The final settings-focused rerun also passed (12 tests).
- `npm run build`: passed, including the unchanged Donut v1.7.0 integrity check;
  existing bundle-size, mixed-import and Browserslist warnings remain.
- Browser suite: all 20 tests passed, including both Operator roles, Admin role/user
  control, hidden quotes, acknowledgement/history, desktop Feature Access at
  1920/1440/1366/1024px plus a narrow-screen fallback, filtering/arrow keyboard use,
  fixed gates, failed navigation saves/read recovery, and
  1440/1024/768/390/320px map filter geometry, menu selection and keyboard focus.
- Disposable Postgres: all 30 behavioral checks passed; exact migration applied
  twice. This fixture does not contain the full deployed lead approval/RLS triggers.
- No remote schema/data mutations, CRM publication, or live workflow QA performed
  during desktop branch verification. The subsequent integration retains `main`'s
  regenerated types and the earlier approved SQL application record above.

## Earlier operator-workflow verification

- `npm run lint` on the latest-main base: 111 pre-existing errors and 29 warnings.
  Changed-file lint also reports the three inherited `any` errors in
  `src/pages/Settings.tsx`; no feature-added lint errors. The earlier zero-error
  result used a local branch with unrelated lint fixes; those fixes are deliberately
  excluded from this feature branch.
- Typecheck: both app/node `tsc --noEmit` checks passed (the main-base package has
  no `typecheck` script, and unrelated local package-script edits are excluded).
- `npm test`: 60 files, 458 tests passed.
- `npm run build`: passed, including the unchanged Donut v1.7.0 integrity check;
  existing bundle-size, mixed-import and Browserslist warnings remain.
- Browser coverage: all 12 scenarios passed across suite and targeted runs,
  including both Operator roles, Admin role/user control, hidden quotes,
  acknowledgement/history, and 1440/1024/768/390/320px map filter geometry, menu
  selection and keyboard focus. The integrated run reached 11 passes before a
  harness timeout at the final 320px test; its isolated rerun passed. Concurrent
  test/typecheck attempts also encountered process interruptions in this environment.
- Disposable Postgres: all 30 behavioral checks passed; exact migration applied
  twice. This fixture does not contain the full deployed lead approval/RLS triggers.
- The initial branch verification above preceded migration application. The
  approved MCP application and type regeneration are recorded in the deployment
  section. CRM publication and live workflow QA still remain separate pending steps.

## Saved-photo View action follow-up

- `src/components/leads/LeadPhotoActions.tsx` now exposes View N photos alongside
  the existing copy/handoff actions wherever this shared component is rendered.
  It signs saved paths on demand, retains original ordering, handles request/load
  failures, and ignores stale responses when the lead's photos change.
- `src/components/leads/ImageLightbox.tsx` remains the shared previous/next/close
  viewer, now with an accessible dialog name and no signed URL logged on failure.
- Regression coverage is in `LeadPhotoActions.test.tsx` and the network-isolated
  browser suite. Donut already previews its intake thumbnails; no extension source
  changes, version bump or ZIP installation are required for this CRM fix.
- Follow-up verification: changed-file lint passed; full lint remains at the same
  111 pre-existing errors / 29 warnings. Both app/node typechecks passed.
  `npm test`: 60 files / 463 tests passed. Browser suite: all 14 scenarios passed
  in one run, including photo navigation, Escape and focus restoration on desktop
  and 390px mobile layouts. Build/unchanged Donut v1.7.0 integrity check passed.
  Disposable PostgreSQL: all 30 checks passed with the migration applied twice.
  No production write-based workflow harness, customer-record edits, Quo sending,
  CRM Publish, or live browser QA was performed. Committing/pushing this follow-up
  does not publish the CRM; publication and live verification remain pending.

## GitHub / Lovable sync check (2026-10-12)

- Verified PR #123 is merged into `main` at `1dae7cd`, including the saved-photo
  View action and regenerated database types. This check changes documentation only.
- If Lovable still previews #122, return to the latest version and confirm its
  GitHub connection uses `pastry-marketing/Marshmallow`, branch `main`.
- Merging this check provides a fresh push notification on `main`. Lovable's
  [sync troubleshooting](https://docs.lovable.dev/integrations/github) recommends
  a new push when a previous GitHub notification was missed. Check for edits held
  only in Lovable before merging; a new sync can replace unsynced editor changes.
- Lovable sync and CRM publication remain unverified. Do not revert to #122 or
  reapply the database migration; publish only after checking the latest preview.
- Fresh push trigger sent to sync repository updates with Lovable.

## PR #126 main integration (2026-10-13)

- Resolved all seven conflicts against `main` at `63e6376`. Retained the desktop
  Feature Access matrix, searchable/collapsible Copy Details overrides, and both
  branches' behavioral tests. Also retained `main`'s saved-photo preview, secure
  role-update API, regenerated database types and cast-free workflow RPC boundary.
- The approved migration application record above is preserved. No migration or
  extension source changed; do not reapply SQL just to resolve this PR.
- Verification of the combined source: lint passed with 29 existing warnings;
  `npm run typecheck` passed; `npm test -- --maxWorkers=2` passed all 471 tests in
  61 files; all 22 network-isolated browser scenarios passed; build and unchanged
  Donut v1.7.0 integrity check passed. All 30 disposable PostgreSQL checks passed,
  including applying the exact migration twice.
- Resolution/testing used an isolated worktree to preserve uncommitted local
  configuration. No production writes, backend deployment, CRM Publish or live
  workflow verification were performed. Updating the PR branch does not merge
  it into `main` or publish the CRM.
