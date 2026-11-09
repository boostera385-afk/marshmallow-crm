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
| Lead access checked on every read | `supabase/migrations/20261206000000_notification_access_on_read.sql` | **Applied 2026-11-09** (see below) |

Read-only production measurement before the change: unread badge for the busiest
Processor 787 → 30 with the 3-day window, Admin 199 → 31, CS Admin 95 → 11.

The access check hides (never deletes) a lead notification while its recipient
cannot load the lead under the lead table's own row-level security, the same check
the CRM makes when it opens the lead. Workflow notifications keep their existing
check. Access granted again shows the notification again. Per-user status
visibility (a screen setting) is not part of it.

### Production application, 2026-11-09

1. First version used `workflow_job_visible_to`, which is stricter than lead RLS.
   Applied, measured and **rolled back within about 3 minutes**: it hid alerts for
   leads a user can open. Two of the `40_leads_rls_baseline.sql` sample accounts
   had also changed role (an Admin moved `eb18…` from Processor to Customer Service
   at 08:43 UTC; `0071…` is Customer Service), so that harness's role labels are
   out of date.
2. Corrected version (lead RLS as the caller) evaluated read-only for all 14 users
   with notifications before applying, then applied. Live results matched the
   preview for every user:

| User | Role | Readable before | Readable after | Unread, last 3 days |
| --- | --- | --- | --- | --- |
| 9ac1 | admin | 3,922 | 3,922 | 31 |
| 5b77 | admin | 1,675 | 1,675 | 12 |
| 7ed8 | processor | 3,275 | 3,275 | 30 |
| 2f22 | processor | 142 | 142 | 30 |
| 5c5a | cs_admin | 3,146 | 2,234 | 11 |
| ccc4 | customer_service | 1,300 | 703 | 4 |
| 88c1 | customer_service | 821 | 249 | 2 |
| 76ce | customer_service | 727 | 648 | 4 |
| eb18 | customer_service (was processor until today) | 936 | 3 | 0 (was 20) |
| e25b | customer_service | 304 | 269 | 0 |
| 6c61 | customer_service | 265 | 240 | 0 |
| 0071 | customer_service | 499 | 0 | 0 |
| 8584 | customer_service | 9 | 9 | 0 |
| 5721 | opr | 458 | 458 | 0 |

   Bell query (3-day unread count + latest 20) at most 13 ms per user; 30-day
   history count at most 108 ms. `151_workflow_inbox_readonly.sql`: 24/24 PASS.

Verification: isolated `node scripts/test-workflow-inbox-db.mjs <pglite dir>` runs
`150`, `160`, `151` and the new `152_notification_access.sql` with the migration
applied twice (136 checks). After applying, run `151_workflow_inbox_readonly.sql`
read-only on production. CRM tests: `notification-requests.test.tsx`,
`WorkflowAlerts.test.tsx`, `useNotificationInbox.test.tsx`,
`CrmUpdatePopup.test.tsx`, `notification-window.test.ts`.

Not in phase 1: decided cancellation/paid requests still count as unread until they
age out of the 3-day window (phase 3 resolves them); the browser can still create
notifications for other users (phase 2 closes this).
