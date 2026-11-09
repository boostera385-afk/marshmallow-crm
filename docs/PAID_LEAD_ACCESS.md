# Paid lead access (Settings → Status visibility → Paid)

Requested 2026-11-07. Before this, switching **Paid** on for a user only changed the
screen: the database hid paid leads from CS Admin entirely and limited CS to their
own leads, so the switch could not show them.

## Behaviour

- In **Settings → Status visibility**, switching **Paid** on for a **user** opens
  "Share paid leads with …": **All time**, or a **custom date range**.
- The range is the date each lead **became paid** (New York time), inclusive. The
  created date does not matter (changed 2026-11-09, migration
  `20261205000000_paid_lead_access_by_paid_date.sql`; before that it was the
  created date). Example from production on 2026-11-09: 18 leads became paid in
  November but only 2 were created in November.
- Paid dates come from `public.lead_paid_dates`: recorded by a trigger the first
  time a lead becomes paid, and backfilled from payment history (the earliest
  `payment_recorded` / `payment_approved` log with `status_to: paid`, or an approved
  payment request). On 2026-11-09 this dated 396 of 452 paid leads. The other 56
  (older leads with no payment record) are still shown under **All time** but match
  no custom range; no date is guessed for them.
- Under the switch the grid shows the grant ("All time" or the range); click it to
  change the range. Switching Paid off removes the grant.
- The user then sees **all paid leads** in that window (not only their own), read
  only. Other statuses are unchanged. Paid stays terminal.
- The **role-wide** Paid row does not grant data; grants are per user.
- Admin-only, audited in activity logs (`paid_lead_access_granted` / `_removed`).

## How it is enforced

Paid-date ranges (2026-11-09): `20261205000000_paid_lead_access_by_paid_date.sql`
adds the server-owned `lead_paid_dates` table (no browser access), the
`leads_record_paid_at` trigger and backfill, replaces the "Granted paid leads"
policy with one that matches the paid date (all time unchanged; id list computed
once per query), adds `public.my_paid_lead_ids()` for the CRM list filter, and
changes the audit text to "leads paid <start> to <end>". **Apply it before
publishing the CRM build that calls `my_paid_lead_ids`** (until then that build
hides ranged paid leads). Rollback steps are at the end of the migration.

Original grant feature (2026-11-07):

Migration `supabase/migrations/20261204000000_paid_lead_access.sql`:
`public.paid_lead_access` (one grant per user), one extra lead SELECT policy
"Granted paid leads" (paid + user's own Paid switch on + created date in the
window, computed once per query), and `public.set_paid_lead_access` (Admin only).
The CRM (`src/lib/paid-lead-access.ts`, `useAllowedStatuses`) applies the same
window to lists, so roles that could already read every paid lead (Processor,
Operator) also see only their range once one is set.

## Verification

- Isolated: `node scripts/test-paid-lead-access-db.mjs <pglite dir>` applies both
  migrations twice and runs `supabase/tests/170_paid_lead_access.sql` (37 checks,
  2026-11-09: backfill, trigger, paid-date ranges incl. leads created in one month
  and paid in another, `my_paid_lead_ids`, no browser access to paid dates).
- Paid-date migration on production: **not applied yet** (manual). Before and after
  applying, run `supabase/tests/40_leads_rls_baseline.sql` read-only; users without
  a paid grant must keep an identical matrix. Before-run, 2026-11-09 (production,
  read-only, rolled back):

| role | visible | paid | partial | job done | cancelled | scammed | urgent |
|------|---------|------|---------|----------|-----------|---------|--------|
| admin | 5406 | 452 | 24 | 3 | 1404 | 17 | 56 |
| cs_admin | 3506 | 0 | 0 | 0 | 0 | 0 | 56 |
| customer_service | 659 | 18 | 3 | 0 | 227 | 0 | 13 |
| processor | 5406 | 452 | 24 | 3 | 1404 | 17 | 56 |
| opr | 5406 | 452 | 24 | 3 | 1404 | 17 | 56 |
| opr_admin | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

  One user currently has a Nov 1–30, 2026 grant; after applying, that user sees
  the leads that became paid in November instead of those created in November.
- Production, read-only, before the migration (2026-11-07), harness
  `supabase/tests/40_leads_rls_baseline.sql` matrix:

| role | visible | paid | partial | job done | cancelled | scammed | urgent |
|------|---------|------|---------|----------|-----------|---------|--------|
| admin | 5366 | 451 | 24 | 3 | 1405 | 17 | 56 |
| cs_admin | 3466 | 0 | 0 | 0 | 0 | 0 | 56 |
| customer_service | 649 | 18 | 3 | 0 | 227 | 0 | 11 |
| processor | 5366 | 451 | 24 | 3 | 1405 | 17 | 56 |
| opr | 5366 | 451 | 24 | 3 | 1405 | 17 | 56 |
| opr_admin | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

  After applying, with no grants, the matrix must be identical.
- **Applied in production 2026-11-07.** The after-run of the same harness matched
  the table above cell for cell. Read-only checks: grants table has RLS on and 0
  rows; signed-in users can read it but not write it; `set_paid_lead_access` is
  callable by signed-in users (Admin check inside) and not anonymously; the new
  lead policy is SELECT only; no user has Paid switched on yet. The Settings range
  dialog **awaits CRM Publish**.
- No Donut counterpart (Donut has no status visibility settings).
