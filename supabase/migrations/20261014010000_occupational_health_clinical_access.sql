-- Full Occupational Health records are limited to clinical staff and administrators.
-- Existing tenant and module policies still apply in addition to this restriction.
create or replace function public.can_access_occupational_health_clinical()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('occupational_health', 'sephs_admin', 'admin')
  );
$$;
revoke all on function public.can_access_occupational_health_clinical() from public;
grant execute on function public.can_access_occupational_health_clinical() to authenticated;

do $$
declare clinical_table text;
begin
  foreach clinical_table in array array[
    'medical_surveillance', 'audiometry_records', 'spirometry_records',
    'vaccination_records', 'occupational_diseases', 'exposure_monitoring'
  ] loop
    execute format('drop policy if exists clinical_role_access on public.%I', clinical_table);
    execute format(
      'create policy clinical_role_access on public.%I as restrictive for all to authenticated using (public.can_access_occupational_health_clinical()) with check (public.can_access_occupational_health_clinical())',
      clinical_table
    );
  end loop;
end $$;

-- A deliberately narrow operational projection. It never returns diagnosis, tests,
-- measurements, referral details, medical notes or record identifiers.
create or replace function public.occupational_fitness_summaries(p_company_id uuid)
returns table (
  employee_name text, employee_id text, department text,
  exam_date date, next_exam_date date, fitness_status text, restrictions text
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id = auth.uid();
  if not found or actor.status is distinct from 'active'
     or actor.role is null
     or actor.role not in ('occupational_health', 'sephs_admin', 'admin',
                           'hse_manager', 'hse_officer', 'manager', 'site_manager', 'supervisor')
     or (actor.role is distinct from 'sephs_admin' and actor.company_id is distinct from p_company_id)
     or not public.user_access_allowed('ohealth', 'view') then
    raise exception 'Occupational Health summary unavailable' using errcode = '42501';
  end if;
  return query
    select distinct on (coalesce(nullif(m.employee_id, ''), m.person_id::text, lower(m.employee_name)))
      m.employee_name, m.employee_id, m.department, m.exam_date, m.next_exam_date,
      m.fitness_status,
      case when m.fitness_status = 'fit_with_restrictions' then m.restrictions else null end
    from public.medical_surveillance m
    where m.company_id = p_company_id and m.status not in ('cancelled', 'archived')
    order by coalesce(nullif(m.employee_id, ''), m.person_id::text, lower(m.employee_name)),
             m.exam_date desc, m.created_at desc;
end $$;
revoke all on function public.occupational_fitness_summaries(uuid) from public;
grant execute on function public.occupational_fitness_summaries(uuid) to authenticated;
