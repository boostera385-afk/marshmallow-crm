# Notifications

Design proposal with production evidence (2026-11-09):
https://claude.ai/artifact/Ya6c72UXZfguRm8ms1iXMN (private to the owner until shared).

## Decisions (2026-11-09)

- **Shown for 3 days at most.** The bell, unread badge, pop-ups and workflow
  toasts show notifications from the last 3 days only.
- **New users see nothing old.** Nothing created or published before a user's
  account existed is shown to them (notifications, workflow toasts, CRM
  announcements).
- **History is 30 days.** The Notifications page shows the last 30 days. Deleting
  older rows is a separate, explicitly approved data step (phase 3) with a backup;
  until then older rows are only hidden.
- Recipients per alert type are decided with the catalogue in phase 2.

## Phase 1 (this change)

| Part | Where | Status |
| --- | --- | --- |
| 3-day window for bell, badge, 4 pop-ups, toasts | `src/lib/notification-window.ts` and each consumer | Code; awaiting CRM Publish |
| 30-day history floor | `useNotificationInbox` | Code; awaiting CRM Publish |
| Announcements only after the user joined | `CrmUpdatePopup` | Code; awaiting CRM Publish |
| Lead access checked on every read | `supabase/migrations/20261206000000_notification_access_on_read.sql` | **Manual migration, not applied** |

Read-only production measurement before the change: unread badge for the busiest
Processor 787 → 30 with the 3-day window, Admin 199 → 31, CS Admin 95 → 11.

The access check hides (never deletes) a notification while its recipient cannot
open the lead, using the CRM's own job-visibility rule: Processor, CS Admin and
Customer Service. Admin is unchanged (sees every lead). Operators are unchanged in
this phase (the bell scopes them to assigned leads; their recipients are fixed in
phase 2). Access granted again shows the notification again.

Verification: isolated `node scripts/test-workflow-inbox-db.mjs <pglite dir>` runs
`150`, `160`, `151` and the new `152_notification_access.sql` with the migration
applied twice (138 checks). After applying, run `151_workflow_inbox_readonly.sql`
read-only on production. CRM tests: `notification-requests.test.tsx`,
`WorkflowAlerts.test.tsx`, `useNotificationInbox.test.tsx`,
`CrmUpdatePopup.test.tsx`, `notification-window.test.ts`.

Not in phase 1: decided cancellation/paid requests still count as unread until they
age out of the 3-day window (phase 3 resolves them); the browser can still create
notifications for other users (phase 2 closes this).
