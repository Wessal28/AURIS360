-- A Draft is private work in progress. Notify the configured incident managers
-- only when it is first reported, using the queue's complete source contract.
-- No existing incident, notification, grant on a table, policy or CHECK changes.
begin;
set local lock_timeout='5s';

do $preflight$
declare routine regprocedure:=to_regprocedure('public.notify_new_incident()');
  company_attnum smallint; key_attnum smallint;
begin
  if routine is null or not exists(select 1 from pg_proc where oid=routine and pronargs=0
    and prorettype='trigger'::regtype and prosecdef) then
    raise exception 'Incident notification repair stopped: the existing notify_new_incident() trigger function requires review';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.events')
    and tgname='trg_notify_incident' and tgfoid=routine and tgtype in (5,21)
    and tgenabled in ('O','A') and not tgisinternal and tgnargs=0 and tgqual is null)
    or exists(select 1 from pg_trigger where tgfoid=routine and not tgisinternal
      and (tgrelid<>to_regclass('public.events') or tgname<>'trg_notify_incident')) then
    raise exception 'Incident notification repair stopped: the incident notification trigger wiring differs from the reviewed baseline';
  end if;
  if exists(select 1 from (values
    ('public.events','id','uuid'::regtype),('public.events','company_id','uuid'::regtype),
    ('public.events','status','text'::regtype),('public.events','event_ref','text'::regtype),
    ('public.events','incident_number','text'::regtype),('public.events','severity','text'::regtype),
    ('public.events','event_date','timestamptz'::regtype),('public.events','location','text'::regtype),
    ('public.events','description','text'::regtype),
    ('public.profiles','id','uuid'::regtype),('public.profiles','company_id','uuid'::regtype),
    ('public.profiles','status','text'::regtype),('public.profiles','role','text'::regtype),
    ('public.profiles','email','text'::regtype),('public.profiles','full_name','text'::regtype),
    ('public.notification_settings','company_id','uuid'::regtype),
    ('public.notification_settings','notify_on_incident','bool'::regtype),('public.notification_settings','email_enabled','bool'::regtype),
    ('public.notification_queue','id','uuid'::regtype),('public.notification_queue','company_id','uuid'::regtype),
    ('public.notification_queue','type','text'::regtype),('public.notification_queue','subject','text'::regtype),
    ('public.notification_queue','body_html','text'::regtype),('public.notification_queue','to_email','text'::regtype),
    ('public.notification_queue','to_name','text'::regtype),('public.notification_queue','status','text'::regtype),
    ('public.notification_queue','channel','text'::regtype),('public.notification_queue','related_module','text'::regtype),
    ('public.notification_queue','related_table','text'::regtype),('public.notification_queue','related_id','uuid'::regtype),
    ('public.notification_queue','related_ref','text'::regtype),('public.notification_queue','record_url','text'::regtype),
    ('public.notification_queue','metadata','jsonb'::regtype),('public.notification_queue','idempotency_key','text'::regtype),
    ('public.notification_queue','recipient_profile_id','uuid'::regtype)
  ) required(relation_name,column_name,type_oid) where not exists(select 1 from pg_attribute
    where attrelid=to_regclass(required.relation_name) and attname=required.column_name
      and attnum>0 and not attisdropped and atttypid=required.type_oid)) then
    raise exception 'Incident notification repair stopped: the incident, manager settings or notification queue schema differs from the reviewed contract';
  end if;
  if not exists(select 1 from pg_class where oid=to_regclass('public.events') and relrowsecurity)
    or not exists(select 1 from pg_class where oid=to_regclass('public.notification_queue') and relrowsecurity) then
    raise exception 'Incident notification repair stopped: incident and notification queue row security must remain enabled';
  end if;
  if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.notification_queue')
    and conname='notification_queue_workflow_relationship_check' and contype='c') then
    raise exception 'Incident notification repair stopped: the queue workflow relationship CHECK is required';
  end if;
  select attnum into company_attnum from pg_attribute where attrelid='public.notification_queue'::regclass and attname='company_id';
  select attnum into key_attnum from pg_attribute where attrelid='public.notification_queue'::regclass and attname='idempotency_key';
  if not exists(select 1 from pg_index i where i.indrelid='public.notification_queue'::regclass
    and i.indexrelid=to_regclass('public.notification_queue_idempotency') and i.indisunique and i.indisvalid
    and i.indnkeyatts=2 and i.indnatts=2 and i.indkey[0]=company_attnum and i.indkey[1]=key_attnum
    and regexp_replace(lower(pg_get_expr(i.indpred,i.indrelid)),'[[:space:]()]','','g')='idempotency_keyisnotnull') then
    raise exception 'Incident notification repair stopped: the reviewed company/idempotency-key unique index is required';
  end if;
