# Operator Todo audit and local implementation

## Scope confirmed by the user

- Hide CRM's Donut button for **OPR and OPR Admin**, not extension sign-in.
- Both roles get one-click **Acknowledge All**, retaining individual acknowledgement.
- Customer-name/CS-notes/full-quote privacy and untagged urgent-only lead visibility
  apply to **regular OPR only**. OPR Admin keeps its existing broader access.
- Implement the missing customer Labor / optional Parts-Materials split in CRM and
  Donut, including CS visibility, without exposing internal technician shares or
  bypassing quote/status approvals.

## Checklist and boundaries

| Item | Finding / implementation | Production status |
| --- | --- | --- |
| Split quote, Materials Yes/No | Shared CRM component on add, detail and legacy drawer; CS can see saved customer-facing amounts, while existing CS editing restrictions and internal-share hiding remain. Native Donut intake persists the same `terms`, `labor_amount`, `material_amount` fields. No means `material_amount = NULL`; selected Yes requires a positive amount. Cards/copy show customer-facing totals; standard technician messages omit absent materials. | Local changes; needs CRM Publish and manual Donut v1.7.3 install/reload. No quote migration required. |
| Regular OPR privacy and safe quote | Regular OPR UI removes customer name, raw quote, email, CS notes and internal For You/For Us values. Its quote shows Quoted/Free Estimate Visit, half of **recorded** labor and full positive materials; no inferred labor from legacy quote text. The CS Notes button/thread no longer mounts/reads for OPR; OPR Admin is unchanged. | **Complete at the API layer (applied 2026-11-13).** `get_operator_safe_leads()` (SECURITY DEFINER) serves a plain OPR's leads with every hidden column NULL at the source, and a RESTRICTIVE policy denies that role any direct `leads` read. A first application briefly left Operators with zero leads because the frontend (`src/pages/LeadsPage.tsx` via `src/lib/operator-safe-leads.ts`) was not yet published; the policy was rolled back, the CRM published (live bundle confirmed to call the RPC), and the policy re-applied. Verified live after re-application: the RPC returns 76 rows for the sampled OPR with zero leakage, a direct OPR `leads` read returns 0, and `40_leads_rls_baseline.sql` shows every other role unchanged. Any future change must publish the frontend before tightening this policy. |
| Operator creates own technicians | Already implemented: `canAddTechnicians`, TechnicianDialog's own-code lock, and deployed technician INSERT/UPDATE RLS. All three current OPR accounts have OPR codes. The existing account used for the read-only audit already has Technicians navigation enabled. | Existing functionality; no technician/customer writes were performed for this task. To enable another user: Settings → Feature Access → that Operator → Technicians. Ensure their profile has an OPR code. Regular OPR cannot select another Operator's code. |
| Tagged jobs hidden from regular OPR | Existing deployed policy limits normal OPR reads to `urgent_job AND cs_tag IS NULL`; frontend does not widen regular OPR status filters for tags. OPR Admin's broader policy is intentionally preserved. | Actual authenticated read-only audit: 76 visible leads, **zero** tagged/non-urgent rows. Existing explicit paid-date grants remain a separate policy and require review before promising this rule overrides every possible future grant. |
| Hide Donut / acknowledge all | Both OPR roles no longer mount the header Donut controls/polling. Popup and bell offer Acknowledge All; single-card Acknowledge remains. Mark all read also acknowledges holds. | Local frontend change; existing authenticated batch RPC is already deployed. No acknowledgement migration needed. |

## Privacy findings — closed (2026-11-13)

Read-only SQL `supabase/tests/181_operator_todo_audit_readonly.sql`, executed through
the real authenticated RLS path on the shared project, originally found 76 raw
customer names, 76 raw quotes and 273 CS note rows readable by the sampled OPR
account. No actual customer values were returned or logged; no customer writes
were performed.

Both fixes below are **applied** to the shared project (`kxiqholnmhkwhdkhtopp`),
via `supabase db query --file ... --linked` rather than `db push` (the linked
migration history is heavily diverged from `supabase/migrations/`, so a `db push`
would attempt to reconcile hundreds of unrelated entries — each file was executed
standalone instead, exactly as written):

