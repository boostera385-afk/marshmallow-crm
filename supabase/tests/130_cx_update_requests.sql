-- MANUAL BEHAVIOR HARNESS. WRITES synthetic fixtures; LOCAL/ISOLATED DB ONLY.
-- Never execute on the shared project without explicit approval (triggers may
-- enqueue external work even though the transaction rolls back).
-- Apply 20261013082939_get_cx_update_requests.sql first. Run exact file text as
-- postgres and inspect every PASS/FAIL. All fixtures/results roll back.
begin;
do $$ begin
  if exists(select 1 from public.profiles where id::text like '13000000-%')
    or exists(select 1 from public.leads where id::text like '13000000-%') then
    raise exception 'Reserved CX test IDs already exist; use a clean isolated DB';
  end if;
end $$;
insert into auth.users(id, email) values
 ('13000000-0000-4000-8000-000000000001','cx-admin@example.invalid'),
 ('13000000-0000-4000-8000-000000000002','cx-processor@example.invalid'),
 ('13000000-0000-4000-8000-000000000003','cx-assigned@example.invalid'),
 ('13000000-0000-4000-8000-000000000004','cx-creator@example.invalid'),
 ('13000000-0000-4000-8000-000000000005','cx-csadmin@example.invalid'),
 ('13000000-0000-4000-8000-000000000006','cx-opr@example.invalid'),
 ('13000000-0000-4000-8000-000000000007','cx-opradmin@example.invalid'),
 ('13000000-0000-4000-8000-000000000008','cx-processor2@example.invalid');
insert into public.profiles(id, full_name, email)
 select id, 'Synthetic CX user', email from auth.users where id::text like '13000000-%'
 on conflict(id) do nothing;
-- Only the just-created, collision-checked synthetic identities: an auth trigger
-- may have assigned a default role. The live table is UNIQUE(user_id, role), not
-- UNIQUE(user_id), so replace those fixture defaults before assigning test roles.
delete from public.user_roles where user_id::text like '13000000-%';
insert into public.user_roles(user_id, role) values
 ('13000000-0000-4000-8000-000000000001','admin'),
 ('13000000-0000-4000-8000-000000000002','processor'),
 ('13000000-0000-4000-8000-000000000003','customer_service'),
 ('13000000-0000-4000-8000-000000000004','customer_service'),
 ('13000000-0000-4000-8000-000000000005','cs_admin'),
 ('13000000-0000-4000-8000-000000000006','opr'),
 ('13000000-0000-4000-8000-000000000007','opr_admin'),
 ('13000000-0000-4000-8000-000000000008','processor');
insert into public.leads(id, job_id, customer_name, status, created_by, assigned_cs,
 tech_name, tech_number, processor_notes, customer_schedule_requirements, scheduled_date, scheduled_time_start)
values
 ('13000000-0000-4000-8000-000000000010','CX-TEST-PAID','Synthetic hidden customer','paid',
 '13000000-0000-4000-8000-000000000004','13000000-0000-4000-8000-000000000003',
 'TECH-SECRET','TECH-NUMBER-SECRET','PROCESSOR-SECRET','Friday afternoon','2026-10-16','13:00'),
 ('13000000-0000-4000-8000-000000000011','CX-TEST-FALLBACK','Synthetic fallback','job_done',
 '13000000-0000-4000-8000-000000000004',null,null,null,null,'Keep agreed schedule',null,null),
 ('13000000-0000-4000-8000-000000000012','CX-TEST-NO-CS','Synthetic no CS','cancelled',
 '13000000-0000-4000-8000-000000000002',null,null,null,null,null,null,null);
create temp table _cx_original as select id, to_jsonb(l) as record from public.leads l where id::text like '13000000-%';
create temp table _cx_checks(name text, result text);
grant all on _cx_checks to authenticated, anon;
create function pg_temp.cx_check(label text, ok boolean) returns void language sql as $$
 insert into _cx_checks values (label, case when ok then 'PASS' else 'FAIL' end);
$$;
create function pg_temp.cx_error(label text, statement text, expected_code text) returns void language plpgsql as $$
begin
  execute statement;
  perform pg_temp.cx_check(label, false);
exception when others then
  perform pg_temp.cx_check(label, sqlstate = expected_code);
