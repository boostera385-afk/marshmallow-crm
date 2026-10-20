# Request resolution and recipient notifications

## Release state — coordinated release required

Implementation is not installed or published. On October 20, the user authorized
migrations and a new remote branch, then selected **Coordinate release** after
preflight identified a breaking request contract. The migration is held until
the Edge Function and CRM cutover is ready. No production mutation occurred.

## Request and notification behavior

CX/Tech replies remain unresolved until their resolution owner marks them resolved.
Only the original requester or an explicitly reassigned resolution owner may
resolve or follow up. Admin reassignment requires an audited reason and retains
the original requester. Revisions reject stale replies, including after reopening
the same request ID. Reading notifications never resolves work.

Notifications provides recipient/current-access-scoped paging, exact totals,
read/action/category filters, search, date ranges, sound controls and five-second
notices. Server-owned metadata supplies exact request destinations. Web Locks
coordinate cross-tab alert claims and chimes. The sidebar reuses the bell count;
CX and Tech counts share one query and coalesce realtime bursts.

## Installation and rollback

Review `supabase/migrations/20261020065810_workflow_resolution_notifications.sql`.
Do not apply it alone to production: the legacy request authority delegates to a
revision-required contract, while the old function/client omit revisions. Coordinate
backend deployment and CRM publication first. Never bulk-push/reset the shared DB.
Regenerate `src/integrations/supabase/types.ts` from the intended installed schema;
do not hand-edit it. Behavioral SQL is `supabase/tests/150_workflow_inbox.sql` and
is write-based: isolated synthetic fixtures only, not production without approval.

After a coordinated installation, verify signed-in requester, responder, supervisor
and excluded roles plus real sound/autoplay and reconnect behavior. Rollback must
retain request/event/audit history and current-access notification restrictions.
Restoring the old supervisor resolution authority needs business approval.

No native Donut request queue or notification center exists. Extension source and
release assets remain unchanged; no ZIP installation is needed for this CRM flow.
