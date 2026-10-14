# CRM / Donut parity contract

Every shared fix must update both clients, use the same authenticated backend,
and include behavior tests. `AGENTS.md` and `GEMINI.md` make this mandatory.

| Flow | CRM | Donut | Shared authority / verification |
| --- | --- | --- | --- |
| Technician intelligence | Technicians → Processing Workflow; map selection up to 8 | Native Technician Intelligence panel for the captured phone, reviewed-label saving, full-workflow link for batch selection/flag approvals/chat actions | `technician-chat-assessment`: Admin/Processor only; identical AI prompt, evidence checks, counts and labels. Missing history is unavailable, not misconduct. |
| Technician flags | Admin applies; Processor requests review | Opens full workflow for the same reviewed actions | Existing `request_technician_change` approval RPC and technician flag trigger; never write flags directly in Donut. |
| Urgent lead review | Latest customer agreement, corrections and missing details | Same check; displays issues, corrections and flags; opens saved-lead review for confirmed corrections/approval | `check-urgent-lead`, urgent verification/review RPCs and database status gate. No duplicate prompt or approval bypass. |
| Address lookup / map coordinates | Authenticated Census-only lookup and preserved units | Same function for Find Address, coverage preview and submission coordinates | `geocode-lead-address`: only Census coordinates may be cached/persisted for the free map. Google or unlabelled points are rejected by both clients. Preserve Apt/Suite/Unit/#. |
| Lead submission | Saves stored record before AI follow-up; mutation errors distinguished from follow-up errors | In-flight guard, reserved job ID through acknowledgement, uncertain retries reuse ID; draft cleanup does not redefine a saved lead as failed | Existing unique lead job ID and RLS. Selected photo-upload failures are reported explicitly. |
| Coverage | Admin coverage/source analytics; map and lead coverage badges | Intake coverage preview; Admin link to the full coverage analytics report | Existing coverage RPC/lead columns/trigger. Technician phone and status counts use actual stored data. |
| Photos | Explicit View N photos beside combined-image copy on saved cards/details, with the existing image viewer and original-file technician handoff | Intake thumbnails already open the native previous/next/close photo preview; original-file attachment handoff to exact technician chat | Authenticated signed storage URLs for saved CRM photos; view never copies or sends. Donut's existing native preview is unchanged (no ZIP release needed). User's Quo Send action completes delivery. |
| Complete lead details copy | Lead cards, OPR cards, tables and both detail views; Admin configures role defaults and Inherit/Allow/Deny user overrides in Feature Access; both Operator roles enabled by default | No equivalent clipboard action in native intake panel; no extension source change required | `get_lead_copy_access` resolves the authenticated caller; settings writes use admin-only `set_lead_copy_permission` and database RLS. Copies only loaded, visible details in Service Details / Address / Schedule Requirement / Quote order. Hidden OPR quotes stay blank. Copy does not write the lead or grant visibility. |
| Feature Access settings usability | Desktop comparison table shows four features per page with Previous/Next arrows, persistent user identity, sticky headings, user/role filters and feature search; Copy All Details is searchable by that name, Copy Complete Details or Copy Details and shows saved Inherit/Allow/Deny overrides plus effective access; the separate role/default panel shares the same query and mutation; narrow screens use labelled stacked controls | No native admin permission editor in Donut; no extension source change required | Existing navigation/profile writes and copy permission RPCs remain the authority. Copy overrides use `set_lead_copy_permission`, never navigation grants, and retain role inheritance. Fixed role/flag gates are labelled rather than offered as ineffective switches. Failed copy/navigation saves do not show save success. Browser tests intercept all external requests and use synthetic users. |
| Marshmallow Copilot | Header mascot and Ctrl+K entry; desktop read-only panel, accessible feature catalogue, lead/technician searches with saved-record deep links, scoped reports and Admin measured health. Feature Access includes role defaults, Inherit/Allow/Deny overrides, global disable, separate AI enablement and allowance. | No native Copilot or Admin permission editor in Donut; extension source and v1.7.0 artifacts unchanged. Existing technician intelligence and urgent review remain distinct. | Authenticated `marshmallow-copilot` endpoint, caller-token SECURITY INVOKER reads with existing RLS plus status/field restrictions; service client only for private budget reservations. No record writes, messages, status changes or approvals. SQL fixture and network-isolated browser tests cover permitted/excluded roles and failures. Backend installed via approved MCP deployment on 2026-10-13; 29 read-only production checks passed and six-role baseline unchanged. CRM publication/pilot checks remain pending; see `docs/COPILOT_ROLLOUT.md`. |
| Operator hold alerts | All OPR/OPR Admin users receive a grey, expandable read-only card and persistent bell history when an urgent job becomes Ready to Schedule, Scheduled or Cancelled; pending urgent cancellations are remembered until final cancellation | No native Operator notification inbox or map filter controls in Donut; no extension source change required | One database trigger handles saved transitions from any client; recipient-only `lead_hold_alerts` RLS, server-owned field-whitelisted snapshots with hidden quotes redacted, revision-checked acknowledgement RPC. Existing lead/status approval gates remain unchanged. See `docs/OPERATOR_WORKFLOW_ROLLOUT.md`. |
| Get CX Update | Review sidebar below Need Attention; Processor/Admin request from saved cards or either detail view; assigned CS (creator only when unassigned) and CS Admin see a temporary customer-only queue. CS Updated responses return to Processor/Admin until acknowledged. | No native saved-lead request/completion queue in Donut; intake/status submission is not a counterpart. Extension source and v1.7.0 ZIP unchanged. | Authenticated `cx-update-requests` function proxies caller-JWT `cx_update_requests` RPC. Request-table RLS, fixed role gates, private authorization, whitelisted customer fields, one pending request per lead, stable retry IDs, atomic audit/notifications. No lead status, schedule, full-lead RLS or approval changes. Backend installed via explicitly approved MCP migration/deployment on 2026-10-13; 33 production-safe checks passed and six-role baseline unchanged. CRM publication and signed-in live workflow QA remain separate; see rollout below. |
| Map service/state filters | Responsive paired filters, non-shrinking grid widths, clipped long labels, collision-aware menus; Leaflet stays in its own stacking context | No equivalent map toolbar in native intake panel | UI-only layout change. No coordinate-provider, coverage, permission or storage changes. |
| Release updates | Latest/installed version, date/time, automatic notice and ZIP instructions | Installed version/date, update notice in panel/settings | `extension-release.json`, bundled `release.json`, manifest and version-correlated bridge. |
| Notification refresh efficiency | Bell and eligible urgent, job-in-progress, incomplete-details and quote-updated popups share one recipient-filtered channel through `realtimeBus`; same-turn refreshes coalesce and in-flight changes get a trailing read | No native notification bell or these popup consumers in Donut; no extension source change required | Existing notification RLS, recipient filters, OPR assignment scope, exact bell counts, per-popup 100-row limits, quote cutoff, sounds, priority, acknowledgement writes and 15/20/25-second polling are preserved. Late retired subscriptions/results cannot affect a replacement scope. No new RPC or production configuration. |

