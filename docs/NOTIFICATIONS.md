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

Phase 1 limits that phases 2 and 3 closed: decided requests no longer stay unread,
and browsers can no longer create notifications for other users.

## Phase 2 — the server sends every lead alert (applied 2026-11-09)

Migration `supabase/migrations/20261207000000_notification_server_sender.sql`, applied
to production. Database triggers send what the browser used to send, with the same
titles, messages and recipients:

| Event | Alert (`kind`) | Recipients |
| --- | --- | --- |
| Lead becomes Urgent Job / Need Tech (insert or status change) | `urgent_job` / `need_tech` | Admin, Processor, CS Admin, the lead's CS (assigned, else creator), shared users, assigned Operators; CS only for their own lead |
| Lead becomes Job in Progress, or its expected completion date changes | `job_in_progress` | Admin, Processor |
| Lead becomes Quote Updated | `quote_updated` | quote requester, CS Admin |
| Lead tagged Incomplete Details | `incomplete_details` | lead creator, CS Admin |
| Cancellation request created | `cancellation_request` | Admin, plus Processor unless a Processor asked |
| Paid approval request created | `paid_approval_request` | Admin |
| Lead shared | `lead_shared` | the user it was shared with |
| Lead assigned to an Operator | `lead_assigned` | that Operator |

The person who made the change is never notified; a repeat refreshes the open
unread alert instead of adding a copy. `notifications.kind` is set for every new row
(a BEFORE INSERT trigger labels rows from other server producers by title).

Security: the INSERT policy "Self or admin can create notifications" is removed;
browsers cannot create notifications and can only change `read` on their own.
`dispatch_lead_status_notification` returns 0, so CRM builds published before this
change cannot send duplicates or choose recipients. The CRM no longer contains a
sender (`src/lib/lead-notifications.ts` removed).

Previous `dispatch_lead_status_notification` (production before 2026-11-09), for rollback:

```sql
CREATE OR REPLACE FUNCTION public.dispatch_lead_status_notification(p_lead_id uuid, p_title text, p_message text, p_user_ids uuid[])
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_recipients uuid[];
  v_inserted integer := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (
    public.has_role(v_actor, 'admin'::public.app_role) OR public.has_role(v_actor, 'processor'::public.app_role)
    OR public.has_role(v_actor, 'opr'::public.app_role) OR public.has_role(v_actor, 'cs_admin'::public.app_role)
    OR public.has_role(v_actor, 'customer_service'::public.app_role)
  ) THEN RAISE EXCEPTION 'Not permitted to dispatch lead notifications'; END IF;
  IF p_lead_id IS NULL OR p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN RETURN 0; END IF;

  SELECT coalesce(array_agg(DISTINCT candidate), '{}'::uuid[]) INTO v_recipients
  FROM unnest(p_user_ids) candidate
  WHERE candidate IS NOT NULL AND candidate <> v_actor AND (
    p_title <> '[Alert] Urgent Job'
    OR NOT public.has_role(candidate, 'customer_service'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l WHERE l.id = p_lead_id AND (
        l.assigned_cs = candidate
        OR (l.assigned_cs IS NULL AND l.created_by = candidate)
        OR EXISTS (SELECT 1 FROM public.lead_shares s WHERE s.lead_id = l.id AND s.shared_with_user_id = candidate)
      )
    )
  );
  IF array_length(v_recipients, 1) IS NULL THEN RETURN 0; END IF;

  UPDATE public.notifications n SET message = p_message, created_at = now()
   WHERE n.lead_id = p_lead_id AND n.title = p_title AND n.read = false
     AND n.user_id = ANY(v_recipients);
  INSERT INTO public.notifications(user_id, title, message, lead_id, read)
  SELECT recipient, p_title, p_message, p_lead_id, false FROM unnest(v_recipients) recipient
   WHERE NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = recipient
     AND n.lead_id = p_lead_id AND n.title = p_title AND n.read = false);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;
```

The browser side that called it is `git show acef29f:src/lib/lead-notifications.ts`.

## Phase 3 — alerts close themselves; 30-day retention (applied 2026-11-09)

Migration `supabase/migrations/20261208000000_notification_lifecycle_retention.sql`:
- alerts resolve (`read = true`, `resolved_at`) when the lead leaves the status, the
  Incomplete Details tag is removed, or the last pending cancellation / paid request
  for the lead is decided; 1,229 already-stale unread alerts were closed once;
- the Google Sheets warning keeps one open alert per Admin and closes when healthy
  (it had been sent 623 times);
