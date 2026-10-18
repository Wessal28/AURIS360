-- Bounded terminal-state cleanup and durable closure confirmations. No historic
-- decision is inferred or rewritten. Closure and its audit entry commit together.
begin;
alter table public.action_tracker add column if not exists closure_checklist jsonb not null default '{}'::jsonb;
alter table public.action_tracker add constraint action_closure_checklist_object check(jsonb_typeof(closure_checklist)='object');
create index if not exists action_notification_inbox_source on public.user_notifications(company_id,related_table,related_id,id);
create index if not exists action_ack_parent_pending on public.notification_queue(company_id,(metadata->>'parent_user_notification_id'))
 where status='pending' and type in ('acknowledgement_reminder','acknowledgement_escalation');
create index if not exists action_activity_exact on public.map_activity_log(company_id,action_id,performed_at desc);

create or replace function public.stop_action_acknowledgement_followups() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare parent_id uuid;
begin
 if lower(coalesce(new.status,'')) not in ('closed','cancelled','canceled','completed','complete','void') or new.status is not distinct from old.status then return new;end if;
 -- Start with this action's inbox rows; never scan every tenant's pending jobs.
 for parent_id in select id from public.user_notifications where company_id=new.company_id and related_table='action_tracker' and related_id=new.id loop
  update public.notification_queue set status='skipped',error_msg='Source action is now '||new.status,locked_at=null,locked_by=null
   where company_id=new.company_id and metadata->>'parent_user_notification_id'=parent_id::text and status='pending' and type in ('acknowledgement_reminder','acknowledgement_escalation');
 end loop;
 update public.user_notifications set dismissed_at=now(),updated_at=now() where company_id=new.company_id and related_table='action_tracker' and related_id=new.id and dismissed_at is null;
 return new;
end $$;

create or replace function public.stop_action_notifications_on_terminal_state() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare queue_id uuid; inbox_id uuid;
begin
 if lower(coalesce(new.status,'')) not in ('closed','cancelled','canceled','completed','complete','void') or new.status is not distinct from old.status then return new;end if;
 for queue_id in select id from public.notification_queue where company_id=new.company_id and related_table='action_tracker' and related_id=new.id and type in ('action','action_due_soon','action_overdue') loop
  update public.notification_queue set status='skipped',error_msg='Source action is now '||new.status,locked_at=null,locked_by=null where id=queue_id and status='pending';
  for inbox_id in select id from public.user_notifications where company_id=new.company_id and source_notification_id=queue_id loop
   update public.user_notifications set dismissed_at=coalesce(dismissed_at,now()),updated_at=now() where id=inbox_id and dismissed_at is null;
   update public.push_delivery_jobs set status='skipped',error_msg='Source action reached a terminal state',locked_at=null,locked_by=null,updated_at=now() where user_notification_id=inbox_id and status='pending';
   update public.whatsapp_delivery_jobs set status='skipped',error_msg='Source action reached a terminal state',locked_at=null,locked_by=null,updated_at=now() where user_notification_id=inbox_id and status='pending';
  end loop;
 end loop;
 return new;
end $$;

create function public.guard_action_closure() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare item jsonb; n integer; required boolean; caller_role text; caller_company uuid; actor text;
begin
 if new.status<>'closed' or (tg_op='UPDATE' and old.status='closed') then return new;end if;
 if tg_op='INSERT' or old.status<>'pending_closure' then raise exception 'Submit the action for closure before approving it.';end if;
 select role,company_id,coalesce(nullif(full_name,''),id::text) into caller_role,caller_company,actor from public.profiles where id=auth.uid();
 if caller_role is null or caller_role not in ('manager','hse_officer','hse_manager','site_manager','admin','sephs_admin') or (caller_role<>'sephs_admin' and caller_company is distinct from new.company_id) then raise exception 'An authorised company reviewer must approve closure.' using errcode='42501';end if;
 if new.progress_pct is distinct from 100 or nullif(btrim(new.evidence),'') is null then raise exception 'Closure requires 100%% completion and an evidence description or controlled-record reference.';end if;
 if old.requires_verification is distinct from false and (new.requires_verification is distinct from old.requires_verification or old.verification_status is distinct from 'passed' or new.verification_status is distinct from 'passed') then raise exception 'Complete the required verification before closure.';end if;
 if nullif(btrim(new.closure_notes),'') is null then raise exception 'Add a closure summary before approving.';end if;
 for n in 1..6 loop
  item:=coalesce(new.closure_checklist->n::text,'{}');required:=n<=2 or (n=3 and old.requires_verification is distinct from false);
  if (item->>'confirmed'='true' and item->>'not_applicable'='true') or (required and (item->>'confirmed' is distinct from 'true' or item->>'not_applicable'='true')) or (not required and item->>'confirmed' is distinct from 'true' and (item->>'not_applicable' is distinct from 'true' or nullif(btrim(item->>'reason'),'') is null)) then raise exception 'Closure confirmation % must be answered; applicable checks require confirmation and N/A requires a reason.',n;end if;
 end loop;
 new.closure_approved_by:=actor;new.closure_approved_date:=current_date;new.completed_date:=current_date;
 return new;
end $$;
create trigger guard_action_closure before insert or update of status on public.action_tracker for each row execute function public.guard_action_closure();

create function public.log_action_closure() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
begin
 if new.status='closed' and old.status is distinct from new.status then
  insert into public.map_activity_log(company_id,action_id,activity_type,performed_by,old_value,new_value,notes)
   values(new.company_id,new.id,'Action closed',new.closure_approved_by,old.status,new.status,new.closure_notes||E'\nClosure confirmations: '||(select string_agg((array['Completion','Evidence','Verification','Root cause','Similar areas','Residual risk / follow-up'])[n]||': '||case when new.closure_checklist->n::text->>'confirmed'='true' then 'Confirmed' else 'N/A - '||(new.closure_checklist->n::text->>'reason') end,'; ' order by n) from generate_series(1,6) n));
 end if;
 return new;
end $$;
create trigger log_action_closure after update of status on public.action_tracker for each row execute function public.log_action_closure();
revoke all on function public.guard_action_closure(),public.log_action_closure() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
