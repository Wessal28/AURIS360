-- AURIS360 tenant-admin action escalation configuration API.
-- Apply after action_notification_escalation_upgrade.sql. Safe and rerunnable.

begin;

create or replace function public.set_notification_escalation_configuration(
  p_company_id uuid,
  p_enabled boolean,
  p_due_soon_days integer,
  p_level_1_days integer,
  p_level_2_days integer,
  p_level_3_days integer,
  p_recipients jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor public.profiles%rowtype; item jsonb; recipient_count integer:=0; selected_profile uuid; override_email text;
begin
  select * into actor from public.profiles where id=auth.uid();
  if not found or not (actor.role='sephs_admin' or (actor.company_id=p_company_id and actor.role in ('admin','hse_manager'))) then
    raise exception 'Only a company administrator or HSE manager can configure escalation';
  end if;
  if p_due_soon_days not between 0 and 90 or p_level_1_days<1 or p_level_2_days<=p_level_1_days or p_level_3_days<=p_level_2_days then
    raise exception 'Escalation thresholds must be ordered';
  end if;
  if jsonb_typeof(coalesce(p_recipients,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_recipients,'[]'::jsonb))>30 then
    raise exception 'Recipients must be an array with no more than 30 entries';
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_recipients,'[]'::jsonb)) loop
    if coalesce((item->>'escalation_level')::integer,0) not between 1 and 3 then raise exception 'Recipient escalation level is invalid'; end if;
    selected_profile:=nullif(item->>'profile_id','')::uuid; override_email:=nullif(lower(trim(item->>'email_override')),'');
    if selected_profile is null and override_email is null then raise exception 'Each recipient requires a user or external email'; end if;
    if selected_profile is not null and not exists(select 1 from public.profiles p where p.id=selected_profile and p.company_id=p_company_id) then raise exception 'Recipient profile is outside the selected company'; end if;
    if override_email is not null and (override_email like '%.local' or override_email!~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'External recipient email is not deliverable'; end if;
  end loop;

  insert into public.notification_escalation_settings(company_id,enabled,due_soon_days,level_1_overdue_days,level_2_overdue_days,level_3_overdue_days,updated_at)
  values(p_company_id,coalesce(p_enabled,true),p_due_soon_days,p_level_1_days,p_level_2_days,p_level_3_days,now())
  on conflict(company_id) do update set enabled=excluded.enabled,due_soon_days=excluded.due_soon_days,
    level_1_overdue_days=excluded.level_1_overdue_days,level_2_overdue_days=excluded.level_2_overdue_days,
    level_3_overdue_days=excluded.level_3_overdue_days,updated_at=now();

  delete from public.notification_escalation_recipients where company_id=p_company_id;
  for item in select value from jsonb_array_elements(coalesce(p_recipients,'[]'::jsonb)) loop
    insert into public.notification_escalation_recipients(company_id,escalation_level,profile_id,display_name,email_override,active,created_at,updated_at)
    values(p_company_id,(item->>'escalation_level')::integer,nullif(item->>'profile_id','')::uuid,
      nullif(trim(item->>'display_name'),''),nullif(lower(trim(item->>'email_override')),''),coalesce((item->>'active')::boolean,true),now(),now());
    recipient_count:=recipient_count+1;
  end loop;
  return jsonb_build_object('company_id',p_company_id,'enabled',coalesce(p_enabled,true),'recipient_count',recipient_count,
    'thresholds',jsonb_build_object('due_soon',p_due_soon_days,'level_1',p_level_1_days,'level_2',p_level_2_days,'level_3',p_level_3_days));
end;
$$;

revoke all on function public.set_notification_escalation_configuration(uuid,boolean,integer,integer,integer,integer,jsonb) from public,anon;
grant execute on function public.set_notification_escalation_configuration(uuid,boolean,integer,integer,integer,integer,jsonb) to authenticated;

comment on function public.set_notification_escalation_configuration(uuid,boolean,integer,integer,integer,integer,jsonb) is
  'Atomically validates and replaces one tenant action-escalation hierarchy; company admin/HSE manager only.';

commit;
notify pgrst, 'reload schema';