end $$;

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.cx_error('Blank request rejected', $$select public.cx_update_requests('create','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000020',' ')$$,'22023');
select pg_temp.cx_error('Missing lead denied', $$select public.cx_update_requests('create','13000000-0000-4000-8000-000000000099','13000000-0000-4000-8000-000000000020','Confirm')$$,'42501');
select public.cx_update_requests('create','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000020','Confirm Friday availability');
select public.cx_update_requests('create','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000020','Confirm Friday availability');
select pg_temp.cx_check('Create retry stores exactly one request', (select count(*) = 1 from public.lead_cx_update_requests));
select pg_temp.cx_error('Second pending request denied', $$select public.cx_update_requests('create','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000021','Confirm again')$$,'23505');
select pg_temp.cx_error('Processor cannot complete', $$select public.cx_update_requests('complete',null,'13000000-0000-4000-8000-000000000020','Confirmed')$$,'42501');
select pg_temp.cx_error('Premature acknowledgement denied', $$select public.cx_update_requests('acknowledge',null,'13000000-0000-4000-8000-000000000020')$$,'22023');
select pg_temp.cx_error('Direct request writes denied', $$update public.lead_cx_update_requests set status='cs_updated'$$,'42501');
reset role;

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.cx_check('Creator excluded when a different CS is assigned', (public.cx_update_requests('count')->>'count')::int = 0);
select pg_temp.cx_check('Unassigned agent cannot read request table', (select count(*) = 0 from public.lead_cx_update_requests));
select pg_temp.cx_error('Unassigned agent completion denied', $$select public.cx_update_requests('complete',null,'13000000-0000-4000-8000-000000000020','Wrong agent')$$,'42501');
reset role;

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.cx_check('Assigned agent receives the pending request', (public.cx_update_requests('list_pending')->>'total')::int = 1);
select pg_temp.cx_check('Customer projection never contains technician/processor secrets', public.cx_update_requests('list_pending')::text not like '%SECRET%');
select pg_temp.cx_check('Customer projection omits technician keys', not ((public.cx_update_requests('list_pending')->'rows'->0->'customer') ?| array['tech_name','tech_number','processor_notes','for_us_amount','status']));
select pg_temp.cx_error('CS cannot request updates', $$select public.cx_update_requests('create','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000021','Confirm')$$,'42501');
select pg_temp.cx_error('CS cannot read completed queue', $$select public.cx_update_requests('list_updated')$$,'42501');
select pg_temp.cx_error('Blank response rejected', $$select public.cx_update_requests('complete',null,'13000000-0000-4000-8000-000000000020',' ')$$,'22023');
-- Ignore a spoofed lead ID: authorization and audit must use the saved request.
select public.cx_update_requests('complete','13000000-0000-4000-8000-000000000099','13000000-0000-4000-8000-000000000020','Friday confirmed by customer');
select public.cx_update_requests('complete',null,'13000000-0000-4000-8000-000000000020','Friday confirmed by customer');
select pg_temp.cx_check('Completion removes temporary queue access', (public.cx_update_requests('list_pending')->>'total')::int = 0);
select pg_temp.cx_check('Completion revokes direct request read', (select count(*) = 0 from public.lead_cx_update_requests));
reset role;

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select pg_temp.cx_check('Paid job stays hidden to CS Admin after completion', (select count(*) = 0 from public.leads where id='13000000-0000-4000-8000-000000000010'));
select pg_temp.cx_error('Competing/stale completion denied', $$select public.cx_update_requests('complete',null,'13000000-0000-4000-8000-000000000020','Different response')$$,'40001');
reset role;

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000008',true);
set local role authenticated;
select pg_temp.cx_check('Processor sees returned CS Updated response', public.cx_update_requests('list_updated')->'rows'->0->>'response_text' = 'Friday confirmed by customer');
select pg_temp.cx_error('Non-requesting Processor cannot acknowledge', $$select public.cx_update_requests('acknowledge',null,'13000000-0000-4000-8000-000000000020')$$,'42501');
reset role;

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.cx_update_requests('acknowledge',null,'13000000-0000-4000-8000-000000000020');
select public.cx_update_requests('acknowledge',null,'13000000-0000-4000-8000-000000000020');
select pg_temp.cx_check('Acknowledged response leaves Processor queue', (public.cx_update_requests('list_updated')->>'total')::int = 0);
select public.cx_update_requests('create','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000022','A new follow-up');
select public.cx_update_requests('create','13000000-0000-4000-8000-000000000011','13000000-0000-4000-8000-000000000023','Creator follow-up');
select public.cx_update_requests('create','13000000-0000-4000-8000-000000000012','13000000-0000-4000-8000-000000000024','CS Admin follow-up');
reset role;

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.cx_check('Creator fallback receives only the unassigned job', (public.cx_update_requests('list_pending')->>'total')::int = 1 and public.cx_update_requests('list_pending')->'rows'->0->>'lead_id' = '13000000-0000-4000-8000-000000000011');
select pg_temp.cx_error('NULL recipient cannot admit an unrelated CS agent', $$select public.cx_update_requests('complete',null,'13000000-0000-4000-8000-000000000024','Unauthorized response')$$,'42501');
reset role;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select pg_temp.cx_check('CS Admin receives all pending jobs including no-CS job', (public.cx_update_requests('list_pending')->>'total')::int = 3);
select pg_temp.cx_check('CX access does not expose full hidden lead rows', (select count(*) = 0 from public.leads where id::text like '13000000-%'));
select public.cx_update_requests('complete',null,'13000000-0000-4000-8000-000000000024','CS Admin response');
reset role;

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000006',true);
set local role authenticated;
select pg_temp.cx_error('OPR denied even by direct RPC', $$select public.cx_update_requests('count')$$,'42501');
select pg_temp.cx_check('OPR request RLS denies all rows', (select count(*) = 0 from public.lead_cx_update_requests));
reset role;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000007',true);
set local role authenticated;
select pg_temp.cx_error('OPR Admin direct RPC denied', $$select public.cx_update_requests('list_pending')$$,'42501');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select pg_temp.cx_error('Missing caller identity denied', $$select public.cx_update_requests('count')$$,'42501');
reset role;
set local role anon;
select pg_temp.cx_error('Anonymous RPC execution denied', $$select public.cx_update_requests('count')$$,'42501');
reset role;

