# Copy Details, map filters, and Operator hold alerts

## Behavior

- Copy Complete Details is enabled by default for every existing role, including
  Operator (`opr`) and Operator Admin (`opr_admin`). Admin always retains access.
- Settings → Feature Access → Copy Complete Details offers role switches and
  per-user Inherit / Allow / Deny. The user override wins. Only Admin may change
  these settings; no profile flag or navigation grant can bypass them.
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
  - `urgent_job` → `scheduled` or `cancelled`;
  - an urgent job entering `cancellation_requested`, then finally `cancelled`.
- Booked is a separate tag and does not count as Scheduled. Non-urgent jobs,
  unchanged tags/statuses, and cancellation requests alone do not generate holds.
- A rejected/abandoned cancellation clears its urgent-origin marker. This is not
  a replacement for the existing cancellation approval workflow.
- The grey card offers Complete card / Hide details and Acknowledge. It does not
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
   Until the manual SQL is applied, `src/lib/operator-workflow.ts` uses a narrow,
   runtime-validated RPC adapter; generated types for these new objects are pending.
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
  `src/pages/Settings.tsx`.
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

## Local verification result

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
- No remote schema/data mutations, CRM publication, or live workflow QA performed.
  Generated types for the unapplied SQL remain pending. Source publication is a
  separate step from database application, CRM Publish, and live verification.
