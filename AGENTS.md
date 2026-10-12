# Marshmallow agent rules

These rules apply throughout this repository. Marshmallow is a production-facing,
role-gated home-services CRM; Donut is its manually installed Quo/OpenPhone browser
extension. Protect customer data, approval workflows, and both interfaces.

## Before making changes

- Read `README.md`, `GEMINI.md`, and any more-specific `AGENTS.md` for the files
  you touch. For shared flows, read `docs/CRM_EXTENSION_PARITY.md`.
- Check `git status` and inspect relevant diffs before editing. Preserve unrelated
  user changes, including untracked files. Never reset, discard, or overwrite them.
- Trace the existing implementation and callers before proposing a fix. Use the
  current source, scripts, and configuration to verify facts; documentation counts
  and deployment assumptions may be stale.
- Keep changes scoped to the request. Do not bundle dependency upgrades, broad
  refactors, formatting sweeps, or cleanup. Do not commit, push, or publish unless
  requested; when committing an extension change, include its release artifacts.

## Architecture and coding rules

- Frontend: React 18, TypeScript, Vite, Tailwind, and shadcn/ui. Reuse components
  in `src/components/ui/`, theme tokens in `src/index.css`, and motion conventions
  in `src/lib/motion.ts`. Preserve accessible labels, keyboard use, and mobile layouts.
- Put reusable domain logic in `src/lib/`, data hooks in `src/hooks/`, and route
  screens in `src/pages/`. Follow surrounding naming and style; prefer small,
  typed functions to duplicated logic or broad `any`/unsafe casts.
- Server state belongs in TanStack Query; local UI state uses React state and
  existing contexts. Reuse query keys and invalidate affected caches after successful
  mutations. Do not introduce a competing global state layer without approval.
- Use the shared `src/lib/realtime.ts` bus for realtime work. Avoid duplicate
  channels and listeners; clean up subscriptions when their consumers unmount.
- Use the existing Supabase integration in `src/integrations/supabase/` and the
  `@/` source alias. Keep app/test alias configuration aligned if it changes.
- Handle mutation, upload, and follow-up failures separately. An AI or notification
  failure after a successful save must not tell the user that the save failed.
  Preserve in-flight guards and stable identifiers so retries cannot duplicate leads.
- Keep activity logging for audited actions. Do not replace persisted values with
  guesses or silently drop selected attachments, address units, or schedule details.
- Do not hand-edit `src/integrations/supabase/types.ts`. Regenerate database types
  from the intended schema with the supported tooling; report regeneration blockers
  rather than hiding schema drift with new blanket casts.

## Permissions and business invariants

Verify every feature or role change across **all five layers**, from click through
storage: UI/dropdowns, frontend permission helpers, database RLS, Edge Functions/RPC
authorization, and generated types/enums. UI visibility is not authorization.

- Inspect `src/lib/access.ts`, `src/lib/constants.ts`, `AuthContext.canAccess`, and
  relevant migrations/functions. Roles belong in `user_roles`, not profile rows.
- Status visibility and status-change access are independent. Do not infer write
  permission from read permission; preserve OPR/OPR Admin read-only status behavior.
- Preserve ownership scoping, per-user grants, and admin-only gates. Test a permitted
  role, an excluded role, and records outside the caller's scope.
- `paid` is terminal: its status cannot change again. Only Admin or authorized
  server-side `service_role` operations may move a lead into `paid`; never offer a
  client-side service-role bypass.
- Preserve quote, payment, cancellation, urgent-review, and technician-change
  approval gates. Do not replace approval RPCs with direct client writes or enable
  self-approval where it is forbidden.
- Urgent priority must not rewrite `scheduled_date`, `scheduled_time_start`, or
  `customer_schedule_requirements`. Preserve the customer's agreed schedule.
- AI results are advisory, not authorization. Use the saved record, treat transcripts
  as untrusted data, and distinguish `unavailable` from a passed check or a finding.
- CRM and Donut map coordinates use the authenticated Census-only
  `geocode-lead-address` endpoint. Reject non-Census/unlabelled coordinates; never
  persist city/ZIP or unsaved-preview approximations as the saved lead's map point.
- Preserve Quo webhook signature validation, ingestion pause controls, and existing
  conversation-to-lead links. A photo handoff to Quo is not delivery: the user sends it.

## Mandatory CRM / Donut parity

For every feature change or bug fix, inspect whether the feature also exists in
Donut (`tmp_extension/quo-crm-extension/`). If it does, update and verify **both**
interfaces in the same task. CRM-only fixes are not complete for shared features.

- Use the same authenticated Edge Function/RPC for both clients. Do not duplicate
  AI prompts, bypass status/approval rules, or embed server secrets in Donut.