-- Simulate a removed requester on a synthetic completed request. NULL must
-- never turn a failed authorization comparison into permission to acknowledge.
update public.lead_cx_update_requests set requested_by=null where id='13000000-0000-4000-8000-000000000024';
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000008',true);
set local role authenticated;
select pg_temp.cx_error('NULL requester cannot admit another Processor', $$select public.cx_update_requests('acknowledge',null,'13000000-0000-4000-8000-000000000024')$$,'42501');
reset role;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.cx_check('Admin can acknowledge an orphaned response', (public.cx_update_requests('acknowledge',null,'13000000-0000-4000-8000-000000000024')->>'saved')::boolean);
reset role;

insert into public.user_roles(user_id, role) values ('13000000-0000-4000-8000-000000000008','customer_service');
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000008',true);
set local role authenticated;
select pg_temp.cx_error('Ambiguous multiple-role caller fails closed', $$select public.cx_update_requests('count')$$,'42501');
reset role;

select pg_temp.cx_check('Every original lead field unchanged, including paid and schedule', not exists(
 select 1 from _cx_original o join public.leads l on l.id=o.id where to_jsonb(l) is distinct from o.record));
select pg_temp.cx_check('Audit contains only successful actions, retries are not duplicates', (select count(*) = 8 from public.activity_logs where action like 'cx_update_%' and user_id::text like '13000000-%'));
select pg_temp.cx_check('Completion audit uses saved request lead, not client-supplied lead ID', exists(select 1 from public.activity_logs where action='cx_update_complete' and user_id='13000000-0000-4000-8000-000000000003' and target_id='13000000-0000-4000-8000-000000000010'));
select pg_temp.cx_check('Assigned recipient and CS Admin were notified', exists(select 1 from public.notifications where title='Get CX Update' and user_id='13000000-0000-4000-8000-000000000003') and exists(select 1 from public.notifications where title='Get CX Update' and user_id='13000000-0000-4000-8000-000000000005'));
select pg_temp.cx_check('Requester receives response notification without a full-lead link', exists(select 1 from public.notifications where title='CS Updated' and user_id='13000000-0000-4000-8000-000000000002' and lead_id is null));
select * from _cx_checks order by name;
rollback;
