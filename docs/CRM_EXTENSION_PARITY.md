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
| Operator hold alerts | All OPR/OPR Admin users receive a grey, expandable read-only card and persistent bell history when an urgent job becomes Ready to Schedule, Scheduled or Cancelled; pending urgent cancellations are remembered until final cancellation | No native Operator notification inbox or map filter controls in Donut; no extension source change required | One database trigger handles saved transitions from any client; recipient-only `lead_hold_alerts` RLS, server-owned field-whitelisted snapshots with hidden quotes redacted, revision-checked acknowledgement RPC. Existing lead/status approval gates remain unchanged. See `docs/OPERATOR_WORKFLOW_ROLLOUT.md`. |
| Map service/state filters | Responsive paired filters, non-shrinking grid widths, clipped long labels, collision-aware menus; Leaflet stays in its own stacking context | No equivalent map toolbar in native intake panel | UI-only layout change. No coordinate-provider, coverage, permission or storage changes. |
| Release updates | Latest/installed version, date/time, automatic notice and ZIP instructions | Installed version/date, update notice in panel/settings | `extension-release.json`, bundled `release.json`, manifest and version-correlated bridge. |

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
