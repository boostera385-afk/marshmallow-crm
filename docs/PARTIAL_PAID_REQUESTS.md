# Partial Paid approvals

## Verification record (2026-11-13)

- Full suite: `npm test -- --maxWorkers=2`: 154 files, 1,493 tests passed.
  The first high-concurrency run timed out in unchanged AppSidebar tests; that
  file then passed in isolation, and the complete lower-concurrency run passed.
- Lint passed with 28 existing warnings; typecheck and production build passed.
  Donut v1.7.1 source/ZIP integrity passed; extension artifacts are unchanged.
- Six mocked browser tests passed (Processor success/denial and CS exclusion on
  cards and full details). No live customer actions were used.
- Isolated SQL: all 25 behavioral checks plus six smoke checks passed, with the
  exact migration applied twice. No production behavioral write harness was run.

## Production application (2026-11-13)

- With explicit session approval, applied the committed
  `supabase/migrations/20261214000000_partial_paid_requests.sql` through Supabase
  MCP to shared project `kxiqholnmhkwhdkhtopp`, after the verified frontend commit
  was pushed. Remote migration record: **`20261113072320 / partial_paid_requests`**.
- No broad `db push` or historical migration repair was run: existing remote/local
  timestamp drift was left untouched. The remote timestamp above accounts for
  this file; do not assume its future-dated local version is pending schema work.
- Ran the exact `supabase/tests/179_partial_paid_requests_readonly.sql` file via
  linked CLI: **six PASS, zero FAIL**. Lead/request RLS policy fingerprints match
  before/after (`8ad16ccad59f389edae457fc49a159d0`). No customer lead writes were
  performed for testing.
- Regenerated public-schema database types with the CLI: only the three generated
  Row/Insert/Update `request_type` properties changed; no manual type edits.
  Typecheck and all 25 focused payment/dialog/status-choice tests passed again.
- Health advisors reported no findings. Existing security/performance advisories
  remain, including the unchanged overlapping request INSERT/UPDATE policies
  ([remediation](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies))
  and unrelated functions with a mutable search path
  ([remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)).
  These were not bundled into this release.
- CRM Publish, refreshed Admin approval tabs and signed-in end-to-end workflow
  checks remain pending. No Edge Function deployment or Donut installation is
  required for this CRM-only change.

## Behavior

Processors select **Paid** or **Partial Paid**, enter a positive amount and optionally
attach a screenshot/comment. Both create a request in the existing Payment Approval
Pending queue. Admin approval applies the requested outcome; rejection restores the
previous status. Admins may also record either outcome directly. Customer Service
cannot select Partial Paid. Only Paid is terminal.

If a request is denied or saving fails, the dialog remains open and retains its
amount, comment and selected screenshot for retry. Request/review database errors
are surfaced rather than being replaced by a generic success or silently ignored.

Cards, the full lead page and legacy lead drawer use the same request helper.
Donut has no native payment recording or review counterpart; no ZIP update is needed.
There is no payment Edge Function to deploy.

## Verification and application

- Unit tests: `npm test -- src/lib/payment-requests.test.ts src/components/leads/PaymentDialog.test.tsx`.
- Mocked browser tests (no production traffic):
  `npx playwright test -c playwright.operator-workflow.config.ts tests/operator-workflow/workflow.spec.ts -g "Partial payment:"`.
- Install PGlite outside the repository, then run
  `node scripts/test-partial-paid-requests-db.mjs <PGlite-installation-directory>`.
  This executes the exact migration twice against disposable Postgres and checks
  six role gates, paid immutability, partial-payment mutability, legacy defaults,
  constraints and synthetic out-of-scope behavior. **Never run its fixture or
  harness on the shared project.** The small fixture is not a full production RLS test.
- Apply only `supabase/migrations/20261214000000_partial_paid_requests.sql` to project
  `kxiqholnmhkwhdkhtopp`, after explicit approval and passing checks. For manual
  application, copy the entire file from GitHub into the Supabase SQL Editor.
  Inspect migration history first; existing remote/manual timestamp drift makes
  an unreviewed broad `supabase db push` unsafe.
- Regenerate `src/integrations/supabase/types.ts` with
  `npx supabase gen types --linked --lang typescript --schema public` after applying.
- Run `supabase/tests/179_partial_paid_requests_readonly.sql` on production after
  application; every smoke check must report PASS. It makes no customer writes.
- CRM Publish is separate. Refresh every CRM tab after publication, especially
  Admin approval tabs, so an older Paid-only client cannot review a Partial Paid
  request as Paid. Signed-in end-to-end verification remains a separate step.

## Rollback

Revert the frontend and pause payment approvals first. Preserve/export requests
and their `request_type` values before dropping the column: dropping it loses the
distinction for existing Partial Paid requests. Restore `enforce_paid_status_rules`
from `20261030020000_enforce_paid_status_rules.sql` and drop `request_type` only
after deciding how to handle pending Partial Paid requests. No lead repair or
status backfill is part of this migration.

## Efficiency review

The new outcome adds one text field to the existing request read/write; it uses
the same UI state, request helper, narrow lead projection, query keys, queue,
RLS, audit, notifications and screenshot upload. A synthetic request has the
same work for either outcome: pending lookup, one request INSERT and one lead
UPDATE (plus existing audit and optional upload), not a second queue or read.
Database read policies/indexes, realtime subscriptions/cadence, background jobs,
storage/bandwidth behavior and Donut are otherwise unchanged. No production
before/after billing or resource reduction is claimed.