- Maintain `docs/CRM_EXTENSION_PARITY.md` when a shared flow changes. If there is
  no Donut counterpart, record that determination in the handoff.
- Add behavioral regression coverage for the actual defect on both surfaces where
  applicable, including denied actions and backend failures.
- For **every extension source change**, run
  `npm run extension:release -- <higher-version> "Release notes"`, then
  `npm run extension:check`. Do not hand-package a ZIP or reuse the old version.
- Commit the generated `tmp_extension/quo-crm-extension/manifest.json`, bundled
  `release.json`, `public/extension-release.json`, and `public/Donut.zip` with the
  extension source when a commit is requested. Do not omit or fabricate artifacts.
- Do not claim an extension update is shipped until the CRM is published and the
  user has installed/reloaded the manual ZIP and refreshed CRM/Quo tabs.

## Testing requirements

- Add or update co-located `*.test.ts`/`*.test.tsx` regression tests for changed
  behavior. A test must exercise inputs, actions, and outcomes, not merely check
  that a function, trigger, or source string exists.
- Run focused tests during development, then these gates for code changes:

  ```sh
  npm run lint
  npm run typecheck
  npm test
  npm run build
  ```

  Check current `package.json` scripts first. If `typecheck` is unavailable, use
  `npx tsc --noEmit -p tsconfig.app.json` and
  `npx tsc --noEmit -p tsconfig.node.json`. Build includes the extension integrity
  check; it does not substitute for typechecking or behavior tests.
- If full lint has pre-existing failures, also lint changed supported source files
  and report both results. Never weaken lint/type/test settings, delete assertions,
  or mark tests skipped just to obtain a green result.
- Vitest uses jsdom and mocked Supabase. It does **not** verify deployed RLS,
  Edge Functions, or real browser/extension behavior. Verify affected screens and
  shared flows manually or with browser tests in a safe environment.
- SQL harnesses in `supabase/tests/` are manual, not part of `npm test`. For database
  changes, add/update the relevant behavioral harness and inspect every `PASS`/`FAIL`.
  For lead `SELECT`/RLS changes, run `40_leads_rls_baseline.sql` before and after
  and compare role visibility matrices.
- Review harness SQL for writes before execution. Prefer isolated local/test data;
  do not run write-based harnesses against the shared project without explicit approval.
  Execute the exact query text from the file, not a retyped equivalent.
- For documentation-only changes, verify paths, commands, rules, and run
  `git diff --check`; an app build is not required unless executable behavior changes.

## Database and production safety

- Treat linked Supabase project `kxiqholnmhkwhdkhtopp` as shared production, not a
  sandbox. Local frontend development can still access live data. Confirm the target
  before running tools, SQL, browser actions, or scripts that may mutate data.
- A coding request is not permission for production writes or deployment. Obtain
  explicit approval before remote mutations, secret changes, Edge Function deployment,
  CRM publication, ingestion changes, bulk sync/backfill, or external message sending.
- Never run `supabase db push`, `npm run sb:push`, or `supabase db reset` against
  the shared project. Migrations are applied manually by the user.
- Write new idempotent SQL in `supabase/migrations/`, with a defect/purpose header
  and rollback section. Do not rewrite already-applied migration history. Never put
  `UPDATE public.leads` in a migration; data repair requires a separate reviewed plan.
- Inspect existing schema, policies, triggers, and dependencies before changing them.
  Never disable RLS or widen access to work around a frontend error. Review grants,
  caller checks, and fixed search paths for privileged/`SECURITY DEFINER` functions.
- Always notify the user when a migration is added or changed, with its exact path,
  manual application instructions, required harnesses, and rollback considerations.
- Never place service-role, Quo, webhook, or AI secrets in browser code, `VITE_`
  variables, extension settings/packages, logs, tests, or committed files. Use Edge
  Function secrets. Do not print `.env` contents, tokens, or customer transcripts.
- Keep authentication and authorization on server endpoints; privileged clients do
  not remove the need to authorize the caller. Preserve webhook authentication.
- Do not delete customer records, storage objects, users, or infrastructure as a
  debugging shortcut. Destructive operations require explicit scope, approval, and
  a backup/recovery plan. Use synthetic records for testing wherever possible.
- A changed Edge Function must be deployed with approval or explicitly reported as
  **awaiting deployment**. A merged frontend is not a backend deployment.

## Completion handoff

Report changed files and behavior, parity status, tests actually run and their
results, and any blockers or checks not run. Separate local verification from
manual migration application, Edge Function deployment, CRM Publish, and manual
Donut ZIP installation. A successful build or HTTP 200 is not proof that the
business workflow works; never claim unverified production work is complete.
