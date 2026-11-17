# Migration history repair (2026-11-17)

`supabase db push` was unsafe on the shared project: the remote history
(`supabase_migrations.schema_migrations`) recorded 121 versions, almost none of
which matched a file in `supabase/migrations/` (migrations had been applied by
hand, through the SQL editor, or through MCP, which stamps its own version).
`db push` would have tried to re-run nearly every local file.

## What was done

1. **Local files** (no SQL changed):
   - Duplicate versions given unique ones: `20261107000001_ai_urgent_features`,
     `20261117000001_technician_processing_workflow`,
     `20261212000001_processor_board_daily_vault_secrets`,
     `20261229000001_quo_webhook_events_retention_14_days`.
   - 8-digit versions widened: `20261011000000_add_can_manage_users`,
     `20261012000000_add_totp_status_rpc`.
   - `20261020000000_technicians_good_tech.sql` converted from UTF-16/CRLF to
     UTF-8/LF (same statement).
2. **Verification that every local file is live.** Each file's tables,
   columns, enum values, cron jobs, indexes, triggers, functions and policies
   were checked against the production catalog (read-only). Files whose
   objects were missing were traced to later migrations that drop or replace
   them. Recent grant/publication/vault-only files were checked individually.
3. **History replaced** in one transaction: the 121 old rows were copied to
   `supabase_migrations.schema_migrations_backup_20261117` (including their
   stored `statements`), then the history was set to exactly the 270 local
   versions. Verified: the md5 of the sorted remote version list equals the
   local one.

## Drift found (recorded as applied so `db push` never runs them)

These were only partly or never applied. Do **not** re-run them as-is:

| File | Not live | Why not to re-run |
| --- | --- | --- |
| `20261016000200_opr_admin_inherits_opr_and_auto_code` | `user_roles_assign_opr_code` trigger, `ensure_opr_code_on_role_assignment()` | Re-running also recreates the old `Scoped lead access` / `Users can view accessible leads` SELECT policies that `20261030160000` consolidated away, widening lead visibility. |
| `20261016000400_enforce_technician_import_rules` | `technicians_validate_required_and_unique` trigger (function exists) | Possibly removed on purpose; confirm before re-adding. |
| `20261021000001_leads_ssp_functions` | `get_lead_status_counts()`, `get_cx_awaiting_urgent_leads()` | Not called by the CRM or Donut. |

Nine remote-only rows had no local file (one-off notification backup/first-run
steps, a rolled-back first attempt, and earlier MCP versions of changes now in
local files). Their SQL is kept in the backup table.

## Going forward

- Apply new migrations with `npm run sb:push` (after `supabase migration list`
  shows only the new files as pending), not through the SQL editor or MCP
  `apply_migration`, which record a different version.
- If something must be applied by hand, record it with
  `supabase migration repair --status applied <version>`.

## Rollback

```sql
begin;
delete from supabase_migrations.schema_migrations;
insert into supabase_migrations.schema_migrations
  select * from supabase_migrations.schema_migrations_backup_20261117;
commit;
```
