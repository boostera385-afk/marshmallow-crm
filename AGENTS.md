# Mandatory CRM / Donut parity rule

For every feature change or bug fix, inspect whether the feature also exists in
Donut (`tmp_extension/quo-crm-extension/`). If it does, update and verify BOTH
interfaces in the same task. CRM-only fixes are not complete for shared features.
Use the same authenticated Edge Function/RPC for both clients; do not duplicate
AI prompts, bypass status/approval rules, or embed server secrets in Donut.

Verify UI, permission helpers, database RLS, Edge Functions, and generated types
from click through storage. Maintain `docs/CRM_EXTENSION_PARITY.md` when a shared
flow changes. Add behavioral regression coverage for the actual defect on both
surfaces where applicable. A changed Edge Function must be deployed or explicitly
reported as awaiting deployment; a merged frontend is not a backend deployment.

For EVERY extension source change, run `npm run extension:release -- <higher-version>
"Release notes"`, commit the generated manifest, release metadata and ZIP, and run
`npm run extension:check`. Do not claim an extension update is shipped until the
CRM is published and the user has installed/reloaded the manual ZIP.

Read `README.md` and `GEMINI.md` for architecture and house rules. Migrations are
manual: write idempotent SQL with a defect header and rollback section, notify the
user to apply it, and never run db push/reset against the shared project. Do not
hand-edit generated Supabase types. Preserve unrelated user changes.

## Optimization by default

Every feature, fix, and refactor must include an efficiency review of every affected
layer: UI/rendering, hooks/cache, API payloads, database queries/RLS/indexes,
realtime, background jobs, storage/bandwidth, and the Donut counterpart. Record
which layers are affected or not applicable; do not expand into unrelated cleanup.

- Optimize unnecessary work, not business requirements. Preserve permissions,
  approvals, exact counts, complete results/exports, alerts/sounds, visible freshness,
  customer schedules, audited history, accessibility, and retry/reconnect behavior.
  Never save cost by weakening authorization, hiding errors, silently dropping data,
  slowing required updates, or disabling a safety net.
- Reuse existing TanStack Query keys and the shared realtime bus. Scope cached data
  by caller/role/record as appropriate; retire stale results after scope changes.
  Deduplicate concurrent reads and coalesce refresh bursts without losing changes
  arriving during an in-flight request. Keep fallback recovery and cleanup.
- Request only required columns and batch compatible work; avoid N+1 reads and
  unnecessary writes/invocations/downloads. Preserve independent per-view limits,
  exact totals, time cutoffs, and independently reported failures.
- For database work, inspect the intended schema, callers, policies, existing indexes,
  and measured query plans before proposing changes. Use read-only MCP diagnostics
  against shared production. Add indexes or change RLS only with evidence, equivalent
  authorization tests, an idempotent migration, and rollback instructions. Production
  mutations, migration application, deployment, and publication need separate approval.
- Add behavioral regression coverage for correctness AND request/resource behavior,
  including excluded roles, backend failures, bursts, scope changes, and recovery
  where applicable. Run the repository's required validation gates; never weaken
  tests or configuration to claim an optimization.
- Report a reproducible before/after comparison with its environment and workload.
  Separate local test reductions from production usage and invoice savings; compare
  comparable periods normalized by active-user hours and work volume. API request
  counts alone are not a bill. State missing billing/health evidence explicitly.
- When commits are requested, group each coherent behavior change with its tests
  and necessary documentation. Prefer small reviewable commits, not artificial
  commit counts. Do not include unrelated work, push without permission, or claim
  that pushing a branch deploys the CRM, functions, database, or manual Donut ZIP.