end;
$preflight$;

create or replace function public.notify_new_incident() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare
  recipient record;
  source_ref text;
  source_url text;
  email_subject text;
  email_body text;
  notification_key text;
  notification_id uuid;
begin
  -- Do not expose incomplete report content, or send cancellation/import alerts.
  if new.company_id is null or new.id is null or new.status is null
    or new.status in ('draft','cancelled','archived') then return new;end if;
  -- Preserve the new-report scope. A saved Draft must notify on submission,
  -- while ordinary edits and subsequent workflow transitions do not resend it.
  if tg_op='UPDATE' and (old.status is distinct from 'draft' or new.status is not distinct from old.status) then return new;end if;
  if tg_op not in ('INSERT','UPDATE') then return new;end if;
  if not exists(select 1 from public.notification_settings settings where settings.company_id=new.company_id
    and settings.notify_on_incident is true and settings.email_enabled is not false) then return new;end if;

  source_ref:=coalesce(nullif(btrim(new.event_ref),''),nullif(btrim(new.incident_number),''),new.id::text);
  source_url:='https://auris360.app/?goto=events&record='||new.id::text||'&table=events&company='||new.company_id::text;
  email_subject:='[AURIS360] New Incident: '||source_ref||' - '||initcap(coalesce(nullif(btrim(new.severity),''),'unknown'))||' Severity';
  email_body:='<!doctype html><html><body><h2>AURIS360 incident reported</h2><dl>'||
    '<dt>Reference</dt><dd>'||replace(replace(replace(source_ref,'&','&amp;'),'<','&lt;'),'>','&gt;')||'</dd>'||
    '<dt>Severity</dt><dd>'||replace(replace(replace(coalesce(new.severity,'Not assessed'),'&','&amp;'),'<','&lt;'),'>','&gt;')||'</dd>'||
    '<dt>Date</dt><dd>'||coalesce(to_char(new.event_date,'DD Mon YYYY'),'Not recorded')||'</dd>'||
    '<dt>Location</dt><dd>'||replace(replace(replace(coalesce(new.location,'Not recorded'),'&','&amp;'),'<','&lt;'),'>','&gt;')||'</dd>'||
    '<dt>Description</dt><dd>'||replace(replace(replace(left(coalesce(new.description,'Not recorded'),300),'&','&amp;'),'<','&lt;'),'>','&gt;')||'</dd>'||
    '</dl><p><a href="'||replace(source_url,'&','&amp;')||'">Open this incident in AURIS360</a></p></body></html>';

  for recipient in
    select distinct on (lower(btrim(p.email))) p.id,lower(btrim(p.email)) as email,
      coalesce(nullif(btrim(p.full_name),''),lower(btrim(p.email))) as name
    from public.profiles p where p.company_id=new.company_id and p.status='active'
      and p.role in ('hse_manager','admin','sephs_admin','site_manager')
      and btrim(p.email) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      and lower(btrim(p.email)) !~ '[.]local$'
    order by lower(btrim(p.email)),p.id
  loop
    notification_key:='incident-reported:'||new.id::text||':'||md5(recipient.email);
    notification_id:=null;
    insert into public.notification_queue(company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,
      status,channel,related_module,related_table,related_id,related_ref,record_url,metadata,idempotency_key)
    values(new.company_id,recipient.id,'incident',email_subject,email_body,recipient.email,recipient.name,
      'pending','email','events','events',new.id,source_ref,source_url,
      jsonb_build_object('event','incident_reported','relationship',jsonb_build_object(
        'company_id',new.company_id,'module','events','table','events','id',new.id,'ref',source_ref,'url',source_url)),notification_key)
    on conflict(company_id,idempotency_key) where idempotency_key is not null do nothing
    returning id into notification_id;
    if notification_id is null then
      -- A repeated publication may find its existing row. A suppressed or
      -- misdirected queue write must roll back the whole incident transaction.
      select q.id into notification_id from public.notification_queue q where q.company_id=new.company_id
        and q.idempotency_key=notification_key and q.related_module='events' and q.related_table='events'
        and q.related_id=new.id and lower(btrim(q.to_email))=recipient.email;
      if notification_id is null then
        raise exception 'The incident notification could not be confirmed. No incident changes were saved';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.notify_new_incident() from public,anon,authenticated;