Copilot Admin AI controls are CRM-only. Global AI applies to all allowed Copilot
users; there is no separate per-user AI permission. The 2026-10-13 audit fixed
unsaved AI/configuration drafts resetting after permission refreshes and verified
Admin authorization and AI limits with isolated regression tests. No extension
source/release change is required; see `docs/COPILOT_ROLLOUT.md` for publication
and live-provider verification boundaries.

The `pilot` enhancement remains CRM-only: saved-vs-draft AI state, checked config
saves, Admin readiness/confirmed provider test, conversational search refinements,
saved lead/daily work briefs, consented message drafting and expanded workspace.
Minimize/restore is also CRM-only and preserves the in-memory session while exposing
the underlying CRM page; closing still clears it. No native Donut assistant exists.
It never executes urgent/technician assessments in a parallel implementation:
existing authorized workflows are opened for those actions. No Donut source,
prompt, manifest or ZIP changed. With user approval, the pilot RPC migration and
Copilot function v2 were installed via MCP on 2026-10-14; generated types were
refreshed. CRM publication and real signed-in/provider QA remain separate pending
steps; see the latest audit in `docs/COPILOT_ROLLOUT.md` before publishing.

## Release verification checklist

1. Test each changed flow on both surfaces and an excluded role.
2. Run Vitest, changed-file lint, app typecheck and the production build.
3. Verify backend source against deployed versions, and deploy changed functions.
4. If a schema migration is required, write idempotent SQL with rollback and ask
   the user to apply it manually; never push/reset the shared database.
