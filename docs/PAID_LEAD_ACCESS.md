# Paid lead access (Settings → Status visibility → Paid)

Requested 2026-11-07. Before this, switching **Paid** on for a user only changed the
screen: the database hid paid leads from CS Admin entirely and limited CS to their
own leads, so the switch could not show them.

## Behaviour

- In **Settings → Status visibility**, switching **Paid** on for a **user** opens
  "Share paid leads with …": **All time**, or a **custom date range**.
- The range is the date each lead was **created** (New York time), inclusive. A
  reliable "paid on" date does not exist for every lead (55 of 451 paid leads had
  no record of when they became paid on 2026-11-07), so created date is used.
- Under the switch the grid shows the grant ("All time" or the range); click it to
  change the range. Switching Paid off removes the grant.
- The user then sees **all paid leads** in that window (not only their own), read
  only. Other statuses are unchanged. Paid stays terminal.
- The **role-wide** Paid row does not grant data; grants are per user.
- Admin-only, audited in activity logs (`paid_lead_access_granted` / `_removed`).

## How it is enforced

Migration `supabase/migrations/20261204000000_paid_lead_access.sql`:
`public.paid_lead_access` (one grant per user), one extra lead SELECT policy
"Granted paid leads" (paid + user's own Paid switch on + created date in the
window, computed once per query), and `public.set_paid_lead_access` (Admin only).
The CRM (`src/lib/paid-lead-access.ts`, `useAllowedStatuses`) applies the same
window to lists, so roles that could already read every paid lead (Processor,
Operator) also see only their range once one is set.

## Verification

- Isolated: `node scripts/test-paid-lead-access-db.mjs <pglite dir>` runs
  `supabase/tests/170_paid_lead_access.sql` (21 checks).
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
