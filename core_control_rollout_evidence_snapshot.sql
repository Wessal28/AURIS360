-- AURIS360 Core Control protected rollout evidence snapshot
-- READ ONLY: creates no policy, transition or business record.
-- Run immediately before and after an authorised Pilot -> Paused -> Disabled
-- exercise. Compare snapshot_fingerprint and all four table counts for the
-- selected company. Use a quiet test window so ordinary user activity does
-- not alter the counts between snapshots.

begin;
set transaction read only;

with action_counts as (
  select company_id,count(*)::bigint as records from public.action_tracker group by company_id
), incident_counts as (
  select company_id,count(*)::bigint as records from public.events group by company_id
), inspection_counts as (
  select company_id,count(*)::bigint as records from public.inspections group by company_id
), risk_counts as (
  select company_id,count(*)::bigint as records from public.risk_assessments group by company_id
), health as (
  select company_id,
         count(*) filter (where resolved_at is null)::bigint as open_findings,
         count(*) filter (where resolved_at is null and severity in ('error','critical'))::bigint as blocking_findings
  from public.rollout_health_events
  where cohort_key='core_control' or cohort_key is null
  group by company_id
), transitions as (
  select company_id,
         count(*)::bigint as transition_count,
         count(*) filter (where new_status in ('paused','disabled'))::bigint as rollback_transition_count,
         max(changed_at) as last_transition_at
  from public.rollout_cohort_transitions
  where cohort_key='core_control'
  group by company_id
), snapshot as (
  select c.id as company_id,c.name as company_name,
         coalesce(rc.status,'compatibility') as current_status,
         rc.updated_at as policy_updated_at,
         coalesce((rc.gate_results->>'database')::boolean,false) as gate_database,
         coalesce((rc.gate_results->>'data_safety')::boolean,false) as gate_data_safety,
         coalesce((rc.gate_results->>'security')::boolean,false) as gate_security,
         coalesce((rc.gate_results->>'navigation')::boolean,false) as gate_navigation,
         coalesce((rc.gate_results->>'resilience')::boolean,false) as gate_resilience,
         coalesce((rc.gate_results->>'workflow')::boolean,false) as gate_workflow,
         coalesce((rc.gate_results->>'mobile_offline')::boolean,false) as gate_mobile_offline,
         coalesce((rc.gate_results->>'rollback')::boolean,false) as gate_rollback,
         coalesce(a.records,0) as action_records,
         coalesce(i.records,0) as incident_records,
         coalesce(n.records,0) as inspection_records,
         coalesce(r.records,0) as risk_records,
         coalesce(h.open_findings,0) as open_findings,
         coalesce(h.blocking_findings,0) as blocking_findings,
         coalesce(t.transition_count,0) as transition_count,
         coalesce(t.rollback_transition_count,0) as rollback_transition_count,
         t.last_transition_at
  from public.companies c
  left join public.company_rollout_cohorts rc on rc.company_id=c.id and rc.cohort_key='core_control'
  left join action_counts a on a.company_id=c.id
  left join incident_counts i on i.company_id=c.id
  left join inspection_counts n on n.company_id=c.id
  left join risk_counts r on r.company_id=c.id
  left join health h on h.company_id=c.id
  left join transitions t on t.company_id=c.id
)
select *,
       action_records+incident_records+inspection_records+risk_records as core_record_total,
       (gate_database::int+gate_data_safety::int+gate_security::int+gate_navigation::int+
        gate_resilience::int+gate_workflow::int+gate_mobile_offline::int+gate_rollback::int) as gates_passed,
       md5(concat_ws('|',company_id::text,action_records,incident_records,inspection_records,risk_records)) as snapshot_fingerprint,
       case
         when blocking_findings>0 then 'BLOCKED_BY_HEALTH_FINDING'
         when gate_database and gate_security and gate_navigation then 'PILOT_MINIMUM_GATES_RECORDED'
         else 'BASELINE_ONLY_GATES_PENDING'
       end as exercise_readiness
from snapshot
order by company_name,company_id;

rollback;
