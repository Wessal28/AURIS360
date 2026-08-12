-- AURIS360 repair for legacy notification rows blocked by the canonical
-- workflow relationship constraint. Safe and rerunnable; no rows are deleted.

begin;

alter table public.notification_queue
  add column if not exists related_module text,
  add column if not exists related_ref text,
  add column if not exists record_url text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.notification_queue
  drop constraint if exists notification_queue_workflow_relationship_check;

update public.notification_queue
set related_module = coalesce(
  nullif(trim(metadata#>>'{relationship,module}'), ''),
  case
    when related_table in ('events','investigations') then 'events'
    when related_table = 'safety_observations' then 'observation'
    when related_table = 'risk_assessments' then 'risk'
    when related_table = 'permits' then 'permit'
    when related_table = 'documents' then 'documents'
    when related_table = 'action_tracker' then 'actions'
    when related_table like 'training_%' or related_table like 'elearning_%' then 'training'
    when related_table = 'companies' then 'admin'
    else related_module
  end)
where nullif(trim(related_module), '') is null;

update public.notification_queue
set related_ref = coalesce(
  nullif(trim(metadata#>>'{relationship,ref}'), ''),
  related_id::text
)
where nullif(trim(related_ref), '') is null
  and related_id is not null;

update public.notification_queue
set record_url = 'https://auris-360.vercel.app/?goto=' ||
    replace(related_module, ' ', '%20') || '&record=' || related_id::text ||
    '&table=' || replace(related_table, ' ', '%20') ||
    '&company=' || company_id::text
where nullif(trim(record_url), '') is null
  and nullif(trim(related_module), '') is not null
  and nullif(trim(related_table), '') is not null
  and related_id is not null;

alter table public.notification_queue
  add constraint notification_queue_workflow_relationship_check
  check (
    type in ('test_email','system')
    or (
      nullif(trim(related_module),'') is not null
      and nullif(trim(related_table),'') is not null
      and related_id is not null
      and nullif(trim(related_ref),'') is not null
    )
  ) not valid;

commit;

notify pgrst, 'reload schema';

-- Diagnostic only: these rows are retained as unresolved legacy history and
-- are intentionally not updated by the personal-inbox recipient backfill.
select id,type,subject,related_module,related_table,related_id,related_ref
from public.notification_queue
where type not in ('test_email','system')
  and (
    nullif(trim(related_module),'') is null
    or nullif(trim(related_table),'') is null
    or related_id is null
    or nullif(trim(related_ref),'') is null
  )
order by created_at desc;