5. Run `npm run extension:release -- <higher-version> "Release notes"`, commit
   generated metadata/manifest/ZIP, then run `npm run extension:check`.
6. State what still needs API credentials, live QA, CRM Publish, or manual ZIP reload.
    A test/build/HTTP 200 is not proof that every reported business task works.

## Get CX Update rollout (2026-10-13)

### Confirmed workflow

- `CS Updated` is a **request status**, not a new job status. It never replaces
  `paid`, `scheduled`, approval-pending or any other lead status.
- Processor/Admin enter the requested customer update on a **saved** lead.
  Unsaved form values are not copied into the request or customer projection.
- Assigned CS takes precedence over the creator. If unassigned, the creator is
  the recipient only when they are a Customer Service agent. CS Admin sees all
  pending requests and handles jobs without an eligible agent. The selected
  recipient is fixed at request creation (later lead reassignment does not
  silently transfer an outstanding request).
- The queue returns an explicit customer-field allowlist: contact, service,
  address/unit and agreed schedule. No technician fields, processor notes,
  internal amounts, photos or full-lead links are supplied to either CS role.
  Request and service text remain user-entered content: do not put technician
  information in customer-facing free text; it is not automatically redacted.
- CS records a required response and selects **Save CS Updated**. The request
  leaves their queue and request-table RLS stops exposing the completed row.
  Their normal lead visibility remains unchanged, so ordinarily visible jobs
  are not hidden simply because an update request finishes.
- Processor/Admin review the **CS Updated** tab. The requesting Processor or
  Admin can acknowledge it; other Processors can read it but cannot clear it.
  Acknowledgement removes it from the active queue, not the audit/history table.
- Bell notifications link to the request queue, not an inaccessible full lead.
  A shared realtime-bus listener invalidates caches; 15-second polling also
  handles RLS-filtered completion events and reconnects. This does not send
  customer messages or bypass any existing approval process.

### Release steps and approved installation

1. Review and apply the exact file
   `supabase/migrations/20261013082939_get_cx_update_requests.sql` in the intended
   Supabase SQL Editor. Do not use `db push` or `db reset`. The migration adds
   one RLS-protected request table and authorized RPC; it does not modify leads.
   **Applied through Supabase MCP with explicit user approval on 2026-10-13**
   to `kxiqholnmhkwhdkhtopp`. MCP recorded version `20261013103924`, name
   `get_cx_update_requests`; the repository retains the original CLI-created
   filename above. No manual reapplication is required on this project. Do not
   use CLI migration-history repair or bulk push to reconcile historical stamps.
2. Regenerate `src/integrations/supabase/types.ts` from the intended schema using
   the supported CLI or MCP tooling, then typecheck. **Completed through MCP**
   after migration application; generated changes add only the new table, its
   relationships and the public RPC. Types were not hand-edited. The browser
   additionally validates the customer-only Edge transport contract at runtime.
   Docker remains unavailable for a full local Supabase stack; isolated SQL
   behavior checks use embedded Postgres/PGlite instead.
3. With explicit deployment approval, deploy only the new function. **Completed
   through MCP on 2026-10-13**, version 1, ACTIVE, `verify_jwt=true`. Both deployed
   source files were retrieved through MCP and match the repository exactly.
   For an independently approved future deployment, the equivalent CLI command is:

   ```sh
   npx supabase functions deploy cx-update-requests --project-ref kxiqholnmhkwhdkhtopp --use-api
   ```

   Keep JWT verification enabled. The function additionally validates the user
   with `auth.getUser()` and forwards their JWT; no service-role client or new
   provider/API secret is needed.
4. Run `supabase/tests/130_cx_update_requests.sql` **only on an isolated test
   database** and inspect every PASS/FAIL. It inserts synthetic users and jobs
   and rolls back, but existing lead/auth triggers can still queue external work.
   Running this write-based harness on shared production requires separate approval.
   For a rollout visibility comparison, run the exact read-only
   `supabase/tests/40_leads_rls_baseline.sql` before and after on the intended
   database; the six-role matrix should be unchanged. **Completed on shared
   production through MCP**, with identical matrices for all six existing roles.
   `supabase/tests/131_cx_update_requests_readonly.sql` is the separate
   production-safe harness: reads and count/list RPC calls only, temporary
   checks rolled back. All **33** checks passed on the deployed schema. The
   write-based 130 harness was not run on production.