drop trigger if exists trg_notify_incident on public.events;
create trigger trg_notify_incident after insert or update of status on public.events
  for each row execute function public.notify_new_incident();

-- The existing Fleet integration may create an assigned review action. Keep
-- unsubmitted vehicle reports out of that notification-producing path too.
-- Projects without this optional helper retain their existing Fleet setup.
do $repair_optional_fleet$
declare helper regprocedure:=to_regprocedure('public.flag_fleet_incident_review()');
begin
  if helper is null then return;end if;
  if not exists(select 1 from pg_proc where oid=helper and pronargs=0 and prorettype='trigger'::regtype and prosecdef
    and md5(regexp_replace(prosrc,'[[:space:]]+','','g')) in
      ('51132c2f56dbc195bfa4d81c91325c4b','a598cb802caa165a0f9f63e5a7d7f47d','9b8142c8b7e1423be31f5508fb143850')) then
    raise exception 'Incident notification repair stopped: the optional Fleet incident review helper differs from its reviewed body. Review it before replacing it';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and tgname='fleet_incident_review_task'
    and tgfoid=helper and tgtype=21 and tgenabled in ('O','A') and not tgisinternal and tgnargs=0 and tgqual is null)
    or exists(select 1 from pg_trigger where tgfoid=helper and not tgisinternal
      and (tgrelid<>'public.events'::regclass or tgname<>'fleet_incident_review_task')) then
    raise exception 'Incident notification repair stopped: the optional Fleet incident review trigger wiring requires review';
  end if;
  execute $fleet_function$
create or replace function public.flag_fleet_incident_review()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_vehicle public.tools_register%rowtype;
  v_review public.action_tracker%rowtype;
  v_review_id uuid;
begin
  if new.status is null or new.status in ('draft','cancelled','archived') then return new;end if;
  if new.company_id is null or nullif(btrim(new.vehicle_reg),'') is null then return new; end if;
  select * into v_vehicle from public.tools_register
    where company_id = new.company_id and is_vehicle = true
      and lower(regexp_replace(coalesce(registration_number,''),'[^a-zA-Z0-9]','','g')) =
          lower(regexp_replace(new.vehicle_reg,'[^a-zA-Z0-9]','','g'))
    limit 1;
  if not found then return new; end if;
  -- A stable ID survives later title, assignment and closure edits. Keep any
  -- older Fleet review row too; do not manufacture another action beside it.
  v_review_id:=md5(new.company_id::text||new.id::text||':fleet_incident_review')::uuid;
  select * into v_review from public.action_tracker where id=v_review_id;
  if found then
    if v_review.company_id is distinct from new.company_id or v_review.source_module is distinct from 'event'
      or v_review.source_type is distinct from 'incident' or v_review.source_id is distinct from new.id then
      raise exception 'The Fleet incident review identity is already in use by a different record. No incident changes were saved';
    end if;
    return new;
  end if;
  if exists(select 1 from public.action_tracker where company_id=new.company_id
    and source_module='fleet_incident_review' and source_id=new.id) then return new;end if;
    insert into public.action_tracker
      (id,company_id,source_module,source_type,source_id,source_ref,title,description,responsible,
       target_date,priority,status,created_by)
    values (v_review_id,new.company_id,'event','incident',new.id,
      coalesce(nullif(btrim(new.event_ref),''),nullif(btrim(new.incident_number),''),new.id::text),
      'Review vehicle after incident: ' || coalesce(v_vehicle.registration_number,v_vehicle.name),
      'Review the linked vehicle incident and determine whether a new inspection or risk assessment is required. Vehicle: '
        || coalesce(v_vehicle.registration_number,v_vehicle.name),
      v_vehicle.assigned_to_name,current_date + 7,'high','open',new.created_by) returning * into v_review;
  if not found or v_review.id is distinct from v_review_id or v_review.company_id is distinct from new.company_id
    or v_review.source_module is distinct from 'event' or v_review.source_type is distinct from 'incident'
    or v_review.source_id is distinct from new.id then
    raise exception 'The Fleet incident review could not be confirmed. No incident changes were saved';
  end if;
  return new;
end;
$$;
  $fleet_function$;
  revoke all on function public.flag_fleet_incident_review() from public,anon,authenticated;
  drop trigger fleet_incident_review_task on public.events;
  create trigger fleet_incident_review_task after insert or update of vehicle_reg,status on public.events
    for each row execute function public.flag_fleet_incident_review();
end;
$repair_optional_fleet$;

commit;
