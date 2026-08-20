--
-- PostgreSQL database dump
--

\restrict wtJ7YEDKizyDhK6bqgEhWti3nUNbF49ZQHmSwQq2To4bxPdg0rXqdGsrrGNEGrV

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: audit_push_delivery_job(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_push_delivery_job() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare notification_row record; event_name text;
begin
  if new.status is not distinct from old.status then return new; end if;
  event_name:=case new.status when 'sent' then 'push_sent' when 'failed' then 'push_failed'
    when 'expired' then 'push_subscription_expired' when 'skipped' then 'push_skipped' else null end;
  if event_name is null then return new; end if;
  select n.* into notification_row from public.user_notifications n where n.id=new.user_notification_id;
  if not found then return new; end if;
  insert into public.notification_events(company_id,notification_id,event_type,related_module,related_table,related_id,related_ref,actor_id,detail)
  values(notification_row.company_id,notification_row.source_notification_id,event_name,notification_row.related_module,
    notification_row.related_table,notification_row.related_id,notification_row.related_ref,null,
    jsonb_build_object('channel','push','job_id',new.id,'subscription_id',new.subscription_id,'attempt',new.attempt_count,
      'provider_status',new.provider_status,'error',new.error_msg,'recipient_profile_id',notification_row.recipient_profile_id));
  return new;
end;
$$;


--
-- Name: audit_rollout_cohort_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_rollout_cohort_transition() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if tg_op='INSERT' or old.status is distinct from new.status then
    insert into public.rollout_cohort_transitions(
      company_id,cohort_key,previous_status,new_status,gate_results,
      compatibility_reads,changed_by
    ) values (
      new.company_id,new.cohort_key,
      case when tg_op='INSERT' then null else old.status end,
      new.status,new.gate_results,new.compatibility_reads,auth.uid()
    );
  end if;
  return new;
end;
$$;


--
-- Name: audit_user_notification_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_user_notification_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if new.read_at is not null and old.read_at is null then
    insert into public.notification_events(
      company_id, notification_id, event_type, related_module, related_table,
      related_id, related_ref, actor_id, detail
    ) values (
      new.company_id, new.source_notification_id, 'opened', new.related_module,
      new.related_table, new.related_id, new.related_ref, auth.uid(),
      jsonb_build_object('surface', 'personal_inbox', 'user_notification_id', new.id)
    );
  end if;

  if new.acknowledged_at is not null and old.acknowledged_at is null then
    insert into public.notification_events(
      company_id, notification_id, event_type, related_module, related_table,
      related_id, related_ref, actor_id, detail
    ) values (
      new.company_id, new.source_notification_id, 'acknowledged', new.related_module,
      new.related_table, new.related_id, new.related_ref, auth.uid(),
      jsonb_build_object('surface', 'personal_inbox', 'user_notification_id', new.id)
    );
  end if;
  return new;
end;
$$;


--
-- Name: audit_whatsapp_delivery_job(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_whatsapp_delivery_job() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare event_name text;
begin
  if new.status is not distinct from old.status then return new; end if;
  event_name:=case new.status when 'accepted' then 'whatsapp_accepted' when 'sent' then 'whatsapp_sent'
    when 'delivered' then 'whatsapp_delivered' when 'read' then 'whatsapp_read'
    when 'failed' then 'whatsapp_failed' when 'skipped' then 'whatsapp_skipped' else null end;
  if event_name is not null then insert into public.notification_events(company_id,notification_id,event_type,actor_id,detail)
    values(new.company_id,new.source_notification_id,event_name,null,jsonb_build_object('channel','whatsapp','job_id',new.id,
      'attempt',new.attempt_count,'provider_message_id',new.provider_message_id,'provider_status',new.provider_status,
      'error_code',new.error_code,'error',new.error_msg,'recipient_profile_id',new.recipient_profile_id)); end if;
  return new;
end;
$$;


--
-- Name: auth_company_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_company_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;


--
-- Name: backfill_location_identity(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_location_identity(p_table text, p_site_column text, p_area_column text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare
  area_expr text;
  sql_text text;
begin
  if to_regclass('public.'||p_table) is null then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name=p_site_column) then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name='site_id') then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name='company_id') then return; end if;
  area_expr := case when p_area_column is not null and exists(
    select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name=p_area_column
  ) then format('r.%I::text',p_area_column) else 'null::text' end;

  sql_text := format($q$
    update public.%I r set
      site_id=coalesce(r.site_id,(public.resolve_location_identity(r.company_id,r.%I::text,%s)->>'site_id')::uuid),
      area_id=coalesce(r.area_id,(public.resolve_location_identity(r.company_id,r.%I::text,%s)->>'area_id')::uuid),
      site_name_snapshot=coalesce(r.site_name_snapshot,nullif(trim(r.%I::text),'')),
      area_name_snapshot=coalesce(r.area_name_snapshot,nullif(trim(%s),''))
    where nullif(trim(r.%I::text),'') is not null
  $q$,p_table,p_site_column,area_expr,p_site_column,area_expr,p_site_column,area_expr,p_site_column);
  execute sql_text;

  sql_text := format($q$
    insert into public.location_identity_backfill_review(
      company_id,source_table,source_id,legacy_site,legacy_area,candidate_location_ids
    )
    select r.company_id,%L,r.id::text,r.%I::text,%s,
      coalesce(array(select jsonb_array_elements_text(public.resolve_location_identity(r.company_id,r.%I::text,%s)->'candidate_ids')::uuid),'{}'::uuid[])
    from public.%I r
    where r.site_id is null and nullif(trim(r.%I::text),'') is not null
    on conflict(source_table,source_id) do update set
      legacy_site=excluded.legacy_site,legacy_area=excluded.legacy_area,
      candidate_location_ids=excluded.candidate_location_ids,updated_at=now()
  $q$,p_table,p_site_column,area_expr,p_site_column,area_expr,p_table,p_site_column);
  execute sql_text;
end;
$_$;


--
-- Name: backfill_person_identity(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_person_identity(p_table text, p_name_column text, p_employee_column text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare
  employee_expr text;
  sql_text text;
begin
  if to_regclass('public.'||p_table) is null then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name='person_id') then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name=p_name_column) then return; end if;
  employee_expr := case when p_employee_column is not null and exists(
    select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name=p_employee_column
  ) then format('%I::text',p_employee_column) else 'null::text' end;

  sql_text := format(
    'update public.%I r set person_id=public.resolve_unique_person_id(r.company_id,r.%I::text,%s) where r.person_id is null and nullif(trim(r.%I::text),'''') is not null',
    p_table,p_name_column,employee_expr,p_name_column
  );
  execute sql_text;

  sql_text := format($q$
    insert into public.person_identity_backfill_review(
      company_id,source_table,source_id,legacy_name,legacy_employee_number,candidate_person_ids
    )
    select r.company_id,%L,r.id,r.%I::text,%s,
      coalesce((select array_agg(p.id order by p.id) from public.people p
        where p.company_id=r.company_id and (
          public.normalise_person_identity_text(concat_ws(' ',p.first_name,p.last_name))=public.normalise_person_identity_text(r.%I::text)
          or public.normalise_person_identity_text(concat_ws(', ',p.last_name,p.first_name))=public.normalise_person_identity_text(r.%I::text)
          or lower(coalesce(p.email,''))=lower(trim(r.%I::text))
        )), '{}'::uuid[])
    from public.%I r
    where r.person_id is null and nullif(trim(r.%I::text),'') is not null
    on conflict(source_table,source_id) do update set
      legacy_name=excluded.legacy_name,legacy_employee_number=excluded.legacy_employee_number,
      candidate_person_ids=excluded.candidate_person_ids,updated_at=now()
  $q$,p_table,p_name_column,employee_expr,p_name_column,p_name_column,p_name_column,p_table,p_name_column);
  execute sql_text;
end;
$_$;


--
-- Name: backfill_verified_reference(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_verified_reference(p_source_table text, p_target_id_column text, p_legacy_ref_column text, p_target_table text, p_target_ref_column text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare sql_text text;
begin
  if p_source_table not in ('atex_areas','ppe_issuance','compliance_calendar','work_schedule','permits','documents')
     or p_target_table not in ('risk_assessments','permits','work_schedule','documents','legal_requirements','action_tracker') then
    raise exception 'Reference backfill table is not allowlisted';
  end if;
  if to_regclass('public.'||p_source_table) is null or to_regclass('public.'||p_target_table) is null then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_source_table and column_name='company_id') then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_source_table and column_name=p_target_id_column) then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_source_table and column_name=p_legacy_ref_column) then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_target_table and column_name=p_target_ref_column) then return; end if;

  sql_text:=format($q$
    update public.%I s set %I=m.target_id
    from (
      select src.id as source_id,(array_agg(t.id order by t.id))[1] as target_id
      from public.%I src join public.%I t on t.company_id=src.company_id
       and (t.id::text=trim(src.%I::text) or public.normalise_operational_reference(t.%I::text)=public.normalise_operational_reference(src.%I::text))
      where src.%I is null and nullif(trim(src.%I::text),'') is not null
      group by src.id having count(*)=1
    ) m where s.id=m.source_id
  $q$,p_source_table,p_target_id_column,p_source_table,p_target_table,p_legacy_ref_column,p_target_ref_column,p_legacy_ref_column,p_target_id_column,p_legacy_ref_column);
  execute sql_text;

  sql_text:=format($q$
    insert into public.reference_identity_backfill_review(
      company_id,source_table,source_id,source_field,legacy_reference,target_table,candidate_target_ids
    )
    select s.company_id,%L,s.id::text,%L,s.%I::text,%L,
      coalesce((select array_agg(t.id order by t.id) from public.%I t where t.company_id=s.company_id
        and (t.id::text=trim(s.%I::text) or public.normalise_operational_reference(t.%I::text)=public.normalise_operational_reference(s.%I::text))),'{}'::uuid[])
    from public.%I s where s.%I is null and nullif(trim(s.%I::text),'') is not null
    on conflict(source_table,source_id,source_field) do update set
      legacy_reference=excluded.legacy_reference,target_table=excluded.target_table,
      candidate_target_ids=excluded.candidate_target_ids,updated_at=now()
  $q$,p_source_table,p_target_id_column,p_legacy_ref_column,p_target_table,p_target_table,p_legacy_ref_column,p_target_ref_column,p_legacy_ref_column,p_source_table,p_target_id_column,p_legacy_ref_column);
  execute sql_text;
end;
$_$;


--
-- Name: capture_notification_attempt(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_notification_attempt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if new.attempt_count is not distinct from old.attempt_count then
    return new;
  end if;

  insert into public.notification_events(
    company_id, notification_id, event_type,
    related_module, related_table, related_id, related_ref, actor_id, detail
  ) values (
    new.company_id, new.id,
    case when new.status = 'pending' and new.next_attempt_at > now()
      then 'retry_scheduled' else 'delivery_attempt' end,
    new.related_module, new.related_table, new.related_id, new.related_ref, null,
    jsonb_build_object(
      'attempt', new.attempt_count,
      'next_attempt_at', new.next_attempt_at,
      'worker', new.locked_by,
      'provider', new.provider,
      'error', new.error_msg
    )
  );
  return new;
end;
$$;


--
-- Name: capture_notification_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_notification_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare v_event text;
begin
  if tg_op='INSERT' then v_event:=case when new.status='failed' then 'delivery_failed' else 'queued' end;
  elsif new.status is distinct from old.status then v_event:=case new.status when 'sent' then 'sent' when 'delivered' then 'delivered'
    when 'failed' then 'delivery_failed' when 'bounced' then 'bounced' when 'skipped' then 'skipped'
    else 'status_'||coalesce(new.status,'unknown') end;
  else return new; end if;
  insert into public.notification_events(company_id,notification_id,event_type,related_module,related_table,related_id,related_ref,actor_id,detail)
  values(new.company_id,new.id,v_event,new.related_module,new.related_table,new.related_id,new.related_ref,auth.uid(),
    jsonb_build_object('status',new.status,'channel',coalesce(new.channel,'email'),'error',new.error_msg,
      'recipient_profile_id',new.recipient_profile_id));
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: notification_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    type text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    to_email text NOT NULL,
    to_name text,
    from_name text DEFAULT 'AURIS360 by SEPHS Consulting'::text,
    related_id uuid,
    related_table text,
    status text DEFAULT 'pending'::text,
    error_msg text,
    created_at timestamp with time zone DEFAULT now(),
    sent_at timestamp with time zone,
    retry_count integer DEFAULT 0,
    resend_id text,
    channel text DEFAULT 'email'::text NOT NULL,
    to_phone text,
    in_app_seen_at timestamp with time zone,
    priority text DEFAULT 'normal'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    related_module text,
    related_ref text,
    record_url text,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_attempt_at timestamp with time zone,
    provider text,
    provider_message_id text,
    delivered_at timestamp with time zone,
    bounced_at timestamp with time zone,
    idempotency_key text,
    recipient_profile_id uuid,
    first_opened_at timestamp with time zone,
    CONSTRAINT notification_queue_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT notification_queue_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'in_app'::text, 'whatsapp'::text, 'sms'::text]))),
    CONSTRAINT notification_queue_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])))
);


--
-- Name: COLUMN notification_queue.idempotency_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_queue.idempotency_key IS 'Optional producer-supplied key preventing duplicate notification creation within a company.';


--
-- Name: claim_notification_queue(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_notification_queue(p_limit integer DEFAULT 50, p_worker_id text DEFAULT NULL::text) RETURNS SETOF public.notification_queue
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with due as (
    select q.id
    from public.notification_queue q
    where q.status = 'pending'
      and coalesce(q.next_attempt_at, q.created_at, now()) <= now()
      and (q.locked_at is null or q.locked_at < now() - interval '10 minutes')
    order by coalesce(q.next_attempt_at, q.created_at), q.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.notification_queue q
  set locked_at = now(),
      locked_by = coalesce(nullif(trim(p_worker_id), ''), 'notification-worker'),
      last_attempt_at = now(),
      attempt_count = coalesce(q.attempt_count, 0) + 1
  from due
  where q.id = due.id
  returning q.*;
end;
$$;


--
-- Name: FUNCTION claim_notification_queue(p_limit integer, p_worker_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.claim_notification_queue(p_limit integer, p_worker_id text) IS 'Service-role-only atomic lease for due notification delivery jobs.';


--
-- Name: push_delivery_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_delivery_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    user_notification_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_attempt_at timestamp with time zone,
    sent_at timestamp with time zone,
    error_msg text,
    provider_status integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_delivery_jobs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT push_delivery_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'expired'::text, 'skipped'::text])))
);


--
-- Name: TABLE push_delivery_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.push_delivery_jobs IS 'Auditable, retryable delivery jobs for high/urgent personal notifications.';


--
-- Name: claim_push_delivery_jobs(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_push_delivery_jobs(p_limit integer DEFAULT 50, p_worker_id text DEFAULT NULL::text) RETURNS SETOF public.push_delivery_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.push_delivery_jobs j
  set status = 'skipped', error_msg = 'Notification no longer requires push',
      locked_at = null, locked_by = null, updated_at = now()
  from public.user_notifications n
  where j.user_notification_id = n.id
    and j.status = 'pending'
    and (
      n.dismissed_at is not null
      or (n.read_at is not null and (not n.acknowledgement_required or n.acknowledged_at is not null))
    );

  update public.push_delivery_jobs j
  set status = 'skipped', error_msg = 'Browser push subscription is disabled',
      locked_at = null, locked_by = null, updated_at = now()
  from public.push_subscriptions s
  where j.subscription_id = s.id
    and j.status = 'pending'
    and not s.enabled;

  return query
  with due as (
    select j.id
    from public.push_delivery_jobs j
    join public.push_subscriptions s on s.id = j.subscription_id
    join public.user_notifications n on n.id = j.user_notification_id
    where j.status = 'pending'
      and j.next_attempt_at <= now()
      and (j.locked_at is null or j.locked_at < now() - interval '10 minutes')
      and s.enabled
      and n.dismissed_at is null
      and (n.read_at is null or n.acknowledgement_required and n.acknowledged_at is null)
    order by case n.severity when 'urgent' then 0 when 'high' then 1 else 2 end,
      j.next_attempt_at, j.created_at
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.push_delivery_jobs j
  set status = 'processing', locked_at = now(),
      locked_by = coalesce(nullif(trim(p_worker_id), ''), 'push-worker'),
      last_attempt_at = now(), attempt_count = j.attempt_count + 1,
      updated_at = now()
  from due
  where j.id = due.id
  returning j.*;
end;
$$;


--
-- Name: whatsapp_delivery_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_delivery_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    recipient_profile_id uuid NOT NULL,
    user_notification_id uuid NOT NULL,
    source_notification_id uuid NOT NULL,
    phone_snapshot text NOT NULL,
    template_name text NOT NULL,
    template_language text DEFAULT 'en'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_attempt_at timestamp with time zone,
    provider_message_id text,
    provider_status text,
    accepted_at timestamp with time zone,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    failed_at timestamp with time zone,
    error_code text,
    error_msg text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_delivery_jobs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT whatsapp_delivery_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'accepted'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: TABLE whatsapp_delivery_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_delivery_jobs IS 'Tenant-safe, retryable Meta WhatsApp template delivery queue.';


--
-- Name: claim_whatsapp_delivery_jobs(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_whatsapp_delivery_jobs(p_limit integer DEFAULT 50, p_worker_id text DEFAULT NULL::text) RETURNS SETOF public.whatsapp_delivery_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.whatsapp_delivery_jobs j set status='skipped',error_msg='Notification no longer requires WhatsApp delivery',updated_at=now()
  from public.user_notifications n where j.user_notification_id=n.id and j.status='pending'
    and (n.dismissed_at is not null or (n.read_at is not null and (not n.acknowledgement_required or n.acknowledged_at is not null)));
  update public.whatsapp_delivery_jobs j set status='skipped',error_msg='Recipient consent is no longer active',updated_at=now()
  from public.profiles p where j.recipient_profile_id=p.id and j.status='pending'
    and (p.whatsapp_opted_in_at is null or p.whatsapp_opted_out_at is not null);
  return query with due as (
    select j.id from public.whatsapp_delivery_jobs j
    where j.status='pending' and j.next_attempt_at<=now()
      and (j.locked_at is null or j.locked_at<now()-interval '10 minutes')
    order by j.next_attempt_at,j.created_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,50),100))
  ) update public.whatsapp_delivery_jobs j set status='processing',locked_at=now(),
    locked_by=coalesce(nullif(trim(p_worker_id),''),'whatsapp-worker'),last_attempt_at=now(),
    attempt_count=j.attempt_count+1,updated_at=now() from due where j.id=due.id returning j.*;
end;
$$;


--
-- Name: record_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.record_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    source_module text NOT NULL,
    source_table text NOT NULL,
    source_id text NOT NULL,
    source_ref text,
    target_module text NOT NULL,
    target_table text NOT NULL,
    target_id text NOT NULL,
    target_ref text,
    relationship_type text DEFAULT 'related_to'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    source_revision text,
    target_revision text,
    applicability jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_valid boolean DEFAULT false NOT NULL,
    target_valid boolean DEFAULT false NOT NULL,
    validation_error text,
    last_validated_at timestamp with time zone,
    verified_at timestamp with time zone,
    verified_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    endpoint_a text GENERATED ALWAYS AS (LEAST(((((lower(source_module) || ':'::text) || lower(source_table)) || ':'::text) || source_id), ((((lower(target_module) || ':'::text) || lower(target_table)) || ':'::text) || target_id))) STORED,
    endpoint_b text GENERATED ALWAYS AS (GREATEST(((((lower(source_module) || ':'::text) || lower(source_table)) || ':'::text) || source_id), ((((lower(target_module) || ':'::text) || lower(target_table)) || ':'::text) || target_id))) STORED,
    source_state text DEFAULT 'unresolved'::text NOT NULL,
    target_state text DEFAULT 'unresolved'::text NOT NULL,
    CONSTRAINT record_relationships_check CHECK ((((((lower(source_module) || ':'::text) || lower(source_table)) || ':'::text) || source_id) <> ((((lower(target_module) || ':'::text) || lower(target_table)) || ':'::text) || target_id))),
    CONSTRAINT record_relationships_source_state_check CHECK ((source_state = ANY (ARRAY['active'::text, 'archived'::text, 'broken'::text, 'unresolved'::text]))),
    CONSTRAINT record_relationships_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending_verification'::text, 'unresolved'::text, 'broken'::text, 'endpoint_archived'::text, 'superseded'::text, 'archived'::text]))),
    CONSTRAINT record_relationships_target_state_check CHECK ((target_state = ANY (ARRAY['active'::text, 'archived'::text, 'broken'::text, 'unresolved'::text])))
);


--
-- Name: create_record_relationship(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_record_relationship(p_company_id uuid, p_source_module text, p_source_table text, p_source_id text, p_source_ref text, p_target_module text, p_target_table text, p_target_id text, p_target_ref text, p_relationship_type text DEFAULT 'related_to'::text, p_source_revision text DEFAULT NULL::text, p_target_revision text DEFAULT NULL::text, p_applicability jsonb DEFAULT '{}'::jsonb, p_allow_unresolved boolean DEFAULT false) RETURNS public.record_relationships
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  result public.record_relationships;
  source_ok boolean;
  target_ok boolean;
begin
  source_ok := public.relationship_endpoint_exists(p_company_id,p_source_module,p_source_table,p_source_id);
  target_ok := public.relationship_endpoint_exists(p_company_id,p_target_module,p_target_table,p_target_id);
  if (not source_ok or not target_ok) and not p_allow_unresolved then
    raise exception 'Relationship endpoint validation failed (source %, target %)', source_ok, target_ok
      using errcode = '23503';
  end if;
  select * into result
  from public.record_relationships r
  where r.company_id=p_company_id
    and r.relationship_type=lower(btrim(p_relationship_type))
    and r.status<>'archived'
    and r.endpoint_a=least(lower(btrim(p_source_module))||':'||lower(btrim(p_source_table))||':'||btrim(p_source_id),lower(btrim(p_target_module))||':'||lower(btrim(p_target_table))||':'||btrim(p_target_id))
    and r.endpoint_b=greatest(lower(btrim(p_source_module))||':'||lower(btrim(p_source_table))||':'||btrim(p_source_id),lower(btrim(p_target_module))||':'||lower(btrim(p_target_table))||':'||btrim(p_target_id));
  if found then return result; end if;
  insert into public.record_relationships(
    company_id,source_module,source_table,source_id,source_ref,
    target_module,target_table,target_id,target_ref,relationship_type,
    source_revision,target_revision,applicability,status,created_by
  ) values (
    p_company_id,p_source_module,p_source_table,p_source_id,p_source_ref,
    p_target_module,p_target_table,p_target_id,p_target_ref,coalesce(nullif(btrim(p_relationship_type),''),'related_to'),
    p_source_revision,p_target_revision,coalesce(p_applicability,'{}'::jsonb),
    case when source_ok and target_ok then 'active' else 'unresolved' end,auth.uid()
  ) returning * into result;
  return result;
end;
$$;


--
-- Name: create_user_notification_from_queue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_user_notification_from_queue() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  recipient_id uuid;
  requires_ack boolean;
  plain_message text;
begin
  recipient_id := public.resolve_notification_recipient_profile(
    new.company_id, new.recipient_profile_id, new.to_email, coalesce(new.metadata, '{}'::jsonb)
  );
  if recipient_id is null then return new; end if;

  requires_ack := coalesce((new.metadata->>'acknowledgement_required')::boolean, false)
    or coalesce(new.priority, 'normal') = 'urgent'
    or (
      new.type = 'action_overdue'
      and coalesce((new.metadata->>'escalation_level')::integer, 0) >= 2
    );
  plain_message := left(trim(regexp_replace(coalesce(new.body_html, ''), '<[^>]*>', ' ', 'g')), 500);

  insert into public.user_notifications(
    company_id, recipient_profile_id, source_notification_id, event_type, severity,
    title, message, related_module, related_table, related_id, related_ref,
    record_url, acknowledgement_required, created_at, updated_at
  ) values (
    new.company_id, recipient_id, new.id, coalesce(new.type, 'system'),
    case when coalesce(new.priority, 'normal') in ('low','normal','high','urgent')
      then coalesce(new.priority, 'normal') else 'normal' end,
    coalesce(nullif(trim(new.subject), ''), 'AURIS360 notification'),
    nullif(plain_message, ''), new.related_module, new.related_table, new.related_id,
    new.related_ref, new.record_url, requires_ack, coalesce(new.created_at, now()), now()
  ) on conflict(source_notification_id, recipient_profile_id) do nothing;

  update public.notification_queue
  set recipient_profile_id = recipient_id
  where id = new.id and recipient_profile_id is null;
  return new;
end;
$$;


--
-- Name: current_user_company(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_company() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1
$$;


--
-- Name: current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1
$$;


--
-- Name: enforce_user_notification_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_user_notification_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'A read notification cannot be returned to unread';
  end if;
  if old.acknowledged_at is not null and (
    new.acknowledged_at is distinct from old.acknowledged_at
    or new.acknowledged_by is distinct from old.acknowledged_by
  ) then
    raise exception 'A notification acknowledgement is immutable';
  end if;
  if new.acknowledged_at is not null and old.acknowledged_at is null then
    if not new.acknowledgement_required then
      raise exception 'This notification does not require acknowledgement';
    end if;
    new.acknowledged_by := auth.uid();
    new.read_at := coalesce(new.read_at, new.acknowledged_at);
  end if;
  return new;
end;
$$;


--
-- Name: evaluate_notification_delivery_policy(uuid, uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.evaluate_notification_delivery_policy(p_company_id uuid, p_profile_id uuid, p_channel text, p_severity text, p_ack_required boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare pref record; local_now timestamp; quiet boolean:=false; urgent_override boolean:=false;
  deliver_after timestamptz:=now(); recent_count integer:=0; channel_enabled boolean:=true;
begin
  if p_profile_id is null then return jsonb_build_object('allowed',true,'deliver_after',now(),'reason','recipient_unresolved'); end if;
  select * into pref from public.notification_user_preferences where profile_id=p_profile_id and company_id=p_company_id;
  if not found then return jsonb_build_object('allowed',true,'deliver_after',now(),'reason','default_preferences'); end if;
  channel_enabled:=case lower(p_channel) when 'email' then pref.email_enabled when 'push' then pref.push_enabled
    when 'whatsapp' then pref.whatsapp_enabled else true end;
  if not channel_enabled then return jsonb_build_object('allowed',false,'deliver_after',null,'reason','channel_disabled'); end if;
  local_now:=now() at time zone pref.timezone;
  if pref.quiet_hours_enabled then
    quiet:=case when pref.quiet_start=pref.quiet_end then true
      when pref.quiet_start<pref.quiet_end then local_now::time>=pref.quiet_start and local_now::time<pref.quiet_end
      else local_now::time>=pref.quiet_start or local_now::time<pref.quiet_end end;
  end if;
  urgent_override:=quiet and lower(coalesce(p_severity,''))='urgent' and coalesce(p_ack_required,false) and pref.allow_urgent_override;
  if quiet and not urgent_override then
    deliver_after:=case when local_now::time<pref.quiet_end
      then ((local_now::date+pref.quiet_end) at time zone pref.timezone)
      else (((local_now::date+1)+pref.quiet_end) at time zone pref.timezone) end;
    return jsonb_build_object('allowed',true,'deliver_after',deliver_after,'reason','quiet_hours_deferred','override',false);
  end if;
  if lower(coalesce(p_severity,'')) not in ('urgent') then
    select count(*) into recent_count from public.notification_events e
    where e.company_id=p_company_id and e.occurred_at>=now()-interval '1 hour'
      and e.detail->>'recipient_profile_id'=p_profile_id::text and e.detail->>'channel'=lower(p_channel)
      and e.event_type in ('sent','delivered','push_sent','whatsapp_accepted','whatsapp_sent','whatsapp_delivered');
    if recent_count>=pref.max_external_alerts_per_hour then
      return jsonb_build_object('allowed',true,'deliver_after',now()+interval '1 hour','reason','rate_limit_deferred','override',false);
    end if;
  end if;
  return jsonb_build_object('allowed',true,'deliver_after',now(),'reason',case when urgent_override then 'urgent_quiet_hours_override' else 'allowed' end,'override',urgent_override);
end;
$$;


--
-- Name: FUNCTION evaluate_notification_delivery_policy(p_company_id uuid, p_profile_id uuid, p_channel text, p_severity text, p_ack_required boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.evaluate_notification_delivery_policy(p_company_id uuid, p_profile_id uuid, p_channel text, p_severity text, p_ack_required boolean) IS 'Service-only central policy; urgent acknowledgement-required alerts may audibly override quiet hours.';


--
-- Name: generate_tool_ref(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_tool_ref(cat text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  prefix text;
  seq_val integer;
BEGIN
  IF cat = 'vehicle' THEN
    prefix := 'VEH-';
    seq_val := nextval('vehicle_ref_seq');
  ELSIF cat IN('hand_tool','power_tool') THEN
    prefix := 'TOOL-';
    seq_val := nextval('tool_ref_seq');
  ELSIF cat = 'lifting' THEN
    prefix := 'LIFT-';
    seq_val := nextval('tool_ref_seq');
  ELSIF cat = 'electrical' THEN
    prefix := 'ELEC-';
    seq_val := nextval('tool_ref_seq');
  ELSE
    prefix := 'EQP-';
    seq_val := nextval('tool_ref_seq');
  END IF;
  RETURN prefix || LPAD(seq_val::text, 3, '0');
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  meta_full_name        text;
  meta_role             text;
  meta_company_id       uuid;
  meta_must_change_pw   boolean;
BEGIN
  -- Extract metadata sent by the edge function (or the signup form)
  meta_full_name      := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  meta_role           := COALESCE(NEW.raw_user_meta_data->>'role', 'employee');
  meta_company_id     := NULLIF(NEW.raw_user_meta_data->>'company_id', '')::uuid;
  meta_must_change_pw := COALESCE((NEW.raw_user_meta_data->>'must_change_password')::boolean, false);

  -- Defensive INSERT with full metadata
  INSERT INTO public.profiles (
    id, email, full_name, role, company_id, must_change_password,
    synthetic_email, created_at, updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    meta_full_name,
    meta_role,
    meta_company_id,
    meta_must_change_pw,
    -- Detect synthetic emails: ones ending in .local (no real inbox)
    (NEW.email LIKE '%.local'),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role      = EXCLUDED.role,
    company_id = COALESCE(EXCLUDED.company_id, profiles.company_id),
    must_change_password = EXCLUDED.must_change_password,
    updated_at = now();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error to Postgres logs so we can diagnose, but DO NOT block signup.
    -- The edge function has its own profile upsert fallback that will run after this.
    RAISE WARNING 'handle_new_user failed for user % (email=%): % %',
      NEW.id, NEW.email, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;


--
-- Name: is_sephs_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_sephs_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'sephs_admin'
  )
$$;


--
-- Name: kpi_config_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_config_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    version_no integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    scope_type text DEFAULT 'company'::text NOT NULL,
    scope_id uuid,
    effective_from date,
    reason text,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    validation jsonb DEFAULT '{}'::jsonb NOT NULL,
    impact_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    supersedes_id uuid,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_by_name text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    validated_by uuid,
    validated_by_name text,
    validated_at timestamp with time zone,
    published_by uuid,
    published_by_name text,
    published_at timestamp with time zone,
    CONSTRAINT kpi_config_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validated'::text, 'published'::text, 'archived'::text])))
);


--
-- Name: kpi_publish_config(uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kpi_publish_config(p_config_id uuid, p_reason text, p_effective_from date DEFAULT CURRENT_DATE) RETURNS public.kpi_config_versions
    LANGUAGE plpgsql
    AS $$
declare v public.kpi_config_versions; old_row public.kpi_config_versions;
begin
  select * into v from public.kpi_config_versions where id=p_config_id for update;
  if v.id is null then raise exception 'Configuration version not found'; end if;
  if v.status <> 'validated' then raise exception 'Only a validated configuration can be published'; end if;
  if coalesce((v.validation->>'valid')::boolean,false) is not true then raise exception 'Validation must pass before publication'; end if;
  select * into old_row from public.kpi_config_versions where company_id=v.company_id and status='published' for update;
  update public.kpi_config_versions set status='archived',updated_at=now() where company_id=v.company_id and status='published';
  update public.kpi_config_versions set status='published',reason=p_reason,effective_from=p_effective_from,
    published_by=auth.uid(),published_by_name=coalesce((select full_name from public.profiles where id=auth.uid()),'User'),
    published_at=now(),updated_at=now() where id=p_config_id returning * into v;
  insert into public.kpi_config_audit(company_id,config_version_id,event_type,before_json,after_json,reason,actor_id,actor_name)
    values(v.company_id,v.id,'published',to_jsonb(old_row),to_jsonb(v),p_reason,auth.uid(),v.published_by_name);
  return v;
end $$;


--
-- Name: mark_notification_sent(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_notification_sent(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  UPDATE notification_queue
  SET status = 'sent', sent_at = now()
  WHERE id = p_id;
END;
$$;


--
-- Name: moc_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.moc_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;


--
-- Name: my_company_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_company_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid()
$$;


--
-- Name: normalise_location_identity_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalise_location_identity_text(value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select regexp_replace(lower(trim(coalesce(value,''))),'[^a-z0-9]+','','g')
$$;


--
-- Name: normalise_operational_reference(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalise_operational_reference(value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select regexp_replace(lower(trim(coalesce(value,''))),'[^a-z0-9]+','','g')
$$;


--
-- Name: normalise_person_identity_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalise_person_identity_text(value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select regexp_replace(lower(trim(coalesce(value,''))),'[^a-z0-9]+','','g')
$$;


--
-- Name: notification_best_email(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_best_email(values_to_check text[]) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select lower(trim(candidate))
  from unnest(coalesce(values_to_check,'{}'::text[])) with ordinality as item(candidate, position)
  where public.notification_deliverable_email(candidate)
  order by position
  limit 1
$$;


--
-- Name: notification_deliverable_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_deliverable_email(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
  select coalesce(trim(value),'') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and lower(trim(value)) not like '%.local'
$_$;


--
-- Name: notification_html_escape(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_html_escape(value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select replace(replace(replace(replace(coalesce(value,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;')
$$;


--
-- Name: notify_action_assigned(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_action_assigned() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_email text;
  v_name  text;
  v_subject text;
  v_body    text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.responsible = NEW.responsible THEN RETURN NEW; END IF;
  IF NEW.responsible IS NULL THEN RETURN NEW; END IF;

  -- Look up responsible person by name or email
  SELECT p.email, p.full_name INTO v_email, v_name
  FROM profiles p
  WHERE p.company_id = NEW.company_id
    AND (p.full_name ILIKE NEW.responsible OR p.email ILIKE NEW.responsible)
  LIMIT 1;

  IF v_email IS NULL THEN RETURN NEW; END IF;

  v_subject := '[AURIS360] Action Assigned: ' || LEFT(COALESCE(NEW.description, 'New action'), 60);

  v_body := '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:20px">'
    || '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">'
    || '<div style="background:#1D9E75;padding:20px 24px;color:#fff"><div style="font-size:20px;font-weight:700">AURIS360</div></div>'
    || '<div style="padding:24px">'
    || '<div style="font-size:18px;font-weight:700;margin-bottom:16px">📋 Action Assigned to You</div>'
    || '<p style="color:#374151;font-size:14px">You have been assigned a new corrective action in AURIS360.</p>'
    || '<table style="width:100%;border-collapse:collapse;font-size:14px">'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600;width:140px">Action</td>'
    ||   '<td style="padding:8px">' || COALESCE(NEW.description, '—') || '</td></tr>'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600">Priority</td>'
    ||   '<td style="padding:8px">' || UPPER(COALESCE(NEW.priority, 'normal')) || '</td></tr>'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600">Due Date</td>'
    ||   '<td style="padding:8px">' || COALESCE(TO_CHAR(NEW.due_date::date, 'DD Mon YYYY'), 'Not set') || '</td></tr>'
    || '</table>'
    || '<div style="margin-top:20px;text-align:center">'
    || '<a href="https://auris360.app/?goto=actions" style="background:#1D9E75;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">View Action</a>'
    || '</div></div>'
    || '<div style="padding:12px 24px;background:#f4f6f8;font-size:11px;color:#6B7280;text-align:center">Automated notification from AURIS360</div>'
    || '</div></body></html>';

  PERFORM queue_notification(
    NEW.company_id, 'action', v_subject, v_body,
    v_email, v_name, NEW.id, 'action_tracker'
  );

  RETURN NEW;
END;
$$;


--
-- Name: notify_new_incident(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_new_incident() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  rec RECORD;
  v_subject text;
  v_body text;
  v_severity_color text;
BEGIN
  IF TG_OP != 'INSERT' THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM notification_settings
    WHERE company_id = NEW.company_id AND notify_on_incident = true
  ) THEN RETURN NEW; END IF;
  v_severity_color := CASE NEW.severity
    WHEN 'critical' THEN '#DC2626'
    WHEN 'high'     THEN '#EF9F27'
    WHEN 'medium'   THEN '#185FA5'
    ELSE                 '#6B7280'
  END;
  v_subject := '[AURIS360] New Incident: ' || COALESCE(NEW.event_ref, 'Unreferenced') ||
               ' — ' || INITCAP(COALESCE(NEW.severity, 'unknown')) || ' Severity';
  v_body := '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:20px">'
    || '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">'
    || '<div style="background:#1D9E75;padding:20px 24px;color:#fff">'
    || '<div style="font-size:20px;font-weight:700">AURIS360</div>'
    || '<div style="font-size:13px;opacity:.8">HSE Management Platform by SEPHS Consulting</div>'
    || '</div>'
    || '<div style="padding:24px">'
    || '<div style="font-size:18px;font-weight:700;margin-bottom:16px">🚨 New Incident Reported</div>'
    || '<table style="width:100%;border-collapse:collapse;font-size:14px">'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600;width:140px">Reference</td>'
    ||   '<td style="padding:8px">' || COALESCE(NEW.event_ref, '—') || '</td></tr>'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600">Severity</td>'
    ||   '<td style="padding:8px"><span style="background:' || v_severity_color || ';color:#fff;padding:3px 10px;border-radius:12px;font-size:12px">'
    ||   UPPER(COALESCE(NEW.severity, 'unknown')) || '</span></td></tr>'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600">Date</td>'
    ||   '<td style="padding:8px">' || TO_CHAR(COALESCE(NEW.event_date::date, now()::date), 'DD Mon YYYY') || '</td></tr>'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600">Location</td>'
    ||   '<td style="padding:8px">' || COALESCE(NEW.location, '—') || '</td></tr>'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600">Description</td>'
    ||   '<td style="padding:8px">' || LEFT(COALESCE(NEW.description, '—'), 300) || '</td></tr>'
    || '</table>'
    || '<div style="margin-top:20px;text-align:center">'
    || '<a href="https://auris360.app/?goto=events" style="background:#1D9E75;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Incident in AURIS360</a>'
    || '</div>'
    || '</div>'
    || '<div style="padding:12px 24px;background:#f4f6f8;font-size:11px;color:#6B7280;text-align:center">'
    || 'This is an automated notification from AURIS360. Do not reply to this email.'
    || '</div></div></body></html>';
  FOR rec IN
    SELECT p.email, p.full_name
    FROM profiles p
    WHERE p.company_id = NEW.company_id
      AND p.role IN ('hse_manager','admin','sephs_admin','site_manager')
      AND p.email IS NOT NULL
  LOOP
    PERFORM queue_notification(
      NEW.company_id, 'incident', v_subject, v_body,
      rec.email, rec.full_name, NEW.id, 'events'
    );
  END LOOP;
  RETURN NEW;
END;
$$;


--
-- Name: notify_permit_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_permit_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_requester_email text;
  v_requester_name  text;
  v_subject text;
  v_body    text;
  v_color   text;
  v_icon    text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected','active','closed') THEN RETURN NEW; END IF;

  -- Look up the permit receiver by NAME (permit_receiver_name is text, not a user id)
  SELECT p.email, p.full_name
  INTO v_requester_email, v_requester_name
  FROM profiles p
  WHERE p.company_id = NEW.company_id
    AND p.full_name ILIKE NEW.permit_receiver_name
  LIMIT 1;

  IF v_requester_email IS NULL THEN RETURN NEW; END IF;

  v_color := CASE NEW.status
    WHEN 'approved' THEN '#1D9E75'
    WHEN 'active'   THEN '#185FA5'
    WHEN 'rejected' THEN '#DC2626'
    ELSE                 '#6B7280'
  END;

  v_icon := CASE NEW.status
    WHEN 'approved' THEN '✅'
    WHEN 'active'   THEN '🔵'
    WHEN 'rejected' THEN '❌'
    ELSE                 '📋'
  END;

  v_subject := '[AURIS360] Permit ' || UPPER(NEW.status) || ': ' || COALESCE(NEW.permit_number, 'PTW');

  v_body := '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:20px">'
    || '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">'
    || '<div style="background:#1D9E75;padding:20px 24px;color:#fff">'
    || '<div style="font-size:20px;font-weight:700">AURIS360</div>'
    || '</div>'
    || '<div style="padding:24px">'
    || '<div style="font-size:18px;font-weight:700;margin-bottom:16px">' || v_icon || ' Permit ' || INITCAP(NEW.status) || '</div>'
    || '<p style="color:#374151;font-size:14px">Your permit <strong>' || COALESCE(NEW.permit_number, 'PTW') || '</strong> has been <strong style="color:' || v_color || '">' || UPPER(NEW.status) || '</strong>.</p>'
    || '<table style="width:100%;border-collapse:collapse;font-size:14px">'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600;width:140px">Permit No.</td>'
    ||   '<td style="padding:8px">' || COALESCE(NEW.permit_number, '—') || '</td></tr>'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600">Type</td>'
    ||   '<td style="padding:8px">' || COALESCE(NEW.permit_type, '—') || '</td></tr>'
    || '<tr><td style="padding:8px;background:#f9fafb;font-weight:600">Work Description</td>'
    ||   '<td style="padding:8px">' || LEFT(COALESCE(NEW.work_description, '—'), 200) || '</td></tr>'
    || '</table>'
    || '<div style="margin-top:20px;text-align:center">'
    || '<a href="https://auris360.app/?goto=permit" style="background:#1D9E75;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Permit</a>'
    || '</div></div>'
    || '<div style="padding:12px 24px;background:#f4f6f8;font-size:11px;color:#6B7280;text-align:center">Automated notification from AURIS360</div>'
    || '</div></body></html>';

  PERFORM queue_notification(
    NEW.company_id, 'permit', v_subject, v_body,
    v_requester_email, v_requester_name, NEW.id, 'permits'
  );

  RETURN NEW;
END;
$$;


--
-- Name: process_action_notification_escalations(date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_action_notification_escalations(p_run_date date DEFAULT CURRENT_DATE, p_limit integer DEFAULT 500) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  action_row record;
  recipient_row record;
  notification_uuid uuid;
  event_name text;
  event_key_value text;
  event_label text;
  priority_value text;
  escalation_level_value integer;
  overdue_days integer;
  action_count integer:=0;
  notification_count integer:=0;
  skipped_recipient_count integer:=0;
  recipient_names text[];
  inserted_state integer;
  record_url_value text;
  body_value text;
begin
  for action_row in
    select a.*,
      coalesce(s.due_soon_days,7) as cfg_due_soon,
      coalesce(s.level_1_overdue_days,7) as cfg_level_1,
      coalesce(s.level_2_overdue_days,21) as cfg_level_2,
      coalesce(s.level_3_overdue_days,45) as cfg_level_3
    from public.action_tracker a
    left join public.notification_escalation_settings s on s.company_id=a.company_id
    where a.target_date is not null
      and lower(coalesce(a.status,'open')) not in ('closed','cancelled','canceled','completed','complete','void')
      and coalesce(s.enabled,true)
      and a.target_date <= p_run_date + coalesce(s.due_soon_days,7)
    order by a.target_date,a.created_at
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    overdue_days:=p_run_date-action_row.target_date;
    if overdue_days >= action_row.cfg_level_3 then
      event_name:='overdue_level_3'; escalation_level_value:=3; priority_value:='urgent';
      event_label:='Level 3 executive escalation - '||overdue_days||' days overdue';
    elsif overdue_days >= action_row.cfg_level_2 then
      event_name:='overdue_level_2'; escalation_level_value:=2; priority_value:='urgent';
      event_label:='Level 2 management escalation - '||overdue_days||' days overdue';
    elsif overdue_days >= action_row.cfg_level_1 then
      event_name:='overdue_level_1'; escalation_level_value:=1; priority_value:='high';
      event_label:='Level 1 supervisor escalation - '||overdue_days||' days overdue';
    elsif overdue_days >= 1 then
      event_name:='overdue_initial'; escalation_level_value:=0; priority_value:='high';
      event_label:='Action overdue by '||overdue_days||case when overdue_days=1 then ' day' else ' days' end;
    elsif action_row.target_date >= p_run_date then
      event_name:='due_soon'; escalation_level_value:=0; priority_value:='normal';
      event_label:='Action due in '||(action_row.target_date-p_run_date)||case when action_row.target_date-p_run_date=1 then ' day' else ' days' end;
    else
      continue;
    end if;

    event_key_value:=event_name||':'||action_row.target_date::text;
    record_url_value:='https://auris360.app/?goto=actions&record='||action_row.id::text||'&table=action_tracker&company='||action_row.company_id::text;
    recipient_names:=array[]::text[];
    action_count:=action_count+1;

    for recipient_row in
      with assignee_person as (
        select p.* from public.people p where p.id=action_row.assigned_to_id and p.company_id=action_row.company_id limit 1
      ),
      assignee_profile as (
        select pr.* from public.profiles pr
        left join assignee_person ap on true
        where pr.company_id=action_row.company_id and (
          pr.id=action_row.assigned_to_id
          or (nullif(trim(ap.email),'') is not null and lower(pr.email)=lower(ap.email))
          or regexp_replace(lower(coalesce(pr.full_name,'')),'[^a-z0-9]+','','g')=
             regexp_replace(lower(coalesce(action_row.assigned_to_name,action_row.responsible,'')),'[^a-z0-9]+','','g')
        )
        order by case when pr.id=action_row.assigned_to_id then 0 else 1 end
        limit 1
      ),
      explicit_recipients as (
        select er.escalation_level,
          coalesce(nullif(trim(er.display_name),''),pr.full_name,er.email_override) as recipient_name,
          public.notification_best_email(array[er.email_override,pr.real_email,pr.email]) as recipient_email
        from public.notification_escalation_recipients er
        left join public.profiles pr on pr.id=er.profile_id and pr.company_id=er.company_id
        where er.company_id=action_row.company_id and er.active
          and er.escalation_level between 1 and escalation_level_value
      ),
      fallback_recipients as (
        select level_value as escalation_level,pr.full_name as recipient_name,
          public.notification_best_email(array[pr.real_email,pr.email]) as recipient_email
        from generate_series(1,escalation_level_value) level_value
        join lateral (
          select p.* from public.profiles p
          where p.company_id=action_row.company_id
            and case level_value
              when 1 then p.role in ('supervisor','site_manager')
              when 2 then p.role in ('manager','hse_manager')
              when 3 then p.role in ('executive','director','company_admin','admin','hse_manager')
              else false end
            and public.notification_best_email(array[p.real_email,p.email]) is not null
          order by case p.role
            when 'supervisor' then 1 when 'manager' then 1
            when 'executive' then 1 when 'director' then 1 when 'company_admin' then 1 when 'admin' then 1
            else 2 end,p.full_name,p.id
          limit 1
        ) pr on true
        where not exists(
          select 1 from public.notification_escalation_recipients configured
          left join public.profiles configured_profile
            on configured_profile.id=configured.profile_id and configured_profile.company_id=configured.company_id
          where configured.company_id=action_row.company_id and configured.active
            and configured.escalation_level=level_value
            and public.notification_best_email(array[configured.email_override,configured_profile.real_email,configured_profile.email]) is not null
        )
      ),
      candidates as (
        select 0 as escalation_level,
          coalesce(apf.full_name,concat_ws(' ',ap.first_name,ap.last_name),action_row.assigned_to_name,action_row.responsible,'Assigned person') as recipient_name,
          public.notification_best_email(array[apf.real_email,apf.email,ap.email]) as recipient_email
        from (select 1) seed
        left join assignee_person ap on true
        left join assignee_profile apf on true
        union all select * from explicit_recipients
        union all select * from fallback_recipients
      )
      select distinct on (recipient_email) escalation_level,recipient_name,recipient_email
      from candidates
      where recipient_email is not null
      order by recipient_email,escalation_level desc
    loop
      if exists(
        select 1 from public.action_notification_escalation_state st
        where st.action_id=action_row.id and st.event_key=event_key_value
          and lower(st.recipient_email)=lower(recipient_row.recipient_email)
      ) then
        continue;
      end if;

      body_value:='<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:20px">'
        ||'<div style="max-width:640px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">'
        ||'<div style="background:#0b7f61;color:#fff;padding:18px 22px"><strong>AURIS360</strong><br>Master Action Plan notification</div>'
        ||'<div style="padding:22px"><h2 style="margin-top:0">'||public.notification_html_escape(event_label)||'</h2>'
        ||'<p><strong>Reference:</strong> '||public.notification_html_escape(coalesce(action_row.action_ref,action_row.source_ref,action_row.id::text))||'</p>'
        ||'<p><strong>Action:</strong> '||public.notification_html_escape(coalesce(action_row.title,action_row.description,'Action'))||'</p>'
        ||'<p><strong>Due date:</strong> '||action_row.target_date::text||'</p>'
        ||'<p><strong>Current status:</strong> '||public.notification_html_escape(coalesce(action_row.status,'open'))||'</p>'
        ||'<p style="text-align:center;margin-top:22px"><a href="'||record_url_value||'" style="background:#0b7f61;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none">Open exact action</a></p>'
        ||'</div></div></body></html>';

      insert into public.notification_queue(
        company_id,type,subject,body_html,to_email,to_name,status,channel,priority,
        related_id,related_table,related_module,related_ref,record_url,metadata,
        idempotency_key,next_attempt_at
      ) values (
        action_row.company_id,
        case when event_name='due_soon' then 'action_due_soon' else 'action_overdue' end,
        '[AURIS360] '||event_label||': '||coalesce(action_row.action_ref,action_row.source_ref,'Action'),
        body_value,recipient_row.recipient_email,recipient_row.recipient_name,'pending','email',priority_value,
        action_row.id,'action_tracker','actions',coalesce(action_row.action_ref,action_row.source_ref,action_row.id::text),
        record_url_value,
        jsonb_build_object('event',event_name,'escalation_level',escalation_level_value,'target_date',action_row.target_date,'relationship',jsonb_build_object('module','actions','table','action_tracker','id',action_row.id,'ref',coalesce(action_row.action_ref,action_row.source_ref,action_row.id::text),'company_id',action_row.company_id,'url',record_url_value)),
        'action-escalation/'||action_row.id::text||'/'||event_key_value||'/'||lower(recipient_row.recipient_email),now()
      )
      on conflict (company_id,idempotency_key) where idempotency_key is not null
      do update set idempotency_key=excluded.idempotency_key
      returning id into notification_uuid;

      insert into public.action_notification_escalation_state(
        company_id,action_id,event_key,escalation_level,recipient_email,notification_id
      ) values (
        action_row.company_id,action_row.id,event_key_value,escalation_level_value,
        recipient_row.recipient_email,notification_uuid
      ) on conflict(action_id,event_key,recipient_email) do nothing;
      get diagnostics inserted_state=row_count;
      if inserted_state>0 then
        notification_count:=notification_count+1;
        recipient_names:=array_append(recipient_names,recipient_row.recipient_name);
      end if;
    end loop;

    if coalesce(array_length(recipient_names,1),0)=0 then
      skipped_recipient_count:=skipped_recipient_count+1;
    end if;

    if escalation_level_value>0 and escalation_level_value>coalesce(action_row.escalation_level,0) then
      update public.action_tracker set
        escalated=true,
        escalation_level=escalation_level_value,
        escalated_to=coalesce(array_to_string(recipient_names,', '),escalated_to),
        escalation_reason='Automatic '||event_label,
        escalated_at=now(),updated_at=now()
      where id=action_row.id and company_id=action_row.company_id
        and lower(coalesce(status,'open')) not in ('closed','cancelled','canceled','completed','complete','void');

      if to_regclass('public.map_activity_log') is not null then
        execute 'insert into public.map_activity_log(company_id,action_id,activity_type,performed_by,old_value,new_value,notes) values ($1,$2,$3,$4,$5,$6,$7)'
        using action_row.company_id,action_row.id,'Automatic escalation to Level '||escalation_level_value,
          'AURIS360 notification engine',coalesce(action_row.escalation_level,0)::text,escalation_level_value::text,event_label;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'run_date',p_run_date,'actions_evaluated',action_count,
    'notifications_queued',notification_count,'actions_without_deliverable_recipient',skipped_recipient_count
  );
end;
$_$;


--
-- Name: FUNCTION process_action_notification_escalations(p_run_date date, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.process_action_notification_escalations(p_run_date date, p_limit integer) IS 'Service-role-only idempotent due-soon and 7/21/45-day Master Action Plan escalation processor.';


--
-- Name: process_action_overdue_digests(date, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_action_overdue_digests(p_run_date date DEFAULT CURRENT_DATE, p_company_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare recipient_row record; notification_uuid uuid; digest_count integer:=0; action_total integer:=0;
  body_value text; first_action_id uuid; first_action_ref text;
begin
  for recipient_row in
    with eligible as (
      select distinct p.company_id,p.id as profile_id,p.full_name,
        public.notification_best_email(array[p.real_email,p.email]) as recipient_email
      from public.profiles p
      join public.notification_settings ns on ns.company_id=p.company_id
      where (p_company_id is null or p.company_id=p_company_id)
        and coalesce(ns.email_enabled,true) and coalesce(ns.notify_on_overdue,true)
        and public.notification_best_email(array[p.real_email,p.email]) is not null
    )
    select e.*,
      count(a.id)::integer as action_count,
      min(a.id::text)::uuid as first_id,
      min(coalesce(a.action_ref,a.source_ref,a.id::text)) as first_ref,
      string_agg(
        '<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb"><a href="https://auris360.app/?goto=actions&amp;record='||a.id::text||'&amp;table=action_tracker&amp;company='||a.company_id::text||'">'||
        public.notification_html_escape(coalesce(a.action_ref,a.source_ref,a.id::text))||'</a></td><td style="padding:9px;border-bottom:1px solid #e5e7eb">'||
        public.notification_html_escape(coalesce(a.title,a.description,'Action'))||'</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">'||
        a.target_date::text||'</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;color:#b91c1c;font-weight:700">'||
        (p_run_date-a.target_date)::text||' day(s)</td></tr>', '' order by a.target_date,a.created_at
      ) as action_rows
    from eligible e
    join public.action_tracker a on a.company_id=e.company_id
      and a.target_date<p_run_date
      and lower(coalesce(a.status,'open')) not in ('closed','cancelled','canceled','completed','complete','void')
      and (
        a.assigned_to_id=e.profile_id
        or regexp_replace(lower(coalesce(a.assigned_to_name,a.responsible,'')),'[^a-z0-9]+','','g')=
           regexp_replace(lower(coalesce(e.full_name,'')),'[^a-z0-9]+','','g')
        or exists(select 1 from public.people person where person.id=a.assigned_to_id and person.company_id=a.company_id
          and lower(coalesce(person.email,''))=lower(e.recipient_email))
      )
    where not exists(select 1 from public.action_digest_runs r where r.company_id=e.company_id
      and r.run_date=p_run_date and r.recipient_profile_id=e.profile_id)
    group by e.company_id,e.profile_id,e.full_name,e.recipient_email
    order by e.company_id,e.full_name
    limit greatest(1,least(coalesce(p_limit,1000),5000))
  loop
    first_action_id:=recipient_row.first_id; first_action_ref:=coalesce(recipient_row.first_ref,first_action_id::text);
    body_value:='<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:20px"><div style="max-width:760px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">'
      ||'<div style="background:#0b7f61;color:#fff;padding:18px 22px"><strong>AURIS360</strong><br>Daily overdue action digest</div><div style="padding:22px">'
      ||'<h2 style="margin-top:0">'||recipient_row.action_count||' overdue action(s)</h2><p>This summary is recalculated from currently open actions. Closed or cancelled actions are excluded.</p>'
      ||'<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f8fafc"><th style="padding:9px;text-align:left">Reference</th><th style="padding:9px;text-align:left">Action</th><th style="padding:9px;text-align:left">Due</th><th style="padding:9px;text-align:left">Overdue</th></tr></thead><tbody>'
      ||recipient_row.action_rows||'</tbody></table><p style="text-align:center;margin-top:22px"><a href="https://auris360.app/?goto=actions" style="background:#0b7f61;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none">Open Master Action Plan</a></p>'
      ||'</div></div></body></html>';

    insert into public.notification_queue(company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,
      channel,priority,related_id,related_table,related_module,related_ref,record_url,metadata,idempotency_key,next_attempt_at)
    values(recipient_row.company_id,recipient_row.profile_id,'overdue_digest','[AURIS360] Daily overdue action digest - '||recipient_row.action_count||' item(s)',
      body_value,recipient_row.recipient_email,recipient_row.full_name,'pending','email','normal',first_action_id,'action_tracker','actions',
      'DIGEST-'||p_run_date::text,'https://auris360.app/?goto=actions',
      jsonb_build_object('digest_date',p_run_date,'action_count',recipient_row.action_count,'recipient_profile_id',recipient_row.profile_id,
        'relationship',jsonb_build_object('module','actions','table','action_tracker','id',first_action_id,'ref',first_action_ref,'company_id',recipient_row.company_id,'url','https://auris360.app/?goto=actions')),
      'overdue-digest/'||recipient_row.company_id::text||'/'||p_run_date::text||'/'||recipient_row.profile_id::text,now())
    on conflict(company_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key
    returning id into notification_uuid;
    insert into public.action_digest_runs(company_id,run_date,recipient_profile_id,notification_id,action_count)
    values(recipient_row.company_id,p_run_date,recipient_row.profile_id,notification_uuid,recipient_row.action_count)
    on conflict(company_id,run_date,recipient_profile_id) do nothing;
    digest_count:=digest_count+1; action_total:=action_total+recipient_row.action_count;
  end loop;
  return jsonb_build_object('run_date',p_run_date,'digests_queued',digest_count,'actions_included',action_total);
end;
$$;


--
-- Name: FUNCTION process_action_overdue_digests(p_run_date date, p_company_id uuid, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.process_action_overdue_digests(p_run_date date, p_company_id uuid, p_limit integer) IS 'Service-only, one-per-recipient daily overdue digest built from live open actions.';


--
-- Name: process_notification_acknowledgement_slas(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_notification_acknowledgement_slas(p_limit integer DEFAULT 500) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare original record; cfg public.notification_acknowledgement_settings%rowtype; recipient record; next_count integer; queued integer:=0; escalated integer:=0; queue_id uuid; event_level integer; email_value text;
begin
  for original in select n.* from public.user_notifications n
    where n.acknowledgement_required and n.acknowledged_at is null and n.dismissed_at is null and n.acknowledgement_due_at<=now()
      and (n.acknowledgement_last_reminded_at is null or n.acknowledgement_last_reminded_at<=now()-coalesce((select make_interval(mins=>s.reminder_interval_minutes) from public.notification_acknowledgement_settings s where s.company_id=n.company_id),interval '60 minutes'))
    order by n.acknowledgement_due_at limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    select * into cfg from public.notification_acknowledgement_settings where company_id=original.company_id;
    if found and not cfg.enabled then continue; end if;
    if original.related_table='action_tracker' and exists(select 1 from public.action_tracker a where a.id=original.related_id and lower(coalesce(a.status,'open')) in ('closed','cancelled','canceled','completed','complete','void')) then
      update public.user_notifications set dismissed_at=now(),updated_at=now() where id=original.id; continue;
    end if;
    next_count:=original.acknowledgement_reminder_count+1;
    if original.acknowledgement_overdue_at is null then
      insert into public.notification_events(company_id,notification_id,event_type,related_module,related_table,related_id,related_ref,actor_id,detail)
      values(original.company_id,original.source_notification_id,'acknowledgement_overdue',original.related_module,original.related_table,
        original.related_id,original.related_ref,null,jsonb_build_object('user_notification_id',original.id,'due_at',original.acknowledgement_due_at,'recipient_profile_id',original.recipient_profile_id));
    end if;
    if next_count<=coalesce(cfg.max_reminders,3) then
      select public.notification_best_email(array[p.real_email,p.email]) into email_value from public.profiles p where p.id=original.recipient_profile_id and p.company_id=original.company_id;
      insert into public.notification_queue(company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,channel,priority,related_id,related_table,related_module,related_ref,record_url,metadata,idempotency_key,next_attempt_at)
      select original.company_id,original.recipient_profile_id,'acknowledgement_reminder','[AURIS360] Response overdue: '||original.title,
        '<p>Your acknowledgement is overdue.</p><p><a href="'||coalesce(original.record_url,'https://auris360.app/')||'">Open the exact record and acknowledge</a></p>',email_value,p.full_name,'pending','email',original.severity,
        original.related_id,original.related_table,original.related_module,original.related_ref,original.record_url,
        jsonb_build_object('parent_user_notification_id',original.id,'reminder_number',next_count,'acknowledgement_required',false,'relationship',jsonb_build_object('module',original.related_module,'table',original.related_table,'id',original.related_id,'ref',original.related_ref,'company_id',original.company_id,'url',original.record_url)),
        'ack-reminder/'||original.id::text||'/'||next_count::text,now() from public.profiles p where p.id=original.recipient_profile_id
      on conflict(company_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key returning id into queue_id;
      queued:=queued+1;
    end if;
    update public.user_notifications set acknowledgement_overdue_at=coalesce(acknowledgement_overdue_at,now()),acknowledgement_reminder_count=next_count,acknowledgement_last_reminded_at=now(),updated_at=now() where id=original.id and acknowledged_at is null;
    if next_count>=coalesce(cfg.escalate_after_reminders,1) and next_count<=coalesce(cfg.max_reminders,3) then
      event_level:=case when original.severity='urgent' then 3 else 2 end;
      for recipient in
        with explicit as (
          select er.profile_id,coalesce(er.display_name,p.full_name,er.email_override) name,public.notification_best_email(array[er.email_override,p.real_email,p.email]) email
          from public.notification_escalation_recipients er left join public.profiles p on p.id=er.profile_id and p.company_id=er.company_id
          where er.company_id=original.company_id and er.active and er.escalation_level=event_level
        ), fallback as (
          select p.id profile_id,p.full_name name,public.notification_best_email(array[p.real_email,p.email]) email from public.profiles p
          where p.company_id=original.company_id and not exists(select 1 from explicit where email is not null)
            and case when event_level=2 then p.role in ('manager','hse_manager') else p.role in ('executive','director','company_admin','admin','hse_manager') end
            and public.notification_best_email(array[p.real_email,p.email]) is not null order by p.full_name,p.id limit 1
        ) select * from explicit where email is not null union all select * from fallback
      loop
        insert into public.notification_queue(company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,channel,priority,related_id,related_table,related_module,related_ref,record_url,metadata,idempotency_key,next_attempt_at)
        values(original.company_id,recipient.profile_id,'acknowledgement_escalation','[AURIS360] Unacknowledged alert requires attention: '||original.title,
          '<p>A required acknowledgement remains overdue after '||next_count||' reminder(s).</p><p><a href="'||coalesce(original.record_url,'https://auris360.app/')||'">Open exact source record</a></p>',recipient.email,recipient.name,'pending','email',original.severity,
          original.related_id,original.related_table,original.related_module,original.related_ref,original.record_url,
          jsonb_build_object('parent_user_notification_id',original.id,'escalation_level',event_level,'reminder_number',next_count,'acknowledgement_required',false,'relationship',jsonb_build_object('module',original.related_module,'table',original.related_table,'id',original.related_id,'ref',original.related_ref,'company_id',original.company_id,'url',original.record_url)),
          'ack-escalation/'||original.id::text||'/'||next_count::text||'/'||coalesce(recipient.profile_id::text,lower(recipient.email)),now())
        on conflict(company_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key;
        escalated:=escalated+1;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('reminders_queued',queued,'hierarchy_escalations_queued',escalated);
end; $$;


--
-- Name: queue_notification(uuid, text, text, text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_notification(p_company_id uuid, p_type text, p_subject text, p_body_html text, p_to_email text, p_to_name text DEFAULT NULL::text, p_related_id uuid DEFAULT NULL::uuid, p_related_table text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_id uuid;
  v_enabled boolean;
BEGIN
  -- Check if email notifications are enabled for this company
  SELECT email_enabled INTO v_enabled
  FROM notification_settings
  WHERE company_id = p_company_id;

  IF v_enabled IS FALSE THEN RETURN NULL; END IF;

  INSERT INTO notification_queue
    (company_id, type, subject, body_html, to_email, to_name, related_id, related_table)
  VALUES
    (p_company_id, p_type, p_subject, p_body_html, p_to_email, p_to_name, p_related_id, p_related_table)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: queue_push_delivery_jobs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_push_delivery_jobs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if new.dismissed_at is not null
    or not (new.severity in ('high','urgent') or new.acknowledgement_required) then
    return new;
  end if;

  insert into public.push_delivery_jobs(
    company_id, user_notification_id, subscription_id, status, next_attempt_at
  )
  select new.company_id, new.id, s.id, 'pending', now()
  from public.push_subscriptions s
  where s.company_id = new.company_id
    and s.recipient_profile_id = new.recipient_profile_id
    and s.enabled
  on conflict(user_notification_id, subscription_id) do nothing;
  return new;
end;
$$;


--
-- Name: queue_recent_push_jobs_for_subscription(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_recent_push_jobs_for_subscription() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if not new.enabled then return new; end if;
  insert into public.push_delivery_jobs(
    company_id, user_notification_id, subscription_id, status, next_attempt_at
  )
  select n.company_id, n.id, new.id, 'pending', now()
  from public.user_notifications n
  where n.company_id = new.company_id
    and n.recipient_profile_id = new.recipient_profile_id
    and n.read_at is null and n.dismissed_at is null
    and n.created_at >= now() - interval '7 days'
    and (n.severity in ('high','urgent') or n.acknowledgement_required)
  on conflict(user_notification_id, subscription_id) do nothing;
  return new;
end;
$$;


--
-- Name: queue_whatsapp_delivery_job(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_whatsapp_delivery_job() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  profile_row record;
  setting_row record;
  source_row record;
  escalation_level integer;
begin
  select * into profile_row from public.profiles where id=new.recipient_profile_id and company_id=new.company_id;
  if not found or profile_row.whatsapp_opted_in_at is null or profile_row.whatsapp_opted_out_at is not null
    or coalesce(profile_row.whatsapp_phone,'')='' then return new; end if;
  select * into setting_row from public.whatsapp_channel_settings where company_id=new.company_id and enabled;
  if not found or coalesce(setting_row.phone_number_id,'')='' then return new; end if;
  select * into source_row from public.notification_queue where id=new.source_notification_id;
  escalation_level:=coalesce((source_row.metadata->>'escalation_level')::integer,0);
  if escalation_level < setting_row.minimum_escalation_level
    and not (setting_row.allow_preferred_high_priority and profile_row.preferred_notification_channel='whatsapp'
      and new.severity in ('high','urgent')) then return new; end if;

  insert into public.whatsapp_delivery_jobs(company_id,recipient_profile_id,user_notification_id,source_notification_id,
    phone_snapshot,template_name,template_language)
  values(new.company_id,new.recipient_profile_id,new.id,new.source_notification_id,profile_row.whatsapp_phone,
    setting_row.alert_template_name,setting_row.template_language)
  on conflict(user_notification_id,recipient_profile_id) do nothing;
  return new;
exception when invalid_text_representation then return new;
end;
$$;


--
-- Name: record_notification_link_open(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_notification_link_open(p_notification_id uuid, p_destination_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: refresh_learning_source_impacts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_learning_source_impacts(p_company_id uuid) RETURNS TABLE(current_count bigint, review_required_count bigint, affected_count bigint)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  rel record;
  source_row jsonb;
  current_revision text;
begin
  for rel in
    select * from public.learning_source_relationships
    where company_id=p_company_id and impact_status<>'superseded'
  loop
    source_row:=null;
    current_revision:=null;
    if rel.related_table is null or rel.related_table!~'^[a-z0-9_]+$'
       or to_regclass('public.'||rel.related_table) is null
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=rel.related_table and column_name='id')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=rel.related_table and column_name='company_id') then
      update public.learning_source_relationships
      set impact_status='affected',impact_note='The linked source type is unavailable.',
          impact_detected_at=coalesce(impact_detected_at,now()),updated_at=now()
      where id=rel.id;
      continue;
    end if;
    execute format('select to_jsonb(t) from public.%I t where t.id::text=$1 and t.company_id=$2 limit 1',rel.related_table)
      into source_row using rel.related_record_id,p_company_id;
    if source_row is null then
      update public.learning_source_relationships
      set impact_status='affected',impact_note='The linked source record no longer resolves in this company.',
          impact_detected_at=coalesce(impact_detected_at,now()),updated_at=now()
      where id=rel.id;
      continue;
    end if;
    current_revision:=coalesce(
      nullif(source_row->>'revision',''),nullif(source_row->>'revision_code',''),
      nullif(source_row->>'doc_version',''),nullif(source_row->>'version',''),
      nullif(source_row->>'current_revision_id',''),nullif(source_row->>'updated_at','')
    );
    if rel.related_revision is null then
      update public.learning_source_relationships
      set related_revision=current_revision,source_current_revision=current_revision,
          impact_note=null,updated_at=now()
      where id=rel.id;
    elsif current_revision is distinct from rel.related_revision then
      update public.learning_source_relationships
      set source_current_revision=current_revision,impact_status='review_required',
          impact_note='The controlled source changed after this learning version was linked.',
          impact_detected_at=coalesce(impact_detected_at,now()),updated_at=now()
      where id=rel.id;
    else
      update public.learning_source_relationships
      set source_current_revision=current_revision,updated_at=now()
      where id=rel.id;
    end if;
  end loop;
  return query
  select count(*) filter(where l.impact_status='current'),
         count(*) filter(where l.impact_status='review_required'),
         count(*) filter(where l.impact_status='affected')
  from public.learning_source_relationships l where l.company_id=p_company_id;
end;
$_$;


--
-- Name: refresh_person_identity_reconciliation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_person_identity_reconciliation(p_company_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare
  caller_role text;
  result jsonb;
  table_name text;
begin
  select p.role into caller_role from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=p_company_id);
  if caller_role is null or caller_role not in ('sephs_admin','admin','hse_manager') then
    raise exception 'Identity reconciliation permission denied';
  end if;

  perform public.backfill_person_identity('training_followup','person_name',null);
  perform public.backfill_person_identity('competency_matrix','person_name',null);
  perform public.backfill_person_identity('induction_records','person_name','employee_id');
  perform public.backfill_person_identity('elearning_enrolments','person_name',null);
  perform public.backfill_person_identity('ppe_issuance','employee_name','employee_id');
  perform public.backfill_person_identity('medical_surveillance','employee_name','employee_id');
  perform public.backfill_person_identity('audiometry_records','employee_name',null);
  perform public.backfill_person_identity('spirometry_records','employee_name',null);
  perform public.backfill_person_identity('vaccination_records','employee_name',null);
  perform public.backfill_person_identity('occupational_diseases','employee_name','employee_id');
  perform public.backfill_person_identity('doc_acknowledgements','employee_name',null);

  -- Account for queue items that became uniquely resolvable after People data
  -- was corrected or added since the previous scan.
  foreach table_name in array array[
    'training_followup','competency_matrix','induction_records','elearning_enrolments',
    'ppe_issuance','medical_surveillance','audiometry_records','spirometry_records',
    'vaccination_records','occupational_diseases','doc_acknowledgements'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format($q$
        insert into public.person_identity_decisions(
          company_id,review_id,source_table,source_id,decision,selected_person_id,
          legacy_name,decision_note,decided_by
        )
        select q.company_id,q.id,q.source_table,q.source_id,'linked',r.person_id,
               q.legacy_name,'Automatically linked after a unique-match rescan',auth.uid()
        from public.person_identity_backfill_review q
        join public.%I r on r.id=q.source_id and r.company_id=q.company_id
        where q.company_id=$1 and q.source_table=%L
          and q.resolution_status='unresolved' and r.person_id is not null
      $q$,table_name,table_name) using p_company_id;
      execute format($q$
        update public.person_identity_backfill_review q
        set resolution_status='resolved',resolved_person_id=r.person_id,
            resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
        from public.%I r
        where q.company_id=$1 and q.source_table=%L
          and q.resolution_status='unresolved'
          and r.id=q.source_id and r.company_id=q.company_id and r.person_id is not null
      $q$,table_name,table_name) using p_company_id;
    end if;
  end loop;

  select to_jsonb(s) into result from public.person_identity_reconciliation_summary s where s.company_id=p_company_id;
  return coalesce(result,'{}'::jsonb);
end;
$_$;


--
-- Name: relationship_endpoint_exists(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relationship_endpoint_exists(p_company_id uuid, p_module text, p_table text, p_record_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  cfg record;
  endpoint_found boolean := false;
begin
  if p_company_id is null or nullif(btrim(p_record_id),'') is null then return false; end if;
  select * into cfg
  from public.relationship_module_registry
  where module_key = lower(btrim(p_module))
    and table_name = lower(btrim(p_table))
    and enabled = true;
  if not found or to_regclass('public.'||cfg.table_name) is null then return false; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name=cfg.table_name and column_name=cfg.id_column
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name=cfg.table_name and column_name='company_id'
  ) then return false; end if;
  execute format(
    'select exists(select 1 from public.%I where %I::text=$1 and company_id=$2)',
    cfg.table_name, cfg.id_column
  ) into endpoint_found using p_record_id, p_company_id;
  return coalesce(endpoint_found,false);
end;
$_$;


--
-- Name: relationship_endpoint_state(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relationship_endpoint_state(p_company_id uuid, p_module text, p_table text, p_record_id text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  cfg record;
  endpoint_row jsonb;
  lifecycle text;
begin
  if p_company_id is null or nullif(btrim(p_record_id),'') is null then return 'unresolved'; end if;
  select * into cfg
  from public.relationship_module_registry
  where module_key=lower(btrim(p_module)) and table_name=lower(btrim(p_table)) and enabled=true;
  if not found or to_regclass('public.'||cfg.table_name) is null then return 'unresolved'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=cfg.table_name and column_name=cfg.id_column)
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=cfg.table_name and column_name='company_id') then
    return 'unresolved';
  end if;
  execute format('select to_jsonb(t) from public.%I t where %I::text=$1 and company_id=$2 limit 1',cfg.table_name,cfg.id_column)
    into endpoint_row using p_record_id,p_company_id;
  if endpoint_row is null then return 'broken'; end if;
  lifecycle:=lower(coalesce(nullif(endpoint_row->>'lifecycle_state',''),nullif(endpoint_row->>'approval_status',''),nullif(endpoint_row->>'status',''),''));
  if lifecycle in ('archived','deleted','obsolete','withdrawn','superseded','retired','inactive','cancelled','out_of_service') then return 'archived'; end if;
  return 'active';
exception when others then
  return 'unresolved';
end;
$_$;


--
-- Name: resolve_location_identity(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_location_identity(p_company_id uuid, p_site_text text, p_area_text text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  matches uuid[];
  area_matches uuid[];
  matched public.sites%rowtype;
begin
  if nullif(trim(p_area_text),'') is null and nullif(trim(p_site_text),'') is null then
    return jsonb_build_object('site_id',null,'area_id',null,'candidate_ids','[]'::jsonb);
  end if;

  if nullif(trim(p_area_text),'') is not null then
    select array_agg(s.id order by s.id) into area_matches
    from public.sites s
    where s.company_id=p_company_id and s.parent_site_id is not null
      and coalesce(s.status,'active')<>'inactive'
      and (public.normalise_location_identity_text(s.name)=public.normalise_location_identity_text(p_area_text)
        or (nullif(trim(s.site_code),'') is not null and public.normalise_location_identity_text(s.site_code)=public.normalise_location_identity_text(p_area_text)));
    if coalesce(array_length(area_matches,1),0)=1 then
      select * into matched from public.sites where id=area_matches[1];
      return jsonb_build_object('site_id',matched.parent_site_id,'area_id',matched.id,'candidate_ids',to_jsonb(area_matches));
    end if;
  end if;

  if nullif(trim(p_site_text),'') is not null then
    select array_agg(s.id order by s.id) into matches
    from public.sites s
    where s.company_id=p_company_id and coalesce(s.status,'active')<>'inactive'
      and (public.normalise_location_identity_text(s.name)=public.normalise_location_identity_text(p_site_text)
        or (nullif(trim(s.site_code),'') is not null and public.normalise_location_identity_text(s.site_code)=public.normalise_location_identity_text(p_site_text)));
  else
    matches := area_matches;
  end if;

  if coalesce(array_length(matches,1),0)=1 then
    select * into matched from public.sites where id=matches[1];
    return jsonb_build_object(
      'site_id',coalesce(matched.parent_site_id,matched.id),
      'area_id',case when matched.parent_site_id is not null then matched.id else null end,
      'candidate_ids',to_jsonb(matches)
    );
  end if;
  return jsonb_build_object('site_id',null,'area_id',null,'candidate_ids',to_jsonb(coalesce(matches,'{}'::uuid[])));
end;
$$;


--
-- Name: resolve_notification_recipient_profile(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_notification_recipient_profile(p_company_id uuid, p_recipient_profile_id uuid, p_to_email text, p_metadata jsonb) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare
  resolved_id uuid;
  metadata_id text;
begin
  if p_recipient_profile_id is not null then
    select p.id into resolved_id
    from public.profiles p
    where p.id = p_recipient_profile_id and p.company_id = p_company_id
    limit 1;
    if resolved_id is not null then return resolved_id; end if;
  end if;

  metadata_id := coalesce(p_metadata->>'recipient_profile_id', p_metadata#>>'{recipient,id}');
  if metadata_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select p.id into resolved_id
    from public.profiles p
    where p.id = metadata_id::uuid and p.company_id = p_company_id
    limit 1;
    if resolved_id is not null then return resolved_id; end if;
  end if;

  select p.id into resolved_id
  from public.profiles p
  where p.company_id = p_company_id
    and nullif(trim(p_to_email), '') is not null
    and (
      lower(trim(coalesce(p.real_email, ''))) = lower(trim(p_to_email))
      or lower(trim(coalesce(p.email, ''))) = lower(trim(p_to_email))
    )
  order by case when lower(trim(coalesce(p.real_email, ''))) = lower(trim(p_to_email)) then 0 else 1 end, p.id
  limit 1;
  return resolved_id;
end;
$_$;


--
-- Name: person_identity_backfill_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_identity_backfill_review (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    source_table text NOT NULL,
    source_id uuid NOT NULL,
    legacy_name text,
    legacy_employee_number text,
    candidate_person_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    resolution_status text DEFAULT 'unresolved'::text NOT NULL,
    resolved_person_id uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_identity_backfill_review_resolution_status_check CHECK ((resolution_status = ANY (ARRAY['unresolved'::text, 'resolved'::text, 'ignored'::text])))
);


--
-- Name: TABLE person_identity_backfill_review; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.person_identity_backfill_review IS 'Ambiguous or unmatched legacy person references awaiting controlled identity resolution.';


--
-- Name: resolve_person_identity_review(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_person_identity_review(p_review_id uuid, p_person_id uuid, p_decision text, p_note text DEFAULT NULL::text) RETURNS public.person_identity_backfill_review
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare
  item public.person_identity_backfill_review%rowtype;
  person_row public.people%rowtype;
  caller_role text;
  set_parts text[]:=array['person_id=$1'];
  update_sql text;
begin
  select * into item from public.person_identity_backfill_review where id=p_review_id for update;
  if item.id is null then raise exception 'Identity review item not found'; end if;
  select p.role into caller_role from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=item.company_id);
  if caller_role is null or caller_role not in ('sephs_admin','admin','hse_manager') then
    raise exception 'Identity reconciliation permission denied';
  end if;
  if p_decision not in ('linked','ignored') then raise exception 'Unsupported reconciliation decision'; end if;

  if p_decision='linked' then
    if p_person_id is null then raise exception 'Select a person before linking'; end if;
    select * into person_row from public.people where id=p_person_id and company_id=item.company_id;
    if person_row.id is null then raise exception 'Selected person is outside this company or unavailable'; end if;
    if item.source_table not in (
      'training_followup','competency_matrix','induction_records','elearning_enrolments',
      'ppe_issuance','medical_surveillance','audiometry_records','spirometry_records',
      'vaccination_records','occupational_diseases','doc_acknowledgements'
    ) then raise exception 'Source table is not approved for identity reconciliation'; end if;
    if to_regclass('public.'||item.source_table) is null then raise exception 'Source table is unavailable'; end if;

    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=item.source_table and column_name='person_name_snapshot') then
      set_parts:=set_parts||'person_name_snapshot=coalesce(person_name_snapshot,$2)';
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=item.source_table and column_name='organization_snapshot') then
      set_parts:=set_parts||'organization_snapshot=coalesce(organization_snapshot,$3)';
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=item.source_table and column_name='role_snapshot') then
      set_parts:=set_parts||'role_snapshot=coalesce(role_snapshot,$4)';
    end if;
    update_sql:=format('update public.%I set %s where id=$5 and company_id=$6',item.source_table,array_to_string(set_parts,','));
    execute update_sql using person_row.id,concat_ws(' ',person_row.first_name,person_row.last_name),coalesce(person_row.company_name,person_row.department),person_row.job_title,item.source_id,item.company_id;
    if not found then raise exception 'Source record no longer exists or belongs to another company'; end if;
  end if;

  update public.person_identity_backfill_review
  set resolution_status=case when p_decision='linked' then 'resolved' else 'ignored' end,
      resolved_person_id=case when p_decision='linked' then p_person_id else null end,
      resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
  where id=p_review_id returning * into item;

  insert into public.person_identity_decisions(
    company_id,review_id,source_table,source_id,decision,selected_person_id,
    legacy_name,decision_note,decided_by
  ) values (
    item.company_id,item.id,item.source_table,item.source_id,p_decision,p_person_id,
    item.legacy_name,nullif(trim(p_note),''),auth.uid()
  );

  if to_regclass('public.audit_events') is not null then
    insert into public.audit_events(
      company_id,actor_user_id,action,module_name,related_table,related_id,
      summary,details
    ) values (
      item.company_id,auth.uid(),'update','people',item.source_table,item.source_id,
      'Legacy person identity '||p_decision,
      jsonb_build_object('review_id',item.id,'legacy_name',item.legacy_name,'selected_person_id',p_person_id,'note',p_note,'event_code','people.identity_'||p_decision,'sensitivity','restricted')
    );
  end if;
  return item;
end;
$_$;


--
-- Name: resolve_unique_person_id(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_unique_person_id(p_company_id uuid, p_name text, p_employee_number text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  matches uuid[];
begin
  select array_agg(p.id order by p.id) into matches
  from public.people p
  where p.company_id=p_company_id
    and (
      (nullif(trim(p_employee_number),'') is not null and
       public.normalise_person_identity_text(coalesce(p.employee_number,p.id_number))=public.normalise_person_identity_text(p_employee_number))
      or
      (nullif(trim(p_name),'') is not null and
       public.normalise_person_identity_text(concat_ws(' ',p.first_name,p.last_name))=public.normalise_person_identity_text(p_name))
      or
      (nullif(trim(p_name),'') is not null and
       public.normalise_person_identity_text(concat_ws(', ',p.last_name,p.first_name))=public.normalise_person_identity_text(p_name))
      or lower(coalesce(p.email,''))=lower(trim(coalesce(p_name,'')))
    );
  if coalesce(array_length(matches,1),0)=1 then return matches[1]; end if;
  return null;
end;
$$;


--
-- Name: notification_user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_user_preferences (
    profile_id uuid NOT NULL,
    company_id uuid NOT NULL,
    timezone text DEFAULT 'Asia/Dubai'::text NOT NULL,
    quiet_hours_enabled boolean DEFAULT false NOT NULL,
    quiet_start time without time zone DEFAULT '20:00:00'::time without time zone NOT NULL,
    quiet_end time without time zone DEFAULT '06:00:00'::time without time zone NOT NULL,
    allow_urgent_override boolean DEFAULT true NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    push_enabled boolean DEFAULT true NOT NULL,
    whatsapp_enabled boolean DEFAULT true NOT NULL,
    max_external_alerts_per_hour integer DEFAULT 10 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_user_preference_max_external_alerts_per_hour_check CHECK (((max_external_alerts_per_hour >= 1) AND (max_external_alerts_per_hour <= 60)))
);


--
-- Name: TABLE notification_user_preferences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_user_preferences IS 'Recipient-owned external notification channel, quiet-hour and rate-protection preferences.';


--
-- Name: set_my_notification_preferences(text, boolean, time without time zone, time without time zone, boolean, boolean, boolean, boolean, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_notification_preferences(p_timezone text, p_quiet_enabled boolean, p_quiet_start time without time zone, p_quiet_end time without time zone, p_allow_urgent_override boolean, p_email_enabled boolean, p_push_enabled boolean, p_whatsapp_enabled boolean, p_max_external_alerts integer) RETURNS public.notification_user_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare profile_row public.profiles%rowtype; result public.notification_user_preferences%rowtype;
begin
  select * into profile_row from public.profiles where id=auth.uid();
  if not found then raise exception 'Authenticated profile not found'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Unsupported timezone'; end if;
  insert into public.notification_user_preferences(profile_id,company_id,timezone,quiet_hours_enabled,quiet_start,quiet_end,
    allow_urgent_override,email_enabled,push_enabled,whatsapp_enabled,max_external_alerts_per_hour,updated_at)
  values(profile_row.id,profile_row.company_id,p_timezone,coalesce(p_quiet_enabled,false),coalesce(p_quiet_start,'20:00'),
    coalesce(p_quiet_end,'06:00'),coalesce(p_allow_urgent_override,true),coalesce(p_email_enabled,true),
    coalesce(p_push_enabled,true),coalesce(p_whatsapp_enabled,true),greatest(1,least(coalesce(p_max_external_alerts,10),60)),now())
  on conflict(profile_id) do update set timezone=excluded.timezone,quiet_hours_enabled=excluded.quiet_hours_enabled,
    quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,allow_urgent_override=excluded.allow_urgent_override,
    email_enabled=excluded.email_enabled,push_enabled=excluded.push_enabled,whatsapp_enabled=excluded.whatsapp_enabled,
    max_external_alerts_per_hour=excluded.max_external_alerts_per_hour,updated_at=now()
  returning * into result;
  return result;
end;
$$;


--
-- Name: set_my_whatsapp_consent(boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_whatsapp_consent(p_opted_in boolean, p_phone text DEFAULT NULL::text, p_consent_version text DEFAULT '2026-08'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  profile_row public.profiles%rowtype;
  normalised_phone text;
  previous_phone text;
  event_name text;
begin
  select * into profile_row from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Authenticated profile not found'; end if;
  previous_phone:=profile_row.whatsapp_phone;
  normalised_phone:=regexp_replace(coalesce(p_phone,profile_row.whatsapp_phone,''),'[^0-9+]','','g');
  if p_opted_in and normalised_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'WhatsApp number must use international format, for example +2305xxxxxxx';
  end if;

  update public.profiles set
    whatsapp_phone=case when p_opted_in then normalised_phone else whatsapp_phone end,
    preferred_notification_channel=case when p_opted_in then 'whatsapp'
      when preferred_notification_channel='whatsapp' then 'in_app' else preferred_notification_channel end,
    whatsapp_opted_in_at=case when p_opted_in then now() else whatsapp_opted_in_at end,
    whatsapp_opted_out_at=case when p_opted_in then null else now() end,
    whatsapp_consent_source='user_profile',
    whatsapp_consent_version=coalesce(nullif(trim(p_consent_version),''),'2026-08'),
    updated_at=now()
  where id=auth.uid();

  event_name:=case when not p_opted_in then 'opted_out'
    when previous_phone is distinct from normalised_phone and profile_row.whatsapp_opted_in_at is not null then 'phone_changed'
    else 'opted_in' end;
  insert into public.whatsapp_consent_events(company_id,profile_id,event_type,phone_snapshot,consent_version,source,actor_id)
  values(profile_row.company_id,profile_row.id,event_name,case when p_opted_in then normalised_phone else previous_phone end,
    coalesce(nullif(trim(p_consent_version),''),'2026-08'),'user_profile',auth.uid());

  if not p_opted_in then
    update public.whatsapp_delivery_jobs set status='skipped',error_msg='Recipient withdrew WhatsApp consent',updated_at=now()
    where recipient_profile_id=auth.uid() and status='pending';
  end if;
  return jsonb_build_object('opted_in',p_opted_in,'phone',case when p_opted_in then normalised_phone else null end,'event',event_name);
end;
$_$;


--
-- Name: notification_acknowledgement_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_acknowledgement_settings (
    company_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    high_sla_minutes integer DEFAULT 240 NOT NULL,
    urgent_sla_minutes integer DEFAULT 30 NOT NULL,
    reminder_interval_minutes integer DEFAULT 60 NOT NULL,
    max_reminders integer DEFAULT 3 NOT NULL,
    escalate_after_reminders integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acknowledgement_sla_order CHECK (((urgent_sla_minutes < high_sla_minutes) AND (escalate_after_reminders <= max_reminders))),
    CONSTRAINT notification_acknowledgement_se_reminder_interval_minutes_check CHECK (((reminder_interval_minutes >= 5) AND (reminder_interval_minutes <= 1440))),
    CONSTRAINT notification_acknowledgement_set_escalate_after_reminders_check CHECK (((escalate_after_reminders >= 1) AND (escalate_after_reminders <= 10))),
    CONSTRAINT notification_acknowledgement_settings_high_sla_minutes_check CHECK (((high_sla_minutes >= 15) AND (high_sla_minutes <= 10080))),
    CONSTRAINT notification_acknowledgement_settings_max_reminders_check CHECK (((max_reminders >= 1) AND (max_reminders <= 10))),
    CONSTRAINT notification_acknowledgement_settings_urgent_sla_minutes_check CHECK (((urgent_sla_minutes >= 5) AND (urgent_sla_minutes <= 1440)))
);


--
-- Name: set_notification_acknowledgement_settings(uuid, boolean, integer, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_notification_acknowledgement_settings(p_company_id uuid, p_enabled boolean, p_high_sla_minutes integer, p_urgent_sla_minutes integer, p_reminder_interval_minutes integer, p_max_reminders integer, p_escalate_after_reminders integer) RETURNS public.notification_acknowledgement_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare actor public.profiles%rowtype; result public.notification_acknowledgement_settings%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid();
  if not found or not(actor.role='sephs_admin' or (actor.company_id=p_company_id and actor.role in ('admin','hse_manager'))) then raise exception 'Only a company administrator or HSE manager can configure acknowledgement control'; end if;
  if p_high_sla_minutes not between 15 and 10080 or p_urgent_sla_minutes not between 5 and 1440 or p_urgent_sla_minutes>=p_high_sla_minutes
    or p_reminder_interval_minutes not between 5 and 1440 or p_max_reminders not between 1 and 10 or p_escalate_after_reminders not between 1 and p_max_reminders then raise exception 'Acknowledgement SLA settings are invalid'; end if;
  insert into public.notification_acknowledgement_settings(company_id,enabled,high_sla_minutes,urgent_sla_minutes,reminder_interval_minutes,max_reminders,escalate_after_reminders,updated_at)
  values(p_company_id,coalesce(p_enabled,true),p_high_sla_minutes,p_urgent_sla_minutes,p_reminder_interval_minutes,p_max_reminders,p_escalate_after_reminders,now())
  on conflict(company_id) do update set enabled=excluded.enabled,high_sla_minutes=excluded.high_sla_minutes,urgent_sla_minutes=excluded.urgent_sla_minutes,
    reminder_interval_minutes=excluded.reminder_interval_minutes,max_reminders=excluded.max_reminders,escalate_after_reminders=excluded.escalate_after_reminders,updated_at=now()
  returning * into result; return result;
end; $$;


--
-- Name: set_notification_escalation_configuration(uuid, boolean, integer, integer, integer, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_notification_escalation_configuration(p_company_id uuid, p_enabled boolean, p_due_soon_days integer, p_level_1_days integer, p_level_2_days integer, p_level_3_days integer, p_recipients jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;


--
-- Name: FUNCTION set_notification_escalation_configuration(p_company_id uuid, p_enabled boolean, p_due_soon_days integer, p_level_1_days integer, p_level_2_days integer, p_level_3_days integer, p_recipients jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_notification_escalation_configuration(p_company_id uuid, p_enabled boolean, p_due_soon_days integer, p_level_1_days integer, p_level_2_days integer, p_level_3_days integer, p_recipients jsonb) IS 'Atomically validates and replaces one tenant action-escalation hierarchy; company admin/HSE manager only.';


--
-- Name: set_security_sla_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_security_sla_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: set_user_notification_ack_deadline(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_notification_ack_deadline() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare cfg record; minutes_value integer;
begin
  if not new.acknowledgement_required or new.acknowledged_at is not null then return new; end if;
  select * into cfg from public.notification_acknowledgement_settings where company_id=new.company_id;
  if not found then
    minutes_value:=case when new.severity='urgent' then 30 else 240 end;
  elsif not cfg.enabled then return new;
  else minutes_value:=case when new.severity='urgent' then cfg.urgent_sla_minutes else cfg.high_sla_minutes end;
  end if;
  new.acknowledgement_due_at:=coalesce(new.acknowledgement_due_at,new.created_at,now())+make_interval(mins=>minutes_value);
  return new;
end; $$;


--
-- Name: stop_acknowledgement_followups(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stop_acknowledgement_followups() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if new.acknowledged_at is null or old.acknowledged_at is not null then return new; end if;
  update public.notification_queue set status='skipped',error_msg='Alert was acknowledged before external delivery',locked_at=null,locked_by=null
    where id=new.source_notification_id and status='pending';
  update public.notification_queue set status='skipped',error_msg='Original alert was acknowledged',locked_at=null,locked_by=null
    where status='pending' and metadata->>'parent_user_notification_id'=new.id::text and type in ('acknowledgement_reminder','acknowledgement_escalation');
  update public.user_notifications u set dismissed_at=coalesce(u.dismissed_at,now()),updated_at=now()
    from public.notification_queue q where u.source_notification_id=q.id and q.metadata->>'parent_user_notification_id'=new.id::text and u.dismissed_at is null;
  return new;
end; $$;


--
-- Name: stop_action_acknowledgement_followups(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stop_action_acknowledgement_followups() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if lower(coalesce(new.status,'')) not in ('closed','cancelled','canceled','completed','complete','void') or lower(coalesce(new.status,''))=lower(coalesce(old.status,'')) then return new; end if;
  update public.notification_queue followup set status='skipped',error_msg='Source action is now '||new.status,locked_at=null,locked_by=null
    where followup.status='pending' and followup.type in ('acknowledgement_reminder','acknowledgement_escalation') and exists(
      select 1 from public.user_notifications original where original.id::text=followup.metadata->>'parent_user_notification_id'
        and original.company_id=new.company_id and original.related_table='action_tracker' and original.related_id=new.id);
  update public.user_notifications original set dismissed_at=coalesce(original.dismissed_at,now()),updated_at=now()
    where original.company_id=new.company_id and original.related_table='action_tracker' and original.related_id=new.id and original.dismissed_at is null;
  return new;
end; $$;


--
-- Name: stop_action_notifications_on_terminal_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stop_action_notifications_on_terminal_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $_$
begin
  if lower(coalesce(new.status,'')) not in ('closed','cancelled','canceled','completed','complete','void')
    or lower(coalesce(new.status,''))=lower(coalesce(old.status,'')) then return new; end if;
  update public.notification_queue set status='skipped',error_msg='Source action is now '||new.status,
    locked_at=null,locked_by=null
  where company_id=new.company_id and related_table='action_tracker' and related_id=new.id and status='pending'
    and type in ('action','action_due_soon','action_overdue');
  update public.user_notifications u set dismissed_at=coalesce(u.dismissed_at,now()),updated_at=now()
  from public.notification_queue q where u.source_notification_id=q.id and q.company_id=new.company_id
    and q.related_table='action_tracker' and q.related_id=new.id and u.dismissed_at is null
    and q.type in ('action','action_due_soon','action_overdue');
  if to_regclass('public.push_delivery_jobs') is not null then
    execute $stop_push$update public.push_delivery_jobs j
      set status='skipped',error_msg='Source action reached a terminal state',locked_at=null,locked_by=null,updated_at=now()
      from public.user_notifications u,public.notification_queue q
      where j.user_notification_id=u.id and u.source_notification_id=q.id
        and q.company_id=$1 and q.related_table='action_tracker' and q.related_id=$2
        and q.type in ('action','action_due_soon','action_overdue') and j.status='pending'$stop_push$
      using new.company_id,new.id;
  end if;
  if to_regclass('public.whatsapp_delivery_jobs') is not null then
    execute $stop_whatsapp$update public.whatsapp_delivery_jobs j
      set status='skipped',error_msg='Source action reached a terminal state',locked_at=null,locked_by=null,updated_at=now()
      from public.user_notifications u,public.notification_queue q
      where j.user_notification_id=u.id and u.source_notification_id=q.id
        and q.company_id=$1 and q.related_table='action_tracker' and q.related_id=$2
        and q.type in ('action','action_due_soon','action_overdue') and j.status='pending'$stop_whatsapp$
      using new.company_id,new.id;
  end if;
  return new;
end;
$_$;


--
-- Name: FUNCTION stop_action_notifications_on_terminal_state(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.stop_action_notifications_on_terminal_state() IS 'Stops still-pending individual action alerts and external jobs when the source reaches a terminal state.';


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: validate_record_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_record_relationship() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  new.source_module := lower(btrim(new.source_module));
  new.source_table := lower(btrim(new.source_table));
  new.source_id := btrim(new.source_id);
  new.target_module := lower(btrim(new.target_module));
  new.target_table := lower(btrim(new.target_table));
  new.target_id := btrim(new.target_id);
  new.relationship_type := lower(btrim(new.relationship_type));
  new.source_state := public.relationship_endpoint_state(new.company_id,new.source_module,new.source_table,new.source_id);
  new.target_state := public.relationship_endpoint_state(new.company_id,new.target_module,new.target_table,new.target_id);
  new.source_valid := new.source_state='active';
  new.target_valid := new.target_state='active';
  new.last_validated_at := now();
  new.updated_at := now();
  if new.status = 'archived' then
    new.validation_error := case when new.source_valid and new.target_valid then null else concat_ws('; ',
      case when not new.source_valid then 'Archived source record is unavailable or outside the company' end,
      case when not new.target_valid then 'Archived target record is unavailable or outside the company' end
    ) end;
  elsif new.source_state='unresolved' or new.target_state='unresolved' then
    new.status := 'unresolved';
    new.validation_error := concat_ws('; ',
      case when new.source_state='unresolved' then 'Source registry, table or permission state cannot be validated' end,
      case when new.target_state='unresolved' then 'Target registry, table or permission state cannot be validated' end
    );
  elsif new.source_state='archived' or new.target_state='archived' then
    new.status := 'endpoint_archived';
    new.validation_error := concat_ws('; ',
      case when new.source_state='archived' then 'Source record is archived, retired or inactive' end,
      case when new.target_state='archived' then 'Target record is archived, retired or inactive' end
    );
  elsif new.source_state='broken' or new.target_state='broken' then
    new.status := 'broken';
    new.validation_error := concat_ws('; ',
      case when new.source_state='broken' then 'Source record no longer exists in this company' end,
      case when new.target_state='broken' then 'Target record no longer exists in this company' end
    );
  elsif new.source_valid and new.target_valid then
    new.validation_error := null;
    if new.status in ('unresolved','broken','endpoint_archived','pending_verification') then new.status := 'active'; end if;
  else
    new.status := 'unresolved';
    new.validation_error := concat_ws('; ',
      case when not new.source_valid then 'Source record is unavailable or outside the company' end,
      case when not new.target_valid then 'Target record is unavailable or outside the company' end
    );
  end if;
  return new;
end;
$$;


--
-- Name: validate_record_relationships(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_record_relationships(p_company_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000, p_trigger_source text DEFAULT 'manual'::text) RETURNS TABLE(scanned_count integer, active_count integer, archived_endpoint_count integer, broken_count integer, unresolved_count integer, completed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  caller record;
  effective_company uuid:=p_company_id;
  scanned integer:=0;
  active_n integer:=0;
  archived_n integer:=0;
  broken_n integer:=0;
  unresolved_n integer:=0;
  finished timestamptz:=now();
begin
  if auth.uid() is not null then
    select id,company_id,role into caller from public.profiles where id=auth.uid();
    if not found or caller.role not in ('sephs_admin','admin','hse_manager','hse_officer') then
      raise exception 'Relationship validation requires administrator or HSE governance access' using errcode='42501';
    end if;
    if caller.role<>'sephs_admin' then
      effective_company:=caller.company_id;
      if p_company_id is not null and p_company_id<>caller.company_id then
        raise exception 'Relationship validation is limited to the active company' using errcode='42501';
      end if;
    end if;
  elsif current_user not in ('postgres','supabase_admin','service_role') then
    raise exception 'Relationship validation requires an authenticated administrator' using errcode='42501';
  end if;

  with candidates as (
    select id from public.record_relationships
    where status<>'archived' and (effective_company is null or company_id=effective_company)
    order by coalesce(last_validated_at,'epoch'::timestamptz),created_at
    limit greatest(1,least(coalesce(p_limit,1000),5000))
  ), refreshed as (
    update public.record_relationships r set status=r.status
    from candidates c where r.id=c.id
    returning r.status
  )
  select count(*)::integer,
         count(*) filter(where status='active')::integer,
         count(*) filter(where status='endpoint_archived')::integer,
         count(*) filter(where status='broken')::integer,
         count(*) filter(where status='unresolved')::integer
    into scanned,active_n,archived_n,broken_n,unresolved_n
  from refreshed;

  finished:=now();
  insert into public.relationship_validation_runs(company_id,requested_by,trigger_source,scanned_count,active_count,archived_endpoint_count,broken_count,unresolved_count,completed_at)
  values(effective_company,auth.uid(),coalesce(nullif(p_trigger_source,''),'manual'),scanned,active_n,archived_n,broken_n,unresolved_n,finished);
  return query select scanned,active_n,archived_n,broken_n,unresolved_n,finished;
end;
$$;


--
-- Name: action_digest_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_digest_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    run_date date NOT NULL,
    recipient_profile_id uuid NOT NULL,
    notification_id uuid,
    action_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: action_notification_escalation_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_notification_escalation_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    action_id uuid NOT NULL,
    event_key text NOT NULL,
    escalation_level integer NOT NULL,
    recipient_email text NOT NULL,
    notification_id uuid,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT action_notification_escalation_state_escalation_level_check CHECK (((escalation_level >= 0) AND (escalation_level <= 3)))
);


--
-- Name: action_tracker; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_tracker (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    source_module text,
    source_id uuid,
    source_ref text,
    action_no text,
    description text NOT NULL,
    responsible text,
    target_date date,
    completion_date date,
    priority text DEFAULT 'medium'::text,
    status text DEFAULT 'open'::text,
    evidence text,
    comments text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    action_ref text,
    title text,
    source_type text,
    root_cause text,
    action_type text DEFAULT 'corrective'::text,
    assigned_to_id uuid,
    assigned_to_name text,
    assigned_by text,
    assigned_date date,
    department text,
    escalated boolean DEFAULT false,
    escalated_to text,
    escalated_at timestamp with time zone,
    escalation_reason text,
    escalation_level integer DEFAULT 0,
    start_date date,
    target_date_original date,
    date_extended boolean DEFAULT false,
    extension_reason text,
    completed_date date,
    progress_pct integer DEFAULT 0,
    progress_notes text,
    requires_verification boolean DEFAULT true,
    verified_by text,
    verified_date date,
    verification_method text,
    verification_notes text,
    verification_status text DEFAULT 'not_required'::text,
    requires_closure_approval boolean DEFAULT false,
    closure_approved_by text,
    closure_approved_date date,
    closure_notes text,
    closure_rejected_reason text,
    estimated_cost numeric,
    actual_cost numeric,
    recurrence_prevented boolean,
    effectiveness_rating integer,
    site_id uuid,
    instructions text,
    related_id uuid,
    due_date date,
    location text,
    assignee_organization_snapshot text,
    assignee_role_snapshot text,
    area_id uuid,
    site_name_snapshot text,
    area_name_snapshot text,
    CONSTRAINT action_tracker_action_type_check CHECK ((action_type = ANY (ARRAY['corrective'::text, 'preventive'::text, 'improvement'::text, 'observation'::text]))),
    CONSTRAINT action_tracker_effectiveness_rating_check CHECK (((effectiveness_rating >= 1) AND (effectiveness_rating <= 5))),
    CONSTRAINT action_tracker_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT action_tracker_source_module_check CHECK ((source_module = ANY (ARRAY['inspection'::text, 'event'::text, 'risk_assessment'::text, 'investigation'::text, 'meeting'::text, 'permit'::text, 'noise_survey'::text, 'kpi'::text, 'manual'::text]))),
    CONSTRAINT action_tracker_source_type_check CHECK ((source_type = ANY (ARRAY['incident'::text, 'audit'::text, 'inspection'::text, 'complaint'::text, 'risk_assessment'::text, 'toolbox_talk'::text, 'permit'::text, 'noise_survey'::text, 'observation'::text, 'meeting'::text, 'ohealth'::text, 'esg'::text, 'emergency'::text, 'ppe'::text, 'kpi'::text, 'manual'::text, 'other'::text]))),
    CONSTRAINT action_tracker_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'overdue'::text, 'closed'::text]))),
    CONSTRAINT action_tracker_verification_status_check CHECK ((verification_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'passed'::text, 'failed'::text])))
);


--
-- Name: alert_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: approval_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    step_no integer NOT NULL,
    decision text NOT NULL,
    decided_by uuid,
    decided_by_name text,
    comments text,
    decided_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    module_name text NOT NULL,
    related_table text NOT NULL,
    related_id uuid NOT NULL,
    workflow_id uuid,
    current_step_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    submitted_by uuid,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    released_by uuid,
    release_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: approval_workflow_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_workflow_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id uuid NOT NULL,
    step_no integer NOT NULL,
    approver_role text,
    approver_person_id uuid,
    approver_name text,
    approver_email text,
    required boolean DEFAULT true NOT NULL,
    notify_channels text[] DEFAULT ARRAY['email'::text, 'in_app'::text] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: approval_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    module_name text NOT NULL,
    workflow_name text NOT NULL,
    applies_to text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: atex_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atex_areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    area_ref text,
    area_name text NOT NULL,
    location text,
    plant_area text,
    zone_type text DEFAULT 'zone_2'::text NOT NULL,
    material_type text DEFAULT 'gas_vapour'::text,
    substance text,
    source_of_release text,
    ventilation_controls text,
    ignition_controls text,
    detection_controls text,
    linked_equipment text,
    linked_ra_ref text,
    linked_permit_type text,
    last_inspection_date date,
    next_inspection_date date,
    status text DEFAULT 'controlled'::text NOT NULL,
    responsible_person text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_ra_id uuid,
    linked_permit_id uuid,
    linked_permit_ref text
);


--
-- Name: atw_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.atw_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audiometry_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audiometry_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_id uuid,
    employee_name text NOT NULL,
    department text,
    job_title text,
    test_date date NOT NULL,
    next_test_date date,
    examiner text,
    audiometer_calibration_date date,
    is_baseline boolean DEFAULT false,
    baseline_date date,
    r_500hz integer,
    r_1000hz integer,
    r_2000hz integer,
    r_3000hz integer,
    r_4000hz integer,
    r_6000hz integer,
    r_8000hz integer,
    l_500hz integer,
    l_1000hz integer,
    l_2000hz integer,
    l_3000hz integer,
    l_4000hz integer,
    l_6000hz integer,
    l_8000hz integer,
    right_ear_result text DEFAULT 'normal'::text,
    left_ear_result text DEFAULT 'normal'::text,
    overall_result text DEFAULT 'normal'::text,
    sts_right boolean DEFAULT false,
    sts_left boolean DEFAULT false,
    age_correction_applied boolean DEFAULT false,
    hearing_protection_worn boolean DEFAULT true,
    ppe_recommendation text,
    referral_required boolean DEFAULT false,
    notes text,
    noise_exposure_level_dba numeric,
    years_noise_exposure numeric,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT audiometry_records_left_ear_result_check CHECK ((left_ear_result = ANY (ARRAY['normal'::text, 'mild_loss'::text, 'moderate_loss'::text, 'severe_loss'::text, 'profound_loss'::text]))),
    CONSTRAINT audiometry_records_right_ear_result_check CHECK ((right_ear_result = ANY (ARRAY['normal'::text, 'mild_loss'::text, 'moderate_loss'::text, 'severe_loss'::text, 'profound_loss'::text])))
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    actor_user_id uuid,
    actor_name text,
    actor_role text,
    action text NOT NULL,
    module_name text,
    related_table text,
    related_id uuid,
    summary text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    event_code text,
    related_ref text,
    relationship_id uuid,
    correlation_id uuid,
    outcome text DEFAULT 'success'::text NOT NULL,
    sensitivity text DEFAULT 'standard'::text NOT NULL,
    CONSTRAINT audit_events_outcome_check CHECK ((outcome = ANY (ARRAY['success'::text, 'failed'::text, 'denied'::text, 'partial'::text]))),
    CONSTRAINT audit_events_sensitivity_check CHECK ((sensitivity = ANY (ARRAY['standard'::text, 'confidential'::text, 'restricted'::text, 'clinical'::text])))
);


--
-- Name: COLUMN audit_events.event_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_events.event_code IS 'Stable module.action code used by cross-module audit contract tests.';


--
-- Name: COLUMN audit_events.relationship_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_events.relationship_id IS 'Canonical record_relationships.id for link and unlink lifecycle events.';


--
-- Name: audit_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    inspection_id uuid,
    finding_ref text,
    finding_type text DEFAULT 'observation'::text,
    clause text,
    description text NOT NULL,
    requirement text,
    evidence text,
    severity text DEFAULT 'medium'::text,
    photo_urls jsonb DEFAULT '[]'::jsonb,
    action_required boolean DEFAULT true,
    status text DEFAULT 'open'::text,
    corrective_action text,
    assigned_to text,
    due_date date,
    closed_date date,
    verified_by text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT audit_findings_finding_type_check CHECK ((finding_type = ANY (ARRAY['major_nc'::text, 'minor_nc'::text, 'observation'::text, 'opportunity'::text, 'positive'::text]))),
    CONSTRAINT audit_findings_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'closed'::text, 'accepted'::text])))
);


--
-- Name: auth_sessions_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email text,
    action text,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: authorisations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authorisations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_id uuid,
    person_name text NOT NULL,
    authorisation_type text NOT NULL,
    issue_date date,
    expiry_date date,
    reference text,
    issuing_body text,
    status text DEFAULT 'active'::text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT authorisations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'suspended'::text, 'pending'::text])))
);


--
-- Name: bbs_action_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_action_links (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    theme_id text,
    observation_id text,
    action_id text NOT NULL,
    action_ref text,
    relationship text DEFAULT 'addresses'::text NOT NULL,
    owner_id uuid,
    owner_name text,
    due_date date,
    status_cache text,
    status_checked_at timestamp with time zone,
    effectiveness text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bbs_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_audit_events (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    event_type text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    reason text,
    actor_id uuid,
    actor_name text,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bbs_barriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_barriers (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    parent_code text,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    effective_from date,
    effective_to date,
    owner_id uuid,
    change_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_barriers_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validated'::text, 'published'::text, 'retired'::text])))
);


--
-- Name: bbs_behaviour_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_behaviour_categories (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    display_order integer DEFAULT 0 NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    effective_from date,
    effective_to date,
    owner_id uuid,
    owner_name text,
    change_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_behaviour_categories_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validated'::text, 'published'::text, 'retired'::text])))
);


--
-- Name: bbs_behaviour_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_behaviour_items (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    category_id text,
    category_code text,
    category_name text,
    code text NOT NULL,
    name text NOT NULL,
    safe_statement text NOT NULL,
    at_risk_examples jsonb DEFAULT '[]'::jsonb NOT NULL,
    applicability jsonb DEFAULT '{}'::jsonb NOT NULL,
    critical boolean DEFAULT false NOT NULL,
    potential_consequence text,
    feedback_prompt text,
    control_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    translations jsonb DEFAULT '{}'::jsonb NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    source_version_id text,
    status text DEFAULT 'draft'::text NOT NULL,
    effective_from date,
    effective_to date,
    owner_id uuid,
    owner_name text,
    change_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_behaviour_items_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validated'::text, 'published'::text, 'active'::text, 'retired'::text])))
);


--
-- Name: bbs_config_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_config_versions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    version_no integer NOT NULL,
    name text NOT NULL,
    configuration_group text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    validation jsonb DEFAULT '{}'::jsonb NOT NULL,
    impact_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    effective_from date,
    effective_to date,
    change_reason text NOT NULL,
    rollback_of text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    validated_by uuid,
    validated_at timestamp with time zone,
    published_by uuid,
    published_at timestamp with time zone,
    CONSTRAINT bbs_config_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validated'::text, 'published'::text, 'retired'::text])))
);


--
-- Name: bbs_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_feedback (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    observation_id text NOT NULL,
    observation_ref text,
    status text NOT NULL,
    method text,
    summary text,
    employee_response text,
    agreed_step text,
    no_feedback_reason text,
    author_id uuid,
    author_name text,
    follow_up_due date,
    follow_up_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bbs_observation_barriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_observation_barriers (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    observation_id text NOT NULL,
    response_id text,
    barrier_id text,
    barrier_code text NOT NULL,
    barrier_name text NOT NULL,
    narrative text,
    review_state text DEFAULT 'selected'::text NOT NULL,
    selected_by uuid,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_observation_barriers_review_state_check CHECK ((review_state = ANY (ARRAY['selected'::text, 'confirmed'::text, 'rejected'::text, 'theme'::text])))
);


--
-- Name: bbs_observation_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_observation_details (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    observation_id text NOT NULL,
    programme_id text,
    observation_type text NOT NULL,
    task_activity text NOT NULL,
    work_group text,
    shift_name text,
    observer_mode text NOT NULL,
    observer_person_id uuid,
    observed_subject_type text DEFAULT 'none'::text NOT NULL,
    observed_subject_name text,
    positive_behaviour_text text,
    at_risk_behaviour_text text,
    potential_severity text,
    work_status text,
    immediate_action text,
    referral_type text DEFAULT 'none'::text NOT NULL,
    referral_id text,
    feedback_status text NOT NULL,
    feedback_method text,
    feedback_summary text,
    employee_response text,
    agreed_step text,
    barrier_narrative text,
    workflow_status text DEFAULT 'draft'::text NOT NULL,
    duplicate_of text,
    checklist_version text NOT NULL,
    configuration_version text NOT NULL,
    quality_score numeric,
    submitted_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    record_version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_observation_details_observer_mode_check CHECK ((observer_mode = ANY (ARRAY['identified'::text, 'confidential'::text, 'anonymous'::text]))),
    CONSTRAINT bbs_observation_details_workflow_status_check CHECK ((workflow_status = ANY (ARRAY['draft'::text, 'submitted'::text, 'in_review'::text, 'returned'::text, 'accepted'::text, 'duplicate'::text, 'redirected'::text, 'closed'::text, 'archived'::text])))
);


--
-- Name: bbs_observation_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_observation_responses (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    observation_id text NOT NULL,
    observation_detail_id text,
    behaviour_item_id text,
    item_code text NOT NULL,
    category_name text,
    item_snapshot jsonb NOT NULL,
    result text NOT NULL,
    comment text,
    critical_flag boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_observation_responses_result_check CHECK ((result = ANY (ARRAY['safe'::text, 'at_risk'::text, 'not_observed'::text, 'not_applicable'::text])))
);


--
-- Name: bbs_programmes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_programmes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    purpose text NOT NULL,
    learning_outcomes jsonb DEFAULT '[]'::jsonb NOT NULL,
    scope text,
    target_population text,
    sampling_method text,
    sampling_plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    checklist_version text NOT NULL,
    privacy_notice text NOT NULL,
    owner_id uuid,
    owner_name text,
    start_date date,
    end_date date,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    evaluation jsonb DEFAULT '{}'::jsonb NOT NULL,
    change_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_by uuid,
    published_at timestamp with time zone,
    CONSTRAINT bbs_programmes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'published'::text, 'active'::text, 'paused'::text, 'completed'::text, 'evaluated'::text, 'archived'::text])))
);


--
-- Name: bbs_quality_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_quality_reviews (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    observation_id text NOT NULL,
    observation_version integer DEFAULT 1 NOT NULL,
    validator_id uuid NOT NULL,
    validator_name text,
    decision text NOT NULL,
    reason text,
    comment text,
    quality_components jsonb DEFAULT '{}'::jsonb NOT NULL,
    quality_score numeric,
    retained_observation_id text,
    destination_module text,
    destination_id text,
    assigned_at timestamp with time zone,
    due_at timestamp with time zone,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_quality_reviews_decision_check CHECK ((decision = ANY (ARRAY['accepted'::text, 'returned'::text, 'duplicate'::text, 'redirected'::text])))
);


--
-- Name: bbs_recognitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_recognitions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    observation_id text NOT NULL,
    source_ref text,
    nominee_type text NOT NULL,
    nominee_id text,
    nominee_name text NOT NULL,
    reason text NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    consent_confirmed boolean DEFAULT false NOT NULL,
    nominated_by_id uuid,
    nominated_by_name text,
    reviewed_by uuid,
    review_reason text,
    status text DEFAULT 'submitted'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_recognitions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'review'::text, 'approved'::text, 'returned'::text, 'declined'::text, 'withdrawn'::text]))),
    CONSTRAINT bbs_recognitions_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'team'::text, 'organisation'::text])))
);


--
-- Name: bbs_report_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_report_definitions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    scope text NOT NULL,
    measures jsonb DEFAULT '[]'::jsonb NOT NULL,
    formats jsonb DEFAULT '["PDF"]'::jsonb NOT NULL,
    schedule text DEFAULT 'on_demand'::text NOT NULL,
    distribution jsonb DEFAULT '{}'::jsonb NOT NULL,
    owner_id uuid,
    owner_name text,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_report_definitions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'published'::text, 'retired'::text])))
);


--
-- Name: bbs_sensitive_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_sensitive_access (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    object_type text NOT NULL,
    object_id text NOT NULL,
    identity_type text NOT NULL,
    purpose text NOT NULL,
    outcome text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bbs_themes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bbs_themes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    title text NOT NULL,
    signature text NOT NULL,
    behaviour_code text,
    barrier_name text,
    context text,
    evidence_count integer DEFAULT 0 NOT NULL,
    source_observation_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    criticality text DEFAULT 'normal'::text NOT NULL,
    response_decision text DEFAULT 'monitor'::text NOT NULL,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    owner_id uuid,
    owner_name text,
    status text DEFAULT 'suggested'::text NOT NULL,
    effectiveness text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bbs_themes_status_check CHECK ((status = ANY (ARRAY['suggested'::text, 'confirmed'::text, 'actioned'::text, 'monitoring'::text, 'closed'::text, 'archived'::text])))
);


--
-- Name: bcp_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bcp_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    bcp_ref text,
    title text NOT NULL,
    business_process text,
    department text,
    priority text DEFAULT 'medium'::text,
    rto_hours integer,
    rpo_hours integer,
    financial_impact text,
    operational_impact text,
    reputational_impact text,
    regulatory_impact text,
    recovery_strategy text,
    minimum_resources text,
    alternate_location text,
    it_dependencies text,
    key_suppliers text,
    activation_procedure text,
    recovery_steps text,
    test_procedure text,
    last_tested date,
    next_test_date date,
    version text DEFAULT '1.0'::text,
    status text DEFAULT 'draft'::text,
    approved_by text,
    approved_date date,
    review_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bcp_records_priority_check CHECK ((priority = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT bcp_records_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'under_review'::text, 'superseded'::text])))
);


--
-- Name: bulletin_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bulletin_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: checklist_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    template_name text NOT NULL,
    inspection_type text NOT NULL,
    category text DEFAULT 'General'::text,
    is_default boolean DEFAULT false,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: chemical_inventory_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chemical_inventory_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    reference text NOT NULL,
    chemical_id uuid NOT NULL,
    event_type text NOT NULL,
    event_date date DEFAULT CURRENT_DATE NOT NULL,
    quantity numeric NOT NULL,
    unit text NOT NULL,
    from_location text,
    to_location text,
    batch_number text,
    container_reference text,
    expiry_date date,
    condition_status text DEFAULT 'acceptable'::text NOT NULL,
    evidence_reference text,
    notes text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chemical_inventory_events_condition_status_check CHECK ((condition_status = ANY (ARRAY['acceptable'::text, 'damaged'::text, 'leaking'::text, 'expired'::text, 'unlabelled'::text, 'quarantined'::text, 'disposed'::text]))),
    CONSTRAINT chemical_inventory_events_event_type_check CHECK ((event_type = ANY (ARRAY['receipt'::text, 'transfer'::text, 'issue'::text, 'return'::text, 'count'::text, 'quarantine'::text, 'release'::text, 'disposal'::text]))),
    CONSTRAINT chemical_inventory_events_quantity_check CHECK ((quantity >= (0)::numeric))
);


--
-- Name: chemical_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chemical_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    chemical_ref text,
    product_name text NOT NULL,
    supplier text,
    manufacturer text,
    sds_file_name text,
    sds_revision_date date,
    signal_word text,
    hazard_identification text,
    hazard_statements text[],
    hazard_pictograms text[],
    exposure_routes text[],
    exposure_consequences text,
    first_aid text,
    handling_storage text,
    ppe_required text,
    location text,
    department text,
    process_use text,
    quantity_stored text,
    persons_exposed integer DEFAULT 0,
    exposure_frequency text DEFAULT 'occasional'::text,
    exposure_duration text DEFAULT 'short'::text,
    task_type text DEFAULT 'closed_handling'::text,
    existing_controls text,
    risk_score integer DEFAULT 0,
    risk_level text DEFAULT 'medium'::text,
    recommendations text,
    status text DEFAULT 'active'::text,
    review_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chemical_sds_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chemical_sds_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    chemical_id uuid NOT NULL,
    file_name text NOT NULL,
    revision_date date,
    source_reference text,
    language_code text,
    jurisdiction text,
    extraction_status text DEFAULT 'extracted'::text NOT NULL,
    validation_status text DEFAULT 'pending'::text NOT NULL,
    reviewer_id uuid,
    reviewer_name text,
    validated_at timestamp with time zone,
    material_change boolean DEFAULT false NOT NULL,
    impact_summary text,
    superseded_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chemical_sds_versions_extraction_status_check CHECK ((extraction_status = ANY (ARRAY['uploaded'::text, 'extracted'::text, 'extraction_failed'::text, 'manual_entry'::text]))),
    CONSTRAINT chemical_sds_versions_validation_status_check CHECK ((validation_status = ANY (ARRAY['pending'::text, 'validated'::text, 'current'::text, 'superseded'::text, 'invalid'::text])))
);


--
-- Name: chemical_use_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chemical_use_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    reference text NOT NULL,
    chemical_id uuid NOT NULL,
    task_name text NOT NULL,
    site_name text,
    location_name text NOT NULL,
    method_description text,
    maximum_quantity numeric,
    quantity_unit text,
    frequency text,
    duration text,
    persons_exposed integer DEFAULT 0 NOT NULL,
    abnormal_conditions text,
    substitution_considered boolean DEFAULT false NOT NULL,
    substitution_outcome text,
    controls_required text NOT NULL,
    emergency_arrangements text,
    waste_arrangements text,
    conditions text,
    owner_name text,
    reviewer_name text,
    status text DEFAULT 'proposed'::text NOT NULL,
    approval_date date,
    review_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chemical_use_approvals_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'assessed'::text, 'approved'::text, 'conditional'::text, 'returned'::text, 'rejected'::text, 'suspended'::text, 'withdrawn'::text, 'prohibited'::text, 'closed'::text])))
);


--
-- Name: cir_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cir_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    industry text,
    contact_name text,
    contact_email text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    logo_url text,
    parent_company_id uuid,
    company_type text DEFAULT 'standalone'::text,
    registration_no text,
    address text,
    country text DEFAULT 'Mauritius'::text,
    phone text,
    timezone text DEFAULT 'Indian/Mauritius'::text,
    currency text DEFAULT 'MUR'::text,
    headcount integer DEFAULT 0,
    settings jsonb DEFAULT '{}'::jsonb,
    subscription_tier text DEFAULT 'professional'::text,
    updated_at timestamp with time zone DEFAULT now(),
    brand_primary text,
    brand_secondary text,
    brand_accent text,
    logo_dark_url text,
    favicon_url text,
    brand_display_name text,
    brand_tagline text,
    brand_tab_title text,
    email_header_color text,
    pdf_footer_text text,
    hide_poweredby boolean DEFAULT false,
    theme_preset text,
    module_access text[],
    CONSTRAINT companies_company_type_check CHECK ((company_type = ANY (ARRAY['group'::text, 'subsidiary'::text, 'client'::text, 'standalone'::text])))
);


--
-- Name: company_rollout_cohorts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_rollout_cohorts (
    company_id uuid NOT NULL,
    cohort_key text NOT NULL,
    status text DEFAULT 'disabled'::text NOT NULL,
    module_keys text[] DEFAULT '{}'::text[] NOT NULL,
    compatibility_reads boolean DEFAULT true NOT NULL,
    gate_results jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    enabled_at timestamp with time zone,
    enabled_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_rollout_cohorts_cohort_key_check CHECK ((cohort_key = ANY (ARRAY['core_control'::text, 'controlled_content'::text, 'people_health'::text, 'specialist_operations'::text]))),
    CONSTRAINT company_rollout_cohorts_status_check CHECK ((status = ANY (ARRAY['disabled'::text, 'pilot'::text, 'enabled'::text, 'paused'::text])))
);


--
-- Name: company_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_settings (
    company_id uuid NOT NULL,
    subdomain_slug text,
    notification_defaults jsonb DEFAULT '{}'::jsonb NOT NULL,
    workflow_defaults jsonb DEFAULT '{}'::jsonb NOT NULL,
    mobile_defaults jsonb DEFAULT '{}'::jsonb NOT NULL,
    ai_enabled boolean DEFAULT true NOT NULL,
    audit_retention_months integer DEFAULT 84 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: competencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    name text NOT NULL,
    category text,
    description text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: competency_matrix; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competency_matrix (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_id uuid,
    competency_id uuid,
    current_level integer DEFAULT 0,
    required_level integer DEFAULT 2,
    notes text,
    updated_at timestamp with time zone DEFAULT now(),
    person_name_snapshot text,
    organization_snapshot text,
    role_snapshot text,
    CONSTRAINT competency_matrix_current_level_check CHECK (((current_level >= 0) AND (current_level <= 4))),
    CONSTRAINT competency_matrix_required_level_check CHECK (((required_level >= 0) AND (required_level <= 4)))
);


--
-- Name: compliance_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    assessment_ref text,
    title text NOT NULL,
    assessment_type text DEFAULT 'periodic'::text,
    scope text,
    assessment_date date,
    next_assessment_date date,
    assessor text,
    total_requirements integer DEFAULT 0,
    compliant_count integer DEFAULT 0,
    partial_count integer DEFAULT 0,
    non_compliant_count integer DEFAULT 0,
    na_count integer DEFAULT 0,
    overall_score integer,
    methodology text,
    findings text,
    recommendations text,
    status text DEFAULT 'draft'::text,
    approved_by text,
    approved_date date,
    linked_audit_ref text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    compliance_score numeric DEFAULT 0
);


--
-- Name: compliance_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    audit_date date,
    audited_by text,
    scope text,
    findings text,
    overall_status text DEFAULT 'partial'::text,
    next_audit_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT compliance_audits_overall_status_check CHECK ((overall_status = ANY (ARRAY['compliant'::text, 'partial'::text, 'non_compliant'::text])))
);


--
-- Name: compliance_calendar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_calendar (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    title text NOT NULL,
    event_type text DEFAULT 'assessment'::text,
    legislation text,
    obligation_ref text,
    due_date date NOT NULL,
    recurrence text DEFAULT 'none'::text,
    responsible_person text,
    department text,
    description text,
    reminder_days integer DEFAULT 30,
    status text DEFAULT 'upcoming'::text,
    completed_date date,
    completion_notes text,
    linked_action_ref text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    legal_requirement_id uuid,
    linked_action_id uuid
);


--
-- Name: compliance_gaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_gaps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    gap_ref text,
    requirement_id uuid,
    legislation text NOT NULL,
    section text,
    gap_description text NOT NULL,
    gap_type text DEFAULT 'missing_control'::text,
    risk_level text DEFAULT 'medium'::text,
    action_required text,
    responsible_person text,
    target_date date,
    completion_date date,
    action_ref text,
    status text DEFAULT 'open'::text,
    closure_notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: contractor_assurance_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contractor_assurance_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    contractor_id uuid NOT NULL,
    risk_tier text DEFAULT 'tier_2'::text NOT NULL,
    approved_scope text,
    permitted_sites text,
    approval_conditions text,
    scope_exclusions text,
    decision_status text DEFAULT 'pending'::text NOT NULL,
    decision_authority text,
    decision_date date,
    valid_until date,
    next_review_date date,
    critical_block boolean DEFAULT false NOT NULL,
    block_reason text,
    change_notification_required boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contractor_assurance_profiles_decision_status_check CHECK ((decision_status = ANY (ARRAY['pending'::text, 'review'::text, 'approved'::text, 'conditional'::text, 'restricted'::text, 'rejected'::text, 'suspended'::text, 'expired'::text, 'archived'::text]))),
    CONSTRAINT contractor_assurance_profiles_risk_tier_check CHECK ((risk_tier = ANY (ARRAY['tier_1'::text, 'tier_2'::text, 'tier_3'::text, 'restricted'::text])))
);


--
-- Name: contractor_authorisations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contractor_authorisations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    contractor_id uuid,
    work_order_id uuid,
    permit_id uuid,
    ref_number text,
    authorisation_date date,
    valid_from date,
    valid_until date,
    work_description text NOT NULL,
    work_location text,
    authorised_persons jsonb DEFAULT '[]'::jsonb,
    conditions text,
    ppe_requirements text,
    supervision_requirements text,
    permit_required boolean DEFAULT false,
    permit_number text,
    risk_assessment_ref text,
    method_statement_ref text,
    induction_completed boolean DEFAULT false,
    induction_date date,
    induction_conducted_by text,
    induction_topics text,
    issued_by text,
    issued_by_id uuid,
    contractor_signature text,
    contractor_signed_at timestamp with time zone,
    status text DEFAULT 'active'::text,
    revocation_reason text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT contractor_authorisations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'suspended'::text, 'completed'::text, 'revoked'::text])))
);


--
-- Name: contractor_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contractor_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    contractor_id uuid NOT NULL,
    work_package_id uuid,
    document_type text NOT NULL,
    scope_type text DEFAULT 'company'::text NOT NULL,
    file_reference text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    issuer text,
    issue_date date,
    expiry_date date,
    review_status text DEFAULT 'submitted'::text NOT NULL,
    reviewer_name text,
    reviewed_at timestamp with time zone,
    review_comment text,
    critical_for_work boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contractor_documents_review_status_check CHECK ((review_status = ANY (ARRAY['submitted'::text, 'review'::text, 'accepted'::text, 'rejected'::text, 'superseded'::text, 'expired'::text]))),
    CONSTRAINT contractor_documents_scope_type_check CHECK ((scope_type = ANY (ARRAY['company'::text, 'package'::text, 'worker'::text, 'plant'::text]))),
    CONSTRAINT contractor_documents_version_no_check CHECK ((version_no > 0))
);


--
-- Name: contractor_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contractor_evaluations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    contractor_id uuid,
    work_order_id uuid,
    evaluation_date date,
    evaluated_by text,
    work_description text,
    work_period_start date,
    work_period_end date,
    score_hse_compliance integer,
    score_ppe_usage integer,
    score_housekeeping integer,
    score_toolbox_talks integer,
    score_incident_reporting integer,
    score_quality_work integer,
    score_communication integer,
    score_punctuality integer,
    total_score integer,
    overall_rating text,
    incidents_during_work integer DEFAULT 0,
    incident_details text,
    recommend_future_use boolean,
    recommendation_notes text,
    positive_observations text,
    areas_improvement text,
    evaluator_signature text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT contractor_evaluations_overall_rating_check CHECK ((overall_rating = ANY (ARRAY['excellent'::text, 'good'::text, 'satisfactory'::text, 'poor'::text, 'unacceptable'::text]))),
    CONSTRAINT contractor_evaluations_score_communication_check CHECK (((score_communication >= 1) AND (score_communication <= 5))),
    CONSTRAINT contractor_evaluations_score_housekeeping_check CHECK (((score_housekeeping >= 1) AND (score_housekeeping <= 5))),
    CONSTRAINT contractor_evaluations_score_hse_compliance_check CHECK (((score_hse_compliance >= 1) AND (score_hse_compliance <= 5))),
    CONSTRAINT contractor_evaluations_score_incident_reporting_check CHECK (((score_incident_reporting >= 1) AND (score_incident_reporting <= 5))),
    CONSTRAINT contractor_evaluations_score_ppe_usage_check CHECK (((score_ppe_usage >= 1) AND (score_ppe_usage <= 5))),
    CONSTRAINT contractor_evaluations_score_punctuality_check CHECK (((score_punctuality >= 1) AND (score_punctuality <= 5))),
    CONSTRAINT contractor_evaluations_score_quality_work_check CHECK (((score_quality_work >= 1) AND (score_quality_work <= 5))),
    CONSTRAINT contractor_evaluations_score_toolbox_talks_check CHECK (((score_toolbox_talks >= 1) AND (score_toolbox_talks <= 5)))
);


--
-- Name: contractor_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contractor_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    contractor_id uuid,
    authorisation_id uuid,
    work_order_id uuid,
    ref_number text,
    incident_date date NOT NULL,
    incident_time time without time zone,
    report_date date,
    reported_by text,
    incident_type text DEFAULT 'near_miss'::text,
    severity text DEFAULT 'low'::text,
    location text,
    description text NOT NULL,
    injured_person_name text,
    injured_person_role text,
    injury_type text,
    injury_description text,
    treatment_provided text,
    immediate_cause text,
    root_cause text,
    contributing_factors text,
    immediate_actions text,
    corrective_actions text,
    action_responsible text,
    action_due_date date,
    reported_to_regulator boolean DEFAULT false,
    regulator_reference text,
    status text DEFAULT 'open'::text,
    closed_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT contractor_incidents_incident_type_check CHECK ((incident_type = ANY (ARRAY['near_miss'::text, 'first_aid'::text, 'medical_treatment'::text, 'lost_time'::text, 'dangerous_occurrence'::text, 'property_damage'::text, 'environmental'::text, 'fatality'::text]))),
    CONSTRAINT contractor_incidents_severity_check CHECK ((severity = ANY (ARRAY['negligible'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT contractor_incidents_status_check CHECK ((status = ANY (ARRAY['open'::text, 'investigating'::text, 'closed'::text])))
);


--
-- Name: contractor_mobilisation_gates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contractor_mobilisation_gates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    work_package_id uuid NOT NULL,
    gate_code text NOT NULL,
    category text NOT NULL,
    requirement text NOT NULL,
    critical boolean DEFAULT true NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    evidence_reference text,
    verified_by text,
    verified_at timestamp with time zone,
    comments text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contractor_mobilisation_gates_category_check CHECK ((category = ANY (ARRAY['company'::text, 'package'::text, 'people'::text, 'plant'::text, 'emergency'::text, 'site_interface'::text]))),
    CONSTRAINT contractor_mobilisation_gates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'passed'::text, 'failed'::text, 'waived'::text, 'not_applicable'::text])))
);


--
-- Name: contractor_preassessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contractor_preassessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    contractor_id uuid,
    assessment_date date,
    assessed_by text,
    has_registration boolean,
    registration_details text,
    has_insurance boolean,
    insurance_details text,
    has_hse_policy boolean,
    hse_policy_details text,
    has_hse_manager boolean,
    hse_manager_name text,
    has_risk_assessment_process boolean,
    has_method_statements boolean,
    has_accident_reporting boolean,
    last_reportable_accident text,
    accident_rate_3yr text,
    has_trained_supervisors boolean,
    training_records_available boolean,
    relevant_certifications text,
    has_equipment_inspection boolean,
    has_statutory_inspections boolean,
    has_environmental_policy boolean,
    waste_management_procedure boolean,
    score integer,
    score_legal integer,
    score_hse integer,
    score_competency integer,
    score_equipment integer,
    score_environmental integer,
    result text DEFAULT 'pending'::text,
    conditions_notes text,
    assessor_comments text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT contractor_preassessments_result_check CHECK ((result = ANY (ARRAY['pending'::text, 'approved'::text, 'conditional'::text, 'rejected'::text])))
);


--
-- Name: contractor_work_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contractor_work_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    reference text NOT NULL,
    contractor_id uuid NOT NULL,
    title text NOT NULL,
    scope_description text NOT NULL,
    scope_exclusions text,
    site_name text NOT NULL,
    work_location text,
    planned_start date NOT NULL,
    planned_end date NOT NULL,
    contract_owner text NOT NULL,
    contractor_manager text,
    hse_lead text,
    risk_tier text DEFAULT 'tier_2'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    interface_summary text,
    hse_plan_reference text,
    risk_assessment_reference text,
    rams_reference text,
    permit_reference text,
    emergency_arrangements text,
    workforce_summary text,
    plant_material_summary text,
    subcontracting_declared boolean DEFAULT false NOT NULL,
    change_summary text,
    closeout_summary text,
    evaluation_reference text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contractor_work_packages_check CHECK ((planned_end >= planned_start)),
    CONSTRAINT contractor_work_packages_risk_tier_check CHECK ((risk_tier = ANY (ARRAY['tier_1'::text, 'tier_2'::text, 'tier_3'::text, 'restricted'::text]))),
    CONSTRAINT contractor_work_packages_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'planning'::text, 'mobilisation'::text, 'ready'::text, 'blocked'::text, 'active'::text, 'suspended'::text, 'close_out'::text, 'closed'::text, 'cancelled'::text])))
);


--
-- Name: contractors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contractors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    contractor_name text NOT NULL,
    trading_name text,
    registration_number text,
    vat_number text,
    address text,
    contact_person text,
    contact_email text,
    contact_phone text,
    website text,
    category text DEFAULT 'general'::text,
    specialisation text,
    status text DEFAULT 'pending'::text,
    approved_date date,
    expiry_date date,
    last_review_date date,
    next_review_date date,
    insurance_type text,
    insurance_provider text,
    insurance_expiry date,
    insurance_policy_number text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT contractors_category_check CHECK ((category = ANY (ARRAY['electrical'::text, 'mechanical'::text, 'civil'::text, 'construction'::text, 'cleaning'::text, 'it'::text, 'security'::text, 'catering'::text, 'other'::text, 'general'::text]))),
    CONSTRAINT contractors_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'pre_assessed'::text, 'approved'::text, 'suspended'::text, 'rejected'::text, 'expired'::text])))
);


--
-- Name: control_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.control_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    hazard_category text,
    hazard_type text,
    control_description text NOT NULL,
    hierarchy_level text,
    effectiveness integer,
    legal_ref text,
    is_global boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT control_library_effectiveness_check CHECK (((effectiveness >= 1) AND (effectiveness <= 5))),
    CONSTRAINT control_library_hierarchy_level_check CHECK ((hierarchy_level = ANY (ARRAY['elimination'::text, 'substitution'::text, 'engineering'::text, 'administrative'::text, 'ppe'::text])))
);


--
-- Name: custom_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    record_table text NOT NULL,
    record_id uuid NOT NULL,
    field_id uuid NOT NULL,
    field_key text NOT NULL,
    value jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: custom_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    module_key text NOT NULL,
    field_label text NOT NULL,
    field_key text NOT NULL,
    field_type text NOT NULL,
    options jsonb DEFAULT '[]'::jsonb NOT NULL,
    required boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_fields_field_type_check CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'date'::text, 'textarea'::text, 'select'::text, 'checkbox'::text])))
);


--
-- Name: doc_acknowledgements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_acknowledgements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    document_id uuid,
    doc_ref text,
    doc_title text,
    doc_version text,
    person_id uuid,
    employee_name text NOT NULL,
    department text,
    acknowledged boolean DEFAULT false,
    acknowledged_at timestamp with time zone,
    signature_text text,
    quiz_score integer,
    quiz_passed boolean,
    status text DEFAULT 'pending'::text,
    due_date date,
    reminder_count integer DEFAULT 0,
    last_reminder_at timestamp with time zone,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    person_name_snapshot text,
    organization_snapshot text,
    role_snapshot text,
    CONSTRAINT doc_acknowledgements_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'acknowledged'::text, 'overdue'::text, 'declined'::text])))
);


--
-- Name: doc_controlled_copies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_controlled_copies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    document_id uuid,
    copy_number text NOT NULL,
    copy_holder text NOT NULL,
    department text,
    location text,
    issued_date date,
    issued_by text,
    is_master boolean DEFAULT false,
    format text DEFAULT 'electronic'::text,
    status text DEFAULT 'active'::text,
    recall_date date,
    recall_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT doc_controlled_copies_format_check CHECK ((format = ANY (ARRAY['electronic'::text, 'print'::text, 'both'::text]))),
    CONSTRAINT doc_controlled_copies_status_check CHECK ((status = ANY (ARRAY['active'::text, 'recalled'::text, 'superseded'::text, 'lost'::text])))
);


--
-- Name: doc_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    document_id uuid,
    version text NOT NULL,
    revision_type text DEFAULT 'minor'::text,
    summary text,
    changed_by text,
    approved_by text,
    effective_date date,
    snapshot jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT doc_revisions_revision_type_check CHECK ((revision_type = ANY (ARRAY['major'::text, 'minor'::text, 'correction'::text])))
);


--
-- Name: document_control_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_control_audit_events (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    document_id text,
    revision_id text,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    reason text,
    source text DEFAULT 'web'::text NOT NULL,
    correlation_id text,
    performed_by uuid,
    performed_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_control_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_control_config (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    workspace text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    scope_type text DEFAULT 'company'::text NOT NULL,
    scope_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    test_cases jsonb DEFAULT '[]'::jsonb NOT NULL,
    test_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    impact_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    copied_from_id text,
    change_reason text,
    effective_from date,
    effective_to date,
    owner_id uuid,
    tested_by uuid,
    tested_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    published_by uuid,
    published_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_control_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_control_files (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    document_id text NOT NULL,
    revision_id text,
    file_role text DEFAULT 'source'::text NOT NULL,
    language_code text DEFAULT 'en'::text NOT NULL,
    file_name text NOT NULL,
    file_url text,
    storage_path text,
    mime_type text,
    file_size bigint,
    content_hash text,
    control_marking text,
    status text DEFAULT 'draft'::text NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_control_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_control_records (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    document_id text,
    revision_id text,
    record_type text NOT NULL,
    code text,
    title text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    owner_id uuid,
    owner_name text,
    assignee_id uuid,
    assignee_name text,
    due_date date,
    completed_at timestamp with time zone,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    parent_id text,
    idempotency_key text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_control_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_control_revisions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    document_id text NOT NULL,
    revision_code text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    language_code text DEFAULT 'en'::text NOT NULL,
    scope_type text DEFAULT 'company'::text NOT NULL,
    scope_id text,
    title text,
    change_summary text,
    content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_hash text,
    source_revision_id text,
    effective_from timestamp with time zone,
    effective_to timestamp with time zone,
    approved_at timestamp with time zone,
    superseded_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    title text NOT NULL,
    doc_type text,
    reference_no text,
    version text,
    issue_date date,
    review_date date,
    owner text,
    file_url text,
    status text DEFAULT 'current'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    doc_ref text,
    document_type text,
    category text,
    description text,
    scope text,
    department text,
    version_major integer DEFAULT 1,
    version_minor integer DEFAULT 0,
    is_latest boolean DEFAULT true,
    superseded_by uuid,
    supersedes uuid,
    revision_summary text,
    effective_date date,
    expiry_date date,
    review_interval_months integer DEFAULT 12,
    last_reviewed_date date,
    author text,
    author_id uuid,
    owner_id uuid,
    reviewer text,
    reviewer_id uuid,
    approver text,
    approver_id uuid,
    approval_status text DEFAULT 'draft'::text,
    review_requested_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    review_comments text,
    approval_requested_at timestamp with time zone,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    rejection_reason text,
    file_name text,
    file_size_kb integer,
    file_type text,
    controlled_copy boolean DEFAULT true,
    copy_number text,
    location text,
    distribution_list jsonb DEFAULT '[]'::jsonb,
    read_access text[] DEFAULT ARRAY['all'::text],
    related_docs jsonb DEFAULT '[]'::jsonb,
    linked_procedures text[],
    legal_refs text[],
    tags text[],
    updated_at timestamp with time zone DEFAULT now(),
    file_size bigint,
    file_mime text,
    file_path text,
    lifecycle_state text,
    confidentiality text DEFAULT 'internal'::text NOT NULL,
    current_revision_id text,
    language_code text DEFAULT 'en'::text NOT NULL,
    scope_type text DEFAULT 'company'::text NOT NULL,
    scope_id text,
    retention_class text,
    archived_at timestamp with time zone,
    idempotency_key text,
    linked_risk_assessment_id uuid,
    linked_permit_id uuid,
    linked_ra_ref text,
    linked_permit_ref text,
    CONSTRAINT documents_approval_status_check CHECK ((approval_status = ANY (ARRAY['draft'::text, 'pending_review'::text, 'under_review'::text, 'pending_approval'::text, 'approved'::text, 'rejected'::text, 'superseded'::text, 'withdrawn'::text]))),
    CONSTRAINT documents_doc_type_check CHECK (((doc_type IS NULL) OR (doc_type = ANY (ARRAY['policy'::text, 'procedure'::text, 'sop'::text, 'swms'::text, 'manual'::text, 'form'::text, 'emergency_plan'::text, 'risk_assessment'::text, 'legal'::text, 'certificate'::text, 'work_instruction'::text, 'technical_spec'::text, 'other'::text])))),
    CONSTRAINT documents_document_type_check CHECK (((document_type IS NULL) OR (document_type = ANY (ARRAY['policy'::text, 'procedure'::text, 'sop'::text, 'swms'::text, 'manual'::text, 'form'::text, 'emergency_plan'::text, 'risk_assessment'::text, 'legal'::text, 'certificate'::text, 'work_instruction'::text, 'technical_spec'::text, 'other'::text])))),
    CONSTRAINT documents_status_check CHECK ((status = ANY (ARRAY['current'::text, 'superseded'::text, 'draft'::text])))
);


--
-- Name: elearning_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.elearning_courses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    course_code text,
    title text NOT NULL,
    category text,
    description text,
    duration_mins integer,
    passing_score integer DEFAULT 80,
    course_url text,
    thumbnail_url text,
    is_mandatory boolean DEFAULT false,
    target_roles text[],
    validity_months integer,
    status text DEFAULT 'active'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    duration_minutes integer,
    mandatory boolean DEFAULT false,
    learning_path jsonb DEFAULT '[]'::jsonb NOT NULL,
    quiz_config jsonb DEFAULT '{"enabled": false, "questions": []}'::jsonb NOT NULL,
    CONSTRAINT elearning_courses_status_check CHECK ((status = ANY (ARRAY['active'::text, 'draft'::text, 'archived'::text])))
);


--
-- Name: elearning_enrolments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.elearning_enrolments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    course_id uuid,
    course_title text,
    person_name text NOT NULL,
    employee_id text,
    department text,
    enrolment_date date,
    started_date date,
    completion_date date,
    score numeric,
    passed boolean,
    attempts integer DEFAULT 0,
    time_spent_mins integer,
    certificate_url text,
    expiry_date date,
    status text DEFAULT 'enrolled'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    time_spent_minutes integer,
    target_date date,
    person_id uuid,
    person_name_snapshot text,
    organization_snapshot text,
    role_snapshot text,
    learning_progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    quiz_passed boolean,
    quiz_completed_at timestamp with time zone,
    CONSTRAINT elearning_enrolments_status_check CHECK ((status = ANY (ARRAY['enrolled'::text, 'in_progress'::text, 'completed'::text, 'failed'::text, 'expired'::text])))
);


--
-- Name: elearning_quiz_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.elearning_quiz_attempts (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    course_id text NOT NULL,
    enrolment_id text NOT NULL,
    learner_profile_id uuid,
    attempt_no integer DEFAULT 1 NOT NULL,
    answers jsonb DEFAULT '[]'::jsonb NOT NULL,
    score numeric NOT NULL,
    passing_score numeric NOT NULL,
    passed boolean NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT elearning_quiz_attempts_attempt_no_check CHECK ((attempt_no > 0)),
    CONSTRAINT elearning_quiz_attempts_passing_score_check CHECK (((passing_score >= (0)::numeric) AND (passing_score <= (100)::numeric))),
    CONSTRAINT elearning_quiz_attempts_score_check CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric)))
);


--
-- Name: emergency_activations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_activations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    activation_ref text,
    plan_id uuid,
    emergency_type text NOT NULL,
    activation_date date NOT NULL,
    activation_time time without time zone,
    location text,
    description text NOT NULL,
    severity text DEFAULT 'moderate'::text,
    time_detected time without time zone,
    time_ert_notified time without time zone,
    time_evacuated time without time zone,
    time_services_called time without time zone,
    time_all_clear time without time zone,
    immediate_actions text,
    ert_response text,
    external_agencies_called text,
    injuries integer DEFAULT 0,
    fatalities integer DEFAULT 0,
    missing_persons integer DEFAULT 0,
    property_damage text,
    containment_method text,
    environmental_impact text,
    business_impact text,
    estimated_cost numeric,
    debrief_conducted boolean DEFAULT false,
    debrief_date date,
    lessons_learned text,
    plan_update_required boolean DEFAULT false,
    status text DEFAULT 'active'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT emergency_activations_severity_check CHECK ((severity = ANY (ARRAY['minor'::text, 'moderate'::text, 'major'::text, 'critical'::text]))),
    CONSTRAINT emergency_activations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'contained'::text, 'resolved'::text, 'under_review'::text])))
);


--
-- Name: emergency_drills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_drills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    drill_ref text,
    drill_type text DEFAULT 'evacuation'::text,
    scenario text,
    drill_date date NOT NULL,
    drill_time time without time zone,
    location text,
    planned_duration integer,
    actual_duration integer,
    total_expected integer,
    total_participated integer,
    departments_involved text,
    external_agencies text,
    evacuation_time_mins numeric,
    all_accounted_for boolean DEFAULT false,
    unaccounted_persons integer DEFAULT 0,
    objectives text,
    observations text,
    strengths text,
    weaknesses text,
    corrective_actions text,
    overall_rating text DEFAULT 'satisfactory'::text,
    conducted_by text,
    reviewed_by text,
    approved_by text,
    status text DEFAULT 'planned'::text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT emergency_drills_drill_type_check CHECK ((drill_type = ANY (ARRAY['evacuation'::text, 'fire'::text, 'chemical'::text, 'medical'::text, 'lockdown'::text, 'tabletop'::text, 'full_scale'::text, 'partial'::text, 'comms_test'::text]))),
    CONSTRAINT emergency_drills_overall_rating_check CHECK ((overall_rating = ANY (ARRAY['excellent'::text, 'good'::text, 'satisfactory'::text, 'needs_improvement'::text, 'failed'::text]))),
    CONSTRAINT emergency_drills_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'completed'::text, 'cancelled'::text, 'postponed'::text])))
);


--
-- Name: emergency_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    equipment_type text NOT NULL,
    identifier text,
    location text NOT NULL,
    building text,
    floor text,
    last_inspection date,
    next_inspection date,
    last_service date,
    next_service date,
    condition text DEFAULT 'good'::text,
    serviced_by text,
    notes text,
    status text DEFAULT 'operational'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT emergency_equipment_condition_check CHECK ((condition = ANY (ARRAY['excellent'::text, 'good'::text, 'fair'::text, 'poor'::text, 'condemned'::text]))),
    CONSTRAINT emergency_equipment_equipment_type_check CHECK ((equipment_type = ANY (ARRAY['fire_extinguisher'::text, 'fire_hose'::text, 'first_aid_kit'::text, 'aed'::text, 'eyewash'::text, 'spill_kit'::text, 'ppe_kit'::text, 'alarm_panel'::text, 'emergency_light'::text, 'pa_system'::text, 'stretcher'::text, 'oxygen_kit'::text, 'other'::text]))),
    CONSTRAINT emergency_equipment_status_check CHECK ((status = ANY (ARRAY['operational'::text, 'out_of_service'::text, 'being_serviced'::text])))
);


--
-- Name: emergency_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    plan_ref text,
    title text NOT NULL,
    emergency_type text NOT NULL,
    severity_level text DEFAULT 'major'::text,
    scope text,
    site_name text,
    location text,
    version text DEFAULT '1.0'::text,
    status text DEFAULT 'draft'::text,
    approved_by text,
    approved_date date,
    review_date date,
    last_tested date,
    objectives text,
    activation_criteria text,
    immediate_actions text,
    escalation_procedure text,
    resource_requirements text,
    communication_plan text,
    recovery_actions text,
    lessons_from_tests text,
    key_contacts jsonb DEFAULT '[]'::jsonb,
    resources jsonb DEFAULT '[]'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT emergency_plans_emergency_type_check CHECK ((emergency_type = ANY (ARRAY['fire'::text, 'chemical_spill'::text, 'explosion'::text, 'medical'::text, 'earthquake'::text, 'flood'::text, 'power_failure'::text, 'cyber'::text, 'workplace_violence'::text, 'bomb_threat'::text, 'gas_leak'::text, 'structural'::text, 'environmental'::text, 'pandemic'::text, 'other'::text]))),
    CONSTRAINT emergency_plans_severity_level_check CHECK ((severity_level = ANY (ARRAY['minor'::text, 'moderate'::text, 'major'::text, 'critical'::text]))),
    CONSTRAINT emergency_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'under_review'::text, 'superseded'::text])))
);


--
-- Name: engagement_activity_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_activity_credits (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    activity_type text NOT NULL,
    source_module text,
    source_id text,
    source_ref text,
    person_id uuid,
    person_name text NOT NULL,
    activity_date date,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_value numeric DEFAULT 1 NOT NULL,
    credited_value numeric,
    quality text,
    potential_kpi text,
    duplicate_of text,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    sla text,
    status text DEFAULT 'pending'::text NOT NULL,
    decision_reason text,
    validated_by uuid,
    validated_at timestamp with time zone,
    correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT engagement_activity_credits_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'review'::text, 'accepted'::text, 'partial'::text, 'rejected'::text, 'duplicate'::text, 'request_info'::text])))
);


--
-- Name: engagement_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_assignments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    programme_id text,
    programme_name text NOT NULL,
    target_type text DEFAULT 'group'::text NOT NULL,
    target_id text,
    target_name text NOT NULL,
    scope text,
    population_rule jsonb DEFAULT '{}'::jsonb NOT NULL,
    people_count integer DEFAULT 0 NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    priority integer DEFAULT 100 NOT NULL,
    override_reason text,
    override_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    approved_by uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    record_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT engagement_assignments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'inactive'::text, 'ended'::text, 'conflict'::text, 'archived'::text])))
);


--
-- Name: engagement_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    event_type text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    actor_id uuid,
    actor_name text,
    reason text,
    installation_id text,
    outcome text,
    correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: engagement_calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_calendar_events (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    person_id uuid,
    title text NOT NULL,
    source_module text NOT NULL,
    source_id text,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone,
    timezone text DEFAULT 'Asia/Dubai'::text NOT NULL,
    location text,
    owner text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    deep_link text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: engagement_coaching_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_coaching_plans (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    person_id uuid,
    person_name text NOT NULL,
    trigger text NOT NULL,
    objective text NOT NULL,
    support_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    barriers jsonb DEFAULT '[]'::jsonb NOT NULL,
    coach_id uuid,
    coach text,
    start_date date NOT NULL,
    review_date date,
    progress integer DEFAULT 0 NOT NULL,
    effectiveness text,
    employee_comment text,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    archived_at timestamp with time zone,
    archived_by uuid,
    record_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT engagement_coaching_plans_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT engagement_coaching_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'improving'::text, 'review'::text, 'effective'::text, 'partial'::text, 'ineffective'::text, 'completed'::text, 'cancelled'::text, 'closed'::text, 'archived'::text])))
);


--
-- Name: engagement_configuration_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_configuration_records (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    record_type text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    scope text DEFAULT 'Company'::text NOT NULL,
    inherited_from_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    impact_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    dependencies jsonb DEFAULT '[]'::jsonb NOT NULL,
    effective_from date,
    effective_to date,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    change_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    published_by uuid,
    published_at timestamp with time zone,
    record_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT engagement_configuration_records_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'published'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: engagement_configuration_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_configuration_versions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    version_no integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    effective_from date,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    validation jsonb DEFAULT '{}'::jsonb NOT NULL,
    impact_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    validated_by uuid,
    validated_at timestamp with time zone,
    published_by uuid,
    published_at timestamp with time zone,
    CONSTRAINT engagement_configuration_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validated'::text, 'published'::text, 'retired'::text])))
);


--
-- Name: engagement_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_disputes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    reference text NOT NULL,
    person_id uuid,
    person_name text NOT NULL,
    period text,
    entity_type text,
    entity_id text,
    issue_type text NOT NULL,
    explanation text,
    evidence_ref text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewer_id uuid,
    reviewer text,
    decision text,
    decision_reason text,
    correction jsonb DEFAULT '{}'::jsonb NOT NULL,
    appeal_of text,
    due_at timestamp with time zone,
    status text DEFAULT 'submitted'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    archived_at timestamp with time zone,
    archived_by uuid,
    record_version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    CONSTRAINT engagement_disputes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'acknowledged'::text, 'evidence'::text, 'review'::text, 'more_information'::text, 'decision'::text, 'approved'::text, 'partially_upheld'::text, 'rejected'::text, 'appeal'::text, 'withdrawn'::text, 'closed'::text, 'archived'::text])))
);


--
-- Name: engagement_kpi_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_kpi_definitions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    programme_id text,
    code text NOT NULL,
    name text NOT NULL,
    measure text NOT NULL,
    target numeric,
    target_operator text DEFAULT 'greater_or_equal'::text NOT NULL,
    unit text DEFAULT 'count'::text NOT NULL,
    frequency text DEFAULT 'monthly'::text NOT NULL,
    weight numeric DEFAULT 0 NOT NULL,
    direction text DEFAULT 'higher'::text NOT NULL,
    source text,
    quality_rule jsonb DEFAULT '{}'::jsonb NOT NULL,
    applicability jsonb DEFAULT '{}'::jsonb NOT NULL,
    score_cap numeric DEFAULT 100 NOT NULL,
    critical boolean DEFAULT false NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    record_version integer DEFAULT 1 NOT NULL,
    effective_from date,
    effective_to date,
    created_by uuid,
    change_reason text,
    CONSTRAINT engagement_kpi_definitions_direction_check CHECK ((direction = ANY (ARRAY['higher'::text, 'lower'::text, 'exact'::text, 'range'::text])))
);


--
-- Name: engagement_mobile_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_mobile_drafts (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    local_id text,
    owner_id uuid NOT NULL,
    installation_id text,
    record_type text NOT NULL,
    schema_version text DEFAULT '1'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    attachment_manifest jsonb DEFAULT '[]'::jsonb NOT NULL,
    checksum text,
    idempotency_key uuid DEFAULT gen_random_uuid() NOT NULL,
    state text DEFAULT 'waiting'::text NOT NULL,
    server_record_id text,
    server_version text,
    error_code text,
    acknowledged_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT engagement_mobile_drafts_state_check CHECK ((state = ANY (ARRAY['waiting'::text, 'syncing'::text, 'synced'::text, 'conflict'::text, 'failed'::text, 'expired'::text])))
);


--
-- Name: engagement_mobile_installations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_mobile_installations (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    person_id uuid NOT NULL,
    installation_id text NOT NULL,
    platform text,
    app_version text,
    status text DEFAULT 'active'::text NOT NULL,
    notification_token_ref text,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_seen timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: engagement_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_notifications (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    recipient_id uuid,
    source_event text,
    source_id text,
    title text NOT NULL,
    detail text,
    priority text DEFAULT 'normal'::text NOT NULL,
    channel text DEFAULT 'in_app'::text NOT NULL,
    deep_link text,
    mandatory boolean DEFAULT false NOT NULL,
    scheduled_at timestamp with time zone,
    delivered_at timestamp with time zone,
    opened_at timestamp with time zone,
    acted_at timestamp with time zone,
    state text DEFAULT 'scheduled'::text NOT NULL,
    failure_code text,
    correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: engagement_person_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_person_results (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    person_id uuid,
    person_name text NOT NULL,
    programme_id text,
    programme_name text NOT NULL,
    period text NOT NULL,
    employment_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    score numeric,
    status text DEFAULT 'pending'::text NOT NULL,
    hazards numeric DEFAULT 0 NOT NULL,
    toolbox numeric DEFAULT 0 NOT NULL,
    training numeric DEFAULT 0 NOT NULL,
    actions numeric DEFAULT 0 NOT NULL,
    pending integer DEFAULT 0 NOT NULL,
    excluded integer DEFAULT 0 NOT NULL,
    calculation jsonb DEFAULT '{}'::jsonb NOT NULL,
    formula_version text DEFAULT '1.0'::text NOT NULL,
    employee_comment text,
    supervisor_comment text,
    review_state text DEFAULT 'open'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    locked_at timestamp with time zone,
    revision_no integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    archived_at timestamp with time zone,
    archived_by uuid,
    record_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT engagement_person_results_status_check CHECK ((status = ANY (ARRAY['on_track'::text, 'at_risk'::text, 'off_track'::text, 'pending'::text, 'not_due'::text, 'na'::text, 'data_error'::text])))
);


--
-- Name: engagement_programmes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_programmes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    purpose text,
    population text,
    population_rule jsonb DEFAULT '{}'::jsonb NOT NULL,
    period text DEFAULT (EXTRACT(year FROM CURRENT_DATE))::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    kpi_count integer DEFAULT 0 NOT NULL,
    weight_total numeric DEFAULT 0 NOT NULL,
    score_method text DEFAULT 'weighted'::text NOT NULL,
    na_rule text DEFAULT 'redistribute'::text NOT NULL,
    pending_rule text DEFAULT 'exclude_from_failure'::text NOT NULL,
    owner text,
    status text DEFAULT 'draft'::text NOT NULL,
    effective_from date,
    effective_to date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    archived_at timestamp with time zone,
    archived_by uuid,
    record_version integer DEFAULT 1 NOT NULL,
    published_by uuid,
    published_at timestamp with time zone,
    CONSTRAINT engagement_programmes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'published'::text, 'inactive'::text, 'retired'::text, 'archived'::text])))
);


--
-- Name: engagement_qr_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_qr_sessions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    session_ref text NOT NULL,
    toolbox_session_id text,
    token_hash text NOT NULL,
    nonce uuid DEFAULT gen_random_uuid() NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    person_id uuid,
    person_name text,
    installation_id text,
    scan_at timestamp with time zone,
    confirmation_id text,
    online_state text DEFAULT 'online'::text NOT NULL,
    anomaly_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'issued'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT engagement_qr_sessions_status_check CHECK ((status = ANY (ARRAY['issued'::text, 'confirmed'::text, 'expired'::text, 'revoked'::text, 'ineligible'::text, 'correction'::text])))
);


--
-- Name: engagement_recognitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_recognitions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    recognition_type text NOT NULL,
    recipient_id uuid,
    recipient_name text NOT NULL,
    basis text NOT NULL,
    activity_credit_id text,
    nominated_by_id uuid,
    nominated_by text,
    approver_id uuid,
    date date DEFAULT CURRENT_DATE NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    consent_confirmed boolean DEFAULT false NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    record_version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    CONSTRAINT engagement_recognitions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'review'::text, 'approved'::text, 'issued'::text, 'declined'::text, 'withdrawn'::text, 'archived'::text]))),
    CONSTRAINT engagement_recognitions_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'team'::text, 'organisation'::text])))
);


--
-- Name: engagement_report_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_report_definitions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    dataset text NOT NULL,
    scope text DEFAULT 'Company'::text NOT NULL,
    privacy_level text DEFAULT 'role_controlled'::text NOT NULL,
    definition jsonb DEFAULT '{}'::jsonb NOT NULL,
    distribution jsonb DEFAULT '{}'::jsonb NOT NULL,
    effective_from date,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    published_by uuid,
    published_at timestamp with time zone,
    record_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT engagement_report_definitions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'published'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: engagement_review_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_review_templates (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    scope text DEFAULT 'Company'::text NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    questions jsonb DEFAULT '[]'::jsonb NOT NULL,
    employee_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    action_triggers jsonb DEFAULT '{}'::jsonb NOT NULL,
    submission_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    approval_flow jsonb DEFAULT '{}'::jsonb NOT NULL,
    communications jsonb DEFAULT '{}'::jsonb NOT NULL,
    effective_from date,
    effective_to date,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    change_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    published_by uuid,
    published_at timestamp with time zone,
    record_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT engagement_review_templates_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'published'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: engagement_seed_reconciliation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_seed_reconciliation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    entity_code text,
    classification text DEFAULT 'pending'::text NOT NULL,
    reason text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT engagement_seed_reconciliation_classification_check CHECK ((classification = ANY (ARRAY['pending'::text, 'retain'::text, 'archive'::text, 'delete_unused_draft'::text])))
);


--
-- Name: engagement_team_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_team_reviews (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    review_code text,
    period text NOT NULL,
    team_id text,
    team_name text NOT NULL,
    template_id text NOT NULL,
    owner_id uuid,
    owner_name text,
    review_date date DEFAULT CURRENT_DATE NOT NULL,
    meeting_date date,
    participants jsonb DEFAULT '[]'::jsonb NOT NULL,
    scope_note text,
    readiness jsonb DEFAULT '{}'::jsonb NOT NULL,
    assessments jsonb DEFAULT '{}'::jsonb NOT NULL,
    conclusions jsonb DEFAULT '{}'::jsonb NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    return_comments text,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    idempotency_key uuid DEFAULT gen_random_uuid() NOT NULL,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    locked_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    record_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT engagement_team_reviews_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'returned'::text, 'approved'::text, 'locked'::text, 'reopened'::text, 'archived'::text])))
);


--
-- Name: environmental_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environmental_inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    inspection_date date NOT NULL,
    inspector text,
    area text,
    inspection_type text DEFAULT 'routine'::text,
    checklist_results jsonb DEFAULT '[]'::jsonb,
    findings text,
    non_conformances integer DEFAULT 0,
    overall_rating text DEFAULT 'satisfactory'::text,
    corrective_actions text,
    next_inspection_date date,
    signed_off boolean DEFAULT false,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT environmental_inspections_inspection_type_check CHECK ((inspection_type = ANY (ARRAY['routine'::text, 'regulatory'::text, 'audit'::text, 'follow_up'::text]))),
    CONSTRAINT environmental_inspections_overall_rating_check CHECK ((overall_rating = ANY (ARRAY['excellent'::text, 'good'::text, 'satisfactory'::text, 'poor'::text, 'unacceptable'::text])))
);


--
-- Name: equipment_assurance_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_assurance_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    equipment_id uuid NOT NULL,
    criticality text DEFAULT 'standard'::text NOT NULL,
    ownership_type text DEFAULT 'company'::text NOT NULL,
    owner_custodian text,
    intended_use text,
    permitted_environment text,
    capacity_rating text,
    configuration text,
    limitations text,
    assurance_requirements text,
    acceptance_status text DEFAULT 'pending'::text NOT NULL,
    acceptance_authority text,
    acceptance_date date,
    review_due date,
    critical_block boolean DEFAULT false NOT NULL,
    block_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT equipment_assurance_profiles_acceptance_status_check CHECK ((acceptance_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'conditional'::text, 'rejected'::text, 'suspended'::text]))),
    CONSTRAINT equipment_assurance_profiles_criticality_check CHECK ((criticality = ANY (ARRAY['standard'::text, 'elevated'::text, 'safety_critical'::text, 'statutory'::text]))),
    CONSTRAINT equipment_assurance_profiles_ownership_type_check CHECK ((ownership_type = ANY (ARRAY['company'::text, 'contractor'::text, 'hired'::text, 'leased'::text])))
);


--
-- Name: equipment_assurance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_assurance_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    equipment_id uuid NOT NULL,
    record_type text NOT NULL,
    reference text NOT NULL,
    provider text,
    method_standard text,
    scope_range text,
    tolerance text,
    result text DEFAULT 'pending'::text NOT NULL,
    performed_date date,
    expiry_date date,
    next_due_date date,
    restrictions text,
    as_found text,
    as_left text,
    out_of_tolerance boolean DEFAULT false NOT NULL,
    impact_review text,
    evidence_reference text,
    validation_status text DEFAULT 'submitted'::text NOT NULL,
    validated_by text,
    validated_at timestamp with time zone,
    release_status text DEFAULT 'not_requested'::text NOT NULL,
    release_authority text,
    release_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT equipment_assurance_records_record_type_check CHECK ((record_type = ANY (ARRAY['acceptance'::text, 'certificate'::text, 'calibration'::text, 'periodic_inspection'::text, 'service'::text, 'return_to_service'::text, 'recall_check'::text]))),
    CONSTRAINT equipment_assurance_records_release_status_check CHECK ((release_status = ANY (ARRAY['not_requested'::text, 'pending'::text, 'released'::text, 'rejected'::text]))),
    CONSTRAINT equipment_assurance_records_result_check CHECK ((result = ANY (ARRAY['pending'::text, 'pass'::text, 'conditional'::text, 'fail'::text, 'not_applicable'::text]))),
    CONSTRAINT equipment_assurance_records_validation_status_check CHECK ((validation_status = ANY (ARRAY['submitted'::text, 'review'::text, 'validated'::text, 'rejected'::text, 'superseded'::text])))
);


--
-- Name: equipment_defects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_defects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    equipment_id uuid NOT NULL,
    reference text NOT NULL,
    source text DEFAULT 'reported'::text NOT NULL,
    severity text DEFAULT 'major'::text NOT NULL,
    description text NOT NULL,
    reported_by text,
    reported_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    quarantine_location text,
    tag_reference text,
    disposition text,
    corrective_action_reference text,
    evidence_reference text,
    verification_result text,
    verified_by text,
    verified_at timestamp with time zone,
    release_required boolean DEFAULT true NOT NULL,
    release_authority text,
    release_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT equipment_defects_severity_check CHECK ((severity = ANY (ARRAY['minor'::text, 'major'::text, 'critical'::text]))),
    CONSTRAINT equipment_defects_status_check CHECK ((status = ANY (ARRAY['open'::text, 'quarantined'::text, 'under_repair'::text, 'awaiting_verification'::text, 'closed'::text, 'disposed'::text])))
);


--
-- Name: equipment_maintenance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_maintenance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    equipment_id uuid NOT NULL,
    reference text NOT NULL,
    maintenance_type text DEFAULT 'corrective'::text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    problem_description text NOT NULL,
    work_performed text,
    parts_used text,
    technician text,
    requested_date date DEFAULT CURRENT_DATE NOT NULL,
    planned_date date,
    completed_date date,
    post_work_test_reference text,
    release_required boolean DEFAULT true NOT NULL,
    release_status text DEFAULT 'pending'::text NOT NULL,
    release_authority text,
    release_date date,
    evidence_reference text,
    cost numeric(14,2),
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT equipment_maintenance_events_maintenance_type_check CHECK ((maintenance_type = ANY (ARRAY['preventive'::text, 'corrective'::text, 'breakdown'::text, 'recall'::text, 'modification'::text]))),
    CONSTRAINT equipment_maintenance_events_release_status_check CHECK ((release_status = ANY (ARRAY['pending'::text, 'released'::text, 'rejected'::text, 'not_required'::text]))),
    CONSTRAINT equipment_maintenance_events_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'planned'::text, 'in_progress'::text, 'testing'::text, 'awaiting_release'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: equipment_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    equipment_id uuid NOT NULL,
    movement_type text NOT NULL,
    linked_movement_id uuid,
    holder_name text,
    holder_reference text,
    custody_type text,
    task_reference text,
    work_package_reference text,
    site_name text,
    location_from text,
    location_to text,
    issued_at timestamp with time zone,
    expected_return_at timestamp with time zone,
    returned_at timestamp with time zone,
    condition_out text,
    condition_in text,
    eligibility_verified boolean DEFAULT false NOT NULL,
    eligibility_evidence_reference text,
    status text DEFAULT 'open'::text NOT NULL,
    defect_noted boolean DEFAULT false NOT NULL,
    evidence_reference text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT equipment_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['issue'::text, 'return'::text, 'reservation'::text, 'transfer'::text, 'possession_check'::text]))),
    CONSTRAINT equipment_movements_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'open'::text, 'returned'::text, 'cancelled'::text, 'overdue'::text])))
);


--
-- Name: ert_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ert_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_id uuid,
    name text NOT NULL,
    job_title text,
    department text,
    phone_primary text,
    phone_secondary text,
    email text,
    ert_role text NOT NULL,
    ert_team text,
    coverage_area text,
    first_aid_certified boolean DEFAULT false,
    first_aid_expiry date,
    fire_warden_certified boolean DEFAULT false,
    fire_warden_expiry date,
    ert_trained boolean DEFAULT false,
    ert_trained_date date,
    status text DEFAULT 'active'::text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ert_members_ert_role_check CHECK ((ert_role = ANY (ARRAY['chief_warden'::text, 'area_warden'::text, 'first_aider'::text, 'fire_marshal'::text, 'ert_leader'::text, 'ert_member'::text, 'site_manager'::text, 'external_coordinator'::text]))),
    CONSTRAINT ert_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'on_leave'::text, 'inactive'::text])))
);


--
-- Name: esg_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.esg_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    year integer NOT NULL,
    category text NOT NULL,
    metric text NOT NULL,
    baseline_value numeric,
    target_value numeric,
    target_unit text,
    target_reduction_pct numeric,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT esg_targets_category_check CHECK ((category = ANY (ARRAY['waste'::text, 'energy'::text, 'water'::text, 'carbon'::text, 'other'::text])))
);


--
-- Name: event_sequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_sequence (
    company_id uuid NOT NULL,
    year integer NOT NULL,
    last_seq integer DEFAULT 0
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    event_type text NOT NULL,
    severity text,
    event_date timestamp with time zone,
    location text,
    description text,
    immediate_action text,
    reported_by text,
    assigned_to text,
    action_due_date date,
    status text DEFAULT 'open'::text,
    created_at timestamp with time zone DEFAULT now(),
    event_ref text,
    person_id uuid,
    reported_by_id uuid,
    assigned_to_id uuid,
    investigation_id uuid,
    department text,
    closed_date date,
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    person_involved text,
    incident_subtype text,
    incident_number text,
    injury_type text,
    body_part text,
    treatment text,
    lost_time_days integer DEFAULT 0,
    restricted_work_days integer DEFAULT 0,
    vehicle_reg text,
    damage_estimate numeric,
    property_owner text,
    environmental_media text[],
    quantity_released text,
    regulator_notified boolean DEFAULT false,
    regulator_ref text,
    notification_deadline date,
    investigation_required boolean DEFAULT false,
    investigation_ref text,
    lat numeric,
    lng numeric,
    gps_address text,
    site_id uuid,
    assigned_to_name text,
    reported_by_name text,
    due_date date,
    event_time text,
    event_datetime timestamp with time zone,
    title text,
    witnesses text,
    injured_person text,
    root_cause text,
    corrective_action text,
    estimated_time boolean DEFAULT false NOT NULL,
    potential_severity text,
    likelihood text,
    confidentiality text DEFAULT 'internal'::text NOT NULL,
    emergency_gate text,
    immediate_danger boolean DEFAULT false NOT NULL,
    reporter_mode text DEFAULT 'named'::text NOT NULL,
    work_activity text,
    regulatory_required text,
    triage_status text,
    investigation_level text,
    target_closure_date date,
    idempotency_key text,
    submitted_at timestamp with time zone,
    lifecycle_version integer DEFAULT 1 NOT NULL,
    area_id uuid,
    site_name_snapshot text,
    area_name_snapshot text,
    CONSTRAINT events_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'in_progress'::text, 'under_investigation'::text, 'action_required'::text, 'resolved'::text])))
);


--
-- Name: exp_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exp_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exposure_monitoring; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exposure_monitoring (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    monitoring_ref text,
    monitoring_type text NOT NULL,
    monitoring_date date NOT NULL,
    location text NOT NULL,
    department text,
    job_role text,
    agent text,
    measurement_value numeric,
    measurement_unit text,
    exposure_duration_hrs numeric,
    twa_8hr numeric,
    stel numeric,
    oel_twa numeric,
    oel_stel numeric,
    oel_source text,
    exceedance_pct numeric,
    risk_level text DEFAULT 'low'::text,
    exceeded_oel boolean DEFAULT false,
    monitoring_method text,
    instrument_used text,
    calibration_ref text,
    sampler_name text,
    existing_controls text,
    controls_adequate boolean DEFAULT true,
    additional_controls_required text,
    noise_peak_dbc numeric,
    noise_lex8h numeric,
    wbgt_value numeric,
    vibration_ahv numeric,
    vibration_exposure_points integer,
    recommended_actions text,
    reassessment_date date,
    status text DEFAULT 'open'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT exposure_monitoring_monitoring_type_check CHECK ((monitoring_type = ANY (ARRAY['noise'::text, 'dust'::text, 'silica'::text, 'chemical'::text, 'heat_stress'::text, 'vibration'::text, 'biological'::text, 'radiation'::text, 'other'::text]))),
    CONSTRAINT exposure_monitoring_risk_level_check CHECK ((risk_level = ANY (ARRAY['negligible'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT exposure_monitoring_status_check CHECK ((status = ANY (ARRAY['open'::text, 'actions_taken'::text, 'closed'::text, 'requires_reassessment'::text])))
);


--
-- Name: fire_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fire_certificates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    cert_number text,
    cert_type text DEFAULT 'fire_certificate'::text NOT NULL,
    premises_name text NOT NULL,
    address text,
    floor_area numeric,
    occupancy_type text,
    max_occupancy integer,
    issuing_authority text DEFAULT 'Mauritius Fire & Rescue Service'::text,
    issue_date date,
    expiry_date date,
    status text DEFAULT 'valid'::text,
    conditions text,
    document_url text,
    renewal_submitted boolean DEFAULT false,
    renewal_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: fire_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fire_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    certificate_id uuid,
    equipment_type text NOT NULL,
    description text,
    location text NOT NULL,
    make_model text,
    serial_number text,
    capacity text,
    last_service_date date,
    next_service_date date,
    status text DEFAULT 'operational'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: fire_inspection_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fire_inspection_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    category text,
    finding text NOT NULL,
    severity text DEFAULT 'minor'::text,
    action_required text,
    responsible_person text,
    due_date date,
    status text DEFAULT 'open'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: fire_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fire_inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    certificate_id uuid,
    inspection_date date NOT NULL,
    inspector_name text,
    inspector_authority text,
    inspection_type text DEFAULT 'routine'::text,
    overall_result text DEFAULT 'satisfactory'::text,
    findings text,
    recommendations text,
    follow_up_date date,
    status text DEFAULT 'open'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: fire_layout_symbols; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fire_layout_symbols (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    item_type text NOT NULL,
    label text NOT NULL,
    symbol text DEFAULT 'EQ'::text NOT NULL,
    image_data text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fire_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fire_layouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    layout_type text DEFAULT 'fire'::text NOT NULL,
    title text DEFAULT 'Fire equipment layout'::text NOT NULL,
    image_url text,
    image_path text,
    markers jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fuel_consumption; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fuel_consumption (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    record_date date NOT NULL,
    fuel_type text DEFAULT 'diesel'::text,
    quantity numeric NOT NULL,
    unit text DEFAULT 'litres'::text,
    vehicle_equipment text,
    meter_reading_start numeric,
    meter_reading_end numeric,
    purpose text,
    department text,
    cost numeric,
    currency text DEFAULT 'MUR'::text,
    carbon_kg numeric,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT fuel_consumption_fuel_type_check CHECK ((fuel_type = ANY (ARRAY['diesel'::text, 'petrol'::text, 'lpg'::text, 'natural_gas'::text, 'electricity'::text, 'heavy_fuel_oil'::text, 'other'::text]))),
    CONSTRAINT fuel_consumption_unit_check CHECK ((unit = ANY (ARRAY['litres'::text, 'kg'::text, 'm3'::text, 'kwh'::text])))
);


--
-- Name: hazard_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hazard_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    category text NOT NULL,
    hazard_type text NOT NULL,
    hazard_description text NOT NULL,
    potential_harm text,
    default_severity integer,
    default_probability integer,
    applicable_activities text[],
    tags text[],
    is_global boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT hazard_library_default_probability_check CHECK (((default_probability >= 1) AND (default_probability <= 5))),
    CONSTRAINT hazard_library_default_severity_check CHECK (((default_severity >= 1) AND (default_severity <= 5)))
);


--
-- Name: hazardous_waste; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hazardous_waste (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    waste_name text NOT NULL,
    un_number text,
    hazard_class text,
    quantity numeric,
    unit text DEFAULT 'kg'::text,
    storage_location text,
    container_type text,
    generation_date date,
    collection_date date,
    disposal_date date,
    licensed_contractor text,
    contractor_license_number text,
    manifest_number text,
    disposal_method text,
    status text DEFAULT 'stored'::text,
    sds_available boolean DEFAULT false,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT hazardous_waste_status_check CHECK ((status = ANY (ARRAY['stored'::text, 'awaiting_collection'::text, 'in_transit'::text, 'disposed'::text, 'spilled'::text])))
);


--
-- Name: hse_meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hse_meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    title text NOT NULL,
    meeting_type text,
    meeting_date timestamp with time zone,
    location text,
    chaired_by text,
    attendees text,
    agenda text,
    minutes text,
    next_meeting_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    agenda_items jsonb DEFAULT '[]'::jsonb,
    recommendations jsonb DEFAULT '[]'::jsonb,
    apologies text,
    series_id uuid,
    updated_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'draft'::text,
    chair_person_id uuid,
    attendee_person_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    CONSTRAINT hse_meetings_meeting_type_check CHECK ((meeting_type = ANY (ARRAY['toolbox_talk'::text, 'safety_committee'::text, 'management_review'::text, 'emergency_drill'::text, 'other'::text])))
);


--
-- Name: incident_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    event_id uuid,
    investigation_id uuid,
    evidence_type text DEFAULT 'photo'::text,
    title text,
    description text,
    file_url text,
    file_name text,
    file_size text,
    witness_name text,
    witness_statement text,
    witness_contact text,
    location_description text,
    lat numeric,
    lng numeric,
    collected_by text,
    collected_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT incident_evidence_evidence_type_check CHECK ((evidence_type = ANY (ARRAY['photo'::text, 'video'::text, 'document'::text, 'witness_statement'::text, 'voice_note'::text, 'sketch'::text, 'measurement'::text, 'other'::text])))
);


--
-- Name: incident_mgmt_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_mgmt_audit_events (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    reason text,
    source text DEFAULT 'web'::text NOT NULL,
    correlation_id text,
    performed_by uuid,
    performed_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: incident_mgmt_config_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_mgmt_config_records (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    workspace text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    scope_type text DEFAULT 'company'::text NOT NULL,
    scope_id text,
    inherited_from_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    test_cases jsonb DEFAULT '[]'::jsonb NOT NULL,
    impact_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    owner_id uuid,
    owner_name text,
    effective_from date,
    effective_to date,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    copied_from_id text,
    change_reason text,
    tested_by uuid,
    tested_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    published_by uuid,
    published_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: incident_mgmt_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_mgmt_records (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    incident_id text,
    investigation_id text,
    record_type text NOT NULL,
    code text,
    title text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    confidentiality text DEFAULT 'internal'::text NOT NULL,
    owner_id uuid,
    owner_name text,
    due_date date,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    parent_id text,
    change_reason text,
    effective_from date,
    effective_to date,
    submitted_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    published_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: induction_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.induction_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    induction_ref text,
    induction_type text DEFAULT 'new_employee'::text,
    person_name text NOT NULL,
    employee_id text,
    department text,
    job_title text,
    start_date date,
    induction_date date,
    inducted_by text,
    duration_hours numeric DEFAULT 1,
    topics_covered jsonb DEFAULT '[]'::jsonb,
    completed boolean DEFAULT false,
    signature_obtained boolean DEFAULT false,
    score numeric,
    passed boolean DEFAULT true,
    certificate_issued boolean DEFAULT false,
    refresher_due_date date,
    notes text,
    status text DEFAULT 'pending'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    person_id uuid,
    inducted_by_person_id uuid,
    person_name_snapshot text,
    organization_snapshot text,
    role_snapshot text,
    CONSTRAINT induction_records_induction_type_check CHECK ((induction_type = ANY (ARRAY['new_employee'::text, 'contractor'::text, 'visitor'::text, 'refresher'::text, 'site_specific'::text]))),
    CONSTRAINT induction_records_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: inspection_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid,
    seq_no integer,
    observation text,
    recommendation text,
    responsible text,
    due_date date,
    status text DEFAULT 'open'::text,
    CONSTRAINT inspection_actions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'closed'::text])))
);


--
-- Name: inspection_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid,
    category text,
    item_name text,
    result text,
    observation text,
    CONSTRAINT inspection_items_result_check CHECK ((result = ANY (ARRAY['good'::text, 'insufficient'::text, 'na'::text])))
);


--
-- Name: inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    site text,
    inspection_date date,
    performed_by text,
    employees_present text,
    score_good integer DEFAULT 0,
    score_insuf integer DEFAULT 0,
    positive_obs text,
    negative_obs text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reviewed_by text,
    reviewed_date date,
    inspection_type text DEFAULT 'workplace'::text,
    audit_standard text,
    audit_scope text,
    auditor_name text,
    lead_auditor text,
    audit_team text,
    auditee text,
    reference_no text,
    planned_date date,
    actual_date date,
    department text,
    priority text DEFAULT 'medium'::text,
    status text DEFAULT 'open'::text,
    photos jsonb DEFAULT '[]'::jsonb,
    voice_notes jsonb DEFAULT '[]'::jsonb,
    offline_created boolean DEFAULT false,
    synced_at timestamp with time zone,
    site_id uuid,
    if_site text,
    if_date date,
    inspector text,
    by text,
    if_by text,
    if_pos text,
    if_neg text,
    items jsonb,
    action_items jsonb,
    sign_inspector text,
    sign_date date,
    sign_reviewer text,
    sign_reviewer_date date,
    gps_address text,
    lat double precision,
    lng double precision,
    area_id uuid,
    site_name_snapshot text,
    area_name_snapshot text,
    CONSTRAINT inspections_inspection_type_check CHECK ((inspection_type = ANY (ARRAY['workplace'::text, 'behavioral'::text, 'equipment'::text, 'ppe'::text, 'fire'::text, 'environmental'::text, 'iso_audit'::text, 'internal_audit'::text, 'supplier_audit'::text, 'contractor_audit'::text, 'regulatory'::text, 'prestart'::text, 'custom'::text])))
);


--
-- Name: integration_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_sync_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    integration_id uuid,
    sync_type text,
    status text DEFAULT 'success'::text,
    records_synced integer DEFAULT 0,
    errors jsonb DEFAULT '[]'::jsonb,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    triggered_by uuid,
    notes text
);


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    integration_key text NOT NULL,
    integration_type text NOT NULL,
    display_name text NOT NULL,
    status text DEFAULT 'disconnected'::text,
    config jsonb DEFAULT '{}'::jsonb,
    last_sync timestamp with time zone,
    last_sync_status text,
    last_sync_count integer DEFAULT 0,
    sync_frequency text DEFAULT 'manual'::text,
    webhook_url text,
    api_endpoint text,
    enabled boolean DEFAULT false,
    notes text,
    connected_by uuid,
    connected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT integrations_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'disconnected'::text, 'error'::text, 'pending'::text, 'testing'::text])))
);


--
-- Name: inv_sequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inv_sequence (
    company_id uuid NOT NULL,
    year integer NOT NULL,
    last_seq integer DEFAULT 0
);


--
-- Name: investigations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investigations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    event_id uuid,
    title text,
    incident_date timestamp with time zone,
    location text,
    investigated_by text,
    persons_involved text,
    what_happened text,
    immediate_causes text,
    human_factors text,
    technical_conditions text,
    root_causes text,
    corrective_actions text,
    preventive_actions text,
    lessons_learned text,
    plant_manager_review text,
    status text DEFAULT 'open'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    class_hs boolean DEFAULT false,
    class_env boolean DEFAULT false,
    class_site boolean DEFAULT false,
    inv_ref text,
    inv_type text DEFAULT 'basic'::text,
    reported_by text,
    date_completion date,
    incident_time text,
    incident_location text,
    nature_hs text,
    nature_env text,
    nature_site text,
    consequences_hs text,
    consequences_env text,
    consequences_site text,
    person_name text,
    person_function text,
    person_start_date text,
    contract_type text,
    witnesses text,
    task_frequency text,
    work_type text,
    recurring_event boolean DEFAULT false,
    recurring_details text,
    first_aid_given boolean DEFAULT false,
    first_aid_details text,
    immediate_actions text,
    ws1_corrective_actions jsonb DEFAULT '[]'::jsonb,
    further_analyses boolean DEFAULT false,
    department text,
    reported_by_title text,
    ws2_interviewer text,
    ws2_interviewer_title text,
    ws2_interviewee text,
    ws2_interviewee_title text,
    ws2_date date,
    ws2_questions jsonb DEFAULT '[]'::jsonb,
    ws2_procedures jsonb DEFAULT '[]'::jsonb,
    ws2_management jsonb DEFAULT '[]'::jsonb,
    ws2_skills jsonb DEFAULT '[]'::jsonb,
    ws2_attitude jsonb DEFAULT '[]'::jsonb,
    ws2_care jsonb DEFAULT '[]'::jsonb,
    ws2_personal jsonb DEFAULT '[]'::jsonb,
    ws2_root_causes jsonb DEFAULT '[]'::jsonb,
    ws3_completed_by text,
    ws3_completed_title text,
    ws3_participants text,
    ws3_date date,
    ws3_machines boolean DEFAULT false,
    ws3_machines_explain text,
    ws3_materials boolean DEFAULT false,
    ws3_materials_explain text,
    ws3_environment boolean DEFAULT false,
    ws3_environment_explain text,
    ws3_five_why jsonb DEFAULT '[]'::jsonb,
    reviewed_by text,
    approved_by text,
    investigated_date date,
    reviewed_date date,
    approved_date date,
    incident_description text,
    updated_at timestamp with time zone DEFAULT now(),
    person_involved text,
    investigation_ref text,
    investigation_method text DEFAULT '5why'::text,
    investigation_lead text,
    team_members text,
    start_date date,
    target_completion date,
    five_whys jsonb DEFAULT '[]'::jsonb,
    fishbone_causes jsonb DEFAULT '{}'::jsonb,
    timeline_events jsonb DEFAULT '[]'::jsonb,
    icam_absence_controls jsonb DEFAULT '[]'::jsonb,
    icam_individual_factors jsonb DEFAULT '[]'::jsonb,
    icam_task_conditions jsonb DEFAULT '[]'::jsonb,
    icam_org_factors jsonb DEFAULT '[]'::jsonb,
    taproot_root_causes jsonb DEFAULT '[]'::jsonb,
    contributing_factors text,
    systemic_causes text,
    severity_actual text,
    severity_potential text,
    likelihood_recurrence text,
    effectiveness_review_date date,
    effectiveness_rating text,
    closed_date date,
    closed_by text,
    description text,
    investigation_type text,
    linked_event_ref text,
    ws1_contract_type text,
    interviewer text,
    interviewee text,
    interview_date date,
    recurrence_likelihood text,
    sign_investigator text,
    sign_inv_date date,
    sign_reviewer text,
    sign_rev_date date,
    sign_approver text,
    sign_app_date date,
    plan_status text DEFAULT 'draft'::text NOT NULL,
    plan_version integer DEFAULT 1 NOT NULL,
    objective text,
    scope text,
    exclusions text,
    reviewer_name text,
    confidentiality text DEFAULT 'internal'::text NOT NULL,
    completeness_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    closure_snapshot jsonb,
    CONSTRAINT investigations_inv_type_check CHECK ((inv_type = ANY (ARRAY['basic'::text, 'full'::text]))),
    CONSTRAINT investigations_investigation_method_check CHECK ((investigation_method = ANY (ARRAY['5why'::text, 'fishbone'::text, 'icam'::text, 'taproot'::text, 'timeline'::text, 'combined'::text]))),
    CONSTRAINT investigations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'closed'::text])))
);


--
-- Name: jsa_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jsa_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    ra_id uuid,
    jsa_ref text,
    title text NOT NULL,
    job_description text,
    location text,
    work_order_ref text,
    date date,
    prepared_by text,
    reviewed_by text,
    approved_by text,
    status text DEFAULT 'draft'::text,
    steps jsonb DEFAULT '[]'::jsonb,
    revision integer DEFAULT 1,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT jsa_records_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'superseded'::text])))
);


--
-- Name: jsa_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jsa_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kpi_config_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_config_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    config_version_id uuid,
    event_type text NOT NULL,
    section_key text,
    before_json jsonb,
    after_json jsonb,
    reason text,
    actor_id uuid,
    actor_name text,
    correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kpi_indicators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_indicators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kpi_id uuid,
    company_id uuid,
    name text NOT NULL,
    target_value numeric,
    target_operator text DEFAULT 'gte'::text,
    unit text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    ytd_method text DEFAULT 'sum'::text,
    CONSTRAINT kpi_indicators_target_operator_check CHECK ((target_operator = ANY (ARRAY['eq'::text, 'gte'::text, 'lte'::text, 'gt'::text, 'lt'::text]))),
    CONSTRAINT kpi_indicators_ytd_method_check CHECK ((ytd_method = ANY (ARRAY['sum'::text, 'average'::text, 'last'::text, 'max'::text, 'min'::text])))
);


--
-- Name: kpi_monthly_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_monthly_data (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kpi_id uuid,
    company_id uuid,
    year integer NOT NULL,
    month integer NOT NULL,
    actual numeric,
    ytd numeric,
    comment text,
    entered_by uuid,
    entered_at timestamp with time zone DEFAULT now(),
    indicator_id uuid,
    CONSTRAINT kpi_monthly_data_month_check CHECK (((month >= 1) AND (month <= 12)))
);


--
-- Name: kpis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpis (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    name text NOT NULL,
    metric text,
    target_value numeric,
    current_value numeric DEFAULT 0,
    responsible text,
    due_date date,
    status text DEFAULT 'on_track'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT kpis_status_check CHECK ((status = ANY (ARRAY['on_track'::text, 'at_risk'::text, 'off_track'::text, 'completed'::text])))
);


--
-- Name: kpis_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpis_v2 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    objective_id uuid,
    code text,
    name text NOT NULL,
    indicator text,
    target_value numeric,
    target_type text,
    target_operator text DEFAULT 'gte'::text,
    unit text,
    frequency text DEFAULT 'monthly'::text,
    responsible text,
    status text DEFAULT 'not_started'::text,
    year integer DEFAULT (EXTRACT(year FROM now()))::integer,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT kpis_v2_frequency_check CHECK ((frequency = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'annual'::text]))),
    CONSTRAINT kpis_v2_status_check CHECK ((status = ANY (ARRAY['on_track'::text, 'at_risk'::text, 'off_track'::text, 'not_started'::text]))),
    CONSTRAINT kpis_v2_target_operator_check CHECK ((target_operator = ANY (ARRAY['eq'::text, 'gte'::text, 'lte'::text, 'gt'::text, 'lt'::text]))),
    CONSTRAINT kpis_v2_target_type_check CHECK ((target_type = ANY (ARRAY['number'::text, 'percentage'::text, 'yes_no'::text, 'count'::text])))
);


--
-- Name: learning_course_governance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_course_governance (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    course_id text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    lifecycle_status text DEFAULT 'draft'::text NOT NULL,
    owner_name text,
    risk_class text DEFAULT 'standard'::text NOT NULL,
    audience_summary text,
    language_codes text[] DEFAULT ARRAY['en'::text] NOT NULL,
    source_module text,
    source_record_id text,
    source_reference text,
    source_revision text,
    source_status text,
    learning_objectives text,
    accessibility_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    sme_review_status text DEFAULT 'pending'::text NOT NULL,
    hse_review_status text DEFAULT 'pending'::text NOT NULL,
    accessibility_review_status text DEFAULT 'pending'::text NOT NULL,
    material_change_class text,
    effective_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_course_governance_accessibility_review_status_check CHECK ((accessibility_review_status = ANY (ARRAY['pending'::text, 'approved'::text, 'changes_requested'::text]))),
    CONSTRAINT learning_course_governance_hse_review_status_check CHECK ((hse_review_status = ANY (ARRAY['pending'::text, 'approved'::text, 'changes_requested'::text, 'not_required'::text]))),
    CONSTRAINT learning_course_governance_lifecycle_status_check CHECK ((lifecycle_status = ANY (ARRAY['draft'::text, 'sme_review'::text, 'hse_accessibility_review'::text, 'awaiting_approval'::text, 'published'::text, 'under_revision'::text, 'archived'::text]))),
    CONSTRAINT learning_course_governance_material_change_class_check CHECK (((material_change_class IS NULL) OR (material_change_class = ANY (ARRAY['editorial'::text, 'acknowledgement'::text, 'microlearning'::text, 'full_reassessment'::text, 'practical_reassessment'::text, 'immediate_suspension'::text])))),
    CONSTRAINT learning_course_governance_risk_class_check CHECK ((risk_class = ANY (ARRAY['standard'::text, 'elevated'::text, 'safety_critical'::text]))),
    CONSTRAINT learning_course_governance_sme_review_status_check CHECK ((sme_review_status = ANY (ARRAY['pending'::text, 'approved'::text, 'changes_requested'::text, 'not_required'::text])))
);


--
-- Name: learning_external_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_external_providers (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    provider_name text NOT NULL,
    contact_name text,
    contact_email text,
    contact_phone text,
    accreditation_scope text,
    accreditation_reference text,
    accreditation_expiry date,
    approved_status text DEFAULT 'pending'::text NOT NULL,
    evaluation_notes text,
    evidence_reference text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_external_providers_approved_status_check CHECK ((approved_status = ANY (ARRAY['pending'::text, 'approved'::text, 'conditional'::text, 'suspended'::text, 'expired'::text, 'archived'::text])))
);


--
-- Name: learning_practical_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_practical_assessments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    reference text NOT NULL,
    candidate_id uuid,
    candidate_name text NOT NULL,
    course_id text,
    course_title text,
    competency_id text,
    competency_name text NOT NULL,
    scope_text text,
    assessor_id uuid,
    assessor_name text NOT NULL,
    assessor_scope_confirmed boolean DEFAULT false NOT NULL,
    scheduled_at timestamp with time zone,
    assessed_at timestamp with time zone,
    status text DEFAULT 'scheduled'::text NOT NULL,
    result text DEFAULT 'pending'::text NOT NULL,
    criteria jsonb DEFAULT '[]'::jsonb NOT NULL,
    critical_failure boolean DEFAULT false NOT NULL,
    evidence_reference text,
    assessor_comments text,
    candidate_acknowledged boolean DEFAULT false NOT NULL,
    verifier_id uuid,
    verifier_name text,
    verification_status text DEFAULT 'not_required'::text NOT NULL,
    verified_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_practical_assessments_result_check CHECK ((result = ANY (ARRAY['pending'::text, 'competent'::text, 'not_yet_competent'::text, 'stopped_critical_fail'::text]))),
    CONSTRAINT learning_practical_assessments_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'submitted'::text, 'awaiting_verification'::text, 'final'::text, 'cancelled'::text]))),
    CONSTRAINT learning_practical_assessments_verification_status_check CHECK ((verification_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'confirmed'::text, 'returned'::text])))
);


--
-- Name: learning_source_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_source_relationships (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    course_id text NOT NULL,
    course_version integer DEFAULT 1 NOT NULL,
    related_module text NOT NULL,
    related_record_id text NOT NULL,
    related_revision text,
    relationship_type text DEFAULT 'learning_source'::text NOT NULL,
    impact_status text DEFAULT 'current'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    related_table text,
    source_current_revision text,
    impact_note text,
    impact_detected_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    CONSTRAINT learning_source_relationships_impact_status_check CHECK ((impact_status = ANY (ARRAY['current'::text, 'review_required'::text, 'affected'::text, 'superseded'::text])))
);


--
-- Name: legal_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    date_received date,
    source text,
    source_material text,
    jurisdiction text DEFAULT 'Mauritius'::text,
    legislation text,
    category text DEFAULT 'health_safety'::text,
    changes_identified text,
    changes text,
    applicable boolean DEFAULT true,
    action_required text,
    action text,
    responsible_person text,
    effective_date date,
    implemented boolean DEFAULT false,
    comments text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: legal_compliance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_compliance_records (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    requirement_id text,
    record_type text NOT NULL,
    reference text,
    title text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    owner_id uuid,
    owner_name text,
    assignee_id uuid,
    assignee_name text,
    due_date date,
    expiry_date date,
    completed_at timestamp with time zone,
    source_module text,
    source_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    idempotency_key text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT legal_compliance_records_record_type_check CHECK ((record_type = ANY (ARRAY['requirement_profile'::text, 'obligation'::text, 'applicability'::text, 'evidence'::text, 'permit_licence'::text, 'workflow_task'::text])))
);


--
-- Name: legal_compliance_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_compliance_relationships (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    requirement_id text,
    record_id text,
    related_module text NOT NULL,
    related_record_id text NOT NULL,
    relationship_type text DEFAULT 'supports'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: legal_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    no_order integer,
    legislation_main text,
    legislation_title text,
    section text,
    sub_section text,
    requirement text NOT NULL,
    applicable boolean DEFAULT true,
    controls_in_place text,
    gap_identified boolean DEFAULT false,
    gap_notes text,
    further_controls text,
    responsibility text,
    target_date date,
    compliance_status text DEFAULT 'partial'::text,
    last_reviewed date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT legal_register_compliance_status_check CHECK ((compliance_status = ANY (ARRAY['compliant'::text, 'partial'::text, 'non_compliant'::text, 'not_applicable'::text])))
);


--
-- Name: legal_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    req_ref text,
    legislation text NOT NULL,
    title text,
    section text,
    subsection text,
    sub_section text,
    requirement text,
    legislation_type text DEFAULT 'statutory'::text,
    category text DEFAULT 'health_safety'::text,
    jurisdiction text DEFAULT 'Mauritius'::text,
    authority text,
    obligation_type text DEFAULT 'mandatory'::text,
    frequency text DEFAULT 'ongoing'::text,
    applicable boolean DEFAULT true,
    status text DEFAULT 'non_compliant'::text,
    compliance_status text DEFAULT 'non_compliant'::text,
    compliance_score integer DEFAULT 0,
    controls text,
    controls_in_place text,
    evidence_required text,
    evidence_location text,
    gap boolean DEFAULT false,
    gap_identified boolean DEFAULT false,
    gap_description text,
    further_controls text,
    penalty_risk text,
    responsibility text,
    responsible_person text,
    target_date date,
    effective_date date,
    review_date date,
    last_assessed_date date,
    last_reviewed date,
    next_assessment_date date,
    assessed_by text,
    notes text,
    tags text[],
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    part text,
    source_url text,
    last_verified_at timestamp with time zone
);


--
-- Name: legislative_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legislative_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    date_received date,
    source_material text,
    jurisdiction text,
    applicable_legislation text,
    changes_identified text,
    applicable boolean DEFAULT true,
    action_required text,
    implemented boolean DEFAULT false,
    comments text,
    linked_register_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: location_identity_backfill_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_identity_backfill_review (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    source_table text NOT NULL,
    source_id text NOT NULL,
    legacy_site text,
    legacy_area text,
    candidate_location_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    resolution_status text DEFAULT 'unresolved'::text NOT NULL,
    resolved_site_id uuid,
    resolved_area_id uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT location_identity_backfill_review_resolution_status_check CHECK ((resolution_status = ANY (ARRAY['unresolved'::text, 'resolved'::text, 'ignored'::text])))
);


--
-- Name: TABLE location_identity_backfill_review; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.location_identity_backfill_review IS 'Ambiguous or unmatched legacy site/area text awaiting controlled reconciliation.';


--
-- Name: map_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.map_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    action_id uuid,
    activity_type text NOT NULL,
    performed_by text,
    performed_at timestamp with time zone DEFAULT now(),
    old_value text,
    new_value text,
    notes text
);


--
-- Name: map_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.map_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: map_source_backfill_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.map_source_backfill_review (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    action_id uuid NOT NULL,
    source_module text,
    source_ref text,
    candidate_count integer DEFAULT 0 NOT NULL,
    candidate_records jsonb DEFAULT '[]'::jsonb NOT NULL,
    resolution_status text DEFAULT 'unresolved'::text NOT NULL,
    resolved_source_table text,
    resolved_source_id uuid,
    review_notes text,
    first_scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    last_scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone
);


--
-- Name: medical_surveillance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medical_surveillance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_id uuid,
    employee_name text NOT NULL,
    employee_id text,
    department text,
    job_title text,
    date_of_birth date,
    gender text,
    exam_type text DEFAULT 'periodic'::text,
    exam_date date NOT NULL,
    next_exam_date date,
    examining_doctor text,
    clinic_hospital text,
    fitness_status text DEFAULT 'fit'::text,
    restrictions text,
    referral_required boolean DEFAULT false,
    referral_details text,
    height_cm numeric,
    weight_kg numeric,
    bmi numeric,
    blood_pressure_systolic integer,
    blood_pressure_diastolic integer,
    heart_rate integer,
    blood_glucose numeric,
    hypertension boolean DEFAULT false,
    diabetes boolean DEFAULT false,
    respiratory_condition boolean DEFAULT false,
    cardiac_condition boolean DEFAULT false,
    musculoskeletal_condition boolean DEFAULT false,
    skin_condition boolean DEFAULT false,
    noise_exposed boolean DEFAULT false,
    chemical_exposed boolean DEFAULT false,
    dust_exposed boolean DEFAULT false,
    vibration_exposed boolean DEFAULT false,
    medical_notes text,
    follow_up_required boolean DEFAULT false,
    follow_up_date date,
    report_ref text,
    status text DEFAULT 'completed'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT medical_surveillance_exam_type_check CHECK ((exam_type = ANY (ARRAY['pre_employment'::text, 'periodic'::text, 'return_to_work'::text, 'exit'::text, 'special'::text, 'fitness_for_duty'::text]))),
    CONSTRAINT medical_surveillance_fitness_status_check CHECK ((fitness_status = ANY (ARRAY['fit'::text, 'fit_with_restrictions'::text, 'temporarily_unfit'::text, 'permanently_unfit'::text, 'pending'::text]))),
    CONSTRAINT medical_surveillance_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text, 'prefer_not_to_say'::text]))),
    CONSTRAINT medical_surveillance_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text, 'pending_review'::text])))
);


--
-- Name: meeting_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid,
    action text,
    responsible text,
    due_date date,
    status text DEFAULT 'open'::text,
    CONSTRAINT meeting_actions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'closed'::text])))
);


--
-- Name: meeting_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    meeting_type text NOT NULL,
    title text NOT NULL,
    recurrence text NOT NULL,
    location text,
    chaired_by text,
    next_date date,
    responsible text,
    active boolean DEFAULT true,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT meeting_series_meeting_type_check CHECK ((meeting_type = ANY (ARRAY['management_review'::text, 'hse_committee'::text, 'other'::text]))),
    CONSTRAINT meeting_series_recurrence_check CHECK ((recurrence = ANY (ARRAY['monthly'::text, 'bimonthly'::text, 'quarterly'::text, 'triannual'::text, 'biannual'::text, 'annual'::text])))
);


--
-- Name: moc_change_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moc_change_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    moc_ref text NOT NULL,
    title text NOT NULL,
    change_type text DEFAULT 'process'::text NOT NULL,
    reason text,
    current_situation text,
    proposed_change text,
    impacted_areas text[] DEFAULT '{}'::text[] NOT NULL,
    risk_review text,
    pre_implementation_actions text,
    post_change_verification text,
    priority text DEFAULT 'medium'::text NOT NULL,
    lifecycle_status text DEFAULT 'draft'::text NOT NULL,
    owner_id uuid,
    owner_name text,
    location text,
    target_date date,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    implemented_at timestamp with time zone,
    verified_at timestamp with time zone,
    closed_at timestamp with time zone,
    approver_id uuid,
    approver_name text,
    verifier_id uuid,
    verifier_name text,
    legacy_action_id uuid,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moc_change_requests_lifecycle_check CHECK ((lifecycle_status = ANY (ARRAY['draft'::text, 'screening'::text, 'impact_assessment'::text, 'pending_approval'::text, 'approved'::text, 'implementation'::text, 'verification'::text, 'closed'::text, 'rejected'::text, 'cancelled'::text]))),
    CONSTRAINT moc_change_requests_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: TABLE moc_change_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.moc_change_requests IS 'Controlled Management of Change headers. Resulting corrective actions remain separate action_tracker records linked through record_relationships.';


--
-- Name: muster_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.muster_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    name text NOT NULL,
    location_description text,
    capacity integer,
    warden_assigned text,
    emergency_types text[],
    gps_lat numeric,
    gps_lng numeric,
    notes text,
    status text DEFAULT 'active'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT muster_points_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'under_review'::text])))
);


--
-- Name: noise_measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_measurements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    survey_id uuid,
    measurement_point text,
    job_title text,
    leq_db numeric,
    lpeak_db numeric,
    exposure_hours numeric,
    lep_d numeric,
    action_level text,
    ppe_required boolean DEFAULT false,
    remarks text,
    CONSTRAINT noise_measurements_action_level_check CHECK ((action_level = ANY (ARRAY['below'::text, 'lower'::text, 'upper'::text, 'limit'::text])))
);


--
-- Name: noise_mgmt_assessment_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_assessment_profiles (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    jurisdiction text,
    scope text NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    reference_duration_hours numeric DEFAULT 8 NOT NULL,
    parameters_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    bands_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    field_check_tolerance numeric,
    uncertainty_rule text,
    test_cases_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    owner_id uuid,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    change_reason text,
    published_by uuid,
    published_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_audit_events (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    reason text,
    performed_by uuid,
    performed_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_control_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_control_plans (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    source_ref text NOT NULL,
    baseline_result text NOT NULL,
    hierarchy text NOT NULL,
    options_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    selected_control text NOT NULL,
    owner_id uuid,
    owner_name text,
    accountable_manager text,
    due_date date,
    expected_reduction numeric,
    verification_criteria text NOT NULL,
    verification_measurement_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    effectiveness_status text DEFAULT 'not_verified'::text,
    interim_controls text,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_exposure_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_exposure_assessments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    subject_type text NOT NULL,
    subject_id text,
    subject_name text NOT NULL,
    assessment_date date,
    assessment_period text,
    profile_id text,
    profile_name text NOT NULL,
    source_measurement_versions jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_level numeric,
    duration_hours numeric,
    result_value numeric,
    result_unit text,
    calculation_method text,
    calculation_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    classification text,
    data_quality_status text,
    uncertainty jsonb DEFAULT '{}'::jsonb NOT NULL,
    limitations text,
    response_status text,
    assessor_id uuid,
    reviewer_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    supersedes_id text,
    approved_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_field_surveys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_field_surveys (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    survey_type text NOT NULL,
    site text,
    scope text,
    survey_date date,
    plan_id text,
    plan_code text,
    plan_version integer,
    assessor_id uuid,
    assessor_name text,
    instrument_codes text,
    operating_conditions text,
    pre_check_status text,
    post_check_status text,
    planned_samples integer,
    completed_samples integer,
    quality_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    sync_status text DEFAULT 'online'::text,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_health_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_health_statuses (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    subject_code text,
    subject_id uuid,
    seg_id text,
    seg_name text,
    eligibility_status text,
    referral_status text,
    last_surveillance_date date,
    next_surveillance_date date,
    integration_status text,
    source_reference text,
    restriction_flag boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_hearing_protectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_hearing_protectors (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    manufacturer text,
    model text,
    protector_type text,
    certification_reference text,
    snr numeric,
    hml_values text,
    octave_attenuation jsonb DEFAULT '{}'::jsonb NOT NULL,
    derating_percent numeric,
    fit_test_method text,
    compatibility_notes text,
    stock_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_instruments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_instruments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    asset_code text NOT NULL,
    equipment_type text NOT NULL,
    manufacturer text,
    model text,
    serial_number text NOT NULL,
    capabilities text,
    components jsonb DEFAULT '[]'::jsonb NOT NULL,
    custodian_id uuid,
    custodian_name text,
    calibration_certificate text,
    calibration_date date,
    calibration_due_date date,
    service_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    availability text,
    last_field_check_status text,
    status text DEFAULT 'available'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_maps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_maps (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    site text,
    area text,
    survey_id text,
    survey_code text,
    descriptor text,
    point_count integer,
    base_plan_ref text,
    point_layer jsonb DEFAULT '[]'::jsonb NOT NULL,
    zone_layer jsonb DEFAULT '[]'::jsonb NOT NULL,
    interpolation_method text DEFAULT 'point_only'::text,
    operating_condition text,
    limitations text,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    supersedes_id text,
    published_by uuid,
    published_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_measurement_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_measurement_plans (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    programme_id text,
    purpose text NOT NULL,
    scope text NOT NULL,
    profile_id text,
    profile_name text,
    strategy text,
    sample_count integer,
    sample_plan jsonb DEFAULT '[]'::jsonb NOT NULL,
    instrument_requirements text,
    assignee_id uuid,
    assignee_name text,
    planned_date date,
    quality_controls text,
    issued_at timestamp with time zone,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    previous_version_id text,
    change_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_measurements (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    survey_id text,
    measurement_type text NOT NULL,
    subject_type text,
    subject_id text,
    subject_name text,
    location text,
    measurement_date timestamp with time zone NOT NULL,
    descriptor text NOT NULL,
    raw_value numeric,
    unit text,
    valid_duration_minutes numeric,
    instrument_id text,
    instrument_code text,
    weighting_response text,
    operating_context text,
    source_reference text,
    raw_file_ref text,
    raw_file_checksum text,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    excluded_intervals jsonb DEFAULT '[]'::jsonb NOT NULL,
    field_check_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    data_quality_status text DEFAULT 'not_assessed'::text,
    limitations text,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    supersedes_id text,
    exclusion_reason text,
    accepted_by uuid,
    accepted_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_programmes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_programmes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    programme_type text NOT NULL,
    purpose text NOT NULL,
    scope text NOT NULL,
    profile_id text,
    profile_name text,
    coverage_target numeric,
    owner_id uuid,
    owner_name text,
    start_date date,
    end_date date,
    next_due_date date,
    recurrence jsonb DEFAULT '{}'::jsonb NOT NULL,
    strategy text,
    resources jsonb DEFAULT '{}'::jsonb NOT NULL,
    workflow jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    change_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_reports (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    report_type text NOT NULL,
    scope text,
    data_as_of date,
    source_versions jsonb DEFAULT '[]'::jsonb NOT NULL,
    owner_id uuid,
    owner_name text,
    approver_id uuid,
    approver_name text,
    distribution_rules text,
    rendered_file_ref text,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    supersedes_id text,
    issued_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_segs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_segs (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    owner_id uuid,
    owner_name text,
    inclusion_criteria text NOT NULL,
    membership_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    work_profile text,
    sampling_strategy text,
    effective_from date,
    effective_to date,
    next_review_date date,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_sources (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    source_type text,
    site text,
    operating_context text,
    exposed_population text,
    existing_controls text,
    owner_id uuid,
    owner_name text,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    effective_from date,
    effective_to date,
    archived_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_mgmt_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_mgmt_tasks (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    process_name text,
    typical_duration_minutes numeric,
    work_pattern text,
    operating_conditions text,
    population_scope text,
    exposure_components jsonb DEFAULT '[]'::jsonb NOT NULL,
    review_trigger text,
    owner_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: noise_surveys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noise_surveys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    survey_type text,
    site text,
    survey_date date,
    conducted_by text,
    instrument_used text,
    calibration_date date,
    weather_conditions text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    layout_title text,
    layout_url text,
    layout_image text,
    measurements jsonb DEFAULT '[]'::jsonb,
    hpe_assessment jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT noise_surveys_survey_type_check CHECK ((survey_type = ANY (ARRAY['occupational'::text, 'environmental'::text])))
);


--
-- Name: notification_escalation_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_escalation_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    escalation_level integer NOT NULL,
    profile_id uuid,
    display_name text,
    email_override text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_escalation_recipient_target CHECK (((profile_id IS NOT NULL) OR (NULLIF(TRIM(BOTH FROM email_override), ''::text) IS NOT NULL))),
    CONSTRAINT notification_escalation_recipients_escalation_level_check CHECK (((escalation_level >= 1) AND (escalation_level <= 3)))
);


--
-- Name: notification_escalation_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_escalation_settings (
    company_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    due_soon_days integer DEFAULT 7 NOT NULL,
    level_1_overdue_days integer DEFAULT 7 NOT NULL,
    level_2_overdue_days integer DEFAULT 21 NOT NULL,
    level_3_overdue_days integer DEFAULT 45 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_escalation_threshold_order CHECK (((due_soon_days >= 0) AND (due_soon_days <= 90) AND (level_1_overdue_days >= 1) AND (level_2_overdue_days > level_1_overdue_days) AND (level_3_overdue_days > level_2_overdue_days)))
);


--
-- Name: notification_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    notification_id uuid NOT NULL,
    event_type text NOT NULL,
    related_module text,
    related_table text,
    related_id uuid,
    related_ref text,
    actor_id uuid,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE notification_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_events IS 'Append-only notification lifecycle events, including delivery, open and failed-target outcomes.';


--
-- Name: notification_link_opens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_link_opens (
    notification_id uuid NOT NULL,
    company_id uuid NOT NULL,
    destination_hash text NOT NULL,
    first_opened_at timestamp with time zone DEFAULT now() NOT NULL,
    last_opened_at timestamp with time zone DEFAULT now() NOT NULL,
    open_count integer DEFAULT 1 NOT NULL,
    CONSTRAINT notification_link_opens_open_count_check CHECK ((open_count >= 1))
);


--
-- Name: TABLE notification_link_opens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_link_opens IS 'First/last explicit signed email record-link use; stores no recipient address or raw destination.';


--
-- Name: notification_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    email_enabled boolean DEFAULT true,
    notify_on_incident boolean DEFAULT true,
    notify_on_permit boolean DEFAULT true,
    notify_on_overdue boolean DEFAULT true,
    notify_on_investigation boolean DEFAULT true,
    notify_on_audit boolean DEFAULT true,
    notify_recipients jsonb DEFAULT '[]'::jsonb,
    from_email text DEFAULT 'noreply@auris360.app'::text,
    resend_api_key text,
    daily_digest_time text DEFAULT '08:00'::text,
    timezone text DEFAULT 'Indian/Mauritius'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    event_recipients jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: objectives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.objectives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    code text,
    name text NOT NULL,
    color text DEFAULT '#1D9E75'::text,
    sort_order integer DEFAULT 0,
    year integer DEFAULT (EXTRACT(year FROM now()))::integer,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: occupational_diseases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.occupational_diseases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_id uuid,
    employee_name text NOT NULL,
    employee_id text,
    department text,
    job_title text,
    disease_ref text,
    disease_type text NOT NULL,
    icd_code text,
    diagnosis_date date,
    onset_date date,
    causative_agent text,
    exposure_duration_years numeric,
    exposure_type text,
    work_related boolean DEFAULT true,
    work_relatedness_assessment text,
    treating_doctor text,
    hospital_clinic text,
    treatment_description text,
    days_lost integer DEFAULT 0,
    outcome text DEFAULT 'ongoing'::text,
    disability_percentage numeric,
    return_to_work_date date,
    restricted_duties boolean DEFAULT false,
    notified_to_authority boolean DEFAULT false,
    notification_ref text,
    compensation_claimed boolean DEFAULT false,
    compensation_ref text,
    preventive_actions text,
    similar_workers_at_risk boolean DEFAULT false,
    group_monitoring_recommended boolean DEFAULT false,
    status text DEFAULT 'active'::text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT occupational_diseases_exposure_type_check CHECK ((exposure_type = ANY (ARRAY['noise'::text, 'dust'::text, 'silica'::text, 'chemical'::text, 'vibration'::text, 'heat'::text, 'biological'::text, 'ergonomic'::text, 'psychological'::text, 'radiation'::text, 'other'::text]))),
    CONSTRAINT occupational_diseases_outcome_check CHECK ((outcome = ANY (ARRAY['ongoing'::text, 'recovered'::text, 'permanent_disability'::text, 'fatal'::text, 'under_treatment'::text]))),
    CONSTRAINT occupational_diseases_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'under_review'::text])))
);


--
-- Name: od_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.od_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oversight_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oversight_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consultant_company_id uuid,
    client_company_id uuid,
    accessed_by uuid,
    action text,
    module text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: pending_notifications; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.pending_notifications WITH (security_invoker='true') AS
 SELECT id,
    company_id,
    type,
    subject,
    to_email,
    to_name,
    status,
    created_at,
    related_id,
    related_table
   FROM public.notification_queue nq
  WHERE (status = 'pending'::text)
  ORDER BY created_at DESC;


--
-- Name: people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_type text DEFAULT 'employee'::text,
    first_name text NOT NULL,
    last_name text NOT NULL,
    id_number text,
    date_of_birth date,
    gender text,
    nationality text,
    photo_url text,
    job_title text,
    department text,
    site text,
    employee_number text,
    start_date date,
    end_date date,
    contract_type text,
    company_name text,
    contract_ref text,
    contract_start date,
    contract_end date,
    email text,
    phone text,
    emergency_name text,
    emergency_relation text,
    emergency_phone text,
    status text DEFAULT 'active'::text,
    induction_date date,
    induction_completed boolean DEFAULT false,
    medical_fitness_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    site_id uuid,
    primary_site text,
    CONSTRAINT people_contract_type_check CHECK ((contract_type = ANY (ARRAY['permanent'::text, 'fixed_term'::text, 'casual'::text, 'contract'::text]))),
    CONSTRAINT people_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text]))),
    CONSTRAINT people_person_type_check CHECK ((person_type = ANY (ARRAY['employee'::text, 'contractor'::text, 'subcontractor'::text]))),
    CONSTRAINT people_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text])))
);


--
-- Name: people_certifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.people_certifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid,
    company_id uuid,
    certification text NOT NULL,
    issued_by text,
    issue_date date,
    expiry_date date,
    certificate_no text,
    status text DEFAULT 'valid'::text,
    CONSTRAINT people_certifications_status_check CHECK ((status = ANY (ARRAY['valid'::text, 'expired'::text, 'pending'::text])))
);


--
-- Name: permit_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permit_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    permit_id uuid,
    action text NOT NULL,
    performed_by text,
    performed_at timestamp with time zone DEFAULT now(),
    details text,
    old_status text,
    new_status text
);


--
-- Name: permits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    permit_number text,
    permit_type text,
    work_description text,
    location text,
    contractor text,
    start_datetime timestamp with time zone,
    end_datetime timestamp with time zone,
    issued_by text,
    approved_by text,
    precautions text,
    ppe_required text,
    isolation_required boolean DEFAULT false,
    status text DEFAULT 'draft'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    permit_type_v2 text,
    work_location text,
    department text,
    priority text DEFAULT 'medium'::text,
    risk_level text DEFAULT 'medium'::text,
    planned_start timestamp with time zone,
    planned_end timestamp with time zone,
    actual_start timestamp with time zone,
    actual_end timestamp with time zone,
    permit_issuer_id uuid,
    permit_issuer_name text,
    permit_receiver_name text,
    permit_receiver_id uuid,
    contractor_id uuid,
    contractor_name text,
    supervisor_name text,
    work_team jsonb DEFAULT '[]'::jsonb,
    ra_ref text,
    method_statement_ref text,
    work_order_id uuid,
    work_order_ref text,
    approval_level_required integer DEFAULT 1,
    approval_l1_by text,
    approval_l1_at timestamp with time zone,
    approval_l1_status text DEFAULT 'pending'::text,
    approval_l2_by text,
    approval_l2_at timestamp with time zone,
    approval_l2_status text DEFAULT 'pending'::text,
    approval_l3_by text,
    approval_l3_at timestamp with time zone,
    approval_l3_status text DEFAULT 'pending'::text,
    hot_work_data jsonb DEFAULT '{}'::jsonb,
    confined_space_data jsonb DEFAULT '{}'::jsonb,
    electrical_data jsonb DEFAULT '{}'::jsonb,
    height_data jsonb DEFAULT '{}'::jsonb,
    lifting_data jsonb DEFAULT '{}'::jsonb,
    excavation_data jsonb DEFAULT '{}'::jsonb,
    radiation_data jsonb DEFAULT '{}'::jsonb,
    chemical_data jsonb DEFAULT '{}'::jsonb,
    gas_tests jsonb DEFAULT '[]'::jsonb,
    isolations jsonb DEFAULT '[]'::jsonb,
    precautions_checklist jsonb DEFAULT '[]'::jsonb,
    suspended_at timestamp with time zone,
    suspended_by text,
    suspension_reason text,
    cancelled_at timestamp with time zone,
    cancelled_by text,
    cancellation_reason text,
    closed_at timestamp with time zone,
    closed_by text,
    closure_checklist jsonb DEFAULT '[]'::jsonb,
    closure_notes text,
    blocked_reasons jsonb DEFAULT '[]'::jsonb,
    qr_code text,
    validated_at timestamp with time zone,
    validated_by text,
    simops_check_done boolean DEFAULT false,
    simops_conflicts jsonb DEFAULT '[]'::jsonb,
    requires_weather_check boolean DEFAULT false,
    weather_conditions text,
    weather_checked_at timestamp with time zone,
    notes text,
    updated_at timestamp with time zone DEFAULT now(),
    site_id uuid,
    permit_receiver text,
    permit_issuer text,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    hazards jsonb,
    controls jsonb,
    lift_super text,
    lift_cert text,
    approvers jsonb,
    area_id uuid,
    site_name_snapshot text,
    area_name_snapshot text,
    risk_assessment_id uuid,
    method_statement_id uuid,
    CONSTRAINT permits_permit_type_check CHECK ((permit_type = ANY (ARRAY['hot_work'::text, 'confined_space'::text, 'working_at_height'::text, 'electrical'::text, 'excavation'::text, 'general'::text]))),
    CONSTRAINT permits_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'approved'::text, 'active'::text, 'closed'::text, 'cancelled'::text])))
);


--
-- Name: person_duplicate_candidates; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.person_duplicate_candidates WITH (security_invoker='true') AS
 WITH identity_keys AS (
         SELECT p_1.company_id,
            p_1.id,
            'email'::text AS match_type,
            lower(TRIM(BOTH FROM p_1.email)) AS match_key
           FROM public.people p_1
          WHERE (NULLIF(TRIM(BOTH FROM p_1.email), ''::text) IS NOT NULL)
        UNION ALL
         SELECT p_1.company_id,
            p_1.id,
            'employee_number'::text AS text,
            public.normalise_person_identity_text(COALESCE(p_1.employee_number, p_1.id_number)) AS normalise_person_identity_text
           FROM public.people p_1
          WHERE (NULLIF(TRIM(BOTH FROM COALESCE(p_1.employee_number, p_1.id_number)), ''::text) IS NOT NULL)
        UNION ALL
         SELECT p_1.company_id,
            p_1.id,
            'normalised_name'::text AS text,
            public.normalise_person_identity_text(concat_ws(' '::text, p_1.first_name, p_1.last_name)) AS normalise_person_identity_text
           FROM public.people p_1
          WHERE (NULLIF(TRIM(BOTH FROM concat_ws(' '::text, p_1.first_name, p_1.last_name)), ''::text) IS NOT NULL)
        )
 SELECT k.company_id,
    k.match_type,
    k.match_key,
    array_agg(k.id ORDER BY k.id) AS person_ids,
    array_agg(concat_ws(' '::text, p.first_name, p.last_name) ORDER BY p.last_name, p.first_name, p.id) AS person_names,
    (count(*))::integer AS candidate_count
   FROM (identity_keys k
     JOIN public.people p ON ((p.id = k.id)))
  GROUP BY k.company_id, k.match_type, k.match_key
 HAVING (count(*) > 1);


--
-- Name: VIEW person_duplicate_candidates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.person_duplicate_candidates IS 'Advisory duplicate signals only; candidate People records are never merged automatically.';


--
-- Name: person_identity_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_identity_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    review_id uuid,
    source_table text NOT NULL,
    source_id uuid NOT NULL,
    decision text NOT NULL,
    selected_person_id uuid,
    legacy_name text,
    decision_note text,
    decided_by uuid,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_identity_decisions_decision_check CHECK ((decision = ANY (ARRAY['linked'::text, 'ignored'::text, 'reopened'::text])))
);


--
-- Name: person_identity_reconciliation_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.person_identity_reconciliation_summary WITH (security_invoker='true') AS
 SELECT c.id AS company_id,
    (count(r.id) FILTER (WHERE (r.resolution_status = 'unresolved'::text)))::integer AS unresolved_count,
    (count(r.id) FILTER (WHERE (r.resolution_status = 'resolved'::text)))::integer AS resolved_count,
    (count(r.id) FILTER (WHERE (r.resolution_status = 'ignored'::text)))::integer AS ignored_count,
    (COALESCE(( SELECT count(*) AS count
           FROM public.person_duplicate_candidates d
          WHERE (d.company_id = c.id)), (0)::bigint))::integer AS duplicate_cluster_count,
    max(r.updated_at) AS last_review_at
   FROM (public.companies c
     LEFT JOIN public.person_identity_backfill_review r ON ((r.company_id = c.id)))
  GROUP BY c.id;


--
-- Name: ppe_catalogue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ppe_catalogue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    ppe_code text,
    name text NOT NULL,
    category text NOT NULL,
    sub_category text,
    brand text,
    model text,
    standard text,
    hazard_types text[],
    protection_level text,
    quantity_total integer DEFAULT 0,
    quantity_available integer DEFAULT 0,
    quantity_issued integer DEFAULT 0,
    quantity_condemned integer DEFAULT 0,
    reorder_level integer DEFAULT 5,
    unit_cost numeric,
    location text,
    supplier text,
    has_expiry boolean DEFAULT false,
    service_life_months integer,
    inspection_interval_days integer DEFAULT 90,
    status text DEFAULT 'active'::text,
    notes text,
    image_url text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ppe_catalogue_category_check CHECK ((category = ANY (ARRAY['head'::text, 'eye_face'::text, 'hearing'::text, 'respiratory'::text, 'hands'::text, 'feet'::text, 'body'::text, 'fall_protection'::text, 'high_visibility'::text, 'other'::text]))),
    CONSTRAINT ppe_catalogue_status_check CHECK ((status = ANY (ARRAY['active'::text, 'discontinued'::text, 'out_of_stock'::text])))
);


--
-- Name: ppe_insp_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ppe_insp_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ppe_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ppe_inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    inspection_ref text,
    ppe_id uuid,
    ppe_name text NOT NULL,
    issuance_id uuid,
    employee_name text,
    department text,
    inspector text NOT NULL,
    inspection_date date NOT NULL,
    checklist jsonb DEFAULT '[]'::jsonb,
    overall_result text DEFAULT 'pass'::text,
    defects_found text,
    action_taken text,
    replacement_issued boolean DEFAULT false,
    replacement_issuance_ref text,
    next_inspection_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ppe_inspections_action_taken_check CHECK ((action_taken = ANY (ARRAY['cleared_for_use'::text, 'repaired'::text, 'condemned_replaced'::text, 'returned_for_maintenance'::text, 'none'::text]))),
    CONSTRAINT ppe_inspections_overall_result_check CHECK ((overall_result = ANY (ARRAY['pass'::text, 'fail'::text, 'condemn'::text, 'monitor'::text])))
);


--
-- Name: ppe_iss_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ppe_iss_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ppe_issuance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ppe_issuance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    issuance_ref text,
    ppe_id uuid,
    ppe_name text NOT NULL,
    ppe_category text,
    person_id uuid,
    employee_name text NOT NULL,
    employee_id text,
    department text,
    job_title text,
    issued_date date NOT NULL,
    issued_by text,
    quantity integer DEFAULT 1,
    size text,
    serial_number text,
    batch_number text,
    manufacture_date date,
    expiry_date date,
    expected_replacement_date date,
    condition_on_issue text DEFAULT 'new'::text,
    returned boolean DEFAULT false,
    return_date date,
    return_condition text,
    return_reason text,
    work_order_ref text,
    hazard_ref text,
    ra_ref text,
    employee_signature boolean DEFAULT false,
    acknowledgement_date date,
    status text DEFAULT 'active'::text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    issued_by_person_id uuid,
    person_name_snapshot text,
    organization_snapshot text,
    role_snapshot text,
    work_order_id uuid,
    risk_assessment_id uuid,
    CONSTRAINT ppe_issuance_condition_on_issue_check CHECK ((condition_on_issue = ANY (ARRAY['new'::text, 'good'::text, 'fair'::text]))),
    CONSTRAINT ppe_issuance_return_condition_check CHECK ((return_condition = ANY (ARRAY['good'::text, 'damaged'::text, 'condemned'::text, 'lost'::text]))),
    CONSTRAINT ppe_issuance_status_check CHECK ((status = ANY (ARRAY['active'::text, 'returned'::text, 'expired'::text, 'lost'::text, 'condemned'::text])))
);


--
-- Name: ppe_rep_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ppe_rep_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ppe_replacements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ppe_replacements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    replacement_ref text,
    issuance_id uuid,
    ppe_id uuid,
    ppe_name text NOT NULL,
    employee_name text NOT NULL,
    department text,
    reason text NOT NULL,
    reason_notes text,
    old_item_condition text,
    requested_date date NOT NULL,
    requested_by text,
    urgency text DEFAULT 'normal'::text,
    approved_by text,
    approved_date date,
    status text DEFAULT 'pending'::text,
    fulfilled_date date,
    new_issuance_ref text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ppe_replacements_reason_check CHECK ((reason = ANY (ARRAY['expiry'::text, 'damage'::text, 'loss'::text, 'wear'::text, 'inspection_fail'::text, 'size_change'::text, 'other'::text]))),
    CONSTRAINT ppe_replacements_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'fulfilled'::text, 'rejected'::text, 'cancelled'::text]))),
    CONSTRAINT ppe_replacements_urgency_check CHECK ((urgency = ANY (ARRAY['immediate'::text, 'urgent'::text, 'normal'::text, 'planned'::text])))
);


--
-- Name: prestart_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prestart_inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    activity text NOT NULL,
    location text,
    check_date date,
    duration text,
    supervisor_id uuid,
    supervisor_name text,
    team_members text,
    ra_ref text,
    ptw_ref text,
    hazards text,
    controls text,
    tbt_conducted boolean DEFAULT false,
    tbt_topics text,
    stop_work_concerns text,
    ppe_required jsonb DEFAULT '[]'::jsonb,
    ppe_extra text,
    checklist_results jsonb DEFAULT '[]'::jsonb,
    decision text DEFAULT 'go'::text,
    decision_notes text,
    signed_by text,
    signed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT prestart_inspections_decision_check CHECK ((decision = ANY (ARRAY['go'::text, 'hold'::text, 'stop'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    company_id uuid,
    full_name text,
    role text,
    email text,
    created_at timestamp with time zone DEFAULT now(),
    invited_by uuid,
    status text DEFAULT 'active'::text,
    job_title text,
    department text,
    phone text,
    site text,
    contractor_company text,
    last_login timestamp with time zone,
    invited_at timestamp with time zone,
    avatar_url text,
    permissions jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    must_change_password boolean DEFAULT false,
    synthetic_email boolean DEFAULT false,
    provisioned_by uuid,
    provisioned_at timestamp with time zone,
    real_email text,
    mobile_phone text,
    whatsapp_phone text,
    preferred_notification_channel text DEFAULT 'in_app'::text,
    notification_notes text,
    whatsapp_opted_in_at timestamp with time zone,
    whatsapp_opted_out_at timestamp with time zone,
    whatsapp_consent_source text,
    whatsapp_consent_version text,
    CONSTRAINT profiles_preferred_notification_channel_check CHECK ((preferred_notification_channel = ANY (ARRAY['in_app'::text, 'email'::text, 'whatsapp'::text, 'sms'::text]))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['sephs_admin'::text, 'admin'::text, 'manager'::text, 'hse_manager'::text, 'site_manager'::text, 'employee'::text, 'contractor'::text, 'supervisor'::text, 'auditor'::text, 'inspector'::text, 'hr'::text, 'executive'::text, 'user'::text])))
);


--
-- Name: COLUMN profiles.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.email IS 'Login username. May be an app-generated .local address and should not always be used for notifications.';


--
-- Name: COLUMN profiles.real_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.real_email IS 'Real deliverable email address used for notifications when preferred_notification_channel is email.';


--
-- Name: COLUMN profiles.mobile_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.mobile_phone IS 'Mobile number for SMS or phone contact.';


--
-- Name: COLUMN profiles.whatsapp_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.whatsapp_phone IS 'WhatsApp-enabled mobile number for future WhatsApp Business notifications.';


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    recipient_profile_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth_secret text NOT NULL,
    user_agent text,
    device_label text,
    enabled boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    disabled_at timestamp with time zone,
    disabled_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE push_subscriptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.push_subscriptions IS 'User-consented browser/PWA push subscriptions. One user may register multiple devices.';


--
-- Name: qr_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    module_name text NOT NULL,
    related_table text,
    related_id uuid,
    qr_code text NOT NULL,
    label text,
    public_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ra_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ra_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    ra_id uuid,
    revision integer NOT NULL,
    snapshot jsonb,
    changed_by text,
    change_notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ra_sequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ra_sequence (
    company_id uuid NOT NULL,
    ra_type text NOT NULL,
    year integer NOT NULL,
    last_seq integer DEFAULT 0
);


--
-- Name: ra_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ra_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    name text NOT NULL,
    ra_type text NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    cloned_from uuid,
    custom_fields jsonb DEFAULT '[]'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ra_templates_ra_type_check CHECK ((ra_type = ANY (ARRAY['baseline'::text, 'task'::text, 'dynamic'::text])))
);


--
-- Name: record_relationships_bidirectional; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.record_relationships_bidirectional WITH (security_invoker='true') AS
 SELECT record_relationships.id,
    record_relationships.company_id,
    record_relationships.source_module AS record_module,
    record_relationships.source_table AS record_table,
    record_relationships.source_id AS record_id,
    record_relationships.source_ref AS record_ref,
    record_relationships.source_revision AS record_revision,
    record_relationships.target_module AS related_module,
    record_relationships.target_table AS related_table,
    record_relationships.target_id AS related_id,
    record_relationships.target_ref AS related_ref,
    record_relationships.target_revision AS related_revision,
    record_relationships.relationship_type,
    record_relationships.status,
    record_relationships.applicability,
    record_relationships.source_valid AS record_valid,
    record_relationships.target_valid AS related_valid,
    record_relationships.validation_error,
    record_relationships.last_validated_at,
    record_relationships.verified_at,
    record_relationships.created_by,
    record_relationships.created_at,
    record_relationships.updated_at,
    record_relationships.source_state AS record_state,
    record_relationships.target_state AS related_state
   FROM public.record_relationships
UNION ALL
 SELECT record_relationships.id,
    record_relationships.company_id,
    record_relationships.target_module AS record_module,
    record_relationships.target_table AS record_table,
    record_relationships.target_id AS record_id,
    record_relationships.target_ref AS record_ref,
    record_relationships.target_revision AS record_revision,
    record_relationships.source_module AS related_module,
    record_relationships.source_table AS related_table,
    record_relationships.source_id AS related_id,
    record_relationships.source_ref AS related_ref,
    record_relationships.source_revision AS related_revision,
    record_relationships.relationship_type,
    record_relationships.status,
    record_relationships.applicability,
    record_relationships.target_valid AS record_valid,
    record_relationships.source_valid AS related_valid,
    record_relationships.validation_error,
    record_relationships.last_validated_at,
    record_relationships.verified_at,
    record_relationships.created_by,
    record_relationships.created_at,
    record_relationships.updated_at,
    record_relationships.target_state AS record_state,
    record_relationships.source_state AS related_state
   FROM public.record_relationships;


--
-- Name: reference_identity_backfill_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reference_identity_backfill_review (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    source_table text NOT NULL,
    source_id text NOT NULL,
    source_field text NOT NULL,
    legacy_reference text NOT NULL,
    target_table text NOT NULL,
    candidate_target_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    resolution_status text DEFAULT 'unresolved'::text NOT NULL,
    resolved_target_id uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reference_identity_backfill_review_resolution_status_check CHECK ((resolution_status = ANY (ARRAY['unresolved'::text, 'resolved'::text, 'ignored'::text])))
);


--
-- Name: TABLE reference_identity_backfill_review; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reference_identity_backfill_review IS 'Ambiguous or missing legacy operational references requiring controlled resolution.';


--
-- Name: relationship_health_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.relationship_health_summary WITH (security_invoker='true') AS
 SELECT company_id,
    (count(*) FILTER (WHERE (status = 'active'::text)))::integer AS active_count,
    (count(*) FILTER (WHERE (status = 'endpoint_archived'::text)))::integer AS archived_endpoint_count,
    (count(*) FILTER (WHERE (status = 'broken'::text)))::integer AS broken_count,
    (count(*) FILTER (WHERE (status = 'unresolved'::text)))::integer AS unresolved_count,
    (count(*) FILTER (WHERE (status = 'pending_verification'::text)))::integer AS pending_verification_count,
    (count(*) FILTER (WHERE (status = 'archived'::text)))::integer AS archived_relationship_count,
    (count(*))::integer AS total_count,
    max(last_validated_at) AS last_validated_at
   FROM public.record_relationships
  GROUP BY company_id;


--
-- Name: relationship_module_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relationship_module_registry (
    module_key text NOT NULL,
    table_name text NOT NULL,
    id_column text DEFAULT 'id'::text NOT NULL,
    ref_column text,
    display_label text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: relationship_repair_queue; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.relationship_repair_queue WITH (security_invoker='true') AS
 SELECT id,
    company_id,
    source_module,
    source_table,
    source_id,
    source_ref,
    source_revision,
    source_state,
    target_module,
    target_table,
    target_id,
    target_ref,
    target_revision,
    target_state,
    relationship_type,
    status,
    validation_error,
    last_validated_at,
    created_at,
    updated_at,
    applicability
   FROM public.record_relationships
  WHERE (status = ANY (ARRAY['endpoint_archived'::text, 'broken'::text, 'unresolved'::text, 'pending_verification'::text]));


--
-- Name: relationship_validation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relationship_validation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    requested_by uuid,
    trigger_source text DEFAULT 'manual'::text NOT NULL,
    scanned_count integer DEFAULT 0 NOT NULL,
    active_count integer DEFAULT 0 NOT NULL,
    archived_endpoint_count integer DEFAULT 0 NOT NULL,
    broken_count integer DEFAULT 0 NOT NULL,
    unresolved_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: risk_assessment_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_assessment_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assessment_id uuid,
    department text,
    workshop text,
    job_title text,
    workstation text,
    task_description text,
    hazard_description text,
    generic_hazard text,
    risk text,
    activity_type text,
    persons_at_risk text,
    rop_before integer,
    rs_before integer,
    rl_before integer,
    current_controls text,
    hierarchy_of_control text,
    reliability_level text,
    rop_after integer,
    rs_after integer,
    rl_after integer,
    additional_actions text,
    responsible text,
    target_date date,
    actual_end_date date,
    CONSTRAINT risk_assessment_items_activity_type_check CHECK ((activity_type = ANY (ARRAY['Routine'::text, 'Non-Routine'::text, 'Emergency'::text]))),
    CONSTRAINT risk_assessment_items_hierarchy_of_control_check CHECK ((hierarchy_of_control = ANY (ARRAY['Elimination'::text, 'Substitution'::text, 'Engineering'::text, 'Administrative'::text, 'PPE'::text]))),
    CONSTRAINT risk_assessment_items_reliability_level_check CHECK ((reliability_level = ANY (ARRAY['High'::text, 'Medium'::text, 'Low'::text])))
);


--
-- Name: risk_assessment_operational_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_assessment_operational_records (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    risk_assessment_id text NOT NULL,
    record_type text NOT NULL,
    reference text,
    title text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    owner_id uuid,
    owner_name text,
    assignee_id uuid,
    assignee_name text,
    due_at timestamp with time zone,
    performed_at timestamp with time zone,
    completed_at timestamp with time zone,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    idempotency_key text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT risk_assessment_operational_records_record_type_check CHECK ((record_type = ANY (ARRAY['assessment_profile'::text, 'control_verification'::text, 'acknowledgement'::text, 'review_event'::text, 'communication'::text])))
);


--
-- Name: risk_assessment_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_assessment_relationships (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    risk_assessment_id text NOT NULL,
    related_module text NOT NULL,
    related_record_id text NOT NULL,
    relationship_type text DEFAULT 'supports'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: risk_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    title text NOT NULL,
    location text,
    assessed_by text,
    review_date date,
    status text DEFAULT 'draft'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    approved_by text,
    approved_date date,
    workshop text,
    job_seg text,
    task_name text,
    task_description text,
    team_members text,
    ppe_required text,
    work_description text,
    validity_period text,
    site_conditions text,
    rows jsonb DEFAULT '[]'::jsonb,
    sign_assessor text,
    sign_assessor_date date,
    sign_reviewer text,
    sign_reviewer_date date,
    sign_approver text,
    sign_approver_date date,
    ra_type text,
    ra_ref text,
    assessment_date date,
    department text,
    updated_at timestamp with time zone DEFAULT now(),
    template_id uuid,
    ra_type_v2 text,
    scope text,
    activity text,
    revision integer DEFAULT 1,
    previous_revision_id uuid,
    revision_notes text,
    submitted_by text,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    rejected_by text,
    rejection_reason text,
    rams_document_url text,
    rams_document_name text,
    rams_uploaded_at timestamp with time zone,
    site_name text,
    site_address text,
    work_order_id uuid,
    permit_id uuid,
    legal_refs jsonb DEFAULT '[]'::jsonb,
    ai_generated boolean DEFAULT false,
    ai_suggestions jsonb DEFAULT '[]'::jsonb,
    overall_risk_level text,
    overall_risk_score integer,
    ra_assessor text,
    ra_date date,
    date date,
    ra_review_date date,
    ra_approver text,
    ra_sign_assessor text,
    ra_sign_assessor_date date,
    ra_sign_reviewer text,
    ra_sign_reviewer_date date,
    ra_sign_approver text,
    ra_sign_approver_date date,
    ra_briefed text,
    permit_ref text,
    job_segment text,
    ra_job_seg text,
    baseline_rows jsonb,
    dynamic_rows jsonb,
    task_rows jsonb,
    hira_rows jsonb,
    site_id uuid,
    area_id uuid,
    site_name_snapshot text,
    area_name_snapshot text,
    CONSTRAINT risk_assessments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'review'::text, 'closed'::text])))
);


--
-- Name: rollout_health_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rollout_health_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    cohort_key text,
    module_key text,
    event_type text NOT NULL,
    severity text DEFAULT 'warning'::text NOT NULL,
    record_table text,
    record_id text,
    record_ref text,
    fingerprint text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rollout_health_events_cohort_key_check CHECK ((cohort_key = ANY (ARRAY['core_control'::text, 'controlled_content'::text, 'people_health'::text, 'specialist_operations'::text]))),
    CONSTRAINT rollout_health_events_event_type_check CHECK ((event_type = ANY (ARRAY['module_error'::text, 'orphan_relationship'::text, 'failed_deep_link'::text, 'approval_discrepancy'::text]))),
    CONSTRAINT rollout_health_events_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'critical'::text])))
);


--
-- Name: rollout_cohort_health_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rollout_cohort_health_summary WITH (security_invoker='true') AS
 SELECT c.company_id,
    c.cohort_key,
    c.status,
    c.module_keys,
    c.compatibility_reads,
    c.gate_results,
    c.updated_at,
    (count(e.id) FILTER (WHERE (e.resolved_at IS NULL)))::integer AS open_findings,
    (count(e.id) FILTER (WHERE ((e.resolved_at IS NULL) AND (e.event_type = 'module_error'::text))))::integer AS module_errors,
    (count(e.id) FILTER (WHERE ((e.resolved_at IS NULL) AND (e.event_type = 'orphan_relationship'::text))))::integer AS orphan_relationships,
    (count(e.id) FILTER (WHERE ((e.resolved_at IS NULL) AND (e.event_type = 'failed_deep_link'::text))))::integer AS failed_deep_links,
    (count(e.id) FILTER (WHERE ((e.resolved_at IS NULL) AND (e.event_type = 'approval_discrepancy'::text))))::integer AS approval_discrepancies,
    max(e.created_at) AS last_finding_at
   FROM (public.company_rollout_cohorts c
     LEFT JOIN public.rollout_health_events e ON (((e.company_id = c.company_id) AND ((e.cohort_key = c.cohort_key) OR (e.cohort_key IS NULL)))))
  GROUP BY c.company_id, c.cohort_key, c.status, c.module_keys, c.compatibility_reads, c.gate_results, c.updated_at;


--
-- Name: rollout_cohort_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rollout_cohort_transitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    cohort_key text NOT NULL,
    previous_status text,
    new_status text NOT NULL,
    gate_results jsonb DEFAULT '{}'::jsonb NOT NULL,
    compatibility_reads boolean DEFAULT true NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rollout_cohort_transitions_cohort_key_check CHECK ((cohort_key = ANY (ARRAY['core_control'::text, 'controlled_content'::text, 'people_health'::text, 'specialist_operations'::text]))),
    CONSTRAINT rollout_cohort_transitions_new_status_check CHECK ((new_status = ANY (ARRAY['disabled'::text, 'pilot'::text, 'enabled'::text, 'paused'::text]))),
    CONSTRAINT rollout_cohort_transitions_previous_status_check CHECK (((previous_status IS NULL) OR (previous_status = ANY (ARRAY['disabled'::text, 'pilot'::text, 'enabled'::text, 'paused'::text]))))
);


--
-- Name: safety_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    alert_ref text,
    title text NOT NULL,
    alert_type text DEFAULT 'hazard_warning'::text,
    severity text DEFAULT 'medium'::text,
    summary text NOT NULL,
    background text,
    what_happened text,
    lessons_learned text,
    action_required text,
    departments text[],
    applies_to text,
    issued_by text,
    issued_date date NOT NULL,
    expiry_date date,
    requires_ack boolean DEFAULT false,
    ack_count integer DEFAULT 0,
    status text DEFAULT 'active'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT safety_alerts_alert_type_check CHECK ((alert_type = ANY (ARRAY['hazard_warning'::text, 'near_miss'::text, 'incident_learning'::text, 'equipment_recall'::text, 'regulatory'::text, 'weather'::text, 'other'::text]))),
    CONSTRAINT safety_alerts_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT safety_alerts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))
);


--
-- Name: safety_bulletins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_bulletins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    bulletin_ref text,
    title text NOT NULL,
    bulletin_type text DEFAULT 'safety_bulletin'::text,
    issue_number integer,
    publication_date date NOT NULL,
    summary text,
    content text,
    key_messages text,
    topics text[],
    author text,
    approved_by text,
    target_audience text,
    distribution_method text,
    file_url text,
    file_name text,
    status text DEFAULT 'published'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    checked_by jsonb DEFAULT '[]'::jsonb,
    last_checked_at timestamp with time zone,
    acknowledged_by jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT safety_bulletins_bulletin_type_check CHECK ((bulletin_type = ANY (ARRAY['safety_bulletin'::text, 'safety_newsletter'::text, 'regulatory_update'::text, 'best_practice'::text, 'statistics_report'::text, 'campaign'::text, 'other'::text]))),
    CONSTRAINT safety_bulletins_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);


--
-- Name: safety_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    obs_ref text,
    obs_type text DEFAULT 'unsafe_condition'::text,
    category text DEFAULT 'general'::text,
    severity text DEFAULT 'medium'::text,
    observation_date date NOT NULL,
    observation_time text,
    location text,
    department text,
    work_activity text,
    observer_name text,
    observer_id uuid,
    observer_dept text,
    person_observed text,
    num_persons_involved integer DEFAULT 1,
    observation_text text NOT NULL,
    positive_points text,
    unsafe_act_description text,
    unsafe_condition_description text,
    immediate_cause text,
    root_cause text,
    potential_consequence text,
    likelihood text,
    risk_score integer,
    ppe_worn boolean,
    ppe_adequate boolean,
    ppe_notes text,
    immediate_action_taken boolean DEFAULT false,
    immediate_action_desc text,
    stopped_work boolean DEFAULT false,
    action_required boolean DEFAULT false,
    action_description text,
    action_assigned_to text,
    action_due_date date,
    action_completed boolean DEFAULT false,
    action_ref text,
    feedback_given boolean DEFAULT false,
    feedback_notes text,
    photo_url text,
    status text DEFAULT 'open'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    site_id uuid,
    area_id uuid,
    site_name_snapshot text,
    area_name_snapshot text,
    CONSTRAINT safety_observations_category_check CHECK ((category = ANY (ARRAY['ppe'::text, 'housekeeping'::text, 'working_at_height'::text, 'manual_handling'::text, 'electrical'::text, 'machinery'::text, 'chemical'::text, 'fire'::text, 'environmental'::text, 'driving'::text, 'ergonomics'::text, 'procedures'::text, 'other'::text, 'general'::text]))),
    CONSTRAINT safety_observations_likelihood_check CHECK ((likelihood = ANY (ARRAY['unlikely'::text, 'possible'::text, 'likely'::text, 'almost_certain'::text]))),
    CONSTRAINT safety_observations_obs_type_check CHECK ((obs_type = ANY (ARRAY['positive_behaviour'::text, 'unsafe_behaviour'::text, 'unsafe_condition'::text, 'near_miss'::text, 'good_practice'::text]))),
    CONSTRAINT safety_observations_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT safety_observations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'actioned'::text, 'closed'::text, 'acknowledged'::text])))
);


--
-- Name: security_sla_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_sla_settings (
    company_id uuid NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    parent_site_id uuid,
    site_code text,
    name text NOT NULL,
    site_type text DEFAULT 'site'::text,
    address text,
    city text,
    country text,
    lat numeric,
    lng numeric,
    timezone text,
    manager_name text,
    manager_email text,
    headcount integer DEFAULT 0,
    industry text,
    risk_level text DEFAULT 'medium'::text,
    status text DEFAULT 'active'::text,
    logo_url text,
    settings jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT sites_site_type_check CHECK ((site_type = ANY (ARRAY['office'::text, 'factory'::text, 'warehouse'::text, 'construction'::text, 'retail'::text, 'remote'::text, 'group'::text, 'region'::text, 'country'::text, 'site'::text, 'facility'::text, 'building'::text, 'area'::text, 'zone'::text])))
);


--
-- Name: sop_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sop_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    title text NOT NULL,
    sop_number text,
    department text,
    risk_level text DEFAULT 'medium'::text,
    prepared_by text,
    approved_by text,
    revision text DEFAULT 'Rev 00'::text,
    date date,
    description text,
    frames jsonb DEFAULT '[]'::jsonb,
    generated_html text,
    status text DEFAULT 'draft'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sop_documents_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'approved'::text, 'superseded'::text])))
);


--
-- Name: sop_video_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sop_video_evidence (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    project_id text NOT NULL,
    sequence_no integer NOT NULL,
    evidence_type text DEFAULT 'procedure_step'::text NOT NULL,
    source_label text NOT NULL,
    source_start_seconds numeric,
    source_end_seconds numeric,
    confidence numeric,
    transcript_text text,
    instruction_text text,
    safety_notes text,
    quality_notes text,
    abnormal_condition text,
    image_reference text,
    safety_critical boolean DEFAULT false NOT NULL,
    reviewer_disposition text DEFAULT 'pending'::text NOT NULL,
    reviewer_comment text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sop_video_evidence_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (100)::numeric)))),
    CONSTRAINT sop_video_evidence_evidence_type_check CHECK ((evidence_type = ANY (ARRAY['transcript'::text, 'scene'::text, 'procedure_step'::text, 'warning'::text, 'quality_check'::text, 'abnormal_condition'::text]))),
    CONSTRAINT sop_video_evidence_reviewer_disposition_check CHECK ((reviewer_disposition = ANY (ARRAY['pending'::text, 'accepted'::text, 'amended'::text, 'rejected'::text, 'not_required'::text]))),
    CONSTRAINT sop_video_evidence_source_label_check CHECK ((source_label = ANY (ARRAY['observed'::text, 'spoken'::text, 'template_required'::text, 'policy_legal'::text, 'ai_inferred'::text, 'reviewer_added'::text])))
);


--
-- Name: sop_video_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sop_video_projects (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    sop_document_id text,
    reference text,
    title text NOT NULL,
    site_name text,
    business_unit text,
    language_code text DEFAULT 'en'::text NOT NULL,
    template_code text DEFAULT 'standard'::text NOT NULL,
    privacy_level text DEFAULT 'internal'::text NOT NULL,
    consent_confirmed boolean DEFAULT false NOT NULL,
    source_file_name text,
    source_media_type text,
    source_size_bytes bigint,
    source_checksum text,
    source_storage_path text,
    processing_status text DEFAULT 'draft'::text NOT NULL,
    processing_stage text DEFAULT 'capture'::text NOT NULL,
    processing_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    owner_id uuid,
    owner_name text,
    reviewer_id uuid,
    approver_id uuid,
    due_at timestamp with time zone,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sop_video_projects_processing_status_check CHECK ((processing_status = ANY (ARRAY['draft'::text, 'uploaded'::text, 'processing'::text, 'processing_failed'::text, 'ready_for_review'::text, 'in_review'::text, 'changes_requested'::text, 'awaiting_approval'::text, 'approved'::text, 'published'::text, 'superseded'::text, 'withdrawn'::text])))
);


--
-- Name: sop_video_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sop_video_relationships (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    project_id text NOT NULL,
    related_module text NOT NULL,
    related_record_id text NOT NULL,
    relationship_type text DEFAULT 'related_to'::text NOT NULL,
    revision_code text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spill_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spill_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    ref_number text,
    spill_date date NOT NULL,
    spill_time time without time zone,
    reported_by text,
    location text NOT NULL,
    substance text NOT NULL,
    estimated_quantity numeric,
    unit text DEFAULT 'litres'::text,
    spill_cause text,
    reached_drain_watercourse boolean DEFAULT false,
    reached_soil boolean DEFAULT false,
    immediate_actions text,
    containment_method text,
    cleanup_method text,
    cleanup_contractor text,
    waste_generated text,
    root_cause text,
    corrective_actions text,
    regulatory_notification_required boolean DEFAULT false,
    regulatory_body text,
    regulatory_ref text,
    severity text DEFAULT 'minor'::text,
    status text DEFAULT 'open'::text,
    environmental_impact text,
    lessons_learned text,
    photos_taken boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT spill_reports_severity_check CHECK ((severity = ANY (ARRAY['minor'::text, 'moderate'::text, 'major'::text, 'critical'::text]))),
    CONSTRAINT spill_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'contained'::text, 'remediated'::text, 'closed'::text])))
);


--
-- Name: spill_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spill_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spirometry_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spirometry_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_id uuid,
    employee_name text NOT NULL,
    department text,
    test_date date NOT NULL,
    next_test_date date,
    examiner text,
    fvc_predicted numeric,
    fev1_predicted numeric,
    fev1_fvc_predicted numeric,
    fvc_measured numeric,
    fev1_measured numeric,
    fev1_fvc_measured numeric,
    pef_measured numeric,
    fvc_pct_predicted numeric,
    fev1_pct_predicted numeric,
    pattern text DEFAULT 'normal'::text,
    severity text DEFAULT 'none'::text,
    post_bd_test_done boolean DEFAULT false,
    post_bd_fev1 numeric,
    post_bd_fvc numeric,
    reversibility_pct numeric,
    significant_reversibility boolean DEFAULT false,
    dust_exposed boolean DEFAULT false,
    silica_exposed boolean DEFAULT false,
    asbestos_exposed boolean DEFAULT false,
    chemical_fumes_exposed boolean DEFAULT false,
    referral_required boolean DEFAULT false,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT spirometry_records_pattern_check CHECK ((pattern = ANY (ARRAY['normal'::text, 'obstructive'::text, 'restrictive'::text, 'mixed'::text, 'borderline'::text]))),
    CONSTRAINT spirometry_records_severity_check CHECK ((severity = ANY (ARRAY['none'::text, 'mild'::text, 'moderate'::text, 'severe'::text, 'very_severe'::text])))
);


--
-- Name: swms_configuration_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.swms_configuration_versions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    workspace text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    test_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    impact_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason text,
    effective_from date,
    effective_to date,
    approved_by uuid,
    approved_at timestamp with time zone,
    published_by uuid,
    published_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT swms_configuration_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validated'::text, 'tested'::text, 'impact_reviewed'::text, 'approved'::text, 'published'::text, 'superseded'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: swms_operational_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.swms_operational_records (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    swms_document_id text NOT NULL,
    revision_code text,
    record_type text NOT NULL,
    reference text,
    title text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    work_decision text,
    owner_id uuid,
    owner_name text,
    assignee_id uuid,
    assignee_name text,
    due_at timestamp with time zone,
    performed_at timestamp with time zone,
    completed_at timestamp with time zone,
    source_module text,
    source_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT swms_operational_records_record_type_check CHECK ((record_type = ANY (ARRAY['briefing'::text, 'verification'::text, 'change_request'::text, 'work_pack'::text, 'review_task'::text, 'approval_task'::text])))
);


--
-- Name: swms_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.swms_relationships (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id uuid NOT NULL,
    swms_document_id text NOT NULL,
    revision_code text,
    related_module text NOT NULL,
    related_record_id text NOT NULL,
    relationship_type text DEFAULT 'related_to'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    applicability jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tbt_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbt_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tool_checklist_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_checklist_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    category text NOT NULL,
    check_item text NOT NULL,
    sort_order integer DEFAULT 0
);


--
-- Name: tool_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    tool_id uuid,
    inspection_type text DEFAULT 'periodic'::text,
    inspection_date date NOT NULL,
    inspected_by uuid,
    inspected_by_name text,
    overall_result text DEFAULT 'pass'::text,
    checklist_results jsonb DEFAULT '[]'::jsonb,
    defects_found text,
    actions_taken text,
    next_inspection_date date,
    signed_off boolean DEFAULT false,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tool_inspections_inspection_type_check CHECK ((inspection_type = ANY (ARRAY['periodic'::text, 'pre_use'::text, 'statutory'::text, 'handover'::text]))),
    CONSTRAINT tool_inspections_overall_result_check CHECK ((overall_result = ANY (ARRAY['pass'::text, 'fail'::text, 'conditional'::text])))
);


--
-- Name: tool_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tool_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: toolbox_talks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.toolbox_talks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    work_schedule_id uuid,
    title text NOT NULL,
    talk_date date,
    conducted_by_id uuid,
    conducted_by_name text,
    location text,
    duration_minutes integer DEFAULT 15,
    work_activity text,
    work_location text,
    topics_covered text,
    hazards_discussed text,
    controls_discussed text,
    ppe_required text,
    emergency_procedures text,
    attendees jsonb DEFAULT '[]'::jsonb,
    signed_by text,
    signed_at timestamp with time zone,
    status text DEFAULT 'draft'::text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    topic text,
    facilitator text,
    department text,
    duration_min integer,
    actions_raised jsonb,
    key_points text,
    materials text,
    presenter_person_id uuid,
    attendee_person_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    CONSTRAINT toolbox_talks_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'completed'::text])))
);


--
-- Name: tools_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tools_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    ref_number text,
    category text NOT NULL,
    name text NOT NULL,
    description text,
    brand text,
    model text,
    serial_number text,
    location text,
    assigned_to uuid,
    assigned_to_name text,
    inspection_frequency text DEFAULT 'weekly'::text,
    requires_statutory boolean DEFAULT false,
    statutory_type text,
    last_statutory_date date,
    next_statutory_date date,
    statutory_body text,
    is_vehicle boolean DEFAULT false,
    registration_number text,
    status text DEFAULT 'active'::text,
    purchase_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tools_register_category_check CHECK ((category = ANY (ARRAY['hand_tool'::text, 'power_tool'::text, 'equipment'::text, 'vehicle'::text, 'lifting'::text, 'ppe'::text, 'electrical'::text, 'other'::text]))),
    CONSTRAINT tools_register_inspection_frequency_check CHECK ((inspection_frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'quarterly'::text, 'annual'::text, 'statutory'::text]))),
    CONSTRAINT tools_register_status_check CHECK ((status = ANY (ARRAY['active'::text, 'out_of_service'::text, 'under_maintenance'::text, 'disposed'::text])))
);


--
-- Name: training_followup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_followup (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_id uuid,
    person_name text,
    training_topic text NOT NULL,
    training_date date,
    trainer text,
    certificate text,
    expiry_date date,
    refresher_due date,
    score numeric,
    passed boolean,
    notes text,
    plan_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    person_name_snapshot text,
    organization_snapshot text,
    role_snapshot text
);


--
-- Name: training_needs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_needs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    role_name text NOT NULL,
    training_topic text NOT NULL,
    category text DEFAULT 'general'::text,
    requirement text DEFAULT 'D'::text,
    notes text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT training_needs_requirement_check CHECK ((requirement = ANY (ARRAY['M'::text, 'D'::text, 'N'::text])))
);


--
-- Name: training_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_plan (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    year integer DEFAULT EXTRACT(year FROM now()),
    month integer,
    training_topic text NOT NULL,
    target_group text,
    training_type text DEFAULT 'internal'::text,
    priority text DEFAULT 'medium'::text,
    objective text,
    status text DEFAULT 'planned'::text,
    trainer text,
    location text,
    duration_hours numeric,
    planned_date date,
    actual_date date,
    budget numeric,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT training_plan_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT training_plan_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'postponed'::text]))),
    CONSTRAINT training_plan_training_type_check CHECK ((training_type = ANY (ARRAY['internal'::text, 'external'::text, 'e-learning'::text, 'on-the-job'::text])))
);


--
-- Name: training_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    role_name text,
    job_title text,
    department text,
    training_title text NOT NULL,
    training_code text,
    mandatory boolean DEFAULT true NOT NULL,
    validity_months integer,
    refresher_months integer,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    course text NOT NULL,
    trainer text,
    date_conducted date,
    expiry_date date,
    attendees text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    recipient_profile_id uuid NOT NULL,
    source_notification_id uuid NOT NULL,
    event_type text DEFAULT 'system'::text NOT NULL,
    severity text DEFAULT 'normal'::text NOT NULL,
    title text NOT NULL,
    message text,
    related_module text,
    related_table text,
    related_id uuid,
    related_ref text,
    record_url text,
    acknowledgement_required boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    acknowledged_by uuid,
    dismissed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledgement_due_at timestamp with time zone,
    acknowledgement_overdue_at timestamp with time zone,
    acknowledgement_reminder_count integer DEFAULT 0 NOT NULL,
    acknowledgement_last_reminded_at timestamp with time zone,
    CONSTRAINT user_notifications_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])))
);


--
-- Name: TABLE user_notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_notifications IS 'Recipient-private in-app inbox derived from governed notification queue records.';


--
-- Name: user_site_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_site_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id uuid,
    site_id uuid,
    role_override text,
    access_level text DEFAULT 'read_write'::text,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now()
);


--
-- Name: vaccination_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vaccination_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    person_id uuid,
    employee_name text NOT NULL,
    department text,
    vaccine_name text NOT NULL,
    vaccine_type text DEFAULT 'occupational'::text,
    dose_number integer DEFAULT 1,
    total_doses_required integer DEFAULT 1,
    vaccination_date date NOT NULL,
    next_dose_date date,
    expiry_date date,
    administered_by text,
    clinic text,
    batch_number text,
    status text DEFAULT 'completed'::text,
    reaction_noted boolean DEFAULT false,
    reaction_details text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT vaccination_records_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'declined'::text, 'overdue'::text, 'not_applicable'::text]))),
    CONSTRAINT vaccination_records_vaccine_type_check CHECK ((vaccine_type = ANY (ARRAY['occupational'::text, 'travel'::text, 'routine'::text, 'pandemic'::text, 'other'::text])))
);


--
-- Name: vehicle_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vehicle_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: waste_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waste_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    record_date date NOT NULL,
    waste_type text NOT NULL,
    category text DEFAULT 'general'::text,
    quantity numeric NOT NULL,
    unit text DEFAULT 'kg'::text,
    disposal_method text,
    disposal_contractor text,
    manifest_number text,
    location text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT waste_records_category_check CHECK ((category = ANY (ARRAY['general'::text, 'recyclable'::text, 'hazardous'::text, 'organic'::text, 'electronic'::text, 'construction'::text, 'medical'::text, 'other'::text]))),
    CONSTRAINT waste_records_unit_check CHECK ((unit = ANY (ARRAY['kg'::text, 'tonnes'::text, 'litres'::text, 'm3'::text, 'units'::text, 'bags'::text])))
);


--
-- Name: water_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.water_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    record_date date NOT NULL,
    source text DEFAULT 'mains'::text,
    meter_id text,
    meter_reading_start numeric,
    meter_reading_end numeric,
    quantity numeric NOT NULL,
    unit text DEFAULT 'litres'::text,
    purpose text,
    location text,
    cost numeric,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT water_usage_source_check CHECK ((source = ANY (ARRAY['mains'::text, 'borehole'::text, 'rainwater'::text, 'river'::text, 'recycled'::text, 'other'::text]))),
    CONSTRAINT water_usage_unit_check CHECK ((unit = ANY (ARRAY['litres'::text, 'm3'::text, 'gallons'::text])))
);


--
-- Name: whatsapp_channel_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_channel_settings (
    company_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    provider text DEFAULT 'meta_cloud'::text NOT NULL,
    phone_number_id text,
    alert_template_name text DEFAULT 'auris360_alert'::text NOT NULL,
    template_language text DEFAULT 'en'::text NOT NULL,
    minimum_escalation_level integer DEFAULT 2 NOT NULL,
    allow_preferred_high_priority boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT whatsapp_channel_settings_minimum_escalation_level_check CHECK (((minimum_escalation_level >= 0) AND (minimum_escalation_level <= 3))),
    CONSTRAINT whatsapp_channel_settings_provider_check CHECK ((provider = 'meta_cloud'::text))
);


--
-- Name: whatsapp_consent_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_consent_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    event_type text NOT NULL,
    phone_snapshot text,
    consent_version text DEFAULT '2026-08'::text NOT NULL,
    source text DEFAULT 'user_profile'::text NOT NULL,
    actor_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_consent_events_event_type_check CHECK ((event_type = ANY (ARRAY['opted_in'::text, 'opted_out'::text, 'phone_changed'::text])))
);


--
-- Name: TABLE whatsapp_consent_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_consent_events IS 'Append-only evidence of user-controlled WhatsApp consent changes.';


--
-- Name: work_order_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    ref_number text,
    title text NOT NULL,
    description text,
    work_type text DEFAULT 'maintenance'::text,
    location text,
    department text,
    priority text DEFAULT 'medium'::text,
    status text DEFAULT 'planned'::text,
    planned_start date,
    planned_end date,
    actual_start date,
    actual_end date,
    estimated_duration text,
    supervisor_id uuid,
    supervisor_name text,
    team_members text,
    risk_level text DEFAULT 'medium'::text,
    requires_permit boolean DEFAULT false,
    requires_ra boolean DEFAULT true,
    ra_ref text,
    permit_ref text,
    prestart_id uuid,
    site_inspection_id uuid,
    toolbox_talk_id uuid,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    risk_assessment_id uuid,
    permit_id uuid,
    CONSTRAINT work_schedule_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT work_schedule_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT work_schedule_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'approved'::text, 'in_progress'::text, 'on_hold'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT work_schedule_work_type_check CHECK ((work_type = ANY (ARRAY['maintenance'::text, 'construction'::text, 'inspection'::text, 'cleaning'::text, 'electrical'::text, 'mechanical'::text, 'civil'::text, 'other'::text])))
);


--
-- Name: action_digest_runs action_digest_runs_company_id_run_date_recipient_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_digest_runs
    ADD CONSTRAINT action_digest_runs_company_id_run_date_recipient_profile_id_key UNIQUE (company_id, run_date, recipient_profile_id);


--
-- Name: action_digest_runs action_digest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_digest_runs
    ADD CONSTRAINT action_digest_runs_pkey PRIMARY KEY (id);


--
-- Name: action_notification_escalation_state action_notification_escalatio_action_id_event_key_recipient_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_notification_escalation_state
    ADD CONSTRAINT action_notification_escalatio_action_id_event_key_recipient_key UNIQUE (action_id, event_key, recipient_email);


--
-- Name: action_notification_escalation_state action_notification_escalation_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_notification_escalation_state
    ADD CONSTRAINT action_notification_escalation_state_pkey PRIMARY KEY (id);


--
-- Name: action_tracker action_tracker_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_tracker
    ADD CONSTRAINT action_tracker_pkey PRIMARY KEY (id);


--
-- Name: approval_decisions approval_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decisions
    ADD CONSTRAINT approval_decisions_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: approval_workflow_steps approval_workflow_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_steps
    ADD CONSTRAINT approval_workflow_steps_pkey PRIMARY KEY (id);


--
-- Name: approval_workflow_steps approval_workflow_steps_workflow_id_step_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_steps
    ADD CONSTRAINT approval_workflow_steps_workflow_id_step_no_key UNIQUE (workflow_id, step_no);


--
-- Name: approval_workflows approval_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflows
    ADD CONSTRAINT approval_workflows_pkey PRIMARY KEY (id);


--
-- Name: atex_areas atex_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atex_areas
    ADD CONSTRAINT atex_areas_pkey PRIMARY KEY (id);


--
-- Name: audiometry_records audiometry_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audiometry_records
    ADD CONSTRAINT audiometry_records_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: audit_findings audit_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_findings
    ADD CONSTRAINT audit_findings_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions_log auth_sessions_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions_log
    ADD CONSTRAINT auth_sessions_log_pkey PRIMARY KEY (id);


--
-- Name: authorisations authorisations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authorisations
    ADD CONSTRAINT authorisations_pkey PRIMARY KEY (id);


--
-- Name: bbs_action_links bbs_action_links_company_id_action_id_theme_id_observation__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_action_links
    ADD CONSTRAINT bbs_action_links_company_id_action_id_theme_id_observation__key UNIQUE (company_id, action_id, theme_id, observation_id);


--
-- Name: bbs_action_links bbs_action_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_action_links
    ADD CONSTRAINT bbs_action_links_pkey PRIMARY KEY (id);


--
-- Name: bbs_audit_events bbs_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_audit_events
    ADD CONSTRAINT bbs_audit_events_pkey PRIMARY KEY (id);


--
-- Name: bbs_barriers bbs_barriers_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_barriers
    ADD CONSTRAINT bbs_barriers_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: bbs_barriers bbs_barriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_barriers
    ADD CONSTRAINT bbs_barriers_pkey PRIMARY KEY (id);


--
-- Name: bbs_behaviour_categories bbs_behaviour_categories_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_behaviour_categories
    ADD CONSTRAINT bbs_behaviour_categories_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: bbs_behaviour_categories bbs_behaviour_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_behaviour_categories
    ADD CONSTRAINT bbs_behaviour_categories_pkey PRIMARY KEY (id);


--
-- Name: bbs_behaviour_items bbs_behaviour_items_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_behaviour_items
    ADD CONSTRAINT bbs_behaviour_items_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: bbs_behaviour_items bbs_behaviour_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_behaviour_items
    ADD CONSTRAINT bbs_behaviour_items_pkey PRIMARY KEY (id);


--
-- Name: bbs_config_versions bbs_config_versions_company_id_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_config_versions
    ADD CONSTRAINT bbs_config_versions_company_id_version_no_key UNIQUE (company_id, version_no);


--
-- Name: bbs_config_versions bbs_config_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_config_versions
    ADD CONSTRAINT bbs_config_versions_pkey PRIMARY KEY (id);


--
-- Name: bbs_feedback bbs_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_feedback
    ADD CONSTRAINT bbs_feedback_pkey PRIMARY KEY (id);


--
-- Name: bbs_observation_barriers bbs_observation_barriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_barriers
    ADD CONSTRAINT bbs_observation_barriers_pkey PRIMARY KEY (id);


--
-- Name: bbs_observation_details bbs_observation_details_company_id_observation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_details
    ADD CONSTRAINT bbs_observation_details_company_id_observation_id_key UNIQUE (company_id, observation_id);


--
-- Name: bbs_observation_details bbs_observation_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_details
    ADD CONSTRAINT bbs_observation_details_pkey PRIMARY KEY (id);


--
-- Name: bbs_observation_responses bbs_observation_responses_company_id_observation_id_item_co_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_responses
    ADD CONSTRAINT bbs_observation_responses_company_id_observation_id_item_co_key UNIQUE (company_id, observation_id, item_code);


--
-- Name: bbs_observation_responses bbs_observation_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_responses
    ADD CONSTRAINT bbs_observation_responses_pkey PRIMARY KEY (id);


--
-- Name: bbs_programmes bbs_programmes_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_programmes
    ADD CONSTRAINT bbs_programmes_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: bbs_programmes bbs_programmes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_programmes
    ADD CONSTRAINT bbs_programmes_pkey PRIMARY KEY (id);


--
-- Name: bbs_quality_reviews bbs_quality_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_quality_reviews
    ADD CONSTRAINT bbs_quality_reviews_pkey PRIMARY KEY (id);


--
-- Name: bbs_recognitions bbs_recognitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_recognitions
    ADD CONSTRAINT bbs_recognitions_pkey PRIMARY KEY (id);


--
-- Name: bbs_report_definitions bbs_report_definitions_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_report_definitions
    ADD CONSTRAINT bbs_report_definitions_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: bbs_report_definitions bbs_report_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_report_definitions
    ADD CONSTRAINT bbs_report_definitions_pkey PRIMARY KEY (id);


--
-- Name: bbs_sensitive_access bbs_sensitive_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_sensitive_access
    ADD CONSTRAINT bbs_sensitive_access_pkey PRIMARY KEY (id);


--
-- Name: bbs_themes bbs_themes_company_id_signature_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_themes
    ADD CONSTRAINT bbs_themes_company_id_signature_key UNIQUE (company_id, signature);


--
-- Name: bbs_themes bbs_themes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_themes
    ADD CONSTRAINT bbs_themes_pkey PRIMARY KEY (id);


--
-- Name: bcp_records bcp_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bcp_records
    ADD CONSTRAINT bcp_records_pkey PRIMARY KEY (id);


--
-- Name: checklist_templates checklist_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_templates
    ADD CONSTRAINT checklist_templates_pkey PRIMARY KEY (id);


--
-- Name: chemical_inventory_events chemical_inventory_events_company_id_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_inventory_events
    ADD CONSTRAINT chemical_inventory_events_company_id_reference_key UNIQUE (company_id, reference);


--
-- Name: chemical_inventory_events chemical_inventory_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_inventory_events
    ADD CONSTRAINT chemical_inventory_events_pkey PRIMARY KEY (id);


--
-- Name: chemical_register chemical_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_register
    ADD CONSTRAINT chemical_register_pkey PRIMARY KEY (id);


--
-- Name: chemical_sds_versions chemical_sds_versions_company_id_chemical_id_file_name_revi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_sds_versions
    ADD CONSTRAINT chemical_sds_versions_company_id_chemical_id_file_name_revi_key UNIQUE (company_id, chemical_id, file_name, revision_date);


--
-- Name: chemical_sds_versions chemical_sds_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_sds_versions
    ADD CONSTRAINT chemical_sds_versions_pkey PRIMARY KEY (id);


--
-- Name: chemical_use_approvals chemical_use_approvals_company_id_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_use_approvals
    ADD CONSTRAINT chemical_use_approvals_company_id_reference_key UNIQUE (company_id, reference);


--
-- Name: chemical_use_approvals chemical_use_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_use_approvals
    ADD CONSTRAINT chemical_use_approvals_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_rollout_cohorts company_rollout_cohorts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_rollout_cohorts
    ADD CONSTRAINT company_rollout_cohorts_pkey PRIMARY KEY (company_id, cohort_key);


--
-- Name: company_settings company_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_pkey PRIMARY KEY (company_id);


--
-- Name: company_settings company_settings_subdomain_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_subdomain_slug_key UNIQUE (subdomain_slug);


--
-- Name: competencies competencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competencies
    ADD CONSTRAINT competencies_pkey PRIMARY KEY (id);


--
-- Name: competency_matrix competency_matrix_person_id_competency_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_matrix
    ADD CONSTRAINT competency_matrix_person_id_competency_id_key UNIQUE (person_id, competency_id);


--
-- Name: competency_matrix competency_matrix_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_matrix
    ADD CONSTRAINT competency_matrix_pkey PRIMARY KEY (id);


--
-- Name: compliance_assessments compliance_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_assessments
    ADD CONSTRAINT compliance_assessments_pkey PRIMARY KEY (id);


--
-- Name: compliance_audits compliance_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_audits
    ADD CONSTRAINT compliance_audits_pkey PRIMARY KEY (id);


--
-- Name: compliance_calendar compliance_calendar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_calendar
    ADD CONSTRAINT compliance_calendar_pkey PRIMARY KEY (id);


--
-- Name: compliance_gaps compliance_gaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_gaps
    ADD CONSTRAINT compliance_gaps_pkey PRIMARY KEY (id);


--
-- Name: contractor_assurance_profiles contractor_assurance_profiles_company_id_contractor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_assurance_profiles
    ADD CONSTRAINT contractor_assurance_profiles_company_id_contractor_id_key UNIQUE (company_id, contractor_id);


--
-- Name: contractor_assurance_profiles contractor_assurance_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_assurance_profiles
    ADD CONSTRAINT contractor_assurance_profiles_pkey PRIMARY KEY (id);


--
-- Name: contractor_authorisations contractor_authorisations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_authorisations
    ADD CONSTRAINT contractor_authorisations_pkey PRIMARY KEY (id);


--
-- Name: contractor_documents contractor_documents_company_id_contractor_id_scope_type_fi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_documents
    ADD CONSTRAINT contractor_documents_company_id_contractor_id_scope_type_fi_key UNIQUE (company_id, contractor_id, scope_type, file_reference, version_no);


--
-- Name: contractor_documents contractor_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_documents
    ADD CONSTRAINT contractor_documents_pkey PRIMARY KEY (id);


--
-- Name: contractor_evaluations contractor_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_evaluations
    ADD CONSTRAINT contractor_evaluations_pkey PRIMARY KEY (id);


--
-- Name: contractor_incidents contractor_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_incidents
    ADD CONSTRAINT contractor_incidents_pkey PRIMARY KEY (id);


--
-- Name: contractor_mobilisation_gates contractor_mobilisation_gates_company_id_work_package_id_ga_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_mobilisation_gates
    ADD CONSTRAINT contractor_mobilisation_gates_company_id_work_package_id_ga_key UNIQUE (company_id, work_package_id, gate_code);


--
-- Name: contractor_mobilisation_gates contractor_mobilisation_gates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_mobilisation_gates
    ADD CONSTRAINT contractor_mobilisation_gates_pkey PRIMARY KEY (id);


--
-- Name: contractor_preassessments contractor_preassessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_preassessments
    ADD CONSTRAINT contractor_preassessments_pkey PRIMARY KEY (id);


--
-- Name: contractor_work_packages contractor_work_packages_company_id_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_work_packages
    ADD CONSTRAINT contractor_work_packages_company_id_reference_key UNIQUE (company_id, reference);


--
-- Name: contractor_work_packages contractor_work_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_work_packages
    ADD CONSTRAINT contractor_work_packages_pkey PRIMARY KEY (id);


--
-- Name: contractors contractors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractors
    ADD CONSTRAINT contractors_pkey PRIMARY KEY (id);


--
-- Name: control_library control_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.control_library
    ADD CONSTRAINT control_library_pkey PRIMARY KEY (id);


--
-- Name: custom_field_values custom_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_pkey PRIMARY KEY (id);


--
-- Name: custom_field_values custom_field_values_record_table_record_id_field_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_record_table_record_id_field_id_key UNIQUE (record_table, record_id, field_id);


--
-- Name: custom_fields custom_fields_company_id_module_key_field_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_company_id_module_key_field_key_key UNIQUE (company_id, module_key, field_key);


--
-- Name: custom_fields custom_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_pkey PRIMARY KEY (id);


--
-- Name: doc_acknowledgements doc_acknowledgements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_acknowledgements
    ADD CONSTRAINT doc_acknowledgements_pkey PRIMARY KEY (id);


--
-- Name: doc_controlled_copies doc_controlled_copies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_controlled_copies
    ADD CONSTRAINT doc_controlled_copies_pkey PRIMARY KEY (id);


--
-- Name: doc_revisions doc_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_revisions
    ADD CONSTRAINT doc_revisions_pkey PRIMARY KEY (id);


--
-- Name: document_control_audit_events document_control_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_audit_events
    ADD CONSTRAINT document_control_audit_events_pkey PRIMARY KEY (id);


--
-- Name: document_control_config document_control_config_company_id_workspace_code_version_n_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_config
    ADD CONSTRAINT document_control_config_company_id_workspace_code_version_n_key UNIQUE (company_id, workspace, code, version_no);


--
-- Name: document_control_config document_control_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_config
    ADD CONSTRAINT document_control_config_pkey PRIMARY KEY (id);


--
-- Name: document_control_files document_control_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_files
    ADD CONSTRAINT document_control_files_pkey PRIMARY KEY (id);


--
-- Name: document_control_records document_control_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_records
    ADD CONSTRAINT document_control_records_pkey PRIMARY KEY (id);


--
-- Name: document_control_revisions document_control_revisions_company_id_document_id_revision__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_revisions
    ADD CONSTRAINT document_control_revisions_company_id_document_id_revision__key UNIQUE (company_id, document_id, revision_code, language_code, scope_type, scope_id);


--
-- Name: document_control_revisions document_control_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_revisions
    ADD CONSTRAINT document_control_revisions_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: elearning_courses elearning_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elearning_courses
    ADD CONSTRAINT elearning_courses_pkey PRIMARY KEY (id);


--
-- Name: elearning_enrolments elearning_enrolments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elearning_enrolments
    ADD CONSTRAINT elearning_enrolments_pkey PRIMARY KEY (id);


--
-- Name: elearning_quiz_attempts elearning_quiz_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elearning_quiz_attempts
    ADD CONSTRAINT elearning_quiz_attempts_pkey PRIMARY KEY (id);


--
-- Name: emergency_activations emergency_activations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_activations
    ADD CONSTRAINT emergency_activations_pkey PRIMARY KEY (id);


--
-- Name: emergency_drills emergency_drills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_drills
    ADD CONSTRAINT emergency_drills_pkey PRIMARY KEY (id);


--
-- Name: emergency_equipment emergency_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_equipment
    ADD CONSTRAINT emergency_equipment_pkey PRIMARY KEY (id);


--
-- Name: emergency_plans emergency_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_plans
    ADD CONSTRAINT emergency_plans_pkey PRIMARY KEY (id);


--
-- Name: engagement_activity_credits engagement_activity_credits_company_id_source_module_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_activity_credits
    ADD CONSTRAINT engagement_activity_credits_company_id_source_module_source_key UNIQUE (company_id, source_module, source_id, person_id);


--
-- Name: engagement_activity_credits engagement_activity_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_activity_credits
    ADD CONSTRAINT engagement_activity_credits_pkey PRIMARY KEY (id);


--
-- Name: engagement_assignments engagement_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_assignments
    ADD CONSTRAINT engagement_assignments_pkey PRIMARY KEY (id);


--
-- Name: engagement_audit_events engagement_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_audit_events
    ADD CONSTRAINT engagement_audit_events_pkey PRIMARY KEY (id);


--
-- Name: engagement_calendar_events engagement_calendar_events_company_id_source_module_source__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_calendar_events
    ADD CONSTRAINT engagement_calendar_events_company_id_source_module_source__key UNIQUE (company_id, source_module, source_id, person_id);


--
-- Name: engagement_calendar_events engagement_calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_calendar_events
    ADD CONSTRAINT engagement_calendar_events_pkey PRIMARY KEY (id);


--
-- Name: engagement_coaching_plans engagement_coaching_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_coaching_plans
    ADD CONSTRAINT engagement_coaching_plans_pkey PRIMARY KEY (id);


--
-- Name: engagement_configuration_records engagement_configuration_reco_company_id_record_type_code_v_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_configuration_records
    ADD CONSTRAINT engagement_configuration_reco_company_id_record_type_code_v_key UNIQUE (company_id, record_type, code, version_no);


--
-- Name: engagement_configuration_records engagement_configuration_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_configuration_records
    ADD CONSTRAINT engagement_configuration_records_pkey PRIMARY KEY (id);


--
-- Name: engagement_configuration_versions engagement_configuration_versions_company_id_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_configuration_versions
    ADD CONSTRAINT engagement_configuration_versions_company_id_version_no_key UNIQUE (company_id, version_no);


--
-- Name: engagement_configuration_versions engagement_configuration_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_configuration_versions
    ADD CONSTRAINT engagement_configuration_versions_pkey PRIMARY KEY (id);


--
-- Name: engagement_disputes engagement_disputes_company_id_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_disputes
    ADD CONSTRAINT engagement_disputes_company_id_reference_key UNIQUE (company_id, reference);


--
-- Name: engagement_disputes engagement_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_disputes
    ADD CONSTRAINT engagement_disputes_pkey PRIMARY KEY (id);


--
-- Name: engagement_kpi_definitions engagement_kpi_definitions_company_id_code_programme_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_kpi_definitions
    ADD CONSTRAINT engagement_kpi_definitions_company_id_code_programme_id_key UNIQUE (company_id, code, programme_id);


--
-- Name: engagement_kpi_definitions engagement_kpi_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_kpi_definitions
    ADD CONSTRAINT engagement_kpi_definitions_pkey PRIMARY KEY (id);


--
-- Name: engagement_mobile_drafts engagement_mobile_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_mobile_drafts
    ADD CONSTRAINT engagement_mobile_drafts_pkey PRIMARY KEY (id);


--
-- Name: engagement_mobile_installations engagement_mobile_installations_company_id_installation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_mobile_installations
    ADD CONSTRAINT engagement_mobile_installations_company_id_installation_id_key UNIQUE (company_id, installation_id);


--
-- Name: engagement_mobile_installations engagement_mobile_installations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_mobile_installations
    ADD CONSTRAINT engagement_mobile_installations_pkey PRIMARY KEY (id);


--
-- Name: engagement_notifications engagement_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_notifications
    ADD CONSTRAINT engagement_notifications_pkey PRIMARY KEY (id);


--
-- Name: engagement_person_results engagement_person_results_company_id_person_id_programme_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_person_results
    ADD CONSTRAINT engagement_person_results_company_id_person_id_programme_id_key UNIQUE (company_id, person_id, programme_id, period, revision_no);


--
-- Name: engagement_person_results engagement_person_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_person_results
    ADD CONSTRAINT engagement_person_results_pkey PRIMARY KEY (id);


--
-- Name: engagement_programmes engagement_programmes_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_programmes
    ADD CONSTRAINT engagement_programmes_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: engagement_programmes engagement_programmes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_programmes
    ADD CONSTRAINT engagement_programmes_pkey PRIMARY KEY (id);


--
-- Name: engagement_qr_sessions engagement_qr_sessions_company_id_session_ref_person_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_qr_sessions
    ADD CONSTRAINT engagement_qr_sessions_company_id_session_ref_person_id_key UNIQUE (company_id, session_ref, person_id);


--
-- Name: engagement_qr_sessions engagement_qr_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_qr_sessions
    ADD CONSTRAINT engagement_qr_sessions_pkey PRIMARY KEY (id);


--
-- Name: engagement_recognitions engagement_recognitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_recognitions
    ADD CONSTRAINT engagement_recognitions_pkey PRIMARY KEY (id);


--
-- Name: engagement_report_definitions engagement_report_definitions_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_report_definitions
    ADD CONSTRAINT engagement_report_definitions_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: engagement_report_definitions engagement_report_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_report_definitions
    ADD CONSTRAINT engagement_report_definitions_pkey PRIMARY KEY (id);


--
-- Name: engagement_review_templates engagement_review_templates_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_review_templates
    ADD CONSTRAINT engagement_review_templates_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: engagement_review_templates engagement_review_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_review_templates
    ADD CONSTRAINT engagement_review_templates_pkey PRIMARY KEY (id);


--
-- Name: engagement_seed_reconciliation engagement_seed_reconciliatio_company_id_entity_type_entity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_seed_reconciliation
    ADD CONSTRAINT engagement_seed_reconciliatio_company_id_entity_type_entity_key UNIQUE (company_id, entity_type, entity_id);


--
-- Name: engagement_seed_reconciliation engagement_seed_reconciliation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_seed_reconciliation
    ADD CONSTRAINT engagement_seed_reconciliation_pkey PRIMARY KEY (id);


--
-- Name: engagement_team_reviews engagement_team_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_team_reviews
    ADD CONSTRAINT engagement_team_reviews_pkey PRIMARY KEY (id);


--
-- Name: environmental_inspections environmental_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environmental_inspections
    ADD CONSTRAINT environmental_inspections_pkey PRIMARY KEY (id);


--
-- Name: equipment_assurance_profiles equipment_assurance_profiles_company_id_equipment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_assurance_profiles
    ADD CONSTRAINT equipment_assurance_profiles_company_id_equipment_id_key UNIQUE (company_id, equipment_id);


--
-- Name: equipment_assurance_profiles equipment_assurance_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_assurance_profiles
    ADD CONSTRAINT equipment_assurance_profiles_pkey PRIMARY KEY (id);


--
-- Name: equipment_assurance_records equipment_assurance_records_company_id_equipment_id_record__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_assurance_records
    ADD CONSTRAINT equipment_assurance_records_company_id_equipment_id_record__key UNIQUE (company_id, equipment_id, record_type, reference);


--
-- Name: equipment_assurance_records equipment_assurance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_assurance_records
    ADD CONSTRAINT equipment_assurance_records_pkey PRIMARY KEY (id);


--
-- Name: equipment_defects equipment_defects_company_id_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_defects
    ADD CONSTRAINT equipment_defects_company_id_reference_key UNIQUE (company_id, reference);


--
-- Name: equipment_defects equipment_defects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_defects
    ADD CONSTRAINT equipment_defects_pkey PRIMARY KEY (id);


--
-- Name: equipment_maintenance_events equipment_maintenance_events_company_id_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_maintenance_events
    ADD CONSTRAINT equipment_maintenance_events_company_id_reference_key UNIQUE (company_id, reference);


--
-- Name: equipment_maintenance_events equipment_maintenance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_maintenance_events
    ADD CONSTRAINT equipment_maintenance_events_pkey PRIMARY KEY (id);


--
-- Name: equipment_movements equipment_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_pkey PRIMARY KEY (id);


--
-- Name: ert_members ert_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ert_members
    ADD CONSTRAINT ert_members_pkey PRIMARY KEY (id);


--
-- Name: esg_targets esg_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.esg_targets
    ADD CONSTRAINT esg_targets_pkey PRIMARY KEY (id);


--
-- Name: event_sequence event_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_sequence
    ADD CONSTRAINT event_sequence_pkey PRIMARY KEY (company_id, year);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: exposure_monitoring exposure_monitoring_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exposure_monitoring
    ADD CONSTRAINT exposure_monitoring_pkey PRIMARY KEY (id);


--
-- Name: fire_certificates fire_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_certificates
    ADD CONSTRAINT fire_certificates_pkey PRIMARY KEY (id);


--
-- Name: fire_equipment fire_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_equipment
    ADD CONSTRAINT fire_equipment_pkey PRIMARY KEY (id);


--
-- Name: fire_inspection_findings fire_inspection_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_inspection_findings
    ADD CONSTRAINT fire_inspection_findings_pkey PRIMARY KEY (id);


--
-- Name: fire_inspections fire_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_inspections
    ADD CONSTRAINT fire_inspections_pkey PRIMARY KEY (id);


--
-- Name: fire_layout_symbols fire_layout_symbols_company_id_item_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_layout_symbols
    ADD CONSTRAINT fire_layout_symbols_company_id_item_type_key UNIQUE (company_id, item_type);


--
-- Name: fire_layout_symbols fire_layout_symbols_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_layout_symbols
    ADD CONSTRAINT fire_layout_symbols_pkey PRIMARY KEY (id);


--
-- Name: fire_layouts fire_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_layouts
    ADD CONSTRAINT fire_layouts_pkey PRIMARY KEY (id);


--
-- Name: fuel_consumption fuel_consumption_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_consumption
    ADD CONSTRAINT fuel_consumption_pkey PRIMARY KEY (id);


--
-- Name: hazard_library hazard_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hazard_library
    ADD CONSTRAINT hazard_library_pkey PRIMARY KEY (id);


--
-- Name: hazardous_waste hazardous_waste_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hazardous_waste
    ADD CONSTRAINT hazardous_waste_pkey PRIMARY KEY (id);


--
-- Name: hse_meetings hse_meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hse_meetings
    ADD CONSTRAINT hse_meetings_pkey PRIMARY KEY (id);


--
-- Name: incident_evidence incident_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_evidence
    ADD CONSTRAINT incident_evidence_pkey PRIMARY KEY (id);


--
-- Name: incident_mgmt_audit_events incident_mgmt_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_mgmt_audit_events
    ADD CONSTRAINT incident_mgmt_audit_events_pkey PRIMARY KEY (id);


--
-- Name: incident_mgmt_config_records incident_mgmt_config_records_company_id_workspace_code_vers_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_mgmt_config_records
    ADD CONSTRAINT incident_mgmt_config_records_company_id_workspace_code_vers_key UNIQUE (company_id, workspace, code, version_no);


--
-- Name: incident_mgmt_config_records incident_mgmt_config_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_mgmt_config_records
    ADD CONSTRAINT incident_mgmt_config_records_pkey PRIMARY KEY (id);


--
-- Name: incident_mgmt_records incident_mgmt_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_mgmt_records
    ADD CONSTRAINT incident_mgmt_records_pkey PRIMARY KEY (id);


--
-- Name: induction_records induction_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induction_records
    ADD CONSTRAINT induction_records_pkey PRIMARY KEY (id);


--
-- Name: inspection_actions inspection_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_actions
    ADD CONSTRAINT inspection_actions_pkey PRIMARY KEY (id);


--
-- Name: inspection_items inspection_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_items
    ADD CONSTRAINT inspection_items_pkey PRIMARY KEY (id);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: integration_sync_log integration_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_sync_log
    ADD CONSTRAINT integration_sync_log_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: inv_sequence inv_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inv_sequence
    ADD CONSTRAINT inv_sequence_pkey PRIMARY KEY (company_id, year);


--
-- Name: investigations investigations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investigations
    ADD CONSTRAINT investigations_pkey PRIMARY KEY (id);


--
-- Name: jsa_records jsa_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jsa_records
    ADD CONSTRAINT jsa_records_pkey PRIMARY KEY (id);


--
-- Name: kpi_config_audit kpi_config_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_config_audit
    ADD CONSTRAINT kpi_config_audit_pkey PRIMARY KEY (id);


--
-- Name: kpi_config_versions kpi_config_versions_company_id_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_config_versions
    ADD CONSTRAINT kpi_config_versions_company_id_version_no_key UNIQUE (company_id, version_no);


--
-- Name: kpi_config_versions kpi_config_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_config_versions
    ADD CONSTRAINT kpi_config_versions_pkey PRIMARY KEY (id);


--
-- Name: kpi_indicators kpi_indicators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_indicators
    ADD CONSTRAINT kpi_indicators_pkey PRIMARY KEY (id);


--
-- Name: kpi_monthly_data kpi_monthly_data_indicator_year_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_monthly_data
    ADD CONSTRAINT kpi_monthly_data_indicator_year_month_key UNIQUE (indicator_id, year, month);


--
-- Name: kpi_monthly_data kpi_monthly_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_monthly_data
    ADD CONSTRAINT kpi_monthly_data_pkey PRIMARY KEY (id);


--
-- Name: kpis kpis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis
    ADD CONSTRAINT kpis_pkey PRIMARY KEY (id);


--
-- Name: kpis_v2 kpis_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis_v2
    ADD CONSTRAINT kpis_v2_pkey PRIMARY KEY (id);


--
-- Name: learning_course_governance learning_course_governance_company_id_course_id_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_course_governance
    ADD CONSTRAINT learning_course_governance_company_id_course_id_version_no_key UNIQUE (company_id, course_id, version_no);


--
-- Name: learning_course_governance learning_course_governance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_course_governance
    ADD CONSTRAINT learning_course_governance_pkey PRIMARY KEY (id);


--
-- Name: learning_external_providers learning_external_providers_company_id_provider_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_external_providers
    ADD CONSTRAINT learning_external_providers_company_id_provider_name_key UNIQUE (company_id, provider_name);


--
-- Name: learning_external_providers learning_external_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_external_providers
    ADD CONSTRAINT learning_external_providers_pkey PRIMARY KEY (id);


--
-- Name: learning_practical_assessments learning_practical_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_practical_assessments
    ADD CONSTRAINT learning_practical_assessments_pkey PRIMARY KEY (id);


--
-- Name: learning_source_relationships learning_source_relationships_company_id_course_id_course_v_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_source_relationships
    ADD CONSTRAINT learning_source_relationships_company_id_course_id_course_v_key UNIQUE (company_id, course_id, course_version, related_module, related_record_id, relationship_type);


--
-- Name: learning_source_relationships learning_source_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_source_relationships
    ADD CONSTRAINT learning_source_relationships_pkey PRIMARY KEY (id);


--
-- Name: legal_changes legal_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_changes
    ADD CONSTRAINT legal_changes_pkey PRIMARY KEY (id);


--
-- Name: legal_compliance_records legal_compliance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_compliance_records
    ADD CONSTRAINT legal_compliance_records_pkey PRIMARY KEY (id);


--
-- Name: legal_compliance_relationships legal_compliance_relationship_company_id_requirement_id_rec_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_compliance_relationships
    ADD CONSTRAINT legal_compliance_relationship_company_id_requirement_id_rec_key UNIQUE (company_id, requirement_id, record_id, related_module, related_record_id, relationship_type);


--
-- Name: legal_compliance_relationships legal_compliance_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_compliance_relationships
    ADD CONSTRAINT legal_compliance_relationships_pkey PRIMARY KEY (id);


--
-- Name: legal_register legal_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_register
    ADD CONSTRAINT legal_register_pkey PRIMARY KEY (id);


--
-- Name: legal_requirements legal_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_requirements
    ADD CONSTRAINT legal_requirements_pkey PRIMARY KEY (id);


--
-- Name: legislative_changes legislative_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legislative_changes
    ADD CONSTRAINT legislative_changes_pkey PRIMARY KEY (id);


--
-- Name: location_identity_backfill_review location_identity_backfill_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_identity_backfill_review
    ADD CONSTRAINT location_identity_backfill_review_pkey PRIMARY KEY (id);


--
-- Name: location_identity_backfill_review location_identity_backfill_review_source_table_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_identity_backfill_review
    ADD CONSTRAINT location_identity_backfill_review_source_table_source_id_key UNIQUE (source_table, source_id);


--
-- Name: map_activity_log map_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.map_activity_log
    ADD CONSTRAINT map_activity_log_pkey PRIMARY KEY (id);


--
-- Name: map_source_backfill_review map_source_backfill_review_action_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.map_source_backfill_review
    ADD CONSTRAINT map_source_backfill_review_action_id_key UNIQUE (action_id);


--
-- Name: map_source_backfill_review map_source_backfill_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.map_source_backfill_review
    ADD CONSTRAINT map_source_backfill_review_pkey PRIMARY KEY (id);


--
-- Name: medical_surveillance medical_surveillance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_surveillance
    ADD CONSTRAINT medical_surveillance_pkey PRIMARY KEY (id);


--
-- Name: meeting_actions meeting_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_actions
    ADD CONSTRAINT meeting_actions_pkey PRIMARY KEY (id);


--
-- Name: meeting_series meeting_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_series
    ADD CONSTRAINT meeting_series_pkey PRIMARY KEY (id);


--
-- Name: moc_change_requests moc_change_requests_company_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moc_change_requests
    ADD CONSTRAINT moc_change_requests_company_ref_key UNIQUE (company_id, moc_ref);


--
-- Name: moc_change_requests moc_change_requests_legacy_action_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moc_change_requests
    ADD CONSTRAINT moc_change_requests_legacy_action_id_key UNIQUE (legacy_action_id);


--
-- Name: moc_change_requests moc_change_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moc_change_requests
    ADD CONSTRAINT moc_change_requests_pkey PRIMARY KEY (id);


--
-- Name: muster_points muster_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.muster_points
    ADD CONSTRAINT muster_points_pkey PRIMARY KEY (id);


--
-- Name: noise_measurements noise_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_measurements
    ADD CONSTRAINT noise_measurements_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_assessment_profiles noise_mgmt_assessment_profiles_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_assessment_profiles
    ADD CONSTRAINT noise_mgmt_assessment_profiles_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_assessment_profiles noise_mgmt_assessment_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_assessment_profiles
    ADD CONSTRAINT noise_mgmt_assessment_profiles_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_audit_events noise_mgmt_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_audit_events
    ADD CONSTRAINT noise_mgmt_audit_events_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_control_plans noise_mgmt_control_plans_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_control_plans
    ADD CONSTRAINT noise_mgmt_control_plans_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_control_plans noise_mgmt_control_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_control_plans
    ADD CONSTRAINT noise_mgmt_control_plans_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_exposure_assessments noise_mgmt_exposure_assessments_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_exposure_assessments
    ADD CONSTRAINT noise_mgmt_exposure_assessments_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_exposure_assessments noise_mgmt_exposure_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_exposure_assessments
    ADD CONSTRAINT noise_mgmt_exposure_assessments_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_field_surveys noise_mgmt_field_surveys_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_field_surveys
    ADD CONSTRAINT noise_mgmt_field_surveys_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_field_surveys noise_mgmt_field_surveys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_field_surveys
    ADD CONSTRAINT noise_mgmt_field_surveys_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_health_statuses noise_mgmt_health_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_health_statuses
    ADD CONSTRAINT noise_mgmt_health_statuses_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_hearing_protectors noise_mgmt_hearing_protectors_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_hearing_protectors
    ADD CONSTRAINT noise_mgmt_hearing_protectors_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_hearing_protectors noise_mgmt_hearing_protectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_hearing_protectors
    ADD CONSTRAINT noise_mgmt_hearing_protectors_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_instruments noise_mgmt_instruments_company_id_asset_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_instruments
    ADD CONSTRAINT noise_mgmt_instruments_company_id_asset_code_key UNIQUE (company_id, asset_code);


--
-- Name: noise_mgmt_instruments noise_mgmt_instruments_company_id_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_instruments
    ADD CONSTRAINT noise_mgmt_instruments_company_id_serial_number_key UNIQUE (company_id, serial_number);


--
-- Name: noise_mgmt_instruments noise_mgmt_instruments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_instruments
    ADD CONSTRAINT noise_mgmt_instruments_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_maps noise_mgmt_maps_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_maps
    ADD CONSTRAINT noise_mgmt_maps_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_maps noise_mgmt_maps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_maps
    ADD CONSTRAINT noise_mgmt_maps_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_measurement_plans noise_mgmt_measurement_plans_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_measurement_plans
    ADD CONSTRAINT noise_mgmt_measurement_plans_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_measurement_plans noise_mgmt_measurement_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_measurement_plans
    ADD CONSTRAINT noise_mgmt_measurement_plans_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_measurements noise_mgmt_measurements_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_measurements
    ADD CONSTRAINT noise_mgmt_measurements_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_measurements noise_mgmt_measurements_company_id_raw_file_checksum_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_measurements
    ADD CONSTRAINT noise_mgmt_measurements_company_id_raw_file_checksum_key UNIQUE (company_id, raw_file_checksum);


--
-- Name: noise_mgmt_measurements noise_mgmt_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_measurements
    ADD CONSTRAINT noise_mgmt_measurements_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_programmes noise_mgmt_programmes_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_programmes
    ADD CONSTRAINT noise_mgmt_programmes_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_programmes noise_mgmt_programmes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_programmes
    ADD CONSTRAINT noise_mgmt_programmes_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_reports noise_mgmt_reports_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_reports
    ADD CONSTRAINT noise_mgmt_reports_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_reports noise_mgmt_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_reports
    ADD CONSTRAINT noise_mgmt_reports_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_segs noise_mgmt_segs_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_segs
    ADD CONSTRAINT noise_mgmt_segs_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_segs noise_mgmt_segs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_segs
    ADD CONSTRAINT noise_mgmt_segs_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_sources noise_mgmt_sources_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_sources
    ADD CONSTRAINT noise_mgmt_sources_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_sources noise_mgmt_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_sources
    ADD CONSTRAINT noise_mgmt_sources_pkey PRIMARY KEY (id);


--
-- Name: noise_mgmt_tasks noise_mgmt_tasks_company_id_code_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_tasks
    ADD CONSTRAINT noise_mgmt_tasks_company_id_code_version_no_key UNIQUE (company_id, code, version_no);


--
-- Name: noise_mgmt_tasks noise_mgmt_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_tasks
    ADD CONSTRAINT noise_mgmt_tasks_pkey PRIMARY KEY (id);


--
-- Name: noise_surveys noise_surveys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_surveys
    ADD CONSTRAINT noise_surveys_pkey PRIMARY KEY (id);


--
-- Name: notification_acknowledgement_settings notification_acknowledgement_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_acknowledgement_settings
    ADD CONSTRAINT notification_acknowledgement_settings_pkey PRIMARY KEY (company_id);


--
-- Name: notification_escalation_recipients notification_escalation_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_escalation_recipients
    ADD CONSTRAINT notification_escalation_recipients_pkey PRIMARY KEY (id);


--
-- Name: notification_escalation_settings notification_escalation_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_escalation_settings
    ADD CONSTRAINT notification_escalation_settings_pkey PRIMARY KEY (company_id);


--
-- Name: notification_events notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_pkey PRIMARY KEY (id);


--
-- Name: notification_link_opens notification_link_opens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_link_opens
    ADD CONSTRAINT notification_link_opens_pkey PRIMARY KEY (notification_id);


--
-- Name: notification_queue notification_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_queue
    ADD CONSTRAINT notification_queue_pkey PRIMARY KEY (id);


--
-- Name: notification_queue notification_queue_workflow_relationship_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.notification_queue
    ADD CONSTRAINT notification_queue_workflow_relationship_check CHECK (((type = ANY (ARRAY['test_email'::text, 'system'::text])) OR ((NULLIF(TRIM(BOTH FROM related_module), ''::text) IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM related_table), ''::text) IS NOT NULL) AND (related_id IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM related_ref), ''::text) IS NOT NULL)))) NOT VALID;


--
-- Name: notification_settings notification_settings_company_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_settings
    ADD CONSTRAINT notification_settings_company_id_key UNIQUE (company_id);


--
-- Name: notification_settings notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_settings
    ADD CONSTRAINT notification_settings_pkey PRIMARY KEY (id);


--
-- Name: notification_user_preferences notification_user_preferences_company_id_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_user_preferences
    ADD CONSTRAINT notification_user_preferences_company_id_profile_id_key UNIQUE (company_id, profile_id);


--
-- Name: notification_user_preferences notification_user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_user_preferences
    ADD CONSTRAINT notification_user_preferences_pkey PRIMARY KEY (profile_id);


--
-- Name: objectives objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_pkey PRIMARY KEY (id);


--
-- Name: occupational_diseases occupational_diseases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.occupational_diseases
    ADD CONSTRAINT occupational_diseases_pkey PRIMARY KEY (id);


--
-- Name: oversight_log oversight_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oversight_log
    ADD CONSTRAINT oversight_log_pkey PRIMARY KEY (id);


--
-- Name: people_certifications people_certifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people_certifications
    ADD CONSTRAINT people_certifications_pkey PRIMARY KEY (id);


--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_pkey PRIMARY KEY (id);


--
-- Name: permit_activity_log permit_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_activity_log
    ADD CONSTRAINT permit_activity_log_pkey PRIMARY KEY (id);


--
-- Name: permits permits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permits
    ADD CONSTRAINT permits_pkey PRIMARY KEY (id);


--
-- Name: person_identity_backfill_review person_identity_backfill_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identity_backfill_review
    ADD CONSTRAINT person_identity_backfill_review_pkey PRIMARY KEY (id);


--
-- Name: person_identity_backfill_review person_identity_backfill_review_source_table_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identity_backfill_review
    ADD CONSTRAINT person_identity_backfill_review_source_table_source_id_key UNIQUE (source_table, source_id);


--
-- Name: person_identity_decisions person_identity_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identity_decisions
    ADD CONSTRAINT person_identity_decisions_pkey PRIMARY KEY (id);


--
-- Name: ppe_catalogue ppe_catalogue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_catalogue
    ADD CONSTRAINT ppe_catalogue_pkey PRIMARY KEY (id);


--
-- Name: ppe_inspections ppe_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_inspections
    ADD CONSTRAINT ppe_inspections_pkey PRIMARY KEY (id);


--
-- Name: ppe_issuance ppe_issuance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_issuance
    ADD CONSTRAINT ppe_issuance_pkey PRIMARY KEY (id);


--
-- Name: ppe_replacements ppe_replacements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_replacements
    ADD CONSTRAINT ppe_replacements_pkey PRIMARY KEY (id);


--
-- Name: prestart_inspections prestart_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prestart_inspections
    ADD CONSTRAINT prestart_inspections_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: push_delivery_jobs push_delivery_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_delivery_jobs
    ADD CONSTRAINT push_delivery_jobs_pkey PRIMARY KEY (id);


--
-- Name: push_delivery_jobs push_delivery_jobs_user_notification_id_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_delivery_jobs
    ADD CONSTRAINT push_delivery_jobs_user_notification_id_subscription_id_key UNIQUE (user_notification_id, subscription_id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: qr_registry qr_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_registry
    ADD CONSTRAINT qr_registry_pkey PRIMARY KEY (id);


--
-- Name: qr_registry qr_registry_qr_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_registry
    ADD CONSTRAINT qr_registry_qr_code_key UNIQUE (qr_code);


--
-- Name: ra_revisions ra_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ra_revisions
    ADD CONSTRAINT ra_revisions_pkey PRIMARY KEY (id);


--
-- Name: ra_sequence ra_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ra_sequence
    ADD CONSTRAINT ra_sequence_pkey PRIMARY KEY (company_id, ra_type, year);


--
-- Name: ra_templates ra_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ra_templates
    ADD CONSTRAINT ra_templates_pkey PRIMARY KEY (id);


--
-- Name: record_relationships record_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_relationships
    ADD CONSTRAINT record_relationships_pkey PRIMARY KEY (id);


--
-- Name: reference_identity_backfill_review reference_identity_backfill_r_source_table_source_id_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_identity_backfill_review
    ADD CONSTRAINT reference_identity_backfill_r_source_table_source_id_source_key UNIQUE (source_table, source_id, source_field);


--
-- Name: reference_identity_backfill_review reference_identity_backfill_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_identity_backfill_review
    ADD CONSTRAINT reference_identity_backfill_review_pkey PRIMARY KEY (id);


--
-- Name: relationship_module_registry relationship_module_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_module_registry
    ADD CONSTRAINT relationship_module_registry_pkey PRIMARY KEY (module_key, table_name);


--
-- Name: relationship_validation_runs relationship_validation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_validation_runs
    ADD CONSTRAINT relationship_validation_runs_pkey PRIMARY KEY (id);


--
-- Name: risk_assessment_items risk_assessment_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessment_items
    ADD CONSTRAINT risk_assessment_items_pkey PRIMARY KEY (id);


--
-- Name: risk_assessment_operational_records risk_assessment_operational_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessment_operational_records
    ADD CONSTRAINT risk_assessment_operational_records_pkey PRIMARY KEY (id);


--
-- Name: risk_assessment_relationships risk_assessment_relationships_company_id_risk_assessment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessment_relationships
    ADD CONSTRAINT risk_assessment_relationships_company_id_risk_assessment_id_key UNIQUE (company_id, risk_assessment_id, related_module, related_record_id, relationship_type);


--
-- Name: risk_assessment_relationships risk_assessment_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessment_relationships
    ADD CONSTRAINT risk_assessment_relationships_pkey PRIMARY KEY (id);


--
-- Name: risk_assessments risk_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessments
    ADD CONSTRAINT risk_assessments_pkey PRIMARY KEY (id);


--
-- Name: rollout_cohort_transitions rollout_cohort_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollout_cohort_transitions
    ADD CONSTRAINT rollout_cohort_transitions_pkey PRIMARY KEY (id);


--
-- Name: rollout_health_events rollout_health_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollout_health_events
    ADD CONSTRAINT rollout_health_events_pkey PRIMARY KEY (id);


--
-- Name: safety_alerts safety_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_alerts
    ADD CONSTRAINT safety_alerts_pkey PRIMARY KEY (id);


--
-- Name: safety_bulletins safety_bulletins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_bulletins
    ADD CONSTRAINT safety_bulletins_pkey PRIMARY KEY (id);


--
-- Name: safety_observations safety_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_observations
    ADD CONSTRAINT safety_observations_pkey PRIMARY KEY (id);


--
-- Name: security_sla_settings security_sla_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_sla_settings
    ADD CONSTRAINT security_sla_settings_pkey PRIMARY KEY (company_id);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: sop_documents sop_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_documents
    ADD CONSTRAINT sop_documents_pkey PRIMARY KEY (id);


--
-- Name: sop_video_evidence sop_video_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_evidence
    ADD CONSTRAINT sop_video_evidence_pkey PRIMARY KEY (id);


--
-- Name: sop_video_evidence sop_video_evidence_project_id_evidence_type_sequence_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_evidence
    ADD CONSTRAINT sop_video_evidence_project_id_evidence_type_sequence_no_key UNIQUE (project_id, evidence_type, sequence_no);


--
-- Name: sop_video_projects sop_video_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_projects
    ADD CONSTRAINT sop_video_projects_pkey PRIMARY KEY (id);


--
-- Name: sop_video_relationships sop_video_relationships_company_id_project_id_related_modul_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_relationships
    ADD CONSTRAINT sop_video_relationships_company_id_project_id_related_modul_key UNIQUE (company_id, project_id, related_module, related_record_id, relationship_type);


--
-- Name: sop_video_relationships sop_video_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_relationships
    ADD CONSTRAINT sop_video_relationships_pkey PRIMARY KEY (id);


--
-- Name: spill_reports spill_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spill_reports
    ADD CONSTRAINT spill_reports_pkey PRIMARY KEY (id);


--
-- Name: spirometry_records spirometry_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spirometry_records
    ADD CONSTRAINT spirometry_records_pkey PRIMARY KEY (id);


--
-- Name: swms_configuration_versions swms_configuration_versions_company_id_workspace_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swms_configuration_versions
    ADD CONSTRAINT swms_configuration_versions_company_id_workspace_version_no_key UNIQUE (company_id, workspace, version_no);


--
-- Name: swms_configuration_versions swms_configuration_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swms_configuration_versions
    ADD CONSTRAINT swms_configuration_versions_pkey PRIMARY KEY (id);


--
-- Name: swms_operational_records swms_operational_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swms_operational_records
    ADD CONSTRAINT swms_operational_records_pkey PRIMARY KEY (id);


--
-- Name: swms_relationships swms_relationships_company_id_swms_document_id_revision_cod_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swms_relationships
    ADD CONSTRAINT swms_relationships_company_id_swms_document_id_revision_cod_key UNIQUE (company_id, swms_document_id, revision_code, related_module, related_record_id, relationship_type);


--
-- Name: swms_relationships swms_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swms_relationships
    ADD CONSTRAINT swms_relationships_pkey PRIMARY KEY (id);


--
-- Name: tool_checklist_templates tct_cat_item_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_checklist_templates
    ADD CONSTRAINT tct_cat_item_unique UNIQUE (category, check_item);


--
-- Name: tool_checklist_templates tool_checklist_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_checklist_templates
    ADD CONSTRAINT tool_checklist_templates_pkey PRIMARY KEY (id);


--
-- Name: tool_inspections tool_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_inspections
    ADD CONSTRAINT tool_inspections_pkey PRIMARY KEY (id);


--
-- Name: toolbox_talks toolbox_talks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toolbox_talks
    ADD CONSTRAINT toolbox_talks_pkey PRIMARY KEY (id);


--
-- Name: tools_register tools_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tools_register
    ADD CONSTRAINT tools_register_pkey PRIMARY KEY (id);


--
-- Name: tools_register tools_register_ref_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tools_register
    ADD CONSTRAINT tools_register_ref_number_key UNIQUE (ref_number);


--
-- Name: training_followup training_followup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_followup
    ADD CONSTRAINT training_followup_pkey PRIMARY KEY (id);


--
-- Name: training_needs training_needs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_needs
    ADD CONSTRAINT training_needs_pkey PRIMARY KEY (id);


--
-- Name: training_plan training_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_plan
    ADD CONSTRAINT training_plan_pkey PRIMARY KEY (id);


--
-- Name: training_requirements training_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_requirements
    ADD CONSTRAINT training_requirements_pkey PRIMARY KEY (id);


--
-- Name: training_sessions training_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_sessions
    ADD CONSTRAINT training_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_notifications user_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_pkey PRIMARY KEY (id);


--
-- Name: user_notifications user_notifications_source_notification_id_recipient_profile_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_source_notification_id_recipient_profile_key UNIQUE (source_notification_id, recipient_profile_id);


--
-- Name: user_site_access user_site_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_site_access
    ADD CONSTRAINT user_site_access_pkey PRIMARY KEY (id);


--
-- Name: user_site_access user_site_access_user_id_site_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_site_access
    ADD CONSTRAINT user_site_access_user_id_site_id_key UNIQUE (user_id, site_id);


--
-- Name: vaccination_records vaccination_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaccination_records
    ADD CONSTRAINT vaccination_records_pkey PRIMARY KEY (id);


--
-- Name: waste_records waste_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_records
    ADD CONSTRAINT waste_records_pkey PRIMARY KEY (id);


--
-- Name: water_usage water_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.water_usage
    ADD CONSTRAINT water_usage_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_channel_settings whatsapp_channel_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_channel_settings
    ADD CONSTRAINT whatsapp_channel_settings_pkey PRIMARY KEY (company_id);


--
-- Name: whatsapp_consent_events whatsapp_consent_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_consent_events
    ADD CONSTRAINT whatsapp_consent_events_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_delivery_jobs whatsapp_delivery_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_delivery_jobs
    ADD CONSTRAINT whatsapp_delivery_jobs_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_delivery_jobs whatsapp_delivery_jobs_user_notification_id_recipient_profi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_delivery_jobs
    ADD CONSTRAINT whatsapp_delivery_jobs_user_notification_id_recipient_profi_key UNIQUE (user_notification_id, recipient_profile_id);


--
-- Name: work_schedule work_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_schedule
    ADD CONSTRAINT work_schedule_pkey PRIMARY KEY (id);


--
-- Name: action_notification_escalation_company_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_notification_escalation_company_time ON public.action_notification_escalation_state USING btree (company_id, processed_at DESC);


--
-- Name: bbs_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bbs_audit_entity ON public.bbs_audit_events USING btree (company_id, entity_type, entity_id, created_at DESC);


--
-- Name: bbs_details_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bbs_details_company_status ON public.bbs_observation_details USING btree (company_id, workflow_status, submitted_at);


--
-- Name: bbs_details_observation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bbs_details_observation ON public.bbs_observation_details USING btree (company_id, observation_id);


--
-- Name: bbs_programmes_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bbs_programmes_company_status ON public.bbs_programmes USING btree (company_id, status, start_date);


--
-- Name: bbs_responses_observation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bbs_responses_observation ON public.bbs_observation_responses USING btree (company_id, observation_id, result);


--
-- Name: bbs_reviews_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bbs_reviews_queue ON public.bbs_quality_reviews USING btree (company_id, decision, created_at);


--
-- Name: bbs_sensitive_access_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bbs_sensitive_access_lookup ON public.bbs_sensitive_access USING btree (company_id, object_type, object_id, created_at DESC);


--
-- Name: bbs_themes_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bbs_themes_company_status ON public.bbs_themes USING btree (company_id, status, criticality);


--
-- Name: chemical_inventory_trace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chemical_inventory_trace ON public.chemical_inventory_events USING btree (company_id, chemical_id, event_date DESC, event_type);


--
-- Name: chemical_sds_review_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chemical_sds_review_queue ON public.chemical_sds_versions USING btree (company_id, validation_status, revision_date DESC);


--
-- Name: chemical_use_scope_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chemical_use_scope_queue ON public.chemical_use_approvals USING btree (company_id, status, review_date, chemical_id);


--
-- Name: contractor_assurance_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contractor_assurance_queue ON public.contractor_assurance_profiles USING btree (company_id, decision_status, risk_tier, valid_until);


--
-- Name: contractor_document_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contractor_document_queue ON public.contractor_documents USING btree (company_id, review_status, expiry_date, contractor_id);


--
-- Name: contractor_mobilisation_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contractor_mobilisation_queue ON public.contractor_mobilisation_gates USING btree (company_id, work_package_id, status, critical);


--
-- Name: contractor_package_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contractor_package_queue ON public.contractor_work_packages USING btree (company_id, status, planned_start, contractor_id);


--
-- Name: document_control_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_control_audit_entity ON public.document_control_audit_events USING btree (company_id, entity_type, entity_id, created_at DESC);


--
-- Name: document_control_config_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_control_config_workspace ON public.document_control_config USING btree (company_id, workspace, status, effective_from);


--
-- Name: document_control_file_revision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_control_file_revision ON public.document_control_files USING btree (company_id, document_id, revision_id, file_role);


--
-- Name: document_control_one_effective_revision; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_control_one_effective_revision ON public.document_control_revisions USING btree (company_id, document_id, language_code, scope_type, COALESCE(scope_id, ''::text)) WHERE ((status = 'effective'::text) AND (effective_to IS NULL));


--
-- Name: document_control_record_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_control_record_document ON public.document_control_records USING btree (company_id, document_id, revision_id, record_type);


--
-- Name: document_control_record_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_control_record_idempotency ON public.document_control_records USING btree (company_id, record_type, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: document_control_record_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_control_record_queue ON public.document_control_records USING btree (company_id, record_type, status, due_date);


--
-- Name: document_control_revision_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_control_revision_lookup ON public.document_control_revisions USING btree (company_id, document_id, created_at DESC);


--
-- Name: elearning_quiz_attempts_enrolment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX elearning_quiz_attempts_enrolment_idx ON public.elearning_quiz_attempts USING btree (company_id, enrolment_id, completed_at DESC);


--
-- Name: engagement_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_audit_entity ON public.engagement_audit_events USING btree (company_id, entity_type, entity_id, created_at DESC);


--
-- Name: engagement_calendar_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_calendar_person ON public.engagement_calendar_events USING btree (company_id, person_id, start_at);


--
-- Name: engagement_configuration_records_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_configuration_records_type ON public.engagement_configuration_records USING btree (company_id, record_type, status);


--
-- Name: engagement_credits_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_credits_queue ON public.engagement_activity_credits USING btree (company_id, status, submitted_at);


--
-- Name: engagement_disputes_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_disputes_queue ON public.engagement_disputes USING btree (company_id, status, submitted_at);


--
-- Name: engagement_mobile_drafts_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_mobile_drafts_owner ON public.engagement_mobile_drafts USING btree (company_id, owner_id, state);


--
-- Name: engagement_notifications_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_notifications_person ON public.engagement_notifications USING btree (company_id, recipient_id, created_at DESC);


--
-- Name: engagement_one_active_team_review; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX engagement_one_active_team_review ON public.engagement_team_reviews USING btree (company_id, period, COALESCE(team_id, team_name)) WHERE (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'returned'::text, 'approved'::text, 'locked'::text, 'reopened'::text]));


--
-- Name: engagement_one_published_config; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX engagement_one_published_config ON public.engagement_configuration_versions USING btree (company_id) WHERE (status = 'published'::text);


--
-- Name: engagement_report_definitions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_report_definitions_status ON public.engagement_report_definitions USING btree (company_id, status);


--
-- Name: engagement_results_company_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_results_company_period ON public.engagement_person_results USING btree (company_id, period, status);


--
-- Name: engagement_team_reviews_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_team_reviews_period ON public.engagement_team_reviews USING btree (company_id, period, status);


--
-- Name: equipment_assurance_profile_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX equipment_assurance_profile_queue ON public.equipment_assurance_profiles USING btree (company_id, acceptance_status, criticality, review_due);


--
-- Name: equipment_assurance_record_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX equipment_assurance_record_queue ON public.equipment_assurance_records USING btree (company_id, record_type, validation_status, next_due_date);


--
-- Name: equipment_defect_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX equipment_defect_queue ON public.equipment_defects USING btree (company_id, status, severity, equipment_id);


--
-- Name: equipment_maintenance_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX equipment_maintenance_queue ON public.equipment_maintenance_events USING btree (company_id, status, planned_date, equipment_id);


--
-- Name: equipment_movement_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX equipment_movement_queue ON public.equipment_movements USING btree (company_id, equipment_id, status, expected_return_at);


--
-- Name: idx_action_tracker_company_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_tracker_company_ref ON public.action_tracker USING btree (company_id, action_ref) WHERE (action_ref IS NOT NULL);


--
-- Name: idx_action_tracker_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_tracker_company_status ON public.action_tracker USING btree (company_id, status);


--
-- Name: idx_action_tracker_company_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_tracker_company_target ON public.action_tracker USING btree (company_id, target_date);


--
-- Name: idx_action_tracker_location_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_tracker_location_identity ON public.action_tracker USING btree (company_id, site_id, area_id);


--
-- Name: idx_action_tracker_source_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_tracker_source_record ON public.action_tracker USING btree (company_id, source_module, source_id) WHERE (source_id IS NOT NULL);


--
-- Name: idx_approval_requests_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_company_status ON public.approval_requests USING btree (company_id, status, created_at DESC);


--
-- Name: idx_atex_areas_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atex_areas_company ON public.atex_areas USING btree (company_id);


--
-- Name: idx_atex_areas_next_inspection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atex_areas_next_inspection ON public.atex_areas USING btree (next_inspection_date);


--
-- Name: idx_atex_areas_verified_refs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atex_areas_verified_refs ON public.atex_areas USING btree (company_id, linked_ra_id, linked_permit_id);


--
-- Name: idx_atex_areas_zone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atex_areas_zone ON public.atex_areas USING btree (zone_type);


--
-- Name: idx_audit_events_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_company_created ON public.audit_events USING btree (company_id, created_at DESC);


--
-- Name: idx_audit_events_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_contract ON public.audit_events USING btree (company_id, event_code, created_at DESC);


--
-- Name: idx_audit_events_correlation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_correlation ON public.audit_events USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);


--
-- Name: idx_audit_events_related; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_related ON public.audit_events USING btree (related_table, related_id);


--
-- Name: idx_audit_events_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_relationship ON public.audit_events USING btree (relationship_id, created_at DESC) WHERE (relationship_id IS NOT NULL);


--
-- Name: idx_chemical_register_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chemical_register_company ON public.chemical_register USING btree (company_id);


--
-- Name: idx_chemical_register_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chemical_register_product ON public.chemical_register USING btree (company_id, product_name);


--
-- Name: idx_chemical_register_risk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chemical_register_risk ON public.chemical_register USING btree (company_id, risk_level);


--
-- Name: idx_compliance_assessments_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_assessments_company ON public.compliance_assessments USING btree (company_id);


--
-- Name: idx_compliance_calendar_company_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_calendar_company_due ON public.compliance_calendar USING btree (company_id, due_date);


--
-- Name: idx_compliance_calendar_verified_refs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_calendar_verified_refs ON public.compliance_calendar USING btree (company_id, legal_requirement_id, linked_action_id);


--
-- Name: idx_compliance_gaps_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_gaps_company_status ON public.compliance_gaps USING btree (company_id, status);


--
-- Name: idx_custom_field_values_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_field_values_record ON public.custom_field_values USING btree (record_table, record_id);


--
-- Name: idx_custom_fields_company_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_fields_company_module ON public.custom_fields USING btree (company_id, module_key, active, sort_order);


--
-- Name: idx_documents_verified_refs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_verified_refs ON public.documents USING btree (company_id, linked_risk_assessment_id, linked_permit_id);


--
-- Name: idx_events_location_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_location_identity ON public.events USING btree (company_id, site_id, area_id);


--
-- Name: idx_fire_layout_symbols_company_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fire_layout_symbols_company_label ON public.fire_layout_symbols USING btree (company_id, label);


--
-- Name: idx_fire_layouts_company_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fire_layouts_company_type ON public.fire_layouts USING btree (company_id, layout_type);


--
-- Name: idx_fire_layouts_company_type_title; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fire_layouts_company_type_title ON public.fire_layouts USING btree (company_id, layout_type, title);


--
-- Name: idx_inspections_location_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspections_location_identity ON public.inspections USING btree (company_id, site_id, area_id);


--
-- Name: idx_kpi_config_audit_company_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_config_audit_company_time ON public.kpi_config_audit USING btree (company_id, created_at DESC);


--
-- Name: idx_kpi_config_company_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_config_company_version ON public.kpi_config_versions USING btree (company_id, version_no DESC);


--
-- Name: idx_kpi_config_one_published; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_kpi_config_one_published ON public.kpi_config_versions USING btree (company_id) WHERE (status = 'published'::text);


--
-- Name: idx_legal_changes_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_legal_changes_company ON public.legal_changes USING btree (company_id);


--
-- Name: idx_legal_requirements_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_legal_requirements_company ON public.legal_requirements USING btree (company_id);


--
-- Name: idx_legal_requirements_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_legal_requirements_status ON public.legal_requirements USING btree (company_id, status);


--
-- Name: idx_location_identity_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_identity_review_status ON public.location_identity_backfill_review USING btree (company_id, resolution_status, source_table);


--
-- Name: idx_map_activity_log_action_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_map_activity_log_action_time ON public.map_activity_log USING btree (action_id, performed_at DESC);


--
-- Name: idx_map_activity_log_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_map_activity_log_company ON public.map_activity_log USING btree (company_id);


--
-- Name: idx_map_source_backfill_review_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_map_source_backfill_review_company_status ON public.map_source_backfill_review USING btree (company_id, resolution_status);


--
-- Name: idx_moc_change_requests_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moc_change_requests_company_status ON public.moc_change_requests USING btree (company_id, lifecycle_status, updated_at DESC);


--
-- Name: idx_moc_change_requests_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moc_change_requests_owner ON public.moc_change_requests USING btree (company_id, owner_id, target_date);


--
-- Name: idx_notification_events_notification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_notification ON public.notification_events USING btree (notification_id, occurred_at DESC);


--
-- Name: idx_notification_events_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_relationship ON public.notification_events USING btree (company_id, related_table, related_id, occurred_at DESC);


--
-- Name: idx_notification_queue_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_queue_relationship ON public.notification_queue USING btree (company_id, related_table, related_id);


--
-- Name: idx_permits_location_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permits_location_identity ON public.permits USING btree (company_id, site_id, area_id);


--
-- Name: idx_permits_verified_refs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permits_verified_refs ON public.permits USING btree (company_id, risk_assessment_id, method_statement_id, work_order_id);


--
-- Name: idx_person_identity_decisions_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_person_identity_decisions_source ON public.person_identity_decisions USING btree (company_id, source_table, source_id, decided_at DESC);


--
-- Name: idx_person_identity_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_person_identity_review_status ON public.person_identity_backfill_review USING btree (company_id, resolution_status, source_table);


--
-- Name: idx_ppe_issuance_verified_refs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppe_issuance_verified_refs ON public.ppe_issuance USING btree (company_id, work_order_id, risk_assessment_id);


--
-- Name: idx_qr_registry_company_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_registry_company_module ON public.qr_registry USING btree (company_id, module_name);


--
-- Name: idx_reference_identity_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_identity_review_status ON public.reference_identity_backfill_review USING btree (company_id, resolution_status, source_table);


--
-- Name: idx_risk_assessments_location_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_assessments_location_identity ON public.risk_assessments USING btree (company_id, site_id, area_id);


--
-- Name: idx_safety_observations_location_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_safety_observations_location_identity ON public.safety_observations USING btree (company_id, site_id, area_id);


--
-- Name: idx_training_requirements_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_requirements_company ON public.training_requirements USING btree (company_id, role_name, job_title);


--
-- Name: idx_work_schedule_verified_refs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_schedule_verified_refs ON public.work_schedule USING btree (company_id, risk_assessment_id, permit_id);


--
-- Name: incident_mgmt_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incident_mgmt_audit_entity ON public.incident_mgmt_audit_events USING btree (company_id, entity_type, entity_id, created_at DESC);


--
-- Name: incident_mgmt_config_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incident_mgmt_config_workspace ON public.incident_mgmt_config_records USING btree (company_id, workspace, status, effective_from);


--
-- Name: incident_mgmt_records_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incident_mgmt_records_case ON public.incident_mgmt_records USING btree (company_id, incident_id, investigation_id, record_type, status);


--
-- Name: incident_mgmt_records_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incident_mgmt_records_due ON public.incident_mgmt_records USING btree (company_id, record_type, status, due_date);


--
-- Name: learning_course_governance_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_course_governance_queue ON public.learning_course_governance USING btree (company_id, lifecycle_status, risk_class, updated_at DESC);


--
-- Name: learning_external_provider_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_external_provider_status ON public.learning_external_providers USING btree (company_id, approved_status, accreditation_expiry);


--
-- Name: learning_practical_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_practical_queue ON public.learning_practical_assessments USING btree (company_id, status, result, scheduled_at);


--
-- Name: learning_practical_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX learning_practical_reference ON public.learning_practical_assessments USING btree (company_id, reference);


--
-- Name: learning_source_reverse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_source_reverse ON public.learning_source_relationships USING btree (company_id, related_module, related_record_id, impact_status);


--
-- Name: legal_compliance_one_requirement_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legal_compliance_one_requirement_profile ON public.legal_compliance_records USING btree (company_id, requirement_id) WHERE (record_type = 'requirement_profile'::text);


--
-- Name: legal_compliance_record_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_compliance_record_expiry ON public.legal_compliance_records USING btree (company_id, record_type, expiry_date) WHERE (expiry_date IS NOT NULL);


--
-- Name: legal_compliance_record_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legal_compliance_record_idempotency ON public.legal_compliance_records USING btree (company_id, record_type, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: legal_compliance_record_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_compliance_record_queue ON public.legal_compliance_records USING btree (company_id, record_type, status, assignee_id, due_date);


--
-- Name: legal_compliance_record_requirement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_compliance_record_requirement ON public.legal_compliance_records USING btree (company_id, requirement_id, record_type, created_at DESC);


--
-- Name: legal_compliance_relationship_related; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_compliance_relationship_related ON public.legal_compliance_relationships USING btree (company_id, related_module, related_record_id);


--
-- Name: legal_compliance_relationship_requirement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_compliance_relationship_requirement ON public.legal_compliance_relationships USING btree (company_id, requirement_id, relationship_type);


--
-- Name: noise_mgmt_assessments_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX noise_mgmt_assessments_company_status ON public.noise_mgmt_exposure_assessments USING btree (company_id, status, assessment_date DESC);


--
-- Name: noise_mgmt_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX noise_mgmt_audit_entity ON public.noise_mgmt_audit_events USING btree (company_id, entity_type, entity_id, created_at DESC);


--
-- Name: noise_mgmt_controls_company_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX noise_mgmt_controls_company_due ON public.noise_mgmt_control_plans USING btree (company_id, status, due_date);


--
-- Name: noise_mgmt_instruments_company_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX noise_mgmt_instruments_company_due ON public.noise_mgmt_instruments USING btree (company_id, status, calibration_due_date);


--
-- Name: noise_mgmt_measurements_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX noise_mgmt_measurements_company_status ON public.noise_mgmt_measurements USING btree (company_id, status, measurement_date DESC);


--
-- Name: notification_escalation_recipient_profile_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_escalation_recipient_profile_uq ON public.notification_escalation_recipients USING btree (company_id, escalation_level, profile_id) WHERE (profile_id IS NOT NULL);


--
-- Name: notification_link_opens_company_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_link_opens_company_time ON public.notification_link_opens USING btree (company_id, first_opened_at DESC);


--
-- Name: notification_queue_delivery_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_queue_delivery_due ON public.notification_queue USING btree (status, next_attempt_at, created_at) WHERE (status = 'pending'::text);


--
-- Name: notification_queue_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_queue_idempotency ON public.notification_queue USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: notification_queue_provider_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_queue_provider_message ON public.notification_queue USING btree (provider, provider_message_id) WHERE (provider_message_id IS NOT NULL);


--
-- Name: notification_queue_recipient_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_queue_recipient_profile ON public.notification_queue USING btree (company_id, recipient_profile_id, created_at DESC) WHERE (recipient_profile_id IS NOT NULL);


--
-- Name: push_delivery_jobs_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_delivery_jobs_due ON public.push_delivery_jobs USING btree (status, next_attempt_at, created_at) WHERE (status = 'pending'::text);


--
-- Name: push_subscriptions_recipient_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_recipient_active ON public.push_subscriptions USING btree (recipient_profile_id, enabled, last_seen_at DESC);


--
-- Name: record_relationships_canonical_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX record_relationships_canonical_unique ON public.record_relationships USING btree (company_id, relationship_type, endpoint_a, endpoint_b) WHERE (status <> 'archived'::text);


--
-- Name: record_relationships_source_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX record_relationships_source_lookup ON public.record_relationships USING btree (company_id, source_module, source_table, source_id, status);


--
-- Name: record_relationships_target_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX record_relationships_target_lookup ON public.record_relationships USING btree (company_id, target_module, target_table, target_id, status);


--
-- Name: record_relationships_validation_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX record_relationships_validation_queue ON public.record_relationships USING btree (company_id, status, last_validated_at) WHERE (status = ANY (ARRAY['unresolved'::text, 'broken'::text, 'pending_verification'::text]));


--
-- Name: relationship_validation_runs_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX relationship_validation_runs_company ON public.relationship_validation_runs USING btree (company_id, completed_at DESC);


--
-- Name: risk_assessment_one_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX risk_assessment_one_profile ON public.risk_assessment_operational_records USING btree (company_id, risk_assessment_id) WHERE (record_type = 'assessment_profile'::text);


--
-- Name: risk_assessment_record_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX risk_assessment_record_idempotency ON public.risk_assessment_operational_records USING btree (company_id, record_type, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: risk_assessment_record_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX risk_assessment_record_parent ON public.risk_assessment_operational_records USING btree (company_id, risk_assessment_id, record_type, created_at DESC);


--
-- Name: risk_assessment_record_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX risk_assessment_record_queue ON public.risk_assessment_operational_records USING btree (company_id, record_type, status, assignee_id, due_at);


--
-- Name: risk_assessment_relationship_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX risk_assessment_relationship_parent ON public.risk_assessment_relationships USING btree (company_id, risk_assessment_id, related_module);


--
-- Name: risk_assessment_relationship_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX risk_assessment_relationship_source ON public.risk_assessment_relationships USING btree (company_id, related_module, related_record_id);


--
-- Name: rollout_cohort_transitions_company_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rollout_cohort_transitions_company_time ON public.rollout_cohort_transitions USING btree (company_id, cohort_key, changed_at DESC);


--
-- Name: rollout_health_events_company_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rollout_health_events_company_time ON public.rollout_health_events USING btree (company_id, created_at DESC);


--
-- Name: rollout_health_events_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rollout_health_events_open ON public.rollout_health_events USING btree (company_id, event_type, severity) WHERE (resolved_at IS NULL);


--
-- Name: rollout_health_events_open_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rollout_health_events_open_fingerprint ON public.rollout_health_events USING btree (company_id, event_type, fingerprint) WHERE ((fingerprint IS NOT NULL) AND (resolved_at IS NULL));


--
-- Name: sop_video_evidence_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sop_video_evidence_project ON public.sop_video_evidence USING btree (company_id, project_id, sequence_no);


--
-- Name: sop_video_projects_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sop_video_projects_queue ON public.sop_video_projects USING btree (company_id, processing_status, due_at, created_at DESC);


--
-- Name: sop_video_relationships_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sop_video_relationships_source ON public.sop_video_relationships USING btree (company_id, related_module, related_record_id);


--
-- Name: swms_one_published_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX swms_one_published_workspace ON public.swms_configuration_versions USING btree (company_id, workspace) WHERE ((status = 'published'::text) AND (effective_to IS NULL));


--
-- Name: swms_operational_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX swms_operational_document ON public.swms_operational_records USING btree (company_id, swms_document_id, revision_code, record_type, created_at DESC);


--
-- Name: swms_operational_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX swms_operational_idempotency ON public.swms_operational_records USING btree (company_id, record_type, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: swms_operational_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX swms_operational_queue ON public.swms_operational_records USING btree (company_id, record_type, status, due_at);


--
-- Name: swms_relationship_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX swms_relationship_document ON public.swms_relationships USING btree (company_id, swms_document_id, revision_code, related_module);


--
-- Name: swms_relationship_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX swms_relationship_source ON public.swms_relationships USING btree (company_id, related_module, related_record_id);


--
-- Name: user_notifications_ack_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_notifications_ack_due ON public.user_notifications USING btree (acknowledgement_due_at) WHERE (acknowledgement_required AND (acknowledged_at IS NULL) AND (dismissed_at IS NULL));


--
-- Name: user_notifications_acknowledgement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_notifications_acknowledgement ON public.user_notifications USING btree (recipient_profile_id, created_at DESC) WHERE (acknowledgement_required AND (acknowledged_at IS NULL) AND (dismissed_at IS NULL));


--
-- Name: user_notifications_personal_inbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_notifications_personal_inbox ON public.user_notifications USING btree (recipient_profile_id, created_at DESC);


--
-- Name: user_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_notifications_unread ON public.user_notifications USING btree (recipient_profile_id, created_at DESC) WHERE ((read_at IS NULL) AND (dismissed_at IS NULL));


--
-- Name: whatsapp_consent_events_profile_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_consent_events_profile_time ON public.whatsapp_consent_events USING btree (profile_id, occurred_at DESC);


--
-- Name: whatsapp_delivery_jobs_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_delivery_jobs_due ON public.whatsapp_delivery_jobs USING btree (status, next_attempt_at, created_at) WHERE (status = 'pending'::text);


--
-- Name: whatsapp_delivery_jobs_provider_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_delivery_jobs_provider_message ON public.whatsapp_delivery_jobs USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL);


--
-- Name: companies companies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: company_rollout_cohorts company_rollout_cohort_transition_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER company_rollout_cohort_transition_audit AFTER INSERT OR UPDATE OF status ON public.company_rollout_cohorts FOR EACH ROW EXECUTE FUNCTION public.audit_rollout_cohort_transition();


--
-- Name: profiles profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: record_relationships record_relationships_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_relationships_validate BEFORE INSERT OR UPDATE OF company_id, source_module, source_table, source_id, target_module, target_table, target_id, status ON public.record_relationships FOR EACH ROW EXECUTE FUNCTION public.validate_record_relationship();


--
-- Name: sites sites_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sites_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: push_delivery_jobs trg_audit_push_delivery_job; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_push_delivery_job AFTER UPDATE OF status ON public.push_delivery_jobs FOR EACH ROW EXECUTE FUNCTION public.audit_push_delivery_job();


--
-- Name: user_notifications trg_audit_user_notification_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_user_notification_state AFTER UPDATE OF read_at, acknowledged_at ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION public.audit_user_notification_state();


--
-- Name: whatsapp_delivery_jobs trg_audit_whatsapp_delivery_job; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_whatsapp_delivery_job AFTER UPDATE OF status ON public.whatsapp_delivery_jobs FOR EACH ROW EXECUTE FUNCTION public.audit_whatsapp_delivery_job();


--
-- Name: notification_queue trg_capture_notification_attempt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_capture_notification_attempt AFTER UPDATE OF attempt_count ON public.notification_queue FOR EACH ROW EXECUTE FUNCTION public.capture_notification_attempt();


--
-- Name: notification_queue trg_capture_notification_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_capture_notification_event AFTER INSERT OR UPDATE OF status ON public.notification_queue FOR EACH ROW EXECUTE FUNCTION public.capture_notification_event();


--
-- Name: notification_queue trg_create_user_notification_from_queue; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_create_user_notification_from_queue AFTER INSERT ON public.notification_queue FOR EACH ROW EXECUTE FUNCTION public.create_user_notification_from_queue();


--
-- Name: custom_field_values trg_custom_field_values_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_custom_field_values_updated_at BEFORE UPDATE ON public.custom_field_values FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: custom_fields trg_custom_fields_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_custom_fields_updated_at BEFORE UPDATE ON public.custom_fields FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: user_notifications trg_enforce_user_notification_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_user_notification_state BEFORE UPDATE OF read_at, acknowledged_at, acknowledged_by ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION public.enforce_user_notification_state();


--
-- Name: moc_change_requests trg_moc_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_moc_touch_updated_at BEFORE UPDATE ON public.moc_change_requests FOR EACH ROW EXECUTE FUNCTION public.moc_touch_updated_at();


--
-- Name: action_tracker trg_notify_action; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_action AFTER INSERT OR UPDATE ON public.action_tracker FOR EACH ROW EXECUTE FUNCTION public.notify_action_assigned();


--
-- Name: events trg_notify_incident; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_incident AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION public.notify_new_incident();


--
-- Name: permits trg_notify_permit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_permit AFTER INSERT OR UPDATE ON public.permits FOR EACH ROW EXECUTE FUNCTION public.notify_permit_status();


--
-- Name: user_notifications trg_queue_push_delivery_jobs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_queue_push_delivery_jobs AFTER INSERT ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION public.queue_push_delivery_jobs();


--
-- Name: push_subscriptions trg_queue_recent_push_jobs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_queue_recent_push_jobs AFTER INSERT OR UPDATE OF enabled ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.queue_recent_push_jobs_for_subscription();


--
-- Name: user_notifications trg_queue_whatsapp_delivery_job; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_queue_whatsapp_delivery_job AFTER INSERT ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION public.queue_whatsapp_delivery_job();


--
-- Name: security_sla_settings trg_security_sla_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_security_sla_updated_at BEFORE UPDATE ON public.security_sla_settings FOR EACH ROW EXECUTE FUNCTION public.set_security_sla_updated_at();


--
-- Name: user_notifications trg_set_user_notification_ack_deadline; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_user_notification_ack_deadline BEFORE INSERT ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION public.set_user_notification_ack_deadline();


--
-- Name: user_notifications trg_stop_acknowledgement_followups; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stop_acknowledgement_followups AFTER UPDATE OF acknowledged_at ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION public.stop_acknowledgement_followups();


--
-- Name: action_tracker trg_stop_action_acknowledgement_followups; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stop_action_acknowledgement_followups AFTER UPDATE OF status ON public.action_tracker FOR EACH ROW EXECUTE FUNCTION public.stop_action_acknowledgement_followups();


--
-- Name: action_tracker trg_stop_action_notifications; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stop_action_notifications AFTER UPDATE OF status ON public.action_tracker FOR EACH ROW EXECUTE FUNCTION public.stop_action_notifications_on_terminal_state();


--
-- Name: action_digest_runs action_digest_runs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_digest_runs
    ADD CONSTRAINT action_digest_runs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: action_digest_runs action_digest_runs_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_digest_runs
    ADD CONSTRAINT action_digest_runs_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notification_queue(id) ON DELETE SET NULL;


--
-- Name: action_digest_runs action_digest_runs_recipient_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_digest_runs
    ADD CONSTRAINT action_digest_runs_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: action_notification_escalation_state action_notification_escalation_state_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_notification_escalation_state
    ADD CONSTRAINT action_notification_escalation_state_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.action_tracker(id) ON DELETE CASCADE;


--
-- Name: action_notification_escalation_state action_notification_escalation_state_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_notification_escalation_state
    ADD CONSTRAINT action_notification_escalation_state_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: action_notification_escalation_state action_notification_escalation_state_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_notification_escalation_state
    ADD CONSTRAINT action_notification_escalation_state_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notification_queue(id) ON DELETE SET NULL;


--
-- Name: action_tracker action_tracker_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_tracker
    ADD CONSTRAINT action_tracker_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.sites(id);


--
-- Name: action_tracker action_tracker_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_tracker
    ADD CONSTRAINT action_tracker_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: action_tracker action_tracker_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_tracker
    ADD CONSTRAINT action_tracker_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: action_tracker action_tracker_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_tracker
    ADD CONSTRAINT action_tracker_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: approval_decisions approval_decisions_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decisions
    ADD CONSTRAINT approval_decisions_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.approval_requests(id) ON DELETE CASCADE;


--
-- Name: approval_requests approval_requests_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.approval_workflows(id) ON DELETE SET NULL;


--
-- Name: approval_workflow_steps approval_workflow_steps_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_steps
    ADD CONSTRAINT approval_workflow_steps_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.approval_workflows(id) ON DELETE CASCADE;


--
-- Name: atex_areas atex_areas_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atex_areas
    ADD CONSTRAINT atex_areas_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: atex_areas atex_areas_linked_permit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atex_areas
    ADD CONSTRAINT atex_areas_linked_permit_id_fkey FOREIGN KEY (linked_permit_id) REFERENCES public.permits(id);


--
-- Name: atex_areas atex_areas_linked_ra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atex_areas
    ADD CONSTRAINT atex_areas_linked_ra_id_fkey FOREIGN KEY (linked_ra_id) REFERENCES public.risk_assessments(id);


--
-- Name: audiometry_records audiometry_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audiometry_records
    ADD CONSTRAINT audiometry_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: audiometry_records audiometry_records_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audiometry_records
    ADD CONSTRAINT audiometry_records_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: audit_findings audit_findings_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_findings
    ADD CONSTRAINT audit_findings_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: authorisations authorisations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authorisations
    ADD CONSTRAINT authorisations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: authorisations authorisations_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authorisations
    ADD CONSTRAINT authorisations_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: bbs_action_links bbs_action_links_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_action_links
    ADD CONSTRAINT bbs_action_links_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_action_links bbs_action_links_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_action_links
    ADD CONSTRAINT bbs_action_links_theme_id_fkey FOREIGN KEY (theme_id) REFERENCES public.bbs_themes(id) ON DELETE SET NULL;


--
-- Name: bbs_audit_events bbs_audit_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_audit_events
    ADD CONSTRAINT bbs_audit_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_barriers bbs_barriers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_barriers
    ADD CONSTRAINT bbs_barriers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_behaviour_categories bbs_behaviour_categories_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_behaviour_categories
    ADD CONSTRAINT bbs_behaviour_categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_behaviour_items bbs_behaviour_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_behaviour_items
    ADD CONSTRAINT bbs_behaviour_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.bbs_behaviour_categories(id);


--
-- Name: bbs_behaviour_items bbs_behaviour_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_behaviour_items
    ADD CONSTRAINT bbs_behaviour_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_config_versions bbs_config_versions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_config_versions
    ADD CONSTRAINT bbs_config_versions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_feedback bbs_feedback_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_feedback
    ADD CONSTRAINT bbs_feedback_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_observation_barriers bbs_observation_barriers_barrier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_barriers
    ADD CONSTRAINT bbs_observation_barriers_barrier_id_fkey FOREIGN KEY (barrier_id) REFERENCES public.bbs_barriers(id) ON DELETE SET NULL;


--
-- Name: bbs_observation_barriers bbs_observation_barriers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_barriers
    ADD CONSTRAINT bbs_observation_barriers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_observation_barriers bbs_observation_barriers_response_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_barriers
    ADD CONSTRAINT bbs_observation_barriers_response_id_fkey FOREIGN KEY (response_id) REFERENCES public.bbs_observation_responses(id) ON DELETE SET NULL;


--
-- Name: bbs_observation_details bbs_observation_details_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_details
    ADD CONSTRAINT bbs_observation_details_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_observation_details bbs_observation_details_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_details
    ADD CONSTRAINT bbs_observation_details_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.bbs_programmes(id);


--
-- Name: bbs_observation_responses bbs_observation_responses_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_responses
    ADD CONSTRAINT bbs_observation_responses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_observation_responses bbs_observation_responses_observation_detail_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_observation_responses
    ADD CONSTRAINT bbs_observation_responses_observation_detail_id_fkey FOREIGN KEY (observation_detail_id) REFERENCES public.bbs_observation_details(id) ON DELETE CASCADE;


--
-- Name: bbs_programmes bbs_programmes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_programmes
    ADD CONSTRAINT bbs_programmes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_quality_reviews bbs_quality_reviews_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_quality_reviews
    ADD CONSTRAINT bbs_quality_reviews_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_recognitions bbs_recognitions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_recognitions
    ADD CONSTRAINT bbs_recognitions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_report_definitions bbs_report_definitions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_report_definitions
    ADD CONSTRAINT bbs_report_definitions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_sensitive_access bbs_sensitive_access_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_sensitive_access
    ADD CONSTRAINT bbs_sensitive_access_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bbs_themes bbs_themes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bbs_themes
    ADD CONSTRAINT bbs_themes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: bcp_records bcp_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bcp_records
    ADD CONSTRAINT bcp_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: chemical_inventory_events chemical_inventory_events_chemical_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_inventory_events
    ADD CONSTRAINT chemical_inventory_events_chemical_id_fkey FOREIGN KEY (chemical_id) REFERENCES public.chemical_register(id) ON DELETE CASCADE;


--
-- Name: chemical_inventory_events chemical_inventory_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_inventory_events
    ADD CONSTRAINT chemical_inventory_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: chemical_sds_versions chemical_sds_versions_chemical_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_sds_versions
    ADD CONSTRAINT chemical_sds_versions_chemical_id_fkey FOREIGN KEY (chemical_id) REFERENCES public.chemical_register(id) ON DELETE CASCADE;


--
-- Name: chemical_sds_versions chemical_sds_versions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_sds_versions
    ADD CONSTRAINT chemical_sds_versions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: chemical_sds_versions chemical_sds_versions_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_sds_versions
    ADD CONSTRAINT chemical_sds_versions_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.chemical_sds_versions(id);


--
-- Name: chemical_use_approvals chemical_use_approvals_chemical_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_use_approvals
    ADD CONSTRAINT chemical_use_approvals_chemical_id_fkey FOREIGN KEY (chemical_id) REFERENCES public.chemical_register(id) ON DELETE CASCADE;


--
-- Name: chemical_use_approvals chemical_use_approvals_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_use_approvals
    ADD CONSTRAINT chemical_use_approvals_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: companies companies_parent_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_parent_company_id_fkey FOREIGN KEY (parent_company_id) REFERENCES public.companies(id);


--
-- Name: company_rollout_cohorts company_rollout_cohorts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_rollout_cohorts
    ADD CONSTRAINT company_rollout_cohorts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: competencies competencies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competencies
    ADD CONSTRAINT competencies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: competency_matrix competency_matrix_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_matrix
    ADD CONSTRAINT competency_matrix_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: competency_matrix competency_matrix_competency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_matrix
    ADD CONSTRAINT competency_matrix_competency_id_fkey FOREIGN KEY (competency_id) REFERENCES public.competencies(id) ON DELETE CASCADE;


--
-- Name: competency_matrix competency_matrix_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_matrix
    ADD CONSTRAINT competency_matrix_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: compliance_audits compliance_audits_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_audits
    ADD CONSTRAINT compliance_audits_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: compliance_calendar compliance_calendar_legal_requirement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_calendar
    ADD CONSTRAINT compliance_calendar_legal_requirement_id_fkey FOREIGN KEY (legal_requirement_id) REFERENCES public.legal_requirements(id);


--
-- Name: compliance_calendar compliance_calendar_linked_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_calendar
    ADD CONSTRAINT compliance_calendar_linked_action_id_fkey FOREIGN KEY (linked_action_id) REFERENCES public.action_tracker(id);


--
-- Name: contractor_assurance_profiles contractor_assurance_profiles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_assurance_profiles
    ADD CONSTRAINT contractor_assurance_profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: contractor_assurance_profiles contractor_assurance_profiles_contractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_assurance_profiles
    ADD CONSTRAINT contractor_assurance_profiles_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.contractors(id) ON DELETE CASCADE;


--
-- Name: contractor_authorisations contractor_authorisations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_authorisations
    ADD CONSTRAINT contractor_authorisations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: contractor_authorisations contractor_authorisations_contractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_authorisations
    ADD CONSTRAINT contractor_authorisations_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.contractors(id) ON DELETE CASCADE;


--
-- Name: contractor_authorisations contractor_authorisations_issued_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_authorisations
    ADD CONSTRAINT contractor_authorisations_issued_by_id_fkey FOREIGN KEY (issued_by_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: contractor_authorisations contractor_authorisations_permit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_authorisations
    ADD CONSTRAINT contractor_authorisations_permit_id_fkey FOREIGN KEY (permit_id) REFERENCES public.permits(id) ON DELETE SET NULL;


--
-- Name: contractor_authorisations contractor_authorisations_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_authorisations
    ADD CONSTRAINT contractor_authorisations_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_schedule(id) ON DELETE SET NULL;


--
-- Name: contractor_documents contractor_documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_documents
    ADD CONSTRAINT contractor_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: contractor_documents contractor_documents_contractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_documents
    ADD CONSTRAINT contractor_documents_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.contractors(id) ON DELETE CASCADE;


--
-- Name: contractor_documents contractor_documents_work_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_documents
    ADD CONSTRAINT contractor_documents_work_package_id_fkey FOREIGN KEY (work_package_id) REFERENCES public.contractor_work_packages(id) ON DELETE CASCADE;


--
-- Name: contractor_evaluations contractor_evaluations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_evaluations
    ADD CONSTRAINT contractor_evaluations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: contractor_evaluations contractor_evaluations_contractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_evaluations
    ADD CONSTRAINT contractor_evaluations_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.contractors(id) ON DELETE CASCADE;


--
-- Name: contractor_evaluations contractor_evaluations_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_evaluations
    ADD CONSTRAINT contractor_evaluations_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_schedule(id) ON DELETE SET NULL;


--
-- Name: contractor_incidents contractor_incidents_authorisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_incidents
    ADD CONSTRAINT contractor_incidents_authorisation_id_fkey FOREIGN KEY (authorisation_id) REFERENCES public.contractor_authorisations(id) ON DELETE SET NULL;


--
-- Name: contractor_incidents contractor_incidents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_incidents
    ADD CONSTRAINT contractor_incidents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: contractor_incidents contractor_incidents_contractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_incidents
    ADD CONSTRAINT contractor_incidents_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.contractors(id) ON DELETE CASCADE;


--
-- Name: contractor_incidents contractor_incidents_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_incidents
    ADD CONSTRAINT contractor_incidents_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_schedule(id) ON DELETE SET NULL;


--
-- Name: contractor_mobilisation_gates contractor_mobilisation_gates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_mobilisation_gates
    ADD CONSTRAINT contractor_mobilisation_gates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: contractor_mobilisation_gates contractor_mobilisation_gates_work_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_mobilisation_gates
    ADD CONSTRAINT contractor_mobilisation_gates_work_package_id_fkey FOREIGN KEY (work_package_id) REFERENCES public.contractor_work_packages(id) ON DELETE CASCADE;


--
-- Name: contractor_preassessments contractor_preassessments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_preassessments
    ADD CONSTRAINT contractor_preassessments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: contractor_preassessments contractor_preassessments_contractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_preassessments
    ADD CONSTRAINT contractor_preassessments_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.contractors(id) ON DELETE CASCADE;


--
-- Name: contractor_work_packages contractor_work_packages_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_work_packages
    ADD CONSTRAINT contractor_work_packages_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: contractor_work_packages contractor_work_packages_contractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractor_work_packages
    ADD CONSTRAINT contractor_work_packages_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.contractors(id) ON DELETE RESTRICT;


--
-- Name: contractors contractors_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contractors
    ADD CONSTRAINT contractors_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: control_library control_library_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.control_library
    ADD CONSTRAINT control_library_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: custom_field_values custom_field_values_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: custom_field_values custom_field_values_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.custom_fields(id) ON DELETE CASCADE;


--
-- Name: custom_fields custom_fields_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: custom_fields custom_fields_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: doc_acknowledgements doc_acknowledgements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_acknowledgements
    ADD CONSTRAINT doc_acknowledgements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: doc_acknowledgements doc_acknowledgements_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_acknowledgements
    ADD CONSTRAINT doc_acknowledgements_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: doc_acknowledgements doc_acknowledgements_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_acknowledgements
    ADD CONSTRAINT doc_acknowledgements_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: doc_controlled_copies doc_controlled_copies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_controlled_copies
    ADD CONSTRAINT doc_controlled_copies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: doc_controlled_copies doc_controlled_copies_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_controlled_copies
    ADD CONSTRAINT doc_controlled_copies_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: doc_revisions doc_revisions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_revisions
    ADD CONSTRAINT doc_revisions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: doc_revisions doc_revisions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_revisions
    ADD CONSTRAINT doc_revisions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_control_audit_events document_control_audit_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_audit_events
    ADD CONSTRAINT document_control_audit_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: document_control_config document_control_config_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_config
    ADD CONSTRAINT document_control_config_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: document_control_files document_control_files_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_files
    ADD CONSTRAINT document_control_files_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: document_control_records document_control_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_records
    ADD CONSTRAINT document_control_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: document_control_revisions document_control_revisions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_control_revisions
    ADD CONSTRAINT document_control_revisions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: documents documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: documents documents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: documents documents_linked_permit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_linked_permit_id_fkey FOREIGN KEY (linked_permit_id) REFERENCES public.permits(id);


--
-- Name: documents documents_linked_risk_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_linked_risk_assessment_id_fkey FOREIGN KEY (linked_risk_assessment_id) REFERENCES public.risk_assessments(id);


--
-- Name: elearning_enrolments elearning_enrolments_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elearning_enrolments
    ADD CONSTRAINT elearning_enrolments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.elearning_courses(id) ON DELETE CASCADE;


--
-- Name: elearning_enrolments elearning_enrolments_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elearning_enrolments
    ADD CONSTRAINT elearning_enrolments_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: elearning_quiz_attempts elearning_quiz_attempts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elearning_quiz_attempts
    ADD CONSTRAINT elearning_quiz_attempts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: emergency_activations emergency_activations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_activations
    ADD CONSTRAINT emergency_activations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: emergency_activations emergency_activations_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_activations
    ADD CONSTRAINT emergency_activations_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.emergency_plans(id) ON DELETE SET NULL;


--
-- Name: emergency_drills emergency_drills_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_drills
    ADD CONSTRAINT emergency_drills_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: emergency_equipment emergency_equipment_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_equipment
    ADD CONSTRAINT emergency_equipment_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: emergency_plans emergency_plans_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_plans
    ADD CONSTRAINT emergency_plans_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_activity_credits engagement_activity_credits_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_activity_credits
    ADD CONSTRAINT engagement_activity_credits_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_assignments engagement_assignments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_assignments
    ADD CONSTRAINT engagement_assignments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_assignments engagement_assignments_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_assignments
    ADD CONSTRAINT engagement_assignments_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.engagement_programmes(id);


--
-- Name: engagement_audit_events engagement_audit_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_audit_events
    ADD CONSTRAINT engagement_audit_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_calendar_events engagement_calendar_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_calendar_events
    ADD CONSTRAINT engagement_calendar_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_coaching_plans engagement_coaching_plans_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_coaching_plans
    ADD CONSTRAINT engagement_coaching_plans_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_configuration_records engagement_configuration_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_configuration_records
    ADD CONSTRAINT engagement_configuration_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_configuration_records engagement_configuration_records_inherited_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_configuration_records
    ADD CONSTRAINT engagement_configuration_records_inherited_from_id_fkey FOREIGN KEY (inherited_from_id) REFERENCES public.engagement_configuration_records(id);


--
-- Name: engagement_configuration_versions engagement_configuration_versions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_configuration_versions
    ADD CONSTRAINT engagement_configuration_versions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_disputes engagement_disputes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_disputes
    ADD CONSTRAINT engagement_disputes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_kpi_definitions engagement_kpi_definitions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_kpi_definitions
    ADD CONSTRAINT engagement_kpi_definitions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_kpi_definitions engagement_kpi_definitions_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_kpi_definitions
    ADD CONSTRAINT engagement_kpi_definitions_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.engagement_programmes(id) ON DELETE CASCADE;


--
-- Name: engagement_mobile_drafts engagement_mobile_drafts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_mobile_drafts
    ADD CONSTRAINT engagement_mobile_drafts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_mobile_installations engagement_mobile_installations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_mobile_installations
    ADD CONSTRAINT engagement_mobile_installations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_notifications engagement_notifications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_notifications
    ADD CONSTRAINT engagement_notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_person_results engagement_person_results_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_person_results
    ADD CONSTRAINT engagement_person_results_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_person_results engagement_person_results_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_person_results
    ADD CONSTRAINT engagement_person_results_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.engagement_programmes(id);


--
-- Name: engagement_programmes engagement_programmes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_programmes
    ADD CONSTRAINT engagement_programmes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_qr_sessions engagement_qr_sessions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_qr_sessions
    ADD CONSTRAINT engagement_qr_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_recognitions engagement_recognitions_activity_credit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_recognitions
    ADD CONSTRAINT engagement_recognitions_activity_credit_id_fkey FOREIGN KEY (activity_credit_id) REFERENCES public.engagement_activity_credits(id);


--
-- Name: engagement_recognitions engagement_recognitions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_recognitions
    ADD CONSTRAINT engagement_recognitions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_report_definitions engagement_report_definitions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_report_definitions
    ADD CONSTRAINT engagement_report_definitions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_review_templates engagement_review_templates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_review_templates
    ADD CONSTRAINT engagement_review_templates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_seed_reconciliation engagement_seed_reconciliation_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_seed_reconciliation
    ADD CONSTRAINT engagement_seed_reconciliation_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_team_reviews engagement_team_reviews_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_team_reviews
    ADD CONSTRAINT engagement_team_reviews_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: engagement_team_reviews engagement_team_reviews_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_team_reviews
    ADD CONSTRAINT engagement_team_reviews_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.engagement_review_templates(id);


--
-- Name: environmental_inspections environmental_inspections_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environmental_inspections
    ADD CONSTRAINT environmental_inspections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: equipment_assurance_profiles equipment_assurance_profiles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_assurance_profiles
    ADD CONSTRAINT equipment_assurance_profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: equipment_assurance_profiles equipment_assurance_profiles_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_assurance_profiles
    ADD CONSTRAINT equipment_assurance_profiles_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.tools_register(id) ON DELETE CASCADE;


--
-- Name: equipment_assurance_records equipment_assurance_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_assurance_records
    ADD CONSTRAINT equipment_assurance_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: equipment_assurance_records equipment_assurance_records_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_assurance_records
    ADD CONSTRAINT equipment_assurance_records_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.tools_register(id) ON DELETE CASCADE;


--
-- Name: equipment_defects equipment_defects_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_defects
    ADD CONSTRAINT equipment_defects_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: equipment_defects equipment_defects_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_defects
    ADD CONSTRAINT equipment_defects_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.tools_register(id) ON DELETE RESTRICT;


--
-- Name: equipment_maintenance_events equipment_maintenance_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_maintenance_events
    ADD CONSTRAINT equipment_maintenance_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: equipment_maintenance_events equipment_maintenance_events_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_maintenance_events
    ADD CONSTRAINT equipment_maintenance_events_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.tools_register(id) ON DELETE RESTRICT;


--
-- Name: equipment_movements equipment_movements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: equipment_movements equipment_movements_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.tools_register(id) ON DELETE RESTRICT;


--
-- Name: equipment_movements equipment_movements_linked_movement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_linked_movement_id_fkey FOREIGN KEY (linked_movement_id) REFERENCES public.equipment_movements(id) ON DELETE SET NULL;


--
-- Name: ert_members ert_members_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ert_members
    ADD CONSTRAINT ert_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ert_members ert_members_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ert_members
    ADD CONSTRAINT ert_members_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: esg_targets esg_targets_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.esg_targets
    ADD CONSTRAINT esg_targets_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: events events_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.sites(id);


--
-- Name: events events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: events events_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: exposure_monitoring exposure_monitoring_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exposure_monitoring
    ADD CONSTRAINT exposure_monitoring_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: fire_certificates fire_certificates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_certificates
    ADD CONSTRAINT fire_certificates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: fire_equipment fire_equipment_certificate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_equipment
    ADD CONSTRAINT fire_equipment_certificate_id_fkey FOREIGN KEY (certificate_id) REFERENCES public.fire_certificates(id) ON DELETE SET NULL;


--
-- Name: fire_equipment fire_equipment_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_equipment
    ADD CONSTRAINT fire_equipment_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: fire_inspection_findings fire_inspection_findings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_inspection_findings
    ADD CONSTRAINT fire_inspection_findings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: fire_inspection_findings fire_inspection_findings_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_inspection_findings
    ADD CONSTRAINT fire_inspection_findings_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.fire_inspections(id) ON DELETE CASCADE;


--
-- Name: fire_inspections fire_inspections_certificate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_inspections
    ADD CONSTRAINT fire_inspections_certificate_id_fkey FOREIGN KEY (certificate_id) REFERENCES public.fire_certificates(id) ON DELETE SET NULL;


--
-- Name: fire_inspections fire_inspections_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fire_inspections
    ADD CONSTRAINT fire_inspections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: fuel_consumption fuel_consumption_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_consumption
    ADD CONSTRAINT fuel_consumption_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: hazard_library hazard_library_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hazard_library
    ADD CONSTRAINT hazard_library_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: hazardous_waste hazardous_waste_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hazardous_waste
    ADD CONSTRAINT hazardous_waste_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: hse_meetings hse_meetings_chair_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hse_meetings
    ADD CONSTRAINT hse_meetings_chair_person_id_fkey FOREIGN KEY (chair_person_id) REFERENCES public.people(id);


--
-- Name: hse_meetings hse_meetings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hse_meetings
    ADD CONSTRAINT hse_meetings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: hse_meetings hse_meetings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hse_meetings
    ADD CONSTRAINT hse_meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: incident_evidence incident_evidence_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_evidence
    ADD CONSTRAINT incident_evidence_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: incident_mgmt_audit_events incident_mgmt_audit_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_mgmt_audit_events
    ADD CONSTRAINT incident_mgmt_audit_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: incident_mgmt_config_records incident_mgmt_config_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_mgmt_config_records
    ADD CONSTRAINT incident_mgmt_config_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: incident_mgmt_records incident_mgmt_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_mgmt_records
    ADD CONSTRAINT incident_mgmt_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: induction_records induction_records_inducted_by_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induction_records
    ADD CONSTRAINT induction_records_inducted_by_person_id_fkey FOREIGN KEY (inducted_by_person_id) REFERENCES public.people(id);


--
-- Name: induction_records induction_records_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induction_records
    ADD CONSTRAINT induction_records_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: inspection_actions inspection_actions_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_actions
    ADD CONSTRAINT inspection_actions_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_items inspection_items_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_items
    ADD CONSTRAINT inspection_items_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspections inspections_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.sites(id);


--
-- Name: inspections inspections_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: inspections inspections_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: inspections inspections_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: integration_sync_log integration_sync_log_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_sync_log
    ADD CONSTRAINT integration_sync_log_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.integrations(id) ON DELETE CASCADE;


--
-- Name: investigations investigations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investigations
    ADD CONSTRAINT investigations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: investigations investigations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investigations
    ADD CONSTRAINT investigations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: investigations investigations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investigations
    ADD CONSTRAINT investigations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: jsa_records jsa_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jsa_records
    ADD CONSTRAINT jsa_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: jsa_records jsa_records_ra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jsa_records
    ADD CONSTRAINT jsa_records_ra_id_fkey FOREIGN KEY (ra_id) REFERENCES public.risk_assessments(id) ON DELETE SET NULL;


--
-- Name: kpi_config_audit kpi_config_audit_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_config_audit
    ADD CONSTRAINT kpi_config_audit_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: kpi_config_audit kpi_config_audit_config_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_config_audit
    ADD CONSTRAINT kpi_config_audit_config_version_id_fkey FOREIGN KEY (config_version_id) REFERENCES public.kpi_config_versions(id);


--
-- Name: kpi_config_versions kpi_config_versions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_config_versions
    ADD CONSTRAINT kpi_config_versions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: kpi_config_versions kpi_config_versions_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_config_versions
    ADD CONSTRAINT kpi_config_versions_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.kpi_config_versions(id);


--
-- Name: kpi_indicators kpi_indicators_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_indicators
    ADD CONSTRAINT kpi_indicators_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: kpi_indicators kpi_indicators_kpi_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_indicators
    ADD CONSTRAINT kpi_indicators_kpi_id_fkey FOREIGN KEY (kpi_id) REFERENCES public.kpis_v2(id) ON DELETE CASCADE;


--
-- Name: kpi_monthly_data kpi_monthly_data_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_monthly_data
    ADD CONSTRAINT kpi_monthly_data_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: kpi_monthly_data kpi_monthly_data_entered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_monthly_data
    ADD CONSTRAINT kpi_monthly_data_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES public.profiles(id);


--
-- Name: kpi_monthly_data kpi_monthly_data_indicator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_monthly_data
    ADD CONSTRAINT kpi_monthly_data_indicator_id_fkey FOREIGN KEY (indicator_id) REFERENCES public.kpi_indicators(id) ON DELETE CASCADE;


--
-- Name: kpi_monthly_data kpi_monthly_data_kpi_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_monthly_data
    ADD CONSTRAINT kpi_monthly_data_kpi_id_fkey FOREIGN KEY (kpi_id) REFERENCES public.kpis_v2(id) ON DELETE CASCADE;


--
-- Name: kpis kpis_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis
    ADD CONSTRAINT kpis_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: kpis_v2 kpis_v2_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis_v2
    ADD CONSTRAINT kpis_v2_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: kpis_v2 kpis_v2_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis_v2
    ADD CONSTRAINT kpis_v2_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: kpis_v2 kpis_v2_objective_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis_v2
    ADD CONSTRAINT kpis_v2_objective_id_fkey FOREIGN KEY (objective_id) REFERENCES public.objectives(id) ON DELETE CASCADE;


--
-- Name: learning_course_governance learning_course_governance_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_course_governance
    ADD CONSTRAINT learning_course_governance_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: learning_external_providers learning_external_providers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_external_providers
    ADD CONSTRAINT learning_external_providers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: learning_practical_assessments learning_practical_assessments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_practical_assessments
    ADD CONSTRAINT learning_practical_assessments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: learning_source_relationships learning_source_relationships_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_source_relationships
    ADD CONSTRAINT learning_source_relationships_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: legal_compliance_records legal_compliance_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_compliance_records
    ADD CONSTRAINT legal_compliance_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: legal_compliance_relationships legal_compliance_relationships_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_compliance_relationships
    ADD CONSTRAINT legal_compliance_relationships_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: legal_register legal_register_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_register
    ADD CONSTRAINT legal_register_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: legislative_changes legislative_changes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legislative_changes
    ADD CONSTRAINT legislative_changes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: legislative_changes legislative_changes_linked_register_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legislative_changes
    ADD CONSTRAINT legislative_changes_linked_register_id_fkey FOREIGN KEY (linked_register_id) REFERENCES public.legal_register(id) ON DELETE SET NULL;


--
-- Name: location_identity_backfill_review location_identity_backfill_review_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_identity_backfill_review
    ADD CONSTRAINT location_identity_backfill_review_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: location_identity_backfill_review location_identity_backfill_review_resolved_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_identity_backfill_review
    ADD CONSTRAINT location_identity_backfill_review_resolved_area_id_fkey FOREIGN KEY (resolved_area_id) REFERENCES public.sites(id);


--
-- Name: location_identity_backfill_review location_identity_backfill_review_resolved_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_identity_backfill_review
    ADD CONSTRAINT location_identity_backfill_review_resolved_site_id_fkey FOREIGN KEY (resolved_site_id) REFERENCES public.sites(id);


--
-- Name: map_activity_log map_activity_log_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.map_activity_log
    ADD CONSTRAINT map_activity_log_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.action_tracker(id) ON DELETE CASCADE;


--
-- Name: map_activity_log map_activity_log_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.map_activity_log
    ADD CONSTRAINT map_activity_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: map_source_backfill_review map_source_backfill_review_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.map_source_backfill_review
    ADD CONSTRAINT map_source_backfill_review_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.action_tracker(id) ON DELETE CASCADE;


--
-- Name: medical_surveillance medical_surveillance_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_surveillance
    ADD CONSTRAINT medical_surveillance_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: medical_surveillance medical_surveillance_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_surveillance
    ADD CONSTRAINT medical_surveillance_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: meeting_actions meeting_actions_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_actions
    ADD CONSTRAINT meeting_actions_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.hse_meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_series meeting_series_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_series
    ADD CONSTRAINT meeting_series_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: moc_change_requests moc_change_requests_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moc_change_requests
    ADD CONSTRAINT moc_change_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: muster_points muster_points_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.muster_points
    ADD CONSTRAINT muster_points_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_measurements noise_measurements_survey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_measurements
    ADD CONSTRAINT noise_measurements_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.noise_surveys(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_assessment_profiles noise_mgmt_assessment_profiles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_assessment_profiles
    ADD CONSTRAINT noise_mgmt_assessment_profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_audit_events noise_mgmt_audit_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_audit_events
    ADD CONSTRAINT noise_mgmt_audit_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_control_plans noise_mgmt_control_plans_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_control_plans
    ADD CONSTRAINT noise_mgmt_control_plans_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_exposure_assessments noise_mgmt_exposure_assessments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_exposure_assessments
    ADD CONSTRAINT noise_mgmt_exposure_assessments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_field_surveys noise_mgmt_field_surveys_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_field_surveys
    ADD CONSTRAINT noise_mgmt_field_surveys_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_health_statuses noise_mgmt_health_statuses_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_health_statuses
    ADD CONSTRAINT noise_mgmt_health_statuses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_hearing_protectors noise_mgmt_hearing_protectors_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_hearing_protectors
    ADD CONSTRAINT noise_mgmt_hearing_protectors_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_instruments noise_mgmt_instruments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_instruments
    ADD CONSTRAINT noise_mgmt_instruments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_maps noise_mgmt_maps_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_maps
    ADD CONSTRAINT noise_mgmt_maps_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_measurement_plans noise_mgmt_measurement_plans_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_measurement_plans
    ADD CONSTRAINT noise_mgmt_measurement_plans_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_measurements noise_mgmt_measurements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_measurements
    ADD CONSTRAINT noise_mgmt_measurements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_programmes noise_mgmt_programmes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_programmes
    ADD CONSTRAINT noise_mgmt_programmes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_reports noise_mgmt_reports_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_reports
    ADD CONSTRAINT noise_mgmt_reports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_segs noise_mgmt_segs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_segs
    ADD CONSTRAINT noise_mgmt_segs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_sources noise_mgmt_sources_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_sources
    ADD CONSTRAINT noise_mgmt_sources_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_mgmt_tasks noise_mgmt_tasks_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_mgmt_tasks
    ADD CONSTRAINT noise_mgmt_tasks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_surveys noise_surveys_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_surveys
    ADD CONSTRAINT noise_surveys_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: noise_surveys noise_surveys_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noise_surveys
    ADD CONSTRAINT noise_surveys_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: notification_acknowledgement_settings notification_acknowledgement_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_acknowledgement_settings
    ADD CONSTRAINT notification_acknowledgement_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notification_escalation_recipients notification_escalation_recipients_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_escalation_recipients
    ADD CONSTRAINT notification_escalation_recipients_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notification_escalation_recipients notification_escalation_recipients_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_escalation_recipients
    ADD CONSTRAINT notification_escalation_recipients_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notification_escalation_settings notification_escalation_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_escalation_settings
    ADD CONSTRAINT notification_escalation_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notification_events notification_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notification_events notification_events_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notification_queue(id) ON DELETE CASCADE;


--
-- Name: notification_link_opens notification_link_opens_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_link_opens
    ADD CONSTRAINT notification_link_opens_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notification_link_opens notification_link_opens_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_link_opens
    ADD CONSTRAINT notification_link_opens_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notification_queue(id) ON DELETE CASCADE;


--
-- Name: notification_queue notification_queue_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_queue
    ADD CONSTRAINT notification_queue_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notification_queue notification_queue_recipient_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_queue
    ADD CONSTRAINT notification_queue_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: notification_settings notification_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_settings
    ADD CONSTRAINT notification_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notification_user_preferences notification_user_preferences_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_user_preferences
    ADD CONSTRAINT notification_user_preferences_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notification_user_preferences notification_user_preferences_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_user_preferences
    ADD CONSTRAINT notification_user_preferences_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: objectives objectives_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: objectives objectives_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: occupational_diseases occupational_diseases_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.occupational_diseases
    ADD CONSTRAINT occupational_diseases_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: occupational_diseases occupational_diseases_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.occupational_diseases
    ADD CONSTRAINT occupational_diseases_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: people_certifications people_certifications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people_certifications
    ADD CONSTRAINT people_certifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: people_certifications people_certifications_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people_certifications
    ADD CONSTRAINT people_certifications_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: people people_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: people people_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: people people_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: permit_activity_log permit_activity_log_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_activity_log
    ADD CONSTRAINT permit_activity_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: permit_activity_log permit_activity_log_permit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_activity_log
    ADD CONSTRAINT permit_activity_log_permit_id_fkey FOREIGN KEY (permit_id) REFERENCES public.permits(id) ON DELETE CASCADE;


--
-- Name: permits permits_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permits
    ADD CONSTRAINT permits_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.sites(id);


--
-- Name: permits permits_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permits
    ADD CONSTRAINT permits_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: permits permits_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permits
    ADD CONSTRAINT permits_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: permits permits_method_statement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permits
    ADD CONSTRAINT permits_method_statement_id_fkey FOREIGN KEY (method_statement_id) REFERENCES public.documents(id);


--
-- Name: permits permits_risk_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permits
    ADD CONSTRAINT permits_risk_assessment_id_fkey FOREIGN KEY (risk_assessment_id) REFERENCES public.risk_assessments(id);


--
-- Name: permits permits_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permits
    ADD CONSTRAINT permits_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: person_identity_backfill_review person_identity_backfill_review_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identity_backfill_review
    ADD CONSTRAINT person_identity_backfill_review_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: person_identity_backfill_review person_identity_backfill_review_resolved_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identity_backfill_review
    ADD CONSTRAINT person_identity_backfill_review_resolved_person_id_fkey FOREIGN KEY (resolved_person_id) REFERENCES public.people(id);


--
-- Name: person_identity_decisions person_identity_decisions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identity_decisions
    ADD CONSTRAINT person_identity_decisions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: person_identity_decisions person_identity_decisions_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identity_decisions
    ADD CONSTRAINT person_identity_decisions_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.person_identity_backfill_review(id) ON DELETE SET NULL;


--
-- Name: person_identity_decisions person_identity_decisions_selected_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identity_decisions
    ADD CONSTRAINT person_identity_decisions_selected_person_id_fkey FOREIGN KEY (selected_person_id) REFERENCES public.people(id);


--
-- Name: ppe_catalogue ppe_catalogue_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_catalogue
    ADD CONSTRAINT ppe_catalogue_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ppe_inspections ppe_inspections_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_inspections
    ADD CONSTRAINT ppe_inspections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ppe_inspections ppe_inspections_issuance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_inspections
    ADD CONSTRAINT ppe_inspections_issuance_id_fkey FOREIGN KEY (issuance_id) REFERENCES public.ppe_issuance(id) ON DELETE SET NULL;


--
-- Name: ppe_inspections ppe_inspections_ppe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_inspections
    ADD CONSTRAINT ppe_inspections_ppe_id_fkey FOREIGN KEY (ppe_id) REFERENCES public.ppe_catalogue(id) ON DELETE SET NULL;


--
-- Name: ppe_issuance ppe_issuance_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_issuance
    ADD CONSTRAINT ppe_issuance_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ppe_issuance ppe_issuance_issued_by_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_issuance
    ADD CONSTRAINT ppe_issuance_issued_by_person_id_fkey FOREIGN KEY (issued_by_person_id) REFERENCES public.people(id);


--
-- Name: ppe_issuance ppe_issuance_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_issuance
    ADD CONSTRAINT ppe_issuance_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: ppe_issuance ppe_issuance_ppe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_issuance
    ADD CONSTRAINT ppe_issuance_ppe_id_fkey FOREIGN KEY (ppe_id) REFERENCES public.ppe_catalogue(id) ON DELETE SET NULL;


--
-- Name: ppe_issuance ppe_issuance_risk_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_issuance
    ADD CONSTRAINT ppe_issuance_risk_assessment_id_fkey FOREIGN KEY (risk_assessment_id) REFERENCES public.risk_assessments(id);


--
-- Name: ppe_issuance ppe_issuance_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_issuance
    ADD CONSTRAINT ppe_issuance_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_schedule(id);


--
-- Name: ppe_replacements ppe_replacements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_replacements
    ADD CONSTRAINT ppe_replacements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ppe_replacements ppe_replacements_issuance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_replacements
    ADD CONSTRAINT ppe_replacements_issuance_id_fkey FOREIGN KEY (issuance_id) REFERENCES public.ppe_issuance(id) ON DELETE SET NULL;


--
-- Name: ppe_replacements ppe_replacements_ppe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ppe_replacements
    ADD CONSTRAINT ppe_replacements_ppe_id_fkey FOREIGN KEY (ppe_id) REFERENCES public.ppe_catalogue(id) ON DELETE SET NULL;


--
-- Name: prestart_inspections prestart_inspections_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prestart_inspections
    ADD CONSTRAINT prestart_inspections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: prestart_inspections prestart_inspections_supervisor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prestart_inspections
    ADD CONSTRAINT prestart_inspections_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id);


--
-- Name: profiles profiles_provisioned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_provisioned_by_fkey FOREIGN KEY (provisioned_by) REFERENCES public.profiles(id);


--
-- Name: push_delivery_jobs push_delivery_jobs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_delivery_jobs
    ADD CONSTRAINT push_delivery_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: push_delivery_jobs push_delivery_jobs_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_delivery_jobs
    ADD CONSTRAINT push_delivery_jobs_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.push_subscriptions(id) ON DELETE CASCADE;


--
-- Name: push_delivery_jobs push_delivery_jobs_user_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_delivery_jobs
    ADD CONSTRAINT push_delivery_jobs_user_notification_id_fkey FOREIGN KEY (user_notification_id) REFERENCES public.user_notifications(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_recipient_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: ra_revisions ra_revisions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ra_revisions
    ADD CONSTRAINT ra_revisions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ra_revisions ra_revisions_ra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ra_revisions
    ADD CONSTRAINT ra_revisions_ra_id_fkey FOREIGN KEY (ra_id) REFERENCES public.risk_assessments(id) ON DELETE CASCADE;


--
-- Name: ra_templates ra_templates_cloned_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ra_templates
    ADD CONSTRAINT ra_templates_cloned_from_fkey FOREIGN KEY (cloned_from) REFERENCES public.ra_templates(id) ON DELETE SET NULL;


--
-- Name: ra_templates ra_templates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ra_templates
    ADD CONSTRAINT ra_templates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ra_templates ra_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ra_templates
    ADD CONSTRAINT ra_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: record_relationships record_relationships_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_relationships
    ADD CONSTRAINT record_relationships_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: reference_identity_backfill_review reference_identity_backfill_review_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_identity_backfill_review
    ADD CONSTRAINT reference_identity_backfill_review_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: relationship_validation_runs relationship_validation_runs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_validation_runs
    ADD CONSTRAINT relationship_validation_runs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: risk_assessment_items risk_assessment_items_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessment_items
    ADD CONSTRAINT risk_assessment_items_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.risk_assessments(id) ON DELETE CASCADE;


--
-- Name: risk_assessment_operational_records risk_assessment_operational_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessment_operational_records
    ADD CONSTRAINT risk_assessment_operational_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: risk_assessment_relationships risk_assessment_relationships_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessment_relationships
    ADD CONSTRAINT risk_assessment_relationships_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: risk_assessments risk_assessments_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessments
    ADD CONSTRAINT risk_assessments_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.sites(id);


--
-- Name: risk_assessments risk_assessments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessments
    ADD CONSTRAINT risk_assessments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: risk_assessments risk_assessments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessments
    ADD CONSTRAINT risk_assessments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: risk_assessments risk_assessments_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_assessments
    ADD CONSTRAINT risk_assessments_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: rollout_cohort_transitions rollout_cohort_transitions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollout_cohort_transitions
    ADD CONSTRAINT rollout_cohort_transitions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: rollout_health_events rollout_health_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollout_health_events
    ADD CONSTRAINT rollout_health_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: safety_alerts safety_alerts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_alerts
    ADD CONSTRAINT safety_alerts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: safety_bulletins safety_bulletins_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_bulletins
    ADD CONSTRAINT safety_bulletins_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: safety_observations safety_observations_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_observations
    ADD CONSTRAINT safety_observations_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.sites(id);


--
-- Name: safety_observations safety_observations_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_observations
    ADD CONSTRAINT safety_observations_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: security_sla_settings security_sla_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_sla_settings
    ADD CONSTRAINT security_sla_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: security_sla_settings security_sla_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_sla_settings
    ADD CONSTRAINT security_sla_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: sites sites_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: sites sites_parent_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_parent_site_id_fkey FOREIGN KEY (parent_site_id) REFERENCES public.sites(id);


--
-- Name: sop_documents sop_documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_documents
    ADD CONSTRAINT sop_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: sop_video_evidence sop_video_evidence_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_evidence
    ADD CONSTRAINT sop_video_evidence_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: sop_video_evidence sop_video_evidence_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_evidence
    ADD CONSTRAINT sop_video_evidence_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.sop_video_projects(id) ON DELETE CASCADE;


--
-- Name: sop_video_projects sop_video_projects_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_projects
    ADD CONSTRAINT sop_video_projects_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: sop_video_relationships sop_video_relationships_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_relationships
    ADD CONSTRAINT sop_video_relationships_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: sop_video_relationships sop_video_relationships_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_video_relationships
    ADD CONSTRAINT sop_video_relationships_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.sop_video_projects(id) ON DELETE CASCADE;


--
-- Name: spill_reports spill_reports_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spill_reports
    ADD CONSTRAINT spill_reports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: spirometry_records spirometry_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spirometry_records
    ADD CONSTRAINT spirometry_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: spirometry_records spirometry_records_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spirometry_records
    ADD CONSTRAINT spirometry_records_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: swms_configuration_versions swms_configuration_versions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swms_configuration_versions
    ADD CONSTRAINT swms_configuration_versions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: swms_operational_records swms_operational_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swms_operational_records
    ADD CONSTRAINT swms_operational_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: swms_relationships swms_relationships_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swms_relationships
    ADD CONSTRAINT swms_relationships_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: tool_checklist_templates tool_checklist_templates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_checklist_templates
    ADD CONSTRAINT tool_checklist_templates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: tool_inspections tool_inspections_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_inspections
    ADD CONSTRAINT tool_inspections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: tool_inspections tool_inspections_inspected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_inspections
    ADD CONSTRAINT tool_inspections_inspected_by_fkey FOREIGN KEY (inspected_by) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: tool_inspections tool_inspections_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_inspections
    ADD CONSTRAINT tool_inspections_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.tools_register(id) ON DELETE CASCADE;


--
-- Name: toolbox_talks toolbox_talks_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toolbox_talks
    ADD CONSTRAINT toolbox_talks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: toolbox_talks toolbox_talks_conducted_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toolbox_talks
    ADD CONSTRAINT toolbox_talks_conducted_by_id_fkey FOREIGN KEY (conducted_by_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: toolbox_talks toolbox_talks_presenter_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toolbox_talks
    ADD CONSTRAINT toolbox_talks_presenter_person_id_fkey FOREIGN KEY (presenter_person_id) REFERENCES public.people(id);


--
-- Name: toolbox_talks toolbox_talks_work_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.toolbox_talks
    ADD CONSTRAINT toolbox_talks_work_schedule_id_fkey FOREIGN KEY (work_schedule_id) REFERENCES public.work_schedule(id) ON DELETE SET NULL;


--
-- Name: tools_register tools_register_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tools_register
    ADD CONSTRAINT tools_register_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: tools_register tools_register_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tools_register
    ADD CONSTRAINT tools_register_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: training_followup training_followup_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_followup
    ADD CONSTRAINT training_followup_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: training_followup training_followup_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_followup
    ADD CONSTRAINT training_followup_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: training_followup training_followup_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_followup
    ADD CONSTRAINT training_followup_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.training_plan(id) ON DELETE SET NULL;


--
-- Name: training_needs training_needs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_needs
    ADD CONSTRAINT training_needs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: training_plan training_plan_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_plan
    ADD CONSTRAINT training_plan_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: training_sessions training_sessions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_sessions
    ADD CONSTRAINT training_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: training_sessions training_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_sessions
    ADD CONSTRAINT training_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: user_notifications user_notifications_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: user_notifications user_notifications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: user_notifications user_notifications_recipient_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_notifications user_notifications_source_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_source_notification_id_fkey FOREIGN KEY (source_notification_id) REFERENCES public.notification_queue(id) ON DELETE CASCADE;


--
-- Name: user_site_access user_site_access_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_site_access
    ADD CONSTRAINT user_site_access_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;


--
-- Name: vaccination_records vaccination_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaccination_records
    ADD CONSTRAINT vaccination_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: vaccination_records vaccination_records_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaccination_records
    ADD CONSTRAINT vaccination_records_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: waste_records waste_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_records
    ADD CONSTRAINT waste_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: water_usage water_usage_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.water_usage
    ADD CONSTRAINT water_usage_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: whatsapp_channel_settings whatsapp_channel_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_channel_settings
    ADD CONSTRAINT whatsapp_channel_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: whatsapp_channel_settings whatsapp_channel_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_channel_settings
    ADD CONSTRAINT whatsapp_channel_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: whatsapp_consent_events whatsapp_consent_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_consent_events
    ADD CONSTRAINT whatsapp_consent_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: whatsapp_consent_events whatsapp_consent_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_consent_events
    ADD CONSTRAINT whatsapp_consent_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: whatsapp_consent_events whatsapp_consent_events_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_consent_events
    ADD CONSTRAINT whatsapp_consent_events_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: whatsapp_delivery_jobs whatsapp_delivery_jobs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_delivery_jobs
    ADD CONSTRAINT whatsapp_delivery_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: whatsapp_delivery_jobs whatsapp_delivery_jobs_recipient_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_delivery_jobs
    ADD CONSTRAINT whatsapp_delivery_jobs_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: whatsapp_delivery_jobs whatsapp_delivery_jobs_source_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_delivery_jobs
    ADD CONSTRAINT whatsapp_delivery_jobs_source_notification_id_fkey FOREIGN KEY (source_notification_id) REFERENCES public.notification_queue(id) ON DELETE CASCADE;


--
-- Name: whatsapp_delivery_jobs whatsapp_delivery_jobs_user_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_delivery_jobs
    ADD CONSTRAINT whatsapp_delivery_jobs_user_notification_id_fkey FOREIGN KEY (user_notification_id) REFERENCES public.user_notifications(id) ON DELETE CASCADE;


--
-- Name: work_schedule work_schedule_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_schedule
    ADD CONSTRAINT work_schedule_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: work_schedule work_schedule_permit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_schedule
    ADD CONSTRAINT work_schedule_permit_id_fkey FOREIGN KEY (permit_id) REFERENCES public.permits(id);


--
-- Name: work_schedule work_schedule_risk_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_schedule
    ADD CONSTRAINT work_schedule_risk_assessment_id_fkey FOREIGN KEY (risk_assessment_id) REFERENCES public.risk_assessments(id);


--
-- Name: work_schedule work_schedule_supervisor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_schedule
    ADD CONSTRAINT work_schedule_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: action_digest_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.action_digest_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: action_digest_runs action_digest_runs_company_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY action_digest_runs_company_read ON public.action_digest_runs FOR SELECT TO authenticated USING (((recipient_profile_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = action_digest_runs.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))));


--
-- Name: action_notification_escalation_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.action_notification_escalation_state ENABLE ROW LEVEL SECURITY;

--
-- Name: action_notification_escalation_state action_notification_escalation_state_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY action_notification_escalation_state_company ON public.action_notification_escalation_state FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = action_notification_escalation_state.company_id))))));


--
-- Name: action_tracker; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.action_tracker ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_decisions approval_decisions_company_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_decisions_company_access ON public.approval_decisions USING ((EXISTS ( SELECT 1
   FROM (public.approval_requests r
     JOIN public.profiles p ON ((p.id = auth.uid())))
  WHERE ((r.id = approval_decisions.request_id) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = r.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.approval_requests r
     JOIN public.profiles p ON ((p.id = auth.uid())))
  WHERE ((r.id = approval_decisions.request_id) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = r.company_id))))));


--
-- Name: approval_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_requests approval_requests_company_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_requests_company_access ON public.approval_requests USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = approval_requests.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = approval_requests.company_id))))));


--
-- Name: approval_workflow_steps approval_steps_company_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_steps_company_manage ON public.approval_workflow_steps USING ((EXISTS ( SELECT 1
   FROM (public.approval_workflows w
     JOIN public.profiles p ON ((p.id = auth.uid())))
  WHERE ((w.id = approval_workflow_steps.workflow_id) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = w.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.approval_workflows w
     JOIN public.profiles p ON ((p.id = auth.uid())))
  WHERE ((w.id = approval_workflow_steps.workflow_id) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = w.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text]))))))));


--
-- Name: approval_workflow_steps approval_steps_company_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_steps_company_read ON public.approval_workflow_steps FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.approval_workflows w
     JOIN public.profiles p ON ((p.id = auth.uid())))
  WHERE ((w.id = approval_workflow_steps.workflow_id) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = w.company_id))))));


--
-- Name: approval_workflow_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_workflow_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_workflows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_workflows approval_workflows_company_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_workflows_company_manage ON public.approval_workflows USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = approval_workflows.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = approval_workflows.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text]))))))));


--
-- Name: approval_workflows approval_workflows_company_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_workflows_company_read ON public.approval_workflows FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = approval_workflows.company_id))))));


--
-- Name: auth_sessions_log asl_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asl_admin_select ON public.auth_sessions_log FOR SELECT TO authenticated USING (public.is_sephs_admin());


--
-- Name: auth_sessions_log asl_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asl_own_insert ON public.auth_sessions_log FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: atex_areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.atex_areas ENABLE ROW LEVEL SECURITY;

--
-- Name: atex_areas atex_areas_delete_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY atex_areas_delete_company ON public.atex_areas FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = atex_areas.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text]))))))));


--
-- Name: atex_areas atex_areas_insert_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY atex_areas_insert_company ON public.atex_areas FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = atex_areas.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: atex_areas atex_areas_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY atex_areas_select_company ON public.atex_areas FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = atex_areas.company_id))))));


--
-- Name: atex_areas atex_areas_update_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY atex_areas_update_company ON public.atex_areas FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = atex_areas.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = atex_areas.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: audiometry_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audiometry_records ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events audit_events_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_events_insert_authenticated ON public.audit_events FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: audit_events audit_events_select_company_admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_events_select_company_admins ON public.audit_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = audit_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: audit_findings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_findings ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_sessions_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_sessions_log ENABLE ROW LEVEL SECURITY;

--
-- Name: authorisations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.authorisations ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_action_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_action_links ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_action_links bbs_action_links_governed_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_action_links_governed_write ON public.bbs_action_links USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_action_links.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_action_links.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: bbs_action_links bbs_action_links_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_action_links_tenant_read ON public.bbs_action_links FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_action_links.company_id))))));


--
-- Name: bbs_audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_audit_events bbs_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_audit_insert ON public.bbs_audit_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_audit_events.company_id))))));


--
-- Name: bbs_audit_events bbs_audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_audit_read ON public.bbs_audit_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_audit_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'auditor'::text]))))))));


--
-- Name: bbs_barriers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_barriers ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_barriers bbs_barriers_governed_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_barriers_governed_write ON public.bbs_barriers USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_barriers.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_barriers.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: bbs_barriers bbs_barriers_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_barriers_tenant_read ON public.bbs_barriers FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_barriers.company_id))))));


--
-- Name: bbs_behaviour_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_behaviour_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_behaviour_categories bbs_behaviour_categories_governed_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_behaviour_categories_governed_write ON public.bbs_behaviour_categories USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_behaviour_categories.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_behaviour_categories.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: bbs_behaviour_categories bbs_behaviour_categories_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_behaviour_categories_tenant_read ON public.bbs_behaviour_categories FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_behaviour_categories.company_id))))));


--
-- Name: bbs_behaviour_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_behaviour_items ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_behaviour_items bbs_behaviour_items_governed_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_behaviour_items_governed_write ON public.bbs_behaviour_items USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_behaviour_items.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_behaviour_items.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: bbs_behaviour_items bbs_behaviour_items_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_behaviour_items_tenant_read ON public.bbs_behaviour_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_behaviour_items.company_id))))));


--
-- Name: bbs_config_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_config_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_config_versions bbs_config_versions_governed_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_config_versions_governed_write ON public.bbs_config_versions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_config_versions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_config_versions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: bbs_config_versions bbs_config_versions_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_config_versions_tenant_read ON public.bbs_config_versions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_config_versions.company_id))))));


--
-- Name: bbs_observation_details bbs_details_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_details_create ON public.bbs_observation_details FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_observation_details.company_id))))));


--
-- Name: bbs_observation_details bbs_details_scoped_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_details_scoped_read ON public.bbs_observation_details FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_observation_details.company_id) AND ((bbs_observation_details.observer_mode = 'identified'::text) OR (bbs_observation_details.observer_person_id = auth.uid()) OR (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'auditor'::text])))))))));


--
-- Name: bbs_observation_details bbs_details_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_details_update ON public.bbs_observation_details FOR UPDATE USING (((observer_person_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_observation_details.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'auditor'::text])))))))));


--
-- Name: bbs_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_feedback bbs_feedback_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_feedback_tenant_read ON public.bbs_feedback FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_feedback.company_id))))));


--
-- Name: bbs_feedback bbs_feedback_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_feedback_tenant_write ON public.bbs_feedback USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_feedback.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_feedback.company_id))))));


--
-- Name: bbs_observation_barriers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_observation_barriers ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_observation_barriers bbs_observation_barriers_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_observation_barriers_tenant_read ON public.bbs_observation_barriers FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_observation_barriers.company_id))))));


--
-- Name: bbs_observation_barriers bbs_observation_barriers_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_observation_barriers_tenant_write ON public.bbs_observation_barriers USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_observation_barriers.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_observation_barriers.company_id))))));


--
-- Name: bbs_observation_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_observation_details ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_observation_responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_observation_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_observation_responses bbs_observation_responses_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_observation_responses_tenant_read ON public.bbs_observation_responses FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_observation_responses.company_id))))));


--
-- Name: bbs_observation_responses bbs_observation_responses_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_observation_responses_tenant_write ON public.bbs_observation_responses USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_observation_responses.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_observation_responses.company_id))))));


--
-- Name: bbs_programmes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_programmes ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_programmes bbs_programmes_governed_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_programmes_governed_write ON public.bbs_programmes USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_programmes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_programmes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: bbs_programmes bbs_programmes_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_programmes_tenant_read ON public.bbs_programmes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_programmes.company_id))))));


--
-- Name: bbs_quality_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_quality_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_quality_reviews bbs_quality_reviews_governed_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_quality_reviews_governed_write ON public.bbs_quality_reviews USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_quality_reviews.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_quality_reviews.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: bbs_quality_reviews bbs_quality_reviews_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_quality_reviews_tenant_read ON public.bbs_quality_reviews FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_quality_reviews.company_id))))));


--
-- Name: bbs_recognitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_recognitions ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_recognitions bbs_recognitions_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_recognitions_tenant_read ON public.bbs_recognitions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_recognitions.company_id))))));


--
-- Name: bbs_recognitions bbs_recognitions_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_recognitions_tenant_write ON public.bbs_recognitions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_recognitions.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_recognitions.company_id))))));


--
-- Name: bbs_report_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_report_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_report_definitions bbs_report_definitions_governed_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_report_definitions_governed_write ON public.bbs_report_definitions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_report_definitions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_report_definitions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: bbs_report_definitions bbs_report_definitions_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_report_definitions_tenant_read ON public.bbs_report_definitions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_report_definitions.company_id))))));


--
-- Name: bbs_sensitive_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_sensitive_access ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_sensitive_access bbs_sensitive_access_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_sensitive_access_insert ON public.bbs_sensitive_access FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_sensitive_access.company_id))))));


--
-- Name: bbs_sensitive_access bbs_sensitive_access_privacy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_sensitive_access_privacy ON public.bbs_sensitive_access FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_sensitive_access.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'auditor'::text]))))))));


--
-- Name: bbs_themes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bbs_themes ENABLE ROW LEVEL SECURITY;

--
-- Name: bbs_themes bbs_themes_governed_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_themes_governed_write ON public.bbs_themes USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_themes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = bbs_themes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: bbs_themes bbs_themes_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bbs_themes_tenant_read ON public.bbs_themes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = bbs_themes.company_id))))));


--
-- Name: bcp_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bcp_records ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: chemical_inventory_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chemical_inventory_events ENABLE ROW LEVEL SECURITY;

--
-- Name: chemical_inventory_events chemical_inventory_events_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_inventory_events_tenant_read ON public.chemical_inventory_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = chemical_inventory_events.company_id))))));


--
-- Name: chemical_inventory_events chemical_inventory_events_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_inventory_events_tenant_write ON public.chemical_inventory_events TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_inventory_events.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_inventory_events.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: chemical_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chemical_register ENABLE ROW LEVEL SECURITY;

--
-- Name: chemical_register chemical_register_delete_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_register_delete_company ON public.chemical_register FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_register.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: chemical_register chemical_register_insert_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_register_insert_company ON public.chemical_register FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_register.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: chemical_register chemical_register_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_register_select_company ON public.chemical_register FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = chemical_register.company_id))))));


--
-- Name: chemical_register chemical_register_update_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_register_update_company ON public.chemical_register FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_register.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_register.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: chemical_sds_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chemical_sds_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: chemical_sds_versions chemical_sds_versions_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_sds_versions_tenant_read ON public.chemical_sds_versions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = chemical_sds_versions.company_id))))));


--
-- Name: chemical_sds_versions chemical_sds_versions_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_sds_versions_tenant_write ON public.chemical_sds_versions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_sds_versions.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_sds_versions.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: chemical_use_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chemical_use_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: chemical_use_approvals chemical_use_approvals_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_use_approvals_tenant_read ON public.chemical_use_approvals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = chemical_use_approvals.company_id))))));


--
-- Name: chemical_use_approvals chemical_use_approvals_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chemical_use_approvals_tenant_write ON public.chemical_use_approvals TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_use_approvals.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = chemical_use_approvals.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: inspection_actions child_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY child_tenant ON public.inspection_actions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.inspections p
  WHERE ((p.id = inspection_actions.inspection_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.inspections p
  WHERE ((p.id = inspection_actions.inspection_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin())))));


--
-- Name: inspection_items child_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY child_tenant ON public.inspection_items TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.inspections p
  WHERE ((p.id = inspection_items.inspection_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.inspections p
  WHERE ((p.id = inspection_items.inspection_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin())))));


--
-- Name: meeting_actions child_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY child_tenant ON public.meeting_actions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.hse_meetings p
  WHERE ((p.id = meeting_actions.meeting_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.hse_meetings p
  WHERE ((p.id = meeting_actions.meeting_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin())))));


--
-- Name: noise_measurements child_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY child_tenant ON public.noise_measurements TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.noise_surveys p
  WHERE ((p.id = noise_measurements.survey_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.noise_surveys p
  WHERE ((p.id = noise_measurements.survey_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin())))));


--
-- Name: risk_assessment_items child_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY child_tenant ON public.risk_assessment_items TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.risk_assessments p
  WHERE ((p.id = risk_assessment_items.assessment_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.risk_assessments p
  WHERE ((p.id = risk_assessment_items.assessment_id) AND ((p.company_id = public.auth_company_id()) OR public.is_sephs_admin())))));


--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: companies companies_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_delete ON public.companies FOR DELETE TO authenticated USING ((public.current_user_role() = 'sephs_admin'::text));


--
-- Name: companies companies_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_insert ON public.companies FOR INSERT TO authenticated WITH CHECK ((public.current_user_role() = 'sephs_admin'::text));


--
-- Name: companies companies_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated USING (((id = public.current_user_company()) OR (public.current_user_role() = 'sephs_admin'::text)));


--
-- Name: companies companies_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_update ON public.companies FOR UPDATE TO authenticated USING (((public.current_user_role() = 'sephs_admin'::text) OR ((public.current_user_role() = 'admin'::text) AND (id = public.current_user_company())))) WITH CHECK (((public.current_user_role() = 'sephs_admin'::text) OR ((public.current_user_role() = 'admin'::text) AND (id = public.current_user_company()))));


--
-- Name: company_rollout_cohorts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_rollout_cohorts ENABLE ROW LEVEL SECURITY;

--
-- Name: company_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: company_settings company_settings_company_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_settings_company_access ON public.company_settings USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = company_settings.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = company_settings.company_id))))));


--
-- Name: competencies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competencies ENABLE ROW LEVEL SECURITY;

--
-- Name: competency_matrix; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competency_matrix ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_assessments compliance_assessments_delete_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_assessments_delete_company ON public.compliance_assessments FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_assessments.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'admin'::text]))))))));


--
-- Name: compliance_assessments compliance_assessments_insert_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_assessments_insert_company ON public.compliance_assessments FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_assessments.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: compliance_assessments compliance_assessments_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_assessments_select_company ON public.compliance_assessments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = compliance_assessments.company_id))))));


--
-- Name: compliance_assessments compliance_assessments_update_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_assessments_update_company ON public.compliance_assessments FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_assessments.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_assessments.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: compliance_audits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_audits ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_calendar; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_calendar ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_calendar compliance_calendar_delete_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_calendar_delete_company ON public.compliance_calendar FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_calendar.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'admin'::text]))))))));


--
-- Name: compliance_calendar compliance_calendar_insert_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_calendar_insert_company ON public.compliance_calendar FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_calendar.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: compliance_calendar compliance_calendar_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_calendar_select_company ON public.compliance_calendar FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = compliance_calendar.company_id))))));


--
-- Name: compliance_calendar compliance_calendar_update_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_calendar_update_company ON public.compliance_calendar FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_calendar.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_calendar.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: compliance_gaps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_gaps ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_gaps compliance_gaps_delete_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_gaps_delete_company ON public.compliance_gaps FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_gaps.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'admin'::text]))))))));


--
-- Name: compliance_gaps compliance_gaps_insert_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_gaps_insert_company ON public.compliance_gaps FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_gaps.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: compliance_gaps compliance_gaps_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_gaps_select_company ON public.compliance_gaps FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = compliance_gaps.company_id))))));


--
-- Name: compliance_gaps compliance_gaps_update_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_gaps_update_company ON public.compliance_gaps FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_gaps.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = compliance_gaps.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: contractor_assurance_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contractor_assurance_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: contractor_assurance_profiles contractor_assurance_profiles_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contractor_assurance_profiles_tenant_read ON public.contractor_assurance_profiles FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = contractor_assurance_profiles.company_id))))));


--
-- Name: contractor_assurance_profiles contractor_assurance_profiles_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contractor_assurance_profiles_tenant_write ON public.contractor_assurance_profiles TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = contractor_assurance_profiles.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = contractor_assurance_profiles.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: contractor_authorisations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contractor_authorisations ENABLE ROW LEVEL SECURITY;

--
-- Name: contractor_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contractor_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: contractor_documents contractor_documents_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contractor_documents_tenant_read ON public.contractor_documents FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = contractor_documents.company_id))))));


--
-- Name: contractor_documents contractor_documents_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contractor_documents_tenant_write ON public.contractor_documents TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = contractor_documents.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = contractor_documents.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: contractor_evaluations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contractor_evaluations ENABLE ROW LEVEL SECURITY;

--
-- Name: contractor_incidents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contractor_incidents ENABLE ROW LEVEL SECURITY;

--
-- Name: contractor_mobilisation_gates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contractor_mobilisation_gates ENABLE ROW LEVEL SECURITY;

--
-- Name: contractor_mobilisation_gates contractor_mobilisation_gates_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contractor_mobilisation_gates_tenant_read ON public.contractor_mobilisation_gates FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = contractor_mobilisation_gates.company_id))))));


--
-- Name: contractor_mobilisation_gates contractor_mobilisation_gates_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contractor_mobilisation_gates_tenant_write ON public.contractor_mobilisation_gates TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = contractor_mobilisation_gates.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = contractor_mobilisation_gates.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: contractor_preassessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contractor_preassessments ENABLE ROW LEVEL SECURITY;

--
-- Name: contractor_work_packages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contractor_work_packages ENABLE ROW LEVEL SECURITY;

--
-- Name: contractor_work_packages contractor_work_packages_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contractor_work_packages_tenant_read ON public.contractor_work_packages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = contractor_work_packages.company_id))))));


--
-- Name: contractor_work_packages contractor_work_packages_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contractor_work_packages_tenant_write ON public.contractor_work_packages TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = contractor_work_packages.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = contractor_work_packages.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: contractors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;

--
-- Name: control_library; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.control_library ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_field_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_field_values ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_field_values custom_field_values_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_field_values_select_company ON public.custom_field_values FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = custom_field_values.company_id))))));


--
-- Name: custom_field_values custom_field_values_write_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_field_values_write_company ON public.custom_field_values USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = custom_field_values.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = custom_field_values.company_id))))));


--
-- Name: custom_fields; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_fields custom_fields_manage_company_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_fields_manage_company_admin ON public.custom_fields USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = custom_fields.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = custom_fields.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text]))))))));


--
-- Name: custom_fields custom_fields_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_fields_select_company ON public.custom_fields FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = custom_fields.company_id))))));


--
-- Name: doc_acknowledgements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doc_acknowledgements ENABLE ROW LEVEL SECURITY;

--
-- Name: doc_controlled_copies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doc_controlled_copies ENABLE ROW LEVEL SECURITY;

--
-- Name: doc_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doc_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: document_control_audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_control_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: document_control_audit_events document_control_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_audit_insert ON public.document_control_audit_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = document_control_audit_events.company_id))))));


--
-- Name: document_control_audit_events document_control_audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_audit_read ON public.document_control_audit_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = document_control_audit_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'auditor'::text, 'document_controller'::text, 'records_manager'::text]))))))));


--
-- Name: document_control_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_control_config ENABLE ROW LEVEL SECURITY;

--
-- Name: document_control_config document_control_config_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_config_tenant_read ON public.document_control_config FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = document_control_config.company_id))))));


--
-- Name: document_control_config document_control_config_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_config_tenant_write ON public.document_control_config USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = document_control_config.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'records_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = document_control_config.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'records_manager'::text]))))))));


--
-- Name: document_control_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_control_files ENABLE ROW LEVEL SECURITY;

--
-- Name: document_control_files document_control_files_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_files_tenant_read ON public.document_control_files FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = document_control_files.company_id))))));


--
-- Name: document_control_files document_control_files_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_files_tenant_write ON public.document_control_files USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = document_control_files.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'records_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = document_control_files.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'records_manager'::text]))))))));


--
-- Name: document_control_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_control_records ENABLE ROW LEVEL SECURITY;

--
-- Name: document_control_records document_control_records_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_records_tenant_read ON public.document_control_records FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = document_control_records.company_id))))));


--
-- Name: document_control_records document_control_records_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_records_tenant_write ON public.document_control_records USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = document_control_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'records_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = document_control_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'records_manager'::text]))))))));


--
-- Name: document_control_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_control_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: document_control_revisions document_control_revisions_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_revisions_tenant_read ON public.document_control_revisions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = document_control_revisions.company_id))))));


--
-- Name: document_control_revisions document_control_revisions_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_control_revisions_tenant_write ON public.document_control_revisions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = document_control_revisions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'records_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = document_control_revisions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'records_manager'::text]))))))));


--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: elearning_courses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.elearning_courses ENABLE ROW LEVEL SECURITY;

--
-- Name: elearning_enrolments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.elearning_enrolments ENABLE ROW LEVEL SECURITY;

--
-- Name: elearning_quiz_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.elearning_quiz_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: elearning_quiz_attempts elearning_quiz_attempts_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY elearning_quiz_attempts_tenant_read ON public.elearning_quiz_attempts FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = elearning_quiz_attempts.company_id))))));


--
-- Name: elearning_quiz_attempts elearning_quiz_attempts_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY elearning_quiz_attempts_tenant_write ON public.elearning_quiz_attempts USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = elearning_quiz_attempts.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = elearning_quiz_attempts.company_id))))));


--
-- Name: emergency_activations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.emergency_activations ENABLE ROW LEVEL SECURITY;

--
-- Name: emergency_drills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.emergency_drills ENABLE ROW LEVEL SECURITY;

--
-- Name: emergency_equipment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.emergency_equipment ENABLE ROW LEVEL SECURITY;

--
-- Name: emergency_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.emergency_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_activity_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_activity_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_activity_credits engagement_activity_credits_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_activity_credits_manage ON public.engagement_activity_credits USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_activity_credits.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_activity_credits.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: engagement_activity_credits engagement_activity_credits_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_activity_credits_scope ON public.engagement_activity_credits FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_activity_credits.company_id) AND ((p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])) OR (engagement_activity_credits.person_id = auth.uid()))))))));


--
-- Name: engagement_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_assignments engagement_assignments_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_assignments_manage ON public.engagement_assignments USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_assignments.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_assignments.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_assignments engagement_assignments_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_assignments_read ON public.engagement_assignments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_assignments.company_id))))));


--
-- Name: engagement_audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_audit_events engagement_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_audit_insert ON public.engagement_audit_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_audit_events.company_id))))));


--
-- Name: engagement_audit_events engagement_audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_audit_read ON public.engagement_audit_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_audit_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'auditor'::text]))))))));


--
-- Name: engagement_calendar_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_calendar_events ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_calendar_events engagement_calendar_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_calendar_manage ON public.engagement_calendar_events USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_calendar_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_calendar_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: engagement_calendar_events engagement_calendar_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_calendar_scope ON public.engagement_calendar_events FOR SELECT USING (((person_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_calendar_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))));


--
-- Name: engagement_coaching_plans engagement_coaching_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_coaching_manage ON public.engagement_coaching_plans USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_coaching_plans.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'hr'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_coaching_plans.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'hr'::text]))))))));


--
-- Name: engagement_coaching_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_coaching_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_coaching_plans engagement_coaching_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_coaching_scope ON public.engagement_coaching_plans FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_coaching_plans.company_id) AND ((p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'hr'::text])) OR (engagement_coaching_plans.person_id = auth.uid()))))))));


--
-- Name: engagement_configuration_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_configuration_records ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_configuration_records engagement_configuration_records_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_configuration_records_manage ON public.engagement_configuration_records USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_configuration_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_configuration_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_configuration_records engagement_configuration_records_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_configuration_records_read ON public.engagement_configuration_records FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_configuration_records.company_id))))));


--
-- Name: engagement_configuration_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_configuration_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_configuration_versions engagement_configuration_versions_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_configuration_versions_manage ON public.engagement_configuration_versions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_configuration_versions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_configuration_versions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_configuration_versions engagement_configuration_versions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_configuration_versions_read ON public.engagement_configuration_versions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_configuration_versions.company_id))))));


--
-- Name: engagement_disputes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_disputes ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_disputes engagement_disputes_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_disputes_create ON public.engagement_disputes FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_disputes.company_id) AND (engagement_disputes.person_id = auth.uid())) OR ((p.company_id = engagement_disputes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'hr'::text]))))))));


--
-- Name: engagement_disputes engagement_disputes_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_disputes_manage ON public.engagement_disputes FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_disputes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'hr'::text]))))))));


--
-- Name: engagement_disputes engagement_disputes_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_disputes_scope ON public.engagement_disputes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_disputes.company_id) AND ((p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'hr'::text])) OR (engagement_disputes.person_id = auth.uid()))))))));


--
-- Name: engagement_kpi_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_kpi_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_kpi_definitions engagement_kpi_definitions_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_kpi_definitions_manage ON public.engagement_kpi_definitions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_kpi_definitions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_kpi_definitions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_kpi_definitions engagement_kpi_definitions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_kpi_definitions_read ON public.engagement_kpi_definitions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_kpi_definitions.company_id))))));


--
-- Name: engagement_mobile_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_mobile_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_mobile_drafts engagement_mobile_drafts_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_mobile_drafts_owner ON public.engagement_mobile_drafts USING (((owner_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_mobile_drafts.company_id))))))) WITH CHECK (((owner_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_mobile_drafts.company_id)))))));


--
-- Name: engagement_mobile_installations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_mobile_installations ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_mobile_installations engagement_mobile_installations_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_mobile_installations_owner ON public.engagement_mobile_installations USING (((person_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_mobile_installations.company_id))))))) WITH CHECK (((person_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_mobile_installations.company_id)))))));


--
-- Name: engagement_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_notifications engagement_notifications_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_notifications_manage ON public.engagement_notifications USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_notifications.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_notifications.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_notifications engagement_notifications_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_notifications_scope ON public.engagement_notifications FOR SELECT USING (((recipient_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_notifications.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))));


--
-- Name: engagement_person_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_person_results ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_person_results engagement_person_results_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_person_results_manage ON public.engagement_person_results USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_person_results.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_person_results.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: engagement_person_results engagement_person_results_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_person_results_scope ON public.engagement_person_results FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_person_results.company_id) AND ((p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'hr'::text, 'executive'::text])) OR (engagement_person_results.person_id = auth.uid()))))))));


--
-- Name: engagement_programmes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_programmes ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_programmes engagement_programmes_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_programmes_manage ON public.engagement_programmes USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_programmes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_programmes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_programmes engagement_programmes_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_programmes_read ON public.engagement_programmes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_programmes.company_id))))));


--
-- Name: engagement_qr_sessions engagement_qr_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_qr_scope ON public.engagement_qr_sessions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_qr_sessions.company_id) AND ((engagement_qr_sessions.person_id = auth.uid()) OR (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_qr_sessions.company_id) AND ((engagement_qr_sessions.person_id = auth.uid()) OR (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))));


--
-- Name: engagement_qr_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_qr_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_recognitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_recognitions ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_recognitions engagement_recognitions_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_recognitions_create ON public.engagement_recognitions FOR INSERT WITH CHECK (((nominated_by_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_recognitions.company_id)))))));


--
-- Name: engagement_recognitions engagement_recognitions_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_recognitions_manage ON public.engagement_recognitions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_recognitions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: engagement_recognitions engagement_recognitions_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_recognitions_scope ON public.engagement_recognitions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_recognitions.company_id) AND ((p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'hr'::text])) OR (engagement_recognitions.recipient_id = auth.uid()) OR ((engagement_recognitions.visibility = ANY (ARRAY['team'::text, 'organisation'::text])) AND (engagement_recognitions.status = 'approved'::text)))))))));


--
-- Name: engagement_report_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_report_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_report_definitions engagement_report_definitions_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_report_definitions_manage ON public.engagement_report_definitions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_report_definitions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_report_definitions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_report_definitions engagement_report_definitions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_report_definitions_read ON public.engagement_report_definitions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_report_definitions.company_id))))));


--
-- Name: engagement_review_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_review_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_review_templates engagement_review_templates_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_review_templates_manage ON public.engagement_review_templates USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_review_templates.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_review_templates.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_review_templates engagement_review_templates_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_review_templates_read ON public.engagement_review_templates FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_review_templates.company_id))))));


--
-- Name: engagement_seed_reconciliation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_seed_reconciliation ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_seed_reconciliation engagement_seed_reconciliation_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_seed_reconciliation_manage ON public.engagement_seed_reconciliation USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_seed_reconciliation.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_seed_reconciliation.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_seed_reconciliation engagement_seed_reconciliation_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_seed_reconciliation_read ON public.engagement_seed_reconciliation FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_seed_reconciliation.company_id))))));


--
-- Name: engagement_team_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_team_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_team_reviews engagement_team_reviews_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_team_reviews_manage ON public.engagement_team_reviews USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_team_reviews.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = engagement_team_reviews.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: engagement_team_reviews engagement_team_reviews_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_team_reviews_read ON public.engagement_team_reviews FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = engagement_team_reviews.company_id))))));


--
-- Name: engagement_team_reviews engagement_team_reviews_supervisor_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_team_reviews_supervisor_manage ON public.engagement_team_reviews USING (((owner_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.company_id = engagement_team_reviews.company_id) AND (p.role = ANY (ARRAY['manager'::text, 'site_manager'::text, 'supervisor'::text]))))))) WITH CHECK (((owner_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.company_id = engagement_team_reviews.company_id) AND (p.role = ANY (ARRAY['manager'::text, 'site_manager'::text, 'supervisor'::text])))))));


--
-- Name: environmental_inspections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.environmental_inspections ENABLE ROW LEVEL SECURITY;

--
-- Name: equipment_assurance_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equipment_assurance_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: equipment_assurance_profiles equipment_assurance_profiles_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_assurance_profiles_tenant_read ON public.equipment_assurance_profiles FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = equipment_assurance_profiles.company_id))))));


--
-- Name: equipment_assurance_profiles equipment_assurance_profiles_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_assurance_profiles_tenant_write ON public.equipment_assurance_profiles TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_assurance_profiles.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_assurance_profiles.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: equipment_assurance_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equipment_assurance_records ENABLE ROW LEVEL SECURITY;

--
-- Name: equipment_assurance_records equipment_assurance_records_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_assurance_records_tenant_read ON public.equipment_assurance_records FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = equipment_assurance_records.company_id))))));


--
-- Name: equipment_assurance_records equipment_assurance_records_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_assurance_records_tenant_write ON public.equipment_assurance_records TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_assurance_records.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_assurance_records.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: equipment_defects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equipment_defects ENABLE ROW LEVEL SECURITY;

--
-- Name: equipment_defects equipment_defects_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_defects_tenant_read ON public.equipment_defects FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = equipment_defects.company_id))))));


--
-- Name: equipment_defects equipment_defects_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_defects_tenant_write ON public.equipment_defects TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_defects.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_defects.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: equipment_maintenance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equipment_maintenance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: equipment_maintenance_events equipment_maintenance_events_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_maintenance_events_tenant_read ON public.equipment_maintenance_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = equipment_maintenance_events.company_id))))));


--
-- Name: equipment_maintenance_events equipment_maintenance_events_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_maintenance_events_tenant_write ON public.equipment_maintenance_events TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_maintenance_events.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_maintenance_events.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: equipment_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equipment_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: equipment_movements equipment_movements_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_movements_tenant_read ON public.equipment_movements FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = equipment_movements.company_id))))));


--
-- Name: equipment_movements equipment_movements_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_movements_tenant_write ON public.equipment_movements TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_movements.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = equipment_movements.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text]))))))));


--
-- Name: ert_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ert_members ENABLE ROW LEVEL SECURITY;

--
-- Name: esg_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.esg_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: event_sequence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_sequence ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: exposure_monitoring; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exposure_monitoring ENABLE ROW LEVEL SECURITY;

--
-- Name: fire_certificates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fire_certificates ENABLE ROW LEVEL SECURITY;

--
-- Name: fire_equipment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fire_equipment ENABLE ROW LEVEL SECURITY;

--
-- Name: fire_inspection_findings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fire_inspection_findings ENABLE ROW LEVEL SECURITY;

--
-- Name: fire_inspections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fire_inspections ENABLE ROW LEVEL SECURITY;

--
-- Name: fire_layout_symbols; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fire_layout_symbols ENABLE ROW LEVEL SECURITY;

--
-- Name: fire_layout_symbols fire_layout_symbols_company_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fire_layout_symbols_company_manage ON public.fire_layout_symbols USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = fire_layout_symbols.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'site_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = fire_layout_symbols.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'site_manager'::text]))))))));


--
-- Name: fire_layout_symbols fire_layout_symbols_company_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fire_layout_symbols_company_read ON public.fire_layout_symbols FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = fire_layout_symbols.company_id))))));


--
-- Name: fire_layouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fire_layouts ENABLE ROW LEVEL SECURITY;

--
-- Name: fire_layouts fire_layouts_company_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fire_layouts_company_manage ON public.fire_layouts USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = fire_layouts.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'site_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = fire_layouts.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'site_manager'::text]))))))));


--
-- Name: fire_layouts fire_layouts_company_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fire_layouts_company_read ON public.fire_layouts FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = fire_layouts.company_id))))));


--
-- Name: fuel_consumption; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fuel_consumption ENABLE ROW LEVEL SECURITY;

--
-- Name: hazard_library; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hazard_library ENABLE ROW LEVEL SECURITY;

--
-- Name: hazardous_waste; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hazardous_waste ENABLE ROW LEVEL SECURITY;

--
-- Name: hse_meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hse_meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_evidence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_evidence ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_mgmt_audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_mgmt_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_mgmt_audit_events incident_mgmt_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_mgmt_audit_insert ON public.incident_mgmt_audit_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = incident_mgmt_audit_events.company_id))))));


--
-- Name: incident_mgmt_audit_events incident_mgmt_audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_mgmt_audit_read ON public.incident_mgmt_audit_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = incident_mgmt_audit_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'auditor'::text]))))))));


--
-- Name: incident_mgmt_config_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_mgmt_config_records ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_mgmt_config_records incident_mgmt_config_records_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_mgmt_config_records_tenant_read ON public.incident_mgmt_config_records FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = incident_mgmt_config_records.company_id))))));


--
-- Name: incident_mgmt_config_records incident_mgmt_config_records_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_mgmt_config_records_tenant_write ON public.incident_mgmt_config_records USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = incident_mgmt_config_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = incident_mgmt_config_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: incident_mgmt_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_mgmt_records ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_mgmt_records incident_mgmt_records_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_mgmt_records_tenant_read ON public.incident_mgmt_records FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = incident_mgmt_records.company_id))))));


--
-- Name: incident_mgmt_records incident_mgmt_records_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_mgmt_records_tenant_write ON public.incident_mgmt_records USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = incident_mgmt_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = incident_mgmt_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: induction_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.induction_records ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_items ENABLE ROW LEVEL SECURITY;

--
-- Name: inspections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_sync_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_sync_log ENABLE ROW LEVEL SECURITY;

--
-- Name: integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: inv_sequence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inv_sequence ENABLE ROW LEVEL SECURITY;

--
-- Name: investigations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investigations ENABLE ROW LEVEL SECURITY;

--
-- Name: jsa_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jsa_records ENABLE ROW LEVEL SECURITY;

--
-- Name: kpi_config_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_config_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: kpi_config_audit kpi_config_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kpi_config_audit_insert ON public.kpi_config_audit FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = kpi_config_audit.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text]))))))));


--
-- Name: kpi_config_audit kpi_config_audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kpi_config_audit_read ON public.kpi_config_audit FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = kpi_config_audit.company_id))))));


--
-- Name: kpi_config_versions kpi_config_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kpi_config_manage ON public.kpi_config_versions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = kpi_config_versions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = kpi_config_versions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text]))))))));


--
-- Name: kpi_config_versions kpi_config_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kpi_config_read ON public.kpi_config_versions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = kpi_config_versions.company_id))))));


--
-- Name: kpi_config_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_config_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: kpi_indicators; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_indicators ENABLE ROW LEVEL SECURITY;

--
-- Name: kpi_monthly_data; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_monthly_data ENABLE ROW LEVEL SECURITY;

--
-- Name: kpis; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpis ENABLE ROW LEVEL SECURITY;

--
-- Name: kpis_v2; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpis_v2 ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_course_governance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_course_governance ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_course_governance learning_course_governance_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learning_course_governance_tenant_read ON public.learning_course_governance FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = learning_course_governance.company_id))))));


--
-- Name: learning_course_governance learning_course_governance_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learning_course_governance_tenant_write ON public.learning_course_governance USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = learning_course_governance.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'training_admin'::text, 'hr_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = learning_course_governance.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'training_admin'::text, 'hr_manager'::text]))))))));


--
-- Name: learning_external_providers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_external_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_external_providers learning_external_providers_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learning_external_providers_tenant_read ON public.learning_external_providers FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = learning_external_providers.company_id))))));


--
-- Name: learning_external_providers learning_external_providers_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learning_external_providers_tenant_write ON public.learning_external_providers USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = learning_external_providers.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'training_admin'::text, 'hr_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = learning_external_providers.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'training_admin'::text, 'hr_manager'::text]))))))));


--
-- Name: learning_practical_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_practical_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_practical_assessments learning_practical_assessments_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learning_practical_assessments_tenant_read ON public.learning_practical_assessments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = learning_practical_assessments.company_id))))));


--
-- Name: learning_practical_assessments learning_practical_assessments_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learning_practical_assessments_tenant_write ON public.learning_practical_assessments USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = learning_practical_assessments.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'training_admin'::text, 'hr_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = learning_practical_assessments.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'training_admin'::text, 'hr_manager'::text]))))))));


--
-- Name: learning_source_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_source_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_source_relationships learning_source_relationships_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learning_source_relationships_tenant_read ON public.learning_source_relationships FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = learning_source_relationships.company_id))))));


--
-- Name: learning_source_relationships learning_source_relationships_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learning_source_relationships_tenant_write ON public.learning_source_relationships USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = learning_source_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'training_admin'::text, 'hr_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = learning_source_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'training_admin'::text, 'hr_manager'::text]))))))));


--
-- Name: legal_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_changes legal_changes_delete_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_changes_delete_company ON public.legal_changes FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_changes.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'admin'::text]))))))));


--
-- Name: legal_changes legal_changes_insert_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_changes_insert_company ON public.legal_changes FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_changes.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: legal_changes legal_changes_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_changes_select_company ON public.legal_changes FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = legal_changes.company_id))))));


--
-- Name: legal_changes legal_changes_update_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_changes_update_company ON public.legal_changes FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_changes.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_changes.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: legal_compliance_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_compliance_records ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_compliance_records legal_compliance_records_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_compliance_records_tenant_read ON public.legal_compliance_records FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = legal_compliance_records.company_id))))));


--
-- Name: legal_compliance_records legal_compliance_records_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_compliance_records_tenant_write ON public.legal_compliance_records USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_compliance_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'compliance_manager'::text, 'legal_reviewer'::text, 'document_controller'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_compliance_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'compliance_manager'::text, 'legal_reviewer'::text, 'document_controller'::text]))))))));


--
-- Name: legal_compliance_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_compliance_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_compliance_relationships legal_compliance_relationships_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_compliance_relationships_tenant_read ON public.legal_compliance_relationships FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = legal_compliance_relationships.company_id))))));


--
-- Name: legal_compliance_relationships legal_compliance_relationships_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_compliance_relationships_tenant_write ON public.legal_compliance_relationships USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_compliance_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'compliance_manager'::text, 'legal_reviewer'::text, 'document_controller'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_compliance_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'compliance_manager'::text, 'legal_reviewer'::text, 'document_controller'::text]))))))));


--
-- Name: legal_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_register ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_requirements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_requirements ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_requirements legal_requirements_delete_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_requirements_delete_company ON public.legal_requirements FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_requirements.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'admin'::text]))))))));


--
-- Name: legal_requirements legal_requirements_insert_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_requirements_insert_company ON public.legal_requirements FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_requirements.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: legal_requirements legal_requirements_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_requirements_select_company ON public.legal_requirements FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = legal_requirements.company_id))))));


--
-- Name: legal_requirements legal_requirements_update_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_requirements_update_company ON public.legal_requirements FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_requirements.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = legal_requirements.company_id) AND (p.role = ANY (ARRAY['company_admin'::text, 'hse_manager'::text, 'site_manager'::text, 'supervisor'::text, 'manager'::text, 'admin'::text]))))))));


--
-- Name: legislative_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legislative_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: location_identity_backfill_review; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_identity_backfill_review ENABLE ROW LEVEL SECURITY;

--
-- Name: location_identity_backfill_review location_identity_review_admin_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY location_identity_review_admin_access ON public.location_identity_backfill_review USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = location_identity_backfill_review.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = location_identity_backfill_review.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text]))))))));


--
-- Name: map_activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.map_activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: map_activity_log map_activity_log_company_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY map_activity_log_company_access ON public.map_activity_log USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = map_activity_log.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = map_activity_log.company_id))))));


--
-- Name: map_source_backfill_review; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.map_source_backfill_review ENABLE ROW LEVEL SECURITY;

--
-- Name: map_source_backfill_review map_source_backfill_review_company_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY map_source_backfill_review_company_access ON public.map_source_backfill_review USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = map_source_backfill_review.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = map_source_backfill_review.company_id))))));


--
-- Name: medical_surveillance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.medical_surveillance ENABLE ROW LEVEL SECURITY;

--
-- Name: meeting_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meeting_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: meeting_series; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meeting_series ENABLE ROW LEVEL SECURITY;

--
-- Name: moc_change_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.moc_change_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: moc_change_requests moc_change_requests_company_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY moc_change_requests_company_access ON public.moc_change_requests USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = moc_change_requests.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = moc_change_requests.company_id))))));


--
-- Name: muster_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.muster_points ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_audit_events noise_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_audit_insert ON public.noise_mgmt_audit_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_audit_events.company_id))))));


--
-- Name: noise_mgmt_audit_events noise_audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_audit_read ON public.noise_mgmt_audit_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_audit_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_health_statuses noise_health_restricted_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_health_restricted_read ON public.noise_mgmt_health_statuses FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_health_statuses.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'occupational_health'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_health_statuses noise_health_restricted_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_health_restricted_write ON public.noise_mgmt_health_statuses USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_health_statuses.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'occupational_health'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_health_statuses.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'occupational_health'::text]))))))));


--
-- Name: noise_measurements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_measurements ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_assessment_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_assessment_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_assessment_profiles noise_mgmt_assessment_profiles_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_assessment_profiles_tenant_read ON public.noise_mgmt_assessment_profiles FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_assessment_profiles.company_id))))));


--
-- Name: noise_mgmt_assessment_profiles noise_mgmt_assessment_profiles_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_assessment_profiles_tenant_write ON public.noise_mgmt_assessment_profiles USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_assessment_profiles.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_assessment_profiles.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_control_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_control_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_control_plans noise_mgmt_control_plans_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_control_plans_tenant_read ON public.noise_mgmt_control_plans FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_control_plans.company_id))))));


--
-- Name: noise_mgmt_control_plans noise_mgmt_control_plans_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_control_plans_tenant_write ON public.noise_mgmt_control_plans USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_control_plans.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_control_plans.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_exposure_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_exposure_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_exposure_assessments noise_mgmt_exposure_assessments_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_exposure_assessments_tenant_read ON public.noise_mgmt_exposure_assessments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_exposure_assessments.company_id))))));


--
-- Name: noise_mgmt_exposure_assessments noise_mgmt_exposure_assessments_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_exposure_assessments_tenant_write ON public.noise_mgmt_exposure_assessments USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_exposure_assessments.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_exposure_assessments.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_field_surveys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_field_surveys ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_field_surveys noise_mgmt_field_surveys_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_field_surveys_tenant_read ON public.noise_mgmt_field_surveys FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_field_surveys.company_id))))));


--
-- Name: noise_mgmt_field_surveys noise_mgmt_field_surveys_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_field_surveys_tenant_write ON public.noise_mgmt_field_surveys USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_field_surveys.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_field_surveys.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_health_statuses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_health_statuses ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_hearing_protectors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_hearing_protectors ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_hearing_protectors noise_mgmt_hearing_protectors_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_hearing_protectors_tenant_read ON public.noise_mgmt_hearing_protectors FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_hearing_protectors.company_id))))));


--
-- Name: noise_mgmt_hearing_protectors noise_mgmt_hearing_protectors_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_hearing_protectors_tenant_write ON public.noise_mgmt_hearing_protectors USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_hearing_protectors.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_hearing_protectors.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_instruments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_instruments ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_instruments noise_mgmt_instruments_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_instruments_tenant_read ON public.noise_mgmt_instruments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_instruments.company_id))))));


--
-- Name: noise_mgmt_instruments noise_mgmt_instruments_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_instruments_tenant_write ON public.noise_mgmt_instruments USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_instruments.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_instruments.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_maps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_maps ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_maps noise_mgmt_maps_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_maps_tenant_read ON public.noise_mgmt_maps FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_maps.company_id))))));


--
-- Name: noise_mgmt_maps noise_mgmt_maps_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_maps_tenant_write ON public.noise_mgmt_maps USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_maps.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_maps.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_measurement_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_measurement_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_measurement_plans noise_mgmt_measurement_plans_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_measurement_plans_tenant_read ON public.noise_mgmt_measurement_plans FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_measurement_plans.company_id))))));


--
-- Name: noise_mgmt_measurement_plans noise_mgmt_measurement_plans_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_measurement_plans_tenant_write ON public.noise_mgmt_measurement_plans USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_measurement_plans.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_measurement_plans.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_measurements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_measurements ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_measurements noise_mgmt_measurements_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_measurements_tenant_read ON public.noise_mgmt_measurements FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_measurements.company_id))))));


--
-- Name: noise_mgmt_measurements noise_mgmt_measurements_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_measurements_tenant_write ON public.noise_mgmt_measurements USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_measurements.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_measurements.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_programmes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_programmes ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_programmes noise_mgmt_programmes_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_programmes_tenant_read ON public.noise_mgmt_programmes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_programmes.company_id))))));


--
-- Name: noise_mgmt_programmes noise_mgmt_programmes_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_programmes_tenant_write ON public.noise_mgmt_programmes USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_programmes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_programmes.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_reports noise_mgmt_reports_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_reports_tenant_read ON public.noise_mgmt_reports FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_reports.company_id))))));


--
-- Name: noise_mgmt_reports noise_mgmt_reports_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_reports_tenant_write ON public.noise_mgmt_reports USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_reports.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_reports.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_segs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_segs ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_segs noise_mgmt_segs_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_segs_tenant_read ON public.noise_mgmt_segs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_segs.company_id))))));


--
-- Name: noise_mgmt_segs noise_mgmt_segs_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_segs_tenant_write ON public.noise_mgmt_segs USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_segs.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_segs.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_sources noise_mgmt_sources_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_sources_tenant_read ON public.noise_mgmt_sources FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_sources.company_id))))));


--
-- Name: noise_mgmt_sources noise_mgmt_sources_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_sources_tenant_write ON public.noise_mgmt_sources USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_sources.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_sources.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_mgmt_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_mgmt_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: noise_mgmt_tasks noise_mgmt_tasks_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_tasks_tenant_read ON public.noise_mgmt_tasks FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = noise_mgmt_tasks.company_id))))));


--
-- Name: noise_mgmt_tasks noise_mgmt_tasks_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY noise_mgmt_tasks_tenant_write ON public.noise_mgmt_tasks USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_tasks.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = noise_mgmt_tasks.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'auditor'::text]))))))));


--
-- Name: noise_surveys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noise_surveys ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_acknowledgement_settings notification_ack_settings_company_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_ack_settings_company_read ON public.notification_acknowledgement_settings FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = notification_acknowledgement_settings.company_id))))));


--
-- Name: notification_acknowledgement_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_acknowledgement_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_escalation_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_escalation_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_escalation_recipients notification_escalation_recipients_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_escalation_recipients_admin ON public.notification_escalation_recipients USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = notification_escalation_recipients.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = notification_escalation_recipients.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text]))))))));


--
-- Name: notification_escalation_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_escalation_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_escalation_settings notification_escalation_settings_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_escalation_settings_admin ON public.notification_escalation_settings USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = notification_escalation_settings.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = notification_escalation_settings.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text]))))))));


--
-- Name: notification_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_events notification_events_company_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_events_company_access ON public.notification_events USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = notification_events.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = notification_events.company_id))))));


--
-- Name: notification_link_opens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_link_opens ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_link_opens notification_link_opens_company_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_link_opens_company_read ON public.notification_link_opens FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = notification_link_opens.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: notification_user_preferences notification_preferences_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_own_insert ON public.notification_user_preferences FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.company_id = notification_user_preferences.company_id))))));


--
-- Name: notification_user_preferences notification_preferences_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_own_read ON public.notification_user_preferences FOR SELECT TO authenticated USING ((profile_id = auth.uid()));


--
-- Name: notification_user_preferences notification_preferences_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_own_update ON public.notification_user_preferences FOR UPDATE TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: notification_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_user_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_queue nq_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nq_company ON public.notification_queue TO authenticated USING (((company_id = ( SELECT profiles.company_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'sephs_admin'::text)))))) WITH CHECK (((company_id = ( SELECT profiles.company_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'sephs_admin'::text))))));


--
-- Name: objectives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.objectives ENABLE ROW LEVEL SECURITY;

--
-- Name: occupational_diseases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.occupational_diseases ENABLE ROW LEVEL SECURITY;

--
-- Name: oversight_log ol_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ol_admin_write ON public.oversight_log FOR INSERT TO authenticated WITH CHECK (public.is_sephs_admin());


--
-- Name: oversight_log ol_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ol_read ON public.oversight_log FOR SELECT TO authenticated USING ((public.is_sephs_admin() OR (client_company_id = public.auth_company_id())));


--
-- Name: oversight_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.oversight_log ENABLE ROW LEVEL SECURITY;

--
-- Name: people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

--
-- Name: people_certifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.people_certifications ENABLE ROW LEVEL SECURITY;

--
-- Name: permit_activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permit_activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: permits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permits ENABLE ROW LEVEL SECURITY;

--
-- Name: person_identity_backfill_review; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.person_identity_backfill_review ENABLE ROW LEVEL SECURITY;

--
-- Name: person_identity_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.person_identity_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: person_identity_decisions person_identity_decisions_admin_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY person_identity_decisions_admin_access ON public.person_identity_decisions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = person_identity_decisions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text]))))))));


--
-- Name: person_identity_backfill_review person_identity_review_admin_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY person_identity_review_admin_access ON public.person_identity_backfill_review USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = person_identity_backfill_review.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = person_identity_backfill_review.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text]))))))));


--
-- Name: ppe_catalogue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ppe_catalogue ENABLE ROW LEVEL SECURITY;

--
-- Name: ppe_inspections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ppe_inspections ENABLE ROW LEVEL SECURITY;

--
-- Name: ppe_issuance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ppe_issuance ENABLE ROW LEVEL SECURITY;

--
-- Name: ppe_replacements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ppe_replacements ENABLE ROW LEVEL SECURITY;

--
-- Name: prestart_inspections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prestart_inspections ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profile_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_delete ON public.profiles FOR DELETE TO authenticated USING ((public.current_user_role() = 'sephs_admin'::text));


--
-- Name: profiles profile_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));


--
-- Name: profiles profile_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_read_own ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: profiles profile_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_select ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR ((public.current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'hr'::text, 'executive'::text])) AND (company_id = public.current_user_company())) OR (public.current_user_role() = 'sephs_admin'::text)));


--
-- Name: profiles profile_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_update ON public.profiles FOR UPDATE TO authenticated USING (((id = auth.uid()) OR ((public.current_user_role() = 'admin'::text) AND (company_id = public.current_user_company())) OR (public.current_user_role() = 'sephs_admin'::text))) WITH CHECK (((id = auth.uid()) OR ((public.current_user_role() = 'admin'::text) AND (company_id = public.current_user_company())) OR (public.current_user_role() = 'sephs_admin'::text)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: push_delivery_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_delivery_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: push_delivery_jobs push_delivery_jobs_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_delivery_jobs_own_select ON public.push_delivery_jobs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.user_notifications n
  WHERE ((n.id = push_delivery_jobs.user_notification_id) AND (n.recipient_profile_id = auth.uid())))));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_own_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_own_delete ON public.push_subscriptions FOR DELETE TO authenticated USING ((recipient_profile_id = auth.uid()));


--
-- Name: push_subscriptions push_subscriptions_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_own_insert ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (((recipient_profile_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.company_id = push_subscriptions.company_id))))));


--
-- Name: push_subscriptions push_subscriptions_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_own_select ON public.push_subscriptions FOR SELECT TO authenticated USING ((recipient_profile_id = auth.uid()));


--
-- Name: push_subscriptions push_subscriptions_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_own_update ON public.push_subscriptions FOR UPDATE TO authenticated USING ((recipient_profile_id = auth.uid())) WITH CHECK (((recipient_profile_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.company_id = push_subscriptions.company_id))))));


--
-- Name: qr_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qr_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: qr_registry qr_registry_company_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qr_registry_company_access ON public.qr_registry USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = qr_registry.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = qr_registry.company_id))))));


--
-- Name: ra_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ra_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: ra_sequence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ra_sequence ENABLE ROW LEVEL SECURITY;

--
-- Name: ra_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ra_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: record_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.record_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: record_relationships record_relationships_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY record_relationships_tenant_read ON public.record_relationships FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = record_relationships.company_id)) AND ((COALESCE((record_relationships.applicability ->> 'confidentiality'::text), 'general'::text) <> 'privileged'::text) OR (p.role = ANY (ARRAY['sephs_admin'::text, 'admin'::text, 'hse_manager'::text, 'compliance_manager'::text])))))));


--
-- Name: record_relationships record_relationships_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY record_relationships_tenant_write ON public.record_relationships USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = record_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'compliance_manager'::text, 'risk_assessor'::text, 'training_admin'::text, 'hr_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = record_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text, 'compliance_manager'::text, 'risk_assessor'::text, 'training_admin'::text, 'hr_manager'::text]))))))));


--
-- Name: reference_identity_backfill_review; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reference_identity_backfill_review ENABLE ROW LEVEL SECURITY;

--
-- Name: reference_identity_backfill_review reference_identity_review_admin_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reference_identity_review_admin_access ON public.reference_identity_backfill_review USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = reference_identity_backfill_review.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = reference_identity_backfill_review.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text]))))))));


--
-- Name: relationship_module_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.relationship_module_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: relationship_module_registry relationship_registry_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY relationship_registry_admin ON public.relationship_module_registry USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'sephs_admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'sephs_admin'::text)))));


--
-- Name: relationship_module_registry relationship_registry_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY relationship_registry_read ON public.relationship_module_registry FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: relationship_validation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.relationship_validation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: relationship_validation_runs relationship_validation_runs_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY relationship_validation_runs_tenant_read ON public.relationship_validation_runs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['sephs_admin'::text, 'admin'::text, 'hse_manager'::text, 'hse_officer'::text])) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = relationship_validation_runs.company_id))))));


--
-- Name: risk_assessment_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_assessment_items ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_assessment_operational_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_assessment_operational_records ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_assessment_operational_records risk_assessment_operational_records_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_assessment_operational_records_tenant_read ON public.risk_assessment_operational_records FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = risk_assessment_operational_records.company_id))))));


--
-- Name: risk_assessment_operational_records risk_assessment_operational_records_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_assessment_operational_records_tenant_write ON public.risk_assessment_operational_records USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = risk_assessment_operational_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'risk_assessor'::text, 'risk_reviewer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = risk_assessment_operational_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'risk_assessor'::text, 'risk_reviewer'::text]))))))));


--
-- Name: risk_assessment_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_assessment_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_assessment_relationships risk_assessment_relationships_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_assessment_relationships_tenant_read ON public.risk_assessment_relationships FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = risk_assessment_relationships.company_id))))));


--
-- Name: risk_assessment_relationships risk_assessment_relationships_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_assessment_relationships_tenant_write ON public.risk_assessment_relationships USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = risk_assessment_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'risk_assessor'::text, 'risk_reviewer'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = risk_assessment_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'risk_assessor'::text, 'risk_reviewer'::text]))))))));


--
-- Name: risk_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: rollout_cohort_transitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rollout_cohort_transitions ENABLE ROW LEVEL SECURITY;

--
-- Name: company_rollout_cohorts rollout_cohorts_platform_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rollout_cohorts_platform_write ON public.company_rollout_cohorts USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'sephs_admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'sephs_admin'::text)))));


--
-- Name: company_rollout_cohorts rollout_cohorts_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rollout_cohorts_tenant_read ON public.company_rollout_cohorts FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = company_rollout_cohorts.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: rollout_health_events rollout_health_authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rollout_health_authenticated_insert ON public.rollout_health_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = rollout_health_events.company_id))))));


--
-- Name: rollout_health_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rollout_health_events ENABLE ROW LEVEL SECURITY;

--
-- Name: rollout_health_events rollout_health_platform_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rollout_health_platform_update ON public.rollout_health_events FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'sephs_admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'sephs_admin'::text)))));


--
-- Name: rollout_health_events rollout_health_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rollout_health_tenant_read ON public.rollout_health_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = rollout_health_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: rollout_cohort_transitions rollout_transitions_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rollout_transitions_tenant_read ON public.rollout_cohort_transitions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = rollout_cohort_transitions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text]))))))));


--
-- Name: safety_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: safety_bulletins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_bulletins ENABLE ROW LEVEL SECURITY;

--
-- Name: safety_observations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_observations ENABLE ROW LEVEL SECURITY;

--
-- Name: security_sla_settings security_sla_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY security_sla_insert_admin ON public.security_sla_settings FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = security_sla_settings.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text]))))))));


--
-- Name: security_sla_settings security_sla_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY security_sla_select_company ON public.security_sla_settings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = security_sla_settings.company_id))))));


--
-- Name: security_sla_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.security_sla_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: security_sla_settings security_sla_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY security_sla_update_admin ON public.security_sla_settings FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = security_sla_settings.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = security_sla_settings.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'company_admin'::text, 'hse_manager'::text]))))))));


--
-- Name: sites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

--
-- Name: sop_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sop_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: sop_video_evidence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sop_video_evidence ENABLE ROW LEVEL SECURITY;

--
-- Name: sop_video_evidence sop_video_evidence_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sop_video_evidence_tenant_read ON public.sop_video_evidence FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = sop_video_evidence.company_id))))));


--
-- Name: sop_video_evidence sop_video_evidence_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sop_video_evidence_tenant_write ON public.sop_video_evidence USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = sop_video_evidence.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = sop_video_evidence.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text]))))))));


--
-- Name: sop_video_projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sop_video_projects ENABLE ROW LEVEL SECURITY;

--
-- Name: sop_video_projects sop_video_projects_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sop_video_projects_tenant_read ON public.sop_video_projects FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = sop_video_projects.company_id))))));


--
-- Name: sop_video_projects sop_video_projects_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sop_video_projects_tenant_write ON public.sop_video_projects USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = sop_video_projects.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = sop_video_projects.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text]))))))));


--
-- Name: sop_video_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sop_video_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: sop_video_relationships sop_video_relationships_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sop_video_relationships_tenant_read ON public.sop_video_relationships FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = sop_video_relationships.company_id))))));


--
-- Name: sop_video_relationships sop_video_relationships_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sop_video_relationships_tenant_write ON public.sop_video_relationships USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = sop_video_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = sop_video_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text]))))))));


--
-- Name: spill_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spill_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: spirometry_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spirometry_records ENABLE ROW LEVEL SECURITY;

--
-- Name: swms_configuration_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.swms_configuration_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: swms_configuration_versions swms_configuration_versions_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY swms_configuration_versions_tenant_read ON public.swms_configuration_versions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = swms_configuration_versions.company_id))))));


--
-- Name: swms_configuration_versions swms_configuration_versions_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY swms_configuration_versions_tenant_write ON public.swms_configuration_versions USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = swms_configuration_versions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = swms_configuration_versions.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text]))))))));


--
-- Name: swms_operational_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.swms_operational_records ENABLE ROW LEVEL SECURITY;

--
-- Name: swms_operational_records swms_operational_records_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY swms_operational_records_tenant_read ON public.swms_operational_records FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = swms_operational_records.company_id))))));


--
-- Name: swms_operational_records swms_operational_records_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY swms_operational_records_tenant_write ON public.swms_operational_records USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = swms_operational_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = swms_operational_records.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text]))))))));


--
-- Name: swms_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.swms_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: swms_relationships swms_relationships_tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY swms_relationships_tenant_read ON public.swms_relationships FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = swms_relationships.company_id))))));


--
-- Name: swms_relationships swms_relationships_tenant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY swms_relationships_tenant_write ON public.swms_relationships USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = swms_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = swms_relationships.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text, 'hse_officer'::text, 'manager'::text, 'site_manager'::text, 'supervisor'::text, 'document_controller'::text]))))))));


--
-- Name: action_tracker tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.action_tracker TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: audiometry_records tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.audiometry_records TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: audit_findings tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.audit_findings TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: authorisations tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.authorisations TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: bcp_records tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.bcp_records TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: checklist_templates tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.checklist_templates TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: competencies tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.competencies TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: competency_matrix tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.competency_matrix TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: compliance_assessments tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.compliance_assessments TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: compliance_audits tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.compliance_audits TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: compliance_calendar tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.compliance_calendar TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: compliance_gaps tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.compliance_gaps TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: contractor_authorisations tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.contractor_authorisations TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: contractor_evaluations tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.contractor_evaluations TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: contractor_incidents tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.contractor_incidents TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: contractor_preassessments tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.contractor_preassessments TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: contractors tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.contractors TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: control_library tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.control_library TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: doc_acknowledgements tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.doc_acknowledgements TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: doc_controlled_copies tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.doc_controlled_copies TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: doc_revisions tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.doc_revisions TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: documents tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.documents TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: elearning_courses tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.elearning_courses TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: elearning_enrolments tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.elearning_enrolments TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: emergency_activations tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.emergency_activations TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: emergency_drills tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.emergency_drills TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: emergency_equipment tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.emergency_equipment TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: emergency_plans tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.emergency_plans TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: environmental_inspections tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.environmental_inspections TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: ert_members tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.ert_members TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: esg_targets tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.esg_targets TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: event_sequence tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.event_sequence TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: events tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.events TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: exposure_monitoring tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.exposure_monitoring TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: fuel_consumption tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.fuel_consumption TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: hazard_library tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.hazard_library TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: hazardous_waste tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.hazardous_waste TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: hse_meetings tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.hse_meetings TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: incident_evidence tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.incident_evidence TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: induction_records tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.induction_records TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: inspections tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.inspections TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: integration_sync_log tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.integration_sync_log TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: integrations tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.integrations TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: inv_sequence tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.inv_sequence TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: investigations tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.investigations TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: jsa_records tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.jsa_records TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: kpi_indicators tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.kpi_indicators TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: kpi_monthly_data tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.kpi_monthly_data TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: kpis tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.kpis TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: kpis_v2 tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.kpis_v2 TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: legal_changes tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.legal_changes TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: legal_register tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.legal_register TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: legal_requirements tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.legal_requirements TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: legislative_changes tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.legislative_changes TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: map_activity_log tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.map_activity_log TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: medical_surveillance tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.medical_surveillance TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: meeting_series tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.meeting_series TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: muster_points tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.muster_points TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: noise_surveys tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.noise_surveys TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: notification_settings tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.notification_settings TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: objectives tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.objectives TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: occupational_diseases tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.occupational_diseases TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: people tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.people TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: people_certifications tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.people_certifications TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: permit_activity_log tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.permit_activity_log TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: permits tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.permits TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: ppe_catalogue tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.ppe_catalogue TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: ppe_inspections tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.ppe_inspections TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: ppe_issuance tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.ppe_issuance TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: ppe_replacements tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.ppe_replacements TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: prestart_inspections tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.prestart_inspections TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: ra_revisions tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.ra_revisions TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: ra_sequence tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.ra_sequence TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: ra_templates tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.ra_templates TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: risk_assessments tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.risk_assessments TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: safety_alerts tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.safety_alerts TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: safety_bulletins tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.safety_bulletins TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: safety_observations tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.safety_observations TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: sites tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.sites TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: sop_documents tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.sop_documents TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: spill_reports tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.spill_reports TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: spirometry_records tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.spirometry_records TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: tool_checklist_templates tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.tool_checklist_templates TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: tool_inspections tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.tool_inspections TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: toolbox_talks tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.toolbox_talks TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: tools_register tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.tools_register TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: training_followup tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.training_followup TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: training_needs tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.training_needs TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: training_plan tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.training_plan TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: training_sessions tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.training_sessions TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: user_site_access tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.user_site_access TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: vaccination_records tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.vaccination_records TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: waste_records tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.waste_records TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: water_usage tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.water_usage TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: work_schedule tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all ON public.work_schedule TO authenticated USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin())) WITH CHECK (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: fire_certificates tenant_all_fire_certs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all_fire_certs ON public.fire_certificates USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: fire_equipment tenant_all_fire_equip; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all_fire_equip ON public.fire_equipment USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: fire_inspection_findings tenant_all_fire_findings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all_fire_findings ON public.fire_inspection_findings USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: fire_inspections tenant_all_fire_insp; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_all_fire_insp ON public.fire_inspections USING (((company_id = public.auth_company_id()) OR public.is_sephs_admin()));


--
-- Name: tool_checklist_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tool_checklist_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: tool_inspections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tool_inspections ENABLE ROW LEVEL SECURITY;

--
-- Name: toolbox_talks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.toolbox_talks ENABLE ROW LEVEL SECURITY;

--
-- Name: tools_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tools_register ENABLE ROW LEVEL SECURITY;

--
-- Name: training_followup; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_followup ENABLE ROW LEVEL SECURITY;

--
-- Name: training_needs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_needs ENABLE ROW LEVEL SECURITY;

--
-- Name: training_plan; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_plan ENABLE ROW LEVEL SECURITY;

--
-- Name: training_requirements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_requirements ENABLE ROW LEVEL SECURITY;

--
-- Name: training_requirements training_requirements_company_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY training_requirements_company_access ON public.training_requirements USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = training_requirements.company_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = training_requirements.company_id))))));


--
-- Name: training_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notifications user_notifications_recipient_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_notifications_recipient_select ON public.user_notifications FOR SELECT TO authenticated USING ((recipient_profile_id = auth.uid()));


--
-- Name: user_notifications user_notifications_recipient_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_notifications_recipient_update ON public.user_notifications FOR UPDATE TO authenticated USING ((recipient_profile_id = auth.uid())) WITH CHECK (((recipient_profile_id = auth.uid()) AND ((acknowledged_by IS NULL) OR (acknowledged_by = auth.uid()))));


--
-- Name: user_site_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_site_access ENABLE ROW LEVEL SECURITY;

--
-- Name: vaccination_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vaccination_records ENABLE ROW LEVEL SECURITY;

--
-- Name: waste_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waste_records ENABLE ROW LEVEL SECURITY;

--
-- Name: water_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.water_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_channel_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_channel_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_consent_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_consent_events ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_consent_events whatsapp_consent_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_consent_own_read ON public.whatsapp_consent_events FOR SELECT TO authenticated USING (((profile_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = whatsapp_consent_events.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text])))))))));


--
-- Name: whatsapp_delivery_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_delivery_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_delivery_jobs whatsapp_jobs_own_or_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_jobs_own_or_admin_read ON public.whatsapp_delivery_jobs FOR SELECT TO authenticated USING (((recipient_profile_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = whatsapp_delivery_jobs.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text])))))))));


--
-- Name: whatsapp_channel_settings whatsapp_settings_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_settings_admin_write ON public.whatsapp_channel_settings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = whatsapp_channel_settings.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR ((p.company_id = whatsapp_channel_settings.company_id) AND (p.role = ANY (ARRAY['admin'::text, 'hse_manager'::text]))))))));


--
-- Name: whatsapp_channel_settings whatsapp_settings_company_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_settings_company_read ON public.whatsapp_channel_settings FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.role = 'sephs_admin'::text) OR (p.company_id = whatsapp_channel_settings.company_id))))));


--
-- Name: work_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_schedule ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict wtJ7YEDKizyDhK6bqgEhWti3nUNbF49ZQHmSwQq2To4bxPdg0rXqdGsrrGNEGrV