5. Publish the CRM separately after backend installation. Verify a pending hidden
   job with the assigned CS, unrelated CS, CS Admin, requesting Processor and
   an Operator; verify response, acknowledgement, failed saves and notifications.
   Donut has no counterpart and requires no new ZIP installation.

### Verification boundaries and rollback

The exact migration was applied **twice** to isolated embedded Postgres/PGlite
with a minimal schema fixture: all **40** behavioral harness checks passed.
The exact six-role baseline file produced identical nonempty synthetic matrices
before/after. This verifies the SQL logic, not production's complete trigger stack.
Final local gates: lint completed with 0 errors / 29 existing warnings; typecheck,
build (including Donut v1.7.0 integrity) and staged diff checks passed. All **590**
unit tests across 71 files and all **9** CX Playwright tests passed. A concurrent
unit/build/browser run initially timed out in the existing ZIP dataset preload;
the unchanged full suite passed on its own, with no skipped tests or timeout edits.
Network-isolated browser tests exercise both CS roles at desktop/mobile sizes,
creation from a paid saved card, completion failures, returned updates and excluded
Operator routes. All external HTTP and Supabase websocket traffic is blocked/mocked.
The user explicitly approved migration application, Edge Function deployment and
remote branch publication on 2026-10-13. Supabase MCP installed the exact reviewed
migration and function; MCP-generated database types passed typecheck. Both deployed
RPC bodies match the migration exactly. All 33 production-safe harness checks pass,
including live permitted-role count/list calls and excluded-role/anonymous denials.
Four live HTTP boundary checks pass: CORS preflight 200 and no authentication,
invalid user JWT and API-key-only calls 401. MCP logs confirm those expected
responses, with no runtime error entries in that function's checked 30-minute window.

Advisors were checked before/after: no new security findings. The only new
performance findings are four [unused foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
on the empty new table; they intentionally protect future history/FK lookups and
are not removed merely to silence the advisor. Existing unrelated warnings,
including [anonymous definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
remain unchanged and need their own review rather than a bundled permissions change.

No test customer/auth/request records or external customer messages were created
on production. CRM publication and a signed-in, real create → CS Updated →
acknowledgement workflow remain unverified: Supabase MCP does not render the
frontend or provide user login sessions. Frontend workflows were verified with
the network-isolated Playwright tests, not a claimed production browser session.

To roll back, remove the UI entry and revoke authenticated execution of **both**
RPC functions as described at the migration's end. Retain request/audit history;
export and approve archival before any table deletion. Do not drop the shared
`marshmallow_private` schema. There are no lead status/schedule repairs to reverse.

## Quo configuration

Open [Marshmallow Edge Function Secrets](https://supabase.com/dashboard/project/kxiqholnmhkwhdkhtopp/functions/secrets).
Add `QUO_API_KEY` with the **raw Quo API key**. Do not prefix it with `Bearer`:
the [Quo API](https://www.quo.com/docs/api-reference/messages/list-messages) uses
the key directly in its server-side Authorization header. Optionally set
`QUO_API_BASE_URL` to `https://api.quo.com/v1` for all Quo sync functions.

`OPENAI_API_KEY` enables AI review. `QUO_WEBHOOK_SECRET` is a separate webhook
signature secret; do not replace it with the Quo API key. Never put these keys in
CRM frontend environment variables, extension Settings or the ZIP. Quo and AI
requests run in authenticated Edge Functions.

Secrets become available without redeploying. Retry a technician with a valid
saved Quo link, then check the returned source, message count and quoted evidence.
If history is still missing, confirm the key can access the saved phone line and
sync the conversation from the CRM. The native Donut panel uses the same endpoint.

## Free address lookup

The free Leaflet/OpenStreetMap uses Census-derived street coordinates. The shared
`geocode-lead-address` endpoint never calls Google, even if Google keys exist.
Both clients reject non-Census coordinate responses rather than treating an unknown
provider as Census. CRM coordinate updates preserve the customer's address and
use an optimistic address guard. Nearby-area generation persists only a Census
match of the saved location; city/ZIP/unsaved-preview fallbacks cannot overwrite
the lead's map point. Apartment/unit details remain intact.

Optional Google address confirmation in the urgent-review service is a separate
flow; its latitude/longitude are not used for this free map. A Google key is not
required for map coordinates or coverage previews. Review Google's content storage
and attribution terms before enabling optional Google-derived address content.
