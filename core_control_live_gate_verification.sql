-- AURIS360 Core Control live release-gate verification
-- READ ONLY: this script does not create, update, delete or enable a cohort.
-- Run after controlled_rollout_upgrade.sql in the Supabase SQL Editor.

begin;
set transaction read only;

with expected_relations(relation_name) as (
  values
    ('company_rollout_cohorts'),
    ('rollout_health_events'),
    ('rollout_cohort_transitions'),
    ('rollout_cohort_health_summary')
),
schema_state as (
  select
    count(*) filter (where to_regclass('public.'||relation_name) is not null) as present,
    count(*) as expected
  from expected_relations
),
trigger_state as (
  select exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='company_rollout_cohorts'
      and t.tgname='company_rollout_cohort_transition_audit'
      and not t.tgisinternal
  ) as installed
),
rls_state as (
  select count(*) filter (where c.relrowsecurity) as protected
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('company_rollout_cohorts','rollout_health_events','rollout_cohort_transitions')
),
cohort_state as (
  select
    count(*) as saved_policies,
    count(*) filter (where status in ('pilot','enabled')) as active_policies,
    count(*) filter (where status in ('paused','disabled')) as stopped_policies,
    count(*) filter (where status='enabled' and not (
      coalesce((gate_results->>'database')::boolean,false)
      and coalesce((gate_results->>'data_safety')::boolean,false)
      and coalesce((gate_results->>'security')::boolean,false)
      and coalesce((gate_results->>'navigation')::boolean,false)
      and coalesce((gate_results->>'resilience')::boolean,false)
      and coalesce((gate_results->>'workflow')::boolean,false)
      and coalesce((gate_results->>'mobile_offline')::boolean,false)
      and coalesce((gate_results->>'rollback')::boolean,false)
    )) as enabled_without_all_gates
  from public.company_rollout_cohorts
),
transition_state as (
  select
    count(*) as transitions,
    count(*) filter (where new_status in ('paused','disabled')) as rollback_transitions
  from public.rollout_cohort_transitions
),
health_state as (
  select
    count(*) filter (where resolved_at is null) as open_findings,
    count(*) filter (where resolved_at is null and severity in ('error','critical')) as blocking_findings
  from public.rollout_health_events
),
core_records as (
  select 'action_tracker' as source, count(*) as records,
         count(*) filter (where company_id is null) as missing_company from public.action_tracker
  union all
  select 'events',count(*),count(*) filter (where company_id is null) from public.events
  union all
  select 'inspections',count(*),count(*) filter (where company_id is null) from public.inspections
  union all
  select 'risk_assessments',count(*),count(*) filter (where company_id is null) from public.risk_assessments
),
core_state as (
  select sum(records) as records, sum(missing_company) as missing_company
  from core_records
),
checks as (
  select 1 as sort_order,'rollout_schema'::text as check_name,
         case when s.present=s.expected and t.installed and r.protected=3 then 'PASS' else 'REVIEW' end as result,
         format('%s/%s relations; trigger=%s; RLS=%s/3',s.present,s.expected,t.installed,r.protected) as detail
  from schema_state s cross join trigger_state t cross join rls_state r
  union all
  select 2,'cohort_policy_safety',
         case when enabled_without_all_gates=0 then 'PASS' else 'REVIEW' end,
         format('%s saved; %s active; %s stopped; %s enabled without all gates',saved_policies,active_policies,stopped_policies,enabled_without_all_gates)
  from cohort_state
  union all
  select 3,'rollback_transition_history',
         case when (select saved_policies from cohort_state)=0 or transitions>0 then 'PASS' else 'REVIEW' end,
         format('%s transitions; %s Paused/Disabled transitions',transitions,rollback_transitions)
  from transition_state
  union all
  select 4,'rollout_health',
         case when blocking_findings=0 then 'PASS' else 'REVIEW' end,
         format('%s open findings; %s error/critical',open_findings,blocking_findings)
  from health_state
  union all
  select 5,'core_control_company_relationships',
         case when missing_company=0 then 'PASS' else 'REVIEW' end,
         format('%s records; %s missing company_id',records,missing_company)
  from core_state
)
select check_name,result,detail
from (
  select sort_order,check_name,result,detail from checks
  union all
  select 999,'OVERALL',
         case when count(*) filter (where result<>'PASS')=0 then 'PASS' else 'REVIEW' end,
         format('%s of %s checks passed',count(*) filter (where result='PASS'),count(*))
  from checks
) final_results
order by sort_order;

rollback;