1. `supabase/migrations/20261215000000_opr_cs_notes_privacy.sql` — restrictive
   SELECT policy closing regular OPR access to `lead_notes` CS-thread rows.
   Verified on production: `pg_policy` shows the policy live
   (`polpermissive = false`, `polcmd = 'r'`).
2. `supabase/migrations/20261216000000_operator_safe_leads_api.sql` — the
   coordinated safe Operator API this doc previously flagged as missing.
   Applied in full after the CRM publish (see the row above for the brief
   rollback and re-application).
   `get_operator_safe_leads()` (SECURITY DEFINER) returns a plain OPR's visible
   leads with customer_name, customer_email, customer_phone, customer_landline,
   tech_name, tech_number, half_address, latitude, longitude, quote, cs_notes,
   for_you_amount and for_us_amount all NULL at the source, plus the existing
   `location_label`. A new RESTRICTIVE policy denies regular OPR any direct
   `leads` read, so every CRM read for this role (main list, visible-page
   hydration, the urgent-leads overview widget) now goes through this function
   — `src/lib/operator-safe-leads.ts`, wired into `src/pages/LeadsPage.tsx`.

   Verified live against production: the RPC returns exactly 76 rows for the
   sampled OPR account (the same set the original probe found exposed), with
   zero rows leaking any hidden column, zero wrong status/tag, and
   `location_label` populated on every row.
   `supabase/tests/40_leads_rls_baseline.sql` re-run after this migration shows
   only the `opr` row changed (visible: 0, by design — direct reads are now
   denied); every other role's row, including `opr_admin`, is byte-for-byte
   unchanged from the pre-existing baseline.

   **Accepted trade-off:** Realtime `postgres_changes` on `leads` is RLS-gated,
   so it is now silent for this role too. The CRM replaces it with a ~15s
   visibility-gated poll of the same RPC for this role only (was a 60s
   safety-net poll shared with every role). The urgent-leads overview widget's
   "needs CX reply" indicator, which depended on the now-hidden raw
   `customer_phone`, is unavailable for this role — this was discussed and
   accepted explicitly rather than reimplemented with server-side phone
   matching, which remains a separate, explicitly deferred follow-up.

## Data compatibility and release

- No new quote columns or generated-type edits. A positive existing materials
  amount initializes Yes; null/zero initializes No. Choosing No clears the draft
  amount so it cannot return on reselecting Yes or be saved accidentally.
- Existing free-text quote details remain Quote Notes. They are not guessed into
  labor or bulk-repaired. Older jobs with no recorded labor cannot show a reliable
  50% share until a permitted user records that labor amount.
- Built-in quoted technician messages and the former built-in text saved in
  Settings omit the standalone materials line when no materials charge exists.
  Arbitrary administrator-authored prose is preserved, not destructively rewritten.
- Donut retry identity includes the structured quote fields. Finish/reconcile any
  pending old-version submission before upgrading; uncertain saves remain guarded.
- Committing and pushing the code does not apply the prepared migration, deploy
  Edge Functions, publish the CRM or install/reload Donut. The generated manifest,
  release metadata and `public/Donut.zip` travel with the extension source.

## Efficiency review

Quote work uses existing lead columns, reads, caches and saves; no added polling,
joins, jobs or realtime channels. CS's customer-facing summary reuses its existing
lead response. Operator Donut suppression avoids mounting two 60-second checks.
For ordinary hold inboxes, Acknowledge All adds **zero reads and one RPC**, compared
with one RPC per individually acknowledged alert. Overflow inboxes read only
`id,revision` in keyset pages, recipient-scoped and bounded to the observed inbox
time, then make one batch RPC. Later revisions remain unread; read failures cause
no acknowledgement write. Shared mutation state prevents overlapping single/bulk
clicks, and refreshes are scoped to the captured user/role even after failure.
No measured production CPU, bandwidth or invoice savings are claimed.