- `marshmallow_private.purge_old_notifications(30)` runs daily at 03:17 UTC
  (`cron.job` `notifications-retention`); it refuses anything below 30 days.

### Retention backup

Before the first run, rows older than 30 days were copied to
`marshmallow_private.notifications_backup_20261109` (13,241 rows, 2026-03-25 to
2026-10-09) and `marshmallow_private.notification_events_backup_20261109` (0 rows).
Both are server-only (RLS on, no browser grants). The first run deleted exactly those
rows: 17,503 → 4,262 notifications. **Both backup tables were dropped on
2026-11-09 at the owner's request**, so the deleted rows can no longer be restored.

Previous `raise_sheets_sync_stale_alert` (production before 2026-11-09), for rollback:

```sql
CREATE OR REPLACE FUNCTION public.raise_sheets_sync_stale_alert(p_stale_after_seconds integer DEFAULT 900, p_throttle_minutes integer DEFAULT 15)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_health record;
  v_sent integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_health FROM public.get_sheets_sync_health(p_stale_after_seconds);
  IF v_health.status NOT IN ('degraded', 'down') THEN RETURN 0; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
       AND n.title = '[Alert] Google Sheets backup is behind'
       AND n.created_at > now() - make_interval(mins => greatest(coalesce(p_throttle_minutes, 15), 1))
  ) THEN RETURN 0; END IF;

  INSERT INTO public.notifications (user_id, title, message)
  SELECT ur.user_id,
         '[Alert] Google Sheets backup is behind',
          format(
            'Status %s. %s failed attempt(s) in a row; %s failed job(s) and %s total job(s) are queued. Last error: %s.',
            v_health.status, v_health.consecutive_failures, v_health.failed_jobs, v_health.queue_depth,
           coalesce(left(v_health.last_error_message, 200), 'none recorded')
         )
    FROM public.user_roles ur WHERE ur.role = 'admin';
  GET DIAGNOSTICS v_sent = ROW_COUNT;
  RETURN v_sent;
END;
$function$;
```

## Phase 4 — CRM reads (code; awaiting CRM Publish)

- The four pop-ups read through one batched query by `kind`
  (`src/lib/active-alerts.ts`): one read per 20 seconds per browser for all pop-up
  types the role uses, instead of four title searches (Job in Progress moved from 25
  to 20 seconds to share it). Realtime events match by `kind`, older rows by title.
- Notifications page and workflow toasts call `workflow_notifications` directly
  instead of through the `workflow-inbox` Edge Function (no extra login check per
  poll; same error messages and one retry). The schedule monitor still uses the Edge
  Function.
- `src/integrations/supabase/types.ts` regenerated from production (additive only).

Verification: isolated `node scripts/test-notifications-db.mjs <pglite dir>` (all
three notification migrations applied twice, harnesses 153 + 154: 39 checks) and
`node scripts/test-workflow-inbox-db.mjs <pglite dir>` (136 checks). Production
read-only checks after each step are recorded above.

## Operators: no Quote Updated or cancellation alerts (applied 2026-11-09)

Decision (2026-11-09): Operators (`opr`, `opr_admin`) never receive Quote Updated or
cancellation-request alerts. Migration
`supabase/migrations/20261209000000_operators_no_quote_cancellation_alerts.sql`
(applied) blocks those two kinds for Operator-only accounts inside
`marshmallow_private.notify_lead`, the single function that writes lead alerts, so
no recipient list can send them. The server sender already excluded Operators;
the 445 such rows Operators hold (16 Oct – 5 Nov, all read) came from the old
browser sender, show nowhere (older than 3 days, no Notifications page for
Operators) and are removed by the 30-day retention by 5 Dec. Operators still get
Urgent Job / Need Tech, Lead Assigned and their hold alerts. Isolated harness 153:
42/42 with the migration applied twice.

## Operators and the full lead page (2026-11-09)

Report: an Operator opened a notification's "Open lead" button and saw the complete
lead. Operators (`opr`, `opr_admin`) have no "Edit Lead" button on their cards and
were never meant to open `/leads/:id`, but notification buttons, the bell, map links
and Donut links still pointed there. `src/pages/LeadRoute.tsx` now serves that route:
Operators are sent to their Leads view filtered to the job (`/leads?search=<job id>`),
reading only the job ID; every other role gets the full page unchanged. Tests:
`src/pages/LeadRoute.test.tsx`.

Known limit (unchanged, see `20261203000000_opr_location_only.sql`): lead RLS still
lets Operators read lead rows directly through the API; the CRM hides fields at the
screen boundary. Server-side enforcement needs an Operator-only read path.
