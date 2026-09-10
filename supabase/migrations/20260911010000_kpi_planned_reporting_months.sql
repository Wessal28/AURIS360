-- Let periodic KPIs declare the exact months in which a result is expected.
-- Empty arrays retain the legacy schedule for records created before this field.
begin;

alter table public.kpis_v2
  add column if not exists planned_months smallint[] not null default '{}'::smallint[];

alter table public.kpis_v2
  drop constraint if exists kpis_v2_frequency_check;

alter table public.kpis_v2
  add constraint kpis_v2_frequency_check
  check (frequency = any (array['monthly'::text, 'quarterly'::text, 'biannual'::text, 'annual'::text]));

alter table public.kpis_v2
  drop constraint if exists kpis_v2_planned_months_check;

alter table public.kpis_v2
  add constraint kpis_v2_planned_months_check
  check (
    planned_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
    and (
      cardinality(planned_months) = 0
      or (frequency = 'monthly' and cardinality(planned_months) = 12)
      or (frequency = 'quarterly' and cardinality(planned_months) = 4)
      or (frequency = 'biannual' and cardinality(planned_months) = 2)
      or (frequency = 'annual' and cardinality(planned_months) = 1)
    )
  );

comment on column public.kpis_v2.planned_months is
  'Calendar months (1-12) in which a KPI result is due. Empty uses the legacy frequency schedule.';

notify pgrst, 'reload schema';
commit;
