begin;
do $$
declare source_id uuid; next_id uuid; action_id uuid; finding_id uuid; answer text;
begin
  insert into public.inspections
    (site,inspection_date,inspection_type,status,inspector,recurrence_interval,items)
  values
    ('Replay site','2026-10-12','workplace','open','Replay inspector','monthly',
     '[{"category":"Site","item":"Guard","result":"insufficient","observation":"Repair"}]'::jsonb)
  returning id into source_id;
  update public.inspections set status='completed' where id=source_id;
  select id,items->0->>'result' into next_id,answer
    from public.inspections where recurrence_origin_id=source_id;
  if next_id is null or answer is not null then
    raise exception 'Next inspection was not prepared with unanswered checks';
  end if;
  if (select inspection_date from public.inspections where id=next_id) <> date '2026-11-12' then
    raise exception 'Next inspection date is incorrect';
  end if;
  update public.inspections set status='closed' where id=source_id;
  if (select count(*) from public.inspections where recurrence_origin_id=source_id) <> 1 then
    raise exception 'Recurring inspection was duplicated';
  end if;
  insert into public.action_tracker (description,source_module,source_id,status)
    values ('Repair guard','inspection',source_id,'open') returning id into action_id;
  insert into public.audit_findings (inspection_id,description,status,linked_action_id)
    values (source_id,'Guard missing','open',action_id) returning id into finding_id;
  update public.action_tracker set status='pending_verification' where id=action_id;
  if (select status from public.audit_findings where id=finding_id) <> 'awaiting_verification' then
    raise exception 'Completed action did not queue finding for verification';
  end if;
end $$;
rollback;
