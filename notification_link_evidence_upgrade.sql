-- AURIS360 privacy-conscious notification record-link evidence.
-- Tracks explicit record-link use; no invisible pixels or email-address data.
begin;
alter table public.notification_queue add column if not exists first_opened_at timestamptz;
create table if not exists public.notification_link_opens (
  notification_id uuid primary key references public.notification_queue(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  destination_hash text not null,
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  open_count integer not null default 1 check(open_count>=1)
);
create index if not exists notification_link_opens_company_time on public.notification_link_opens(company_id,first_opened_at desc);
alter table public.notification_link_opens enable row level security;
drop policy if exists notification_link_opens_company_read on public.notification_link_opens;
create policy notification_link_opens_company_read on public.notification_link_opens for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=notification_link_opens.company_id and p.role in ('admin','hse_manager','hse_officer'))))
);
revoke all on public.notification_link_opens from anon;
grant select on public.notification_link_opens to authenticated;
create or replace function public.record_notification_link_open(p_notification_id uuid,p_destination_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.notification_queue%rowtype; first_open boolean:=false; total integer;
begin
  select * into q from public.notification_queue where id=p_notification_id;
  if not found then return jsonb_build_object('recorded',false,'reason','notification_not_found'); end if;
  insert into public.notification_link_opens(notification_id,company_id,destination_hash)
  values(q.id,q.company_id,p_destination_hash)
  on conflict(notification_id) do update set last_opened_at=now(),open_count=notification_link_opens.open_count+1,destination_hash=excluded.destination_hash
  returning open_count into total;
  first_open:=total=1;
  if first_open then
    update public.notification_queue set first_opened_at=now() where id=q.id and first_opened_at is null;
    insert into public.notification_events(company_id,notification_id,event_type,related_module,related_table,related_id,related_ref,actor_id,detail)
    values(q.company_id,q.id,'record_opened',q.related_module,q.related_table,q.related_id,q.related_ref,null,
      jsonb_build_object('surface','signed_email_link','destination_hash',p_destination_hash));
  end if;
  return jsonb_build_object('recorded',true,'first_open',first_open,'open_count',total);
end; $$;
revoke all on function public.record_notification_link_open(uuid,text) from public,anon,authenticated;
grant execute on function public.record_notification_link_open(uuid,text) to service_role;
comment on table public.notification_link_opens is 'First/last explicit signed email record-link use; stores no recipient address or raw destination.';
commit;
notify pgrst, 'reload schema';
