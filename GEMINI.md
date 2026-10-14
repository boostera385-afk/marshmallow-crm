# Rule: Comprehensive Role & Feature Updates
When asked to modify a feature, especially role-based access or permissions, you MUST comprehensively check and update ALL related layers. Do NOT make piecemeal changes. Always investigate the full lifecycle of the feature before claiming it is done.

Checklist for Role/Feature changes:
1. **Frontend UI/Dropdowns**: Does the user have the UI option available? (e.g., check `src/lib/constants.ts` or `access.ts` for dropdown configs, hidden statuses, or rendering conditions).
2. **Frontend Permissions**: Does the user have the permission to trigger the action in the codebase? (e.g., `canCreate...` functions).
3. **Database RLS Policies**: Is there a Row Level Security policy in Supabase that restricts `INSERT`, `UPDATE`, `DELETE`, or `SELECT` for this action based on role? (Grep the `supabase/migrations` folder).
4. **Backend Functions/Webhooks**: Are there any Supabase Edge Functions that enforce role checks?
5. **Database Types/Enums**: Does the database schema or TypeScript types need updating?

Never declare a change "done" until you have verified the entire chain from the UI click to the database storage.

# Rule: CRM and Extension Must Stay Synchronized
Every CRM feature change must include an audit of its Donut counterpart. If the
feature exists in both, update both clients in the same task and use the same
authenticated Edge Function/RPC. Verify the parity matrix in
`docs/CRM_EXTENSION_PARITY.md`, run behavior tests, prepare a higher Donut version
with `npm run extension:release`, and commit its metadata and ZIP. Report backend
deployment, CRM publication, and manual extension installation separately. Never
claim "all tasks completed" based only on a successful build or an HTTP 200.

# Rule: Supabase Migrations Notification
Whenever you create or modify a database migration (SQL query) and push it to GitHub, you MUST always explicitly notify the user that they need to manually run the SQL query in their Supabase dashboard or via the Supabase CLI.

# Rule: Optimization by Default for Every Change
Follow `AGENTS.md` → **Optimization by default** for every feature, fix, and refactor.
Review all affected layers, from UI/cache and API/database work through realtime,
background jobs, storage/bandwidth, and CRM/Donut parity. Remove unnecessary work
without changing functionality, permissions, approvals, alert timing, freshness,
complete data, or recovery behavior. Require behavioral tests and evidence-based
before/after comparisons; local request reductions are not verified bill savings.
Production database changes and deployment still require separate approval.
When commits are authorized, keep each coherent change, tests, and relevant docs
together; never include unrelated local work or create artificial commit counts.
