-- Account provisioning links to canonical People identities. This migration
-- changes no existing identities; reconciliation is an explicit preview/apply.
begin;

do $user_people_preflight$
declare missing text[]:='{}'; item record; field text;
begin
  for item in select * from (values
    ('profiles',array['id','company_id','full_name','role','status','permissions','email','real_email','phone','mobile_phone','synthetic_email','must_change_password','job_title','department','site','contractor_company','invited_by','updated_at']),
    ('people',array['id','company_id','person_type','first_name','last_name','email','phone','employee_number','job_title','department','site','company_name','status','created_by']),
    ('companies',array['id']),
    ('person_identity_decisions',array['company_id','source_table','source_id','decision','selected_person_id','legacy_name','decision_note','decided_by'])
  ) as required(table_name,column_names) loop
    if to_regclass('public.'||item.table_name) is null then missing:=array_append(missing,'table public.'||item.table_name);
    else
      foreach field in array item.column_names loop
        if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.table_name) and attname=field and attnum>0 and not attisdropped)
        then missing:=array_append(missing,'column public.'||item.table_name||'.'||field);end if;
      end loop;
    end if;
  end loop;
  if to_regclass('auth.users') is null then missing:=array_append(missing,'table auth.users');end if;
  if exists(select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and attname='person_id' and not attisdropped and atttypid<>'uuid'::regtype)
  then missing:=array_append(missing,'UUID type for public.profiles.person_id');end if;
  if cardinality(missing)>0 then raise exception using message='People/user linking prerequisites are incomplete',detail=array_to_string(missing,'; '),hint='Restore the listed core schema before running this complete migration';end if;
end $user_people_preflight$;

alter table public.profiles add column if not exists person_id uuid references public.people(id) on delete set null;
create unique index if not exists profiles_person_id_unique on public.profiles(person_id) where person_id is not null;

-- Support the role already offered by user administration without discarding
-- additional role allowances in an existing company deployment.
do $user_people_roles$
declare previous record;
begin
  select pg_get_expr(conbin,conrelid) as expression,convalidated,connoinherit into previous
    from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_role_check' and contype='c';
  if found and position('hse_officer' in previous.expression)=0 then
    alter table public.profiles drop constraint profiles_role_check;
    execute format('alter table public.profiles add constraint profiles_role_check check ((%s) or role=%L)%s%s',
      previous.expression,'hse_officer',case when previous.connoinherit then ' no inherit' else '' end,case when previous.convalidated then '' else ' not valid' end);
  end if;
end $user_people_roles$;

create or replace function public.user_person_email_key(value text) returns text
language sql immutable set search_path=pg_catalog as $$
  select case when lower(btrim(value)) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and lower(btrim(value)) !~ '[.]local$' then lower(btrim(value)) else null end
$$;
create or replace function public.user_person_phone_key(value text) returns text
language sql immutable set search_path=pg_catalog as $$
  select case when regexp_replace(btrim(value),'[[:space:]().-]','','g') ~ '^\+[1-9][0-9]{7,14}$'
    then regexp_replace(btrim(value),'[[:space:]().-]','','g') else null end
$$;
revoke all on function public.user_person_email_key(text),public.user_person_phone_key(text) from public,anon;
grant execute on function public.user_person_email_key(text),public.user_person_phone_key(text) to authenticated,service_role;
create index if not exists people_user_email_match on public.people(company_id,public.user_person_email_key(email));
create index if not exists people_user_phone_match on public.people(company_id,public.user_person_phone_key(phone));

-- The existing person FK alone does not protect the company relationship.
-- A shared row lock also serializes linking against a concurrent People move.
create or replace function public.guard_profile_person_company() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare person_company uuid;
begin
  if tg_table_name='profiles' then
    if new.person_id is null then return new;end if;
    select company_id into person_company from public.people where id=new.person_id for share;
    if not found or person_company is distinct from new.company_id then
      raise exception 'The linked person must belong to the same company as the user' using errcode='23514';
    end if;
  elsif new.company_id is distinct from old.company_id and exists(
    select 1 from public.profiles where person_id=new.id and company_id is distinct from new.company_id
  ) then
    raise exception 'A linked person cannot move company while their user account belongs to another company' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_profile_person_company() from public,anon,authenticated;
