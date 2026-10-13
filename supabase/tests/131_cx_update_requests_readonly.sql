-- Production-safe rollout checks for Get CX Update. Run exact text as postgres.
-- Reads existing role identities and invokes only count/list RPC actions. No
-- customer records, request rows, notifications or auth users are written.
-- Only temporary checks/functions are created; all roll back. Outputs PASS/FAIL
-- only (never customer projections). Behavioral mutations remain in local 130.
begin;
create temp table _cx_live_checks(name text, result text);
grant select, insert on _cx_live_checks to authenticated, anon;
create function pg_temp.cx_live_check(label text, ok boolean) returns void language sql as $$
  insert into _cx_live_checks values(label, case when ok then 'PASS' else 'FAIL' end);
$$;
create function pg_temp.cx_live_denied(label text, statement text) returns void language plpgsql as $$
begin
  execute statement;
  perform pg_temp.cx_live_check(label, false);
exception when insufficient_privilege then
  perform pg_temp.cx_live_check(label, true);
end $$;

select pg_temp.cx_live_check('Request table RLS enabled', (select relrowsecurity from pg_class where oid='public.lead_cx_update_requests'::regclass));
select pg_temp.cx_live_check('Authenticated request read granted', has_table_privilege('authenticated','public.lead_cx_update_requests','SELECT'));
select pg_temp.cx_live_check('Authenticated direct insert/update/delete denied', not has_table_privilege('authenticated','public.lead_cx_update_requests','INSERT') and not has_table_privilege('authenticated','public.lead_cx_update_requests','UPDATE') and not has_table_privilege('authenticated','public.lead_cx_update_requests','DELETE'));
select pg_temp.cx_live_check('Anonymous request reads denied', not has_table_privilege('anon','public.lead_cx_update_requests','SELECT'));
select pg_temp.cx_live_check('Public RPC is invoker with fixed search path', (select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.cx_update_requests(text,uuid,uuid,text,integer)'::regprocedure));
select pg_temp.cx_live_check('Private RPC is definer with fixed search path', (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='marshmallow_private.cx_update_requests(text,uuid,uuid,text,integer)'::regprocedure));
select pg_temp.cx_live_check('Anonymous cannot execute either RPC', not has_function_privilege('anon','public.cx_update_requests(text,uuid,uuid,text,integer)','EXECUTE') and not has_function_privilege('anon','marshmallow_private.cx_update_requests(text,uuid,uuid,text,integer)','EXECUTE'));
select pg_temp.cx_live_check('Authenticated can execute public RPC', has_function_privilege('authenticated','public.cx_update_requests(text,uuid,uuid,text,integer)','EXECUTE'));
select pg_temp.cx_live_check('One pending request unique index installed', exists(select 1 from pg_index where indexrelid='public.lead_cx_update_one_pending'::regclass and indisunique and indisvalid));
select pg_temp.cx_live_check('Realtime request publication installed', exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lead_cx_update_requests'));
select pg_temp.cx_live_check('Exactly one SELECT-only request policy', (select count(*)=1 and bool_and(cmd='SELECT') from pg_policies where schemaname='public' and tablename='lead_cx_update_requests'));

select set_config('request.jwt.claim.sub', (select user_id::text from public.user_roles r where role::text='admin' and (select count(*) from public.user_roles where user_id=r.user_id)=1 limit 1), true);
set local role authenticated;
select pg_temp.cx_live_check('Admin count responds', (public.cx_update_requests('count')->>'count')::bigint >= 0);
select pg_temp.cx_live_check('Admin pending queue responds', jsonb_typeof(public.cx_update_requests('list_pending')->'rows')='array');
select pg_temp.cx_live_check('Admin returned queue responds', jsonb_typeof(public.cx_update_requests('list_updated')->'rows')='array');
reset role;

select set_config('request.jwt.claim.sub', (select user_id::text from public.user_roles r where role::text='processor' and (select count(*) from public.user_roles where user_id=r.user_id)=1 limit 1), true);
set local role authenticated;
select pg_temp.cx_live_check('Processor count responds', (public.cx_update_requests('count')->>'count')::bigint >= 0);
select pg_temp.cx_live_check('Processor pending queue responds', jsonb_typeof(public.cx_update_requests('list_pending')->'rows')='array');
select pg_temp.cx_live_check('Processor returned queue responds', jsonb_typeof(public.cx_update_requests('list_updated')->'rows')='array');
reset role;

select set_config('request.jwt.claim.sub', (select user_id::text from public.user_roles r where role::text='customer_service' and (select count(*) from public.user_roles where user_id=r.user_id)=1 limit 1), true);
set local role authenticated;
select pg_temp.cx_live_check('CS count responds', (public.cx_update_requests('count')->>'count')::bigint >= 0);
select pg_temp.cx_live_check('CS pending queue responds', jsonb_typeof(public.cx_update_requests('list_pending')->'rows')='array');
select pg_temp.cx_live_denied('CS returned queue denied', $$select public.cx_update_requests('list_updated')$$);
select pg_temp.cx_live_check('CS request table only exposes assigned pending rows', not exists(select 1 from public.lead_cx_update_requests where status <> 'pending' or recipient_cs is distinct from auth.uid()));
reset role;

select set_config('request.jwt.claim.sub', (select user_id::text from public.user_roles r where role::text='cs_admin' and (select count(*) from public.user_roles where user_id=r.user_id)=1 limit 1), true);
set local role authenticated;
select pg_temp.cx_live_check('CS Admin count responds', (public.cx_update_requests('count')->>'count')::bigint >= 0);
select pg_temp.cx_live_check('CS Admin pending queue responds', jsonb_typeof(public.cx_update_requests('list_pending')->'rows')='array');
select pg_temp.cx_live_denied('CS Admin returned queue denied', $$select public.cx_update_requests('list_updated')$$);
select pg_temp.cx_live_check('CS Admin request table hides completed rows', not exists(select 1 from public.lead_cx_update_requests where status <> 'pending'));
reset role;

select set_config('request.jwt.claim.sub', (select user_id::text from public.user_roles r where role::text='opr' and (select count(*) from public.user_roles where user_id=r.user_id)=1 limit 1), true);
set local role authenticated;
select pg_temp.cx_live_denied('Operator count RPC denied', $$select public.cx_update_requests('count')$$);
select pg_temp.cx_live_denied('Operator pending RPC denied', $$select public.cx_update_requests('list_pending')$$);
select pg_temp.cx_live_check('Operator request RLS denies all rows', (select count(*)=0 from public.lead_cx_update_requests));
reset role;

select set_config('request.jwt.claim.sub', (select user_id::text from public.user_roles r where role::text='opr_admin' and (select count(*) from public.user_roles where user_id=r.user_id)=1 limit 1), true);
set local role authenticated;
select pg_temp.cx_live_denied('Operator Admin count RPC denied', $$select public.cx_update_requests('count')$$);
select pg_temp.cx_live_denied('Operator Admin returned RPC denied', $$select public.cx_update_requests('list_updated')$$);
select pg_temp.cx_live_check('Operator Admin request RLS denies all rows', (select count(*)=0 from public.lead_cx_update_requests));
reset role;

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select pg_temp.cx_live_denied('Missing identity RPC denied', $$select public.cx_update_requests('count')$$);
reset role;
set local role anon;
select pg_temp.cx_live_denied('Anonymous RPC denied', $$select public.cx_update_requests('count')$$);
reset role;
select * from _cx_live_checks order by name;
rollback;
