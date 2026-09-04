-- Keep approved KPI definitions controlled while allowing authorized monthly reporting.

create or replace function public.protect_governed_kpi_monthly_result()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  row_company_id uuid;
  row_indicator_id uuid;
  row_kpi_id uuid;
  parent_state text;
begin
  if current_setting('auris.kpi_result_write',true)='allowed' then
    if tg_op='DELETE' then return old;end if;
    return new;
  end if;

  row_company_id:=case when tg_op='DELETE' then old.company_id else new.company_id end;
  row_indicator_id:=case when tg_op='DELETE' then old.indicator_id else new.indicator_id end;
  row_kpi_id:=case when tg_op='DELETE' then old.kpi_id else new.kpi_id end;

  select k.approval_status
    into parent_state
    from public.kpi_indicators i
    join public.kpis_v2 k on k.id=i.kpi_id and k.company_id=row_company_id
   where i.id=row_indicator_id
     and (row_kpi_id is null or row_kpi_id=k.id);

  if parent_state is null then
    raise exception 'AURIS_KPI_PARENT_REQUIRED' using errcode='23503';
  end if;
  if parent_state in ('submitted','verified') then
    raise exception 'AURIS_KPI_REVIEW_IN_PROGRESS' using errcode='42501';
  end if;

  if tg_op='DELETE' then return old;end if;
  return new;
end;$$;

drop trigger if exists trg_protect_governed_kpi_monthly_data on public.kpi_monthly_data;
create trigger trg_protect_governed_kpi_monthly_data
before insert or update or delete on public.kpi_monthly_data
for each row execute function public.protect_governed_kpi_monthly_result();

revoke all on function public.protect_governed_kpi_monthly_result() from public,anon,authenticated;

comment on function public.protect_governed_kpi_monthly_result() is
'Separates immutable KPI definitions from tenant-scoped monthly results: review states remain frozen, while approved and locked KPIs continue normal reporting.';

notify pgrst,'reload schema';