drop trigger if exists profile_person_company_guard on public.profiles;
create trigger profile_person_company_guard before insert or update of person_id,company_id on public.profiles
  for each row execute function public.guard_profile_person_company();
drop trigger if exists people_profile_company_guard on public.people;
create trigger people_profile_company_guard before update of company_id on public.people
  for each row execute function public.guard_profile_person_company();

create or replace function public.admin_link_user_person(
  p_actor_id uuid,p_company_id uuid,p_user_id uuid,p_profile jsonb,p_person_id uuid default null,
  p_preview boolean default true,p_allow_new_person boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  actor public.profiles; target public.profiles; linked public.profiles; person public.people;
  rules jsonb; emails text[]; phones text[]; profile_ids uuid[]; person_ids uuid[];
  candidate_json jsonb:='[]'; display_name text; name_key text; given_name text; family_name text;
  login_email text; login_key text; contact_email text; contact_phone text; desired_role text; desired_status text;
  is_existing boolean:=false; person_created boolean:=false; reason text; output_user uuid;
  new_account boolean:=not coalesce(p_preview,true) and coalesce((p_profile->>'_new_account')::boolean,false);
begin
  if p_company_id is null then raise exception 'Select a company before linking a user' using errcode='42501';end if;
  -- Lock before taking any profile row locks, including a self-linking actor.
  perform pg_advisory_xact_lock(hashtextextended('people-user-link/'||p_company_id::text,0));
  select * into actor from public.profiles where id=p_actor_id for share;
  if not found or actor.status is distinct from 'active' or (actor.role is distinct from 'admin' and actor.role is distinct from 'sephs_admin')
    or p_company_id is null or (actor.role<>'sephs_admin' and actor.company_id is distinct from p_company_id)
  then raise exception 'An active administrator for this company is required' using errcode='42501';end if;
  if not exists(select 1 from public.companies where id=p_company_id) then raise exception 'The selected company is unavailable' using errcode='42501';end if;
  rules:=coalesce(actor.permissions->'access_v1','{}');
  if actor.role<>'sephs_admin' and (
    rules->'users'->>'view'='false' or rules->'people'->>'view'='false'
    or (rules->'users'->>'create'='false' and rules->'users'->>'edit'='false')
  ) then raise exception 'Users and People access is required' using errcode='42501';end if;
  if jsonb_typeof(coalesce(p_profile,'{}'))<>'object' then
    return jsonb_build_object('ok',false,'code','identity_conflict','error','Supply valid user details','candidates','[]'::jsonb);
  end if;
  if p_user_id is not null then
    select * into target from public.profiles where id=p_user_id for update;
    if found and target.company_id is distinct from p_company_id then
      raise exception 'The user is outside the selected company' using errcode='42501';
    end if;
    if not found and not exists(select 1 from auth.users where id=p_user_id) then
      return jsonb_build_object('ok',false,'code','identity_conflict','error','The user account is unavailable. Refresh the register','candidates','[]'::jsonb);
    end if;
  end if;
  if p_person_id is not null then
    select * into person from public.people where id=p_person_id and company_id=p_company_id for update;
    if not found then raise exception 'The selected person is unavailable in this company' using errcode='42501';end if;
  end if;

  select coalesce(array_agg(distinct key),'{}') into emails from unnest(array[
    public.user_person_email_key(p_profile->>'real_email'),
    case when not coalesce((p_profile->>'synthetic_email')::boolean,false) then public.user_person_email_key(p_profile->>'email') end,
    public.user_person_email_key(target.real_email),
    case when not coalesce(target.synthetic_email,false) then public.user_person_email_key(target.email) end
  ]) key where key is not null;
  select coalesce(array_agg(distinct key),'{}') into phones from unnest(array[
    public.user_person_phone_key(p_profile->>'phone'),public.user_person_phone_key(target.phone),public.user_person_phone_key(target.mobile_phone)
  ]) key where key is not null;
  display_name:=coalesce(nullif(btrim(target.full_name),''),nullif(btrim(p_profile->>'full_name'),''));
  name_key:=regexp_replace(lower(display_name),'[[:space:]]+',' ','g');
  -- A synthetic address can identify an existing login, but never a Person.
  login_key:=lower(nullif(btrim(coalesce(p_profile->>'email',target.email)),''));

  -- Resolve an existing login before Auth invitation or account creation.
  select coalesce(array_agg(distinct id),'{}') into profile_ids from public.profiles where company_id=p_company_id and (
    id=target.id or (p_person_id is not null and person_id=p_person_id) or lower(btrim(email))=login_key
    or public.user_person_email_key(real_email)=any(emails)
    or (not coalesce(synthetic_email,false) and public.user_person_email_key(email)=any(emails))
    or public.user_person_phone_key(phone)=any(phones) or public.user_person_phone_key(mobile_phone)=any(phones)
  );
  if cardinality(profile_ids)>1 or (target.id is not null and cardinality(profile_ids)=1 and profile_ids[1]<>target.id) then
    return jsonb_build_object('ok',false,'code','identity_conflict','error','These contacts identify different user accounts. Review their identities before linking','candidates','[]'::jsonb);
  end if;
  if target.id is null and cardinality(profile_ids)=1 then
    select * into target from public.profiles where id=profile_ids[1] and company_id=p_company_id for update;
  end if;
  if p_user_id is not null and target.id is not null and p_user_id<>target.id then
    return jsonb_build_object('ok',false,'code','identity_conflict','error','These contacts now belong to another existing account. Refresh before continuing','candidates','[]'::jsonb);
  end if;
  if target.id is not null then
    -- Account lookup may have used only its synthetic login. Reuse the saved
    -- real contacts for People matching, and detect conflicting account claims.
    select coalesce(array_agg(distinct key),'{}') into emails from unnest(emails||array[
      public.user_person_email_key(target.real_email),case when not coalesce(target.synthetic_email,false) then public.user_person_email_key(target.email) end
    ]) key where key is not null;
    select coalesce(array_agg(distinct key),'{}') into phones from unnest(phones||array[
      public.user_person_phone_key(target.phone),public.user_person_phone_key(target.mobile_phone)
    ]) key where key is not null;
    display_name:=coalesce(nullif(btrim(target.full_name),''),display_name);
    name_key:=regexp_replace(lower(display_name),'[[:space:]]+',' ','g');
    if exists(select 1 from public.profiles where company_id=p_company_id and id<>target.id and (
      public.user_person_email_key(real_email)=any(emails)
      or (not coalesce(synthetic_email,false) and public.user_person_email_key(email)=any(emails))
      or public.user_person_phone_key(phone)=any(phones) or public.user_person_phone_key(mobile_phone)=any(phones)
    )) then
      return jsonb_build_object('ok',false,'code','identity_conflict','error','The saved account contacts identify another user. Review their identities before linking','candidates','[]'::jsonb);
    end if;
  end if;
  is_existing:=target.id is not null and not new_account;
  if actor.role<>'sephs_admin' and target.id is not null and (
    (not new_account and rules->'users'->>'edit'='false') or (new_account and rules->'users'->>'create'='false')
  ) then raise exception 'The required user creation or editing permission is denied' using errcode='42501';end if;

  -- An established canonical link is authoritative; never remap its history.
  if target.person_id is not null then
    if p_person_id is not null and target.person_id<>p_person_id then
      return jsonb_build_object('ok',false,'code','identity_conflict','error','This user is already linked to another People record. Their history was retained','candidates','[]'::jsonb);
    end if;
    select * into person from public.people where id=target.person_id and company_id=p_company_id for update;
    if not found then raise exception 'The existing user/person company relationship requires administrator review' using errcode='23514';end if;
    return jsonb_build_object('ok',true,'user_id',target.id,'person_id',person.id,'person_created',false,'person_reused',true,
      'existing',true,'login',coalesce(target.email,target.phone),'person_status',person.status,'user_status',target.status,'preview',coalesce(p_preview,true));
  end if;
  if exists(select 1 from public.profiles where company_id is distinct from p_company_id and (
    lower(btrim(email))=login_key or public.user_person_email_key(real_email)=any(emails)
    or (not coalesce(synthetic_email,false) and public.user_person_email_key(email)=any(emails))
    or public.user_person_phone_key(phone)=any(phones) or public.user_person_phone_key(mobile_phone)=any(phones)
  )) then
    return jsonb_build_object('ok',false,'code','identity_conflict','error','A login contact is already assigned outside the selected company. An administrator must review it','candidates','[]'::jsonb);
  end if;

  -- Keep candidate contacts stable while applying the identity decision.
  perform 1 from public.people where company_id=p_company_id and (
    public.user_person_email_key(email)=any(emails) or public.user_person_phone_key(phone)=any(phones)
  ) order by id for update;
  select coalesce(array_agg(id order by id),'{}') into person_ids from public.people where company_id=p_company_id and (
    public.user_person_email_key(email)=any(emails) or public.user_person_phone_key(phone)=any(phones)
  );
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',concat_ws(' ',first_name,last_name),'email',email,'phone',phone,'employee_number',employee_number) order by first_name,last_name,id),'[]')
    into candidate_json from public.people where company_id=p_company_id and id=any(person_ids);
  if cardinality(person_ids)>1 or (person.id is not null and cardinality(person_ids)=1 and person_ids[1]<>person.id) then
    return jsonb_build_object('ok',false,'code','identity_conflict','error','Email and phone match multiple or different People records. Correct the conflicting identities first','candidates',candidate_json);
  end if;
  if person.id is null and cardinality(person_ids)=1 then
    select * into person from public.people where id=person_ids[1] and company_id=p_company_id for update;
    reason:='Reused the unique same-company email or canonical phone match; existing People details retained';
  elsif person.id is not null then reason:='Administrator selected the existing People identity; existing details retained';
  end if;
  if person.id is not null then
    select * into linked from public.profiles where person_id=person.id for update;
    if found then
      if linked.company_id is distinct from p_company_id or (target.id is not null and linked.id<>target.id) or (p_user_id is not null and linked.id<>p_user_id) then
        return jsonb_build_object('ok',false,'code','identity_conflict','error','This People record already belongs to another user account','candidates',candidate_json);
      end if;
      if actor.role<>'sephs_admin' and rules->'users'->>'edit'='false' then raise exception 'User editing permission is required' using errcode='42501';end if;
      return jsonb_build_object('ok',true,'user_id',linked.id,'person_id',person.id,'person_created',false,'person_reused',true,
        'existing',true,'login',coalesce(linked.email,linked.phone),'person_status',person.status,'user_status',linked.status,'preview',coalesce(p_preview,true));
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',concat_ws(' ',first_name,last_name),'email',email,'phone',phone,'employee_number',employee_number) order by id),'[]')
      into candidate_json from public.people where company_id=p_company_id and regexp_replace(lower(btrim(concat_ws(' ',first_name,last_name))),'[[:space:]]+',' ','g')=name_key;
    if not coalesce(p_allow_new_person,false) and (jsonb_array_length(candidate_json)>0 or cardinality(emails)+cardinality(phones)=0 or display_name is null) then
      return jsonb_build_object('ok',false,'code','person_match_required','error','Select the existing person or explicitly confirm a new People record. Names alone are not identity proof','candidates',candidate_json);
    end if;
    if display_name is null then return jsonb_build_object('ok',false,'code','person_match_required','error','Enter a name or select an existing person','candidates',candidate_json);end if;
    if actor.role<>'sephs_admin' and rules->'people'->>'create'='false' then raise exception 'People creation permission is required for a new identity' using errcode='42501';end if;
    reason:='Created a new People identity after contact matching and administrator confirmation when required';
  end if;
  if person.id is not null and person.status is distinct from 'active' and (target.id is null or new_account) then
    return jsonb_build_object('ok',false,'code','identity_conflict','error','The existing People record is inactive or suspended. Review its status explicitly before creating login access','candidates',candidate_json);
  end if;
  if target.id is null and actor.role<>'sephs_admin' and rules->'users'->>'create'='false' then
    raise exception 'User creation permission is required' using errcode='42501';
  end if;
  display_name:=coalesce(display_name,nullif(btrim(concat_ws(' ',person.first_name,person.last_name)),''));
  output_user:=coalesce(target.id,p_user_id);
  if coalesce(p_preview,true) then
    return jsonb_build_object('ok',true,'user_id',output_user,'person_id',person.id,'person_created',false,'person_reused',person.id is not null,
      'will_create_person',person.id is null,'existing',is_existing,'login',coalesce(target.email,target.phone,p_profile->>'email',p_profile->>'phone'),
      'person_status',person.status,'user_status',target.status,'preview',true);
  end if;
  if output_user is null then return jsonb_build_object('ok',false,'code','identity_conflict','error','Create or select the user account before applying the People link','candidates','[]'::jsonb);end if;

  desired_role:=coalesce(nullif(target.role,''),nullif(p_profile->>'role',''),'employee');
  desired_status:=coalesce(target.status,nullif(p_profile->>'status',''),'active');
  if desired_role='sephs_admin' and actor.role<>'sephs_admin' then raise exception 'SEPHS administrator provisioning is protected' using errcode='42501';end if;
  login_email:=coalesce(target.email,nullif(btrim(p_profile->>'email'),''));
  contact_email:=coalesce(public.user_person_email_key(target.real_email),public.user_person_email_key(p_profile->>'real_email'));
  contact_phone:=coalesce(target.phone,public.user_person_phone_key(p_profile->>'phone'));
  if person.id is null then
    given_name:=split_part(display_name,' ',1);family_name:=btrim(substr(display_name,length(given_name)+1));
    insert into public.people(company_id,person_type,first_name,last_name,email,phone,job_title,department,site,company_name,status,created_by)
    values(p_company_id,case when desired_role='contractor' then 'contractor' else 'employee' end,given_name,family_name,
      coalesce(contact_email,public.user_person_email_key(login_email)),public.user_person_phone_key(contact_phone),p_profile->>'job_title',p_profile->>'department',p_profile->>'site',p_profile->>'contractor_company',
      case when desired_status='active' then 'active' when desired_status='suspended' then 'suspended' else 'inactive' end,p_actor_id)
    returning * into person;
    person_created:=true;
  end if;
  if target.id is null then
    insert into public.profiles(id,company_id,person_id,full_name,email,real_email,phone,synthetic_email,role,status,must_change_password,job_title,department,site,contractor_company,invited_by)
    values(output_user,p_company_id,person.id,display_name,login_email,contact_email,contact_phone,coalesce((p_profile->>'synthetic_email')::boolean,false),desired_role,desired_status,
      coalesce((p_profile->>'must_change_password')::boolean,false),p_profile->>'job_title',p_profile->>'department',p_profile->>'site',p_profile->>'contractor_company',p_actor_id) returning * into target;
  else
    update public.profiles set person_id=person.id,full_name=coalesce(nullif(public.profiles.full_name,''),display_name),
      email=coalesce(public.profiles.email,login_email),real_email=coalesce(public.profiles.real_email,contact_email),phone=coalesce(public.profiles.phone,contact_phone),
      job_title=coalesce(public.profiles.job_title,p_profile->>'job_title'),department=coalesce(public.profiles.department,p_profile->>'department'),
      site=coalesce(public.profiles.site,p_profile->>'site'),contractor_company=coalesce(public.profiles.contractor_company,p_profile->>'contractor_company'),
      invited_by=coalesce(public.profiles.invited_by,case when new_account then p_actor_id else null end),updated_at=clock_timestamp()
    where id=target.id and company_id=p_company_id and person_id is null returning * into target;
    if not found then raise exception 'This user changed while linking. Refresh before retrying' using errcode='40001';end if;
  end if;
  insert into public.person_identity_decisions(company_id,source_table,source_id,decision,selected_person_id,legacy_name,decision_note,decided_by)
    values(p_company_id,'profiles',target.id,'linked',person.id,display_name,reason,p_actor_id);
  return jsonb_build_object('ok',true,'user_id',target.id,'person_id',person.id,'person_created',person_created,'person_reused',not person_created,
    'existing',is_existing,'login',coalesce(target.email,target.phone),'person_status',person.status,'user_status',target.status,'preview',false);
exception when unique_violation then
  return jsonb_build_object('ok',false,'code','identity_conflict','error','This person or contact was linked concurrently. Refresh and review the existing account before retrying','candidates','[]'::jsonb);
end $$;
revoke all on function public.admin_link_user_person(uuid,uuid,uuid,jsonb,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_link_user_person(uuid,uuid,uuid,jsonb,uuid,boolean,boolean) to service_role;
notify pgrst,'reload schema';
commit;
