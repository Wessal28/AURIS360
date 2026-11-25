-- The deployed investigation form has six workflow states. The original
-- three-state CHECK rejects completion, submission and release-for-edit saves.
-- Only that CHECK changes: no investigations, links or history are rewritten,
-- and the existing access, signing, editing and closure guards stay in place.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local row_security=off;

do $investigation_status$
declare
  target oid:=to_regclass('public.investigations');
  status_attnum smallint;
  original_not_null boolean;
  original_default text;
  original_acl text;
  original_owner oid;
  original_force_rls boolean;
  check_row record;
  expression text;
  shape text;
  literals text[];
  enum_states text[];
  clause text;
  supported constant text[]:=array['open','submitted','revision_requested','in_progress','completed','closed'];
  sorted_supported text[];
  rows_before bigint;
  rows_after bigint;
begin
  if target is null or not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid=target and c.relkind='r' and n.nspname='public' and c.relname='investigations') then
    raise exception 'Investigation status repair stopped: public.investigations must be the ordinary investigation table. Nothing was changed';
  end if;
  if exists(select 1 from pg_inherits where inhrelid=target or inhparent=target) then
    raise exception 'Investigation status repair stopped: inherited or partitioned investigation tables need a separate review. Nothing was changed';
  end if;
  if not exists(select 1 from pg_attribute where attrelid=target and attname='id' and attnum>0
      and not attisdropped and atttypid='uuid'::regtype)
    or not exists(select 1 from pg_attribute where attrelid=target and attname='company_id' and attnum>0
      and not attisdropped and atttypid='uuid'::regtype) then
    raise exception 'Investigation status repair stopped: the investigation ID and company ID must remain UUID fields. Nothing was changed';
  end if;
  select attnum,attnotnull into status_attnum,original_not_null from pg_attribute
    where attrelid=target and attname='status' and attnum>0 and not attisdropped and atttypid='text'::regtype;
  if not found then
    raise exception 'Investigation status repair stopped: public.investigations.status must be text. An enum or other column type needs review. Nothing was changed';
  end if;
  if not exists(select 1 from pg_class where oid=target and relrowsecurity) then
    raise exception 'Investigation status repair stopped: investigation row-level security must remain enabled. Nothing was changed';
  end if;

  lock table public.investigations in access exclusive mode;
  select relacl::text,relowner,relforcerowsecurity into original_acl,original_owner,original_force_rls from pg_class where oid=target;
  select pg_get_expr(adbin,adrelid) into original_default from pg_attrdef where adrelid=target and adnum=status_attnum;
  select * into check_row from pg_constraint where conrelid=target and conname='investigations_status_check';
  if not found then
    raise exception 'Investigation status repair stopped: investigations_status_check is missing. Inspect the current status checks before proceeding. Nothing was changed';
  end if;
  if check_row.contype<>'c' or check_row.conkey is distinct from array[status_attnum]::smallint[]
    or not check_row.conislocal or check_row.coninhcount<>0 or check_row.connoinherit then
    raise exception 'Investigation status repair stopped: the named constraint is not a local status-only CHECK. Nothing was changed';
  end if;
  if exists(select 1 from pg_constraint where conrelid=target and contype='c'
    and conname<>'investigations_status_check' and status_attnum=any(conkey)) then
    raise exception 'Investigation status repair stopped: another CHECK also restricts investigation status. Review it separately; no checks were bypassed';
  end if;

  -- Recognize a simple enum semantically, independent of state ordering,
  -- whitespace, redundant parentheses and text casts. PostgreSQL may render
  -- IN as ANY(ARRAY[...]), as a text-array constant, or as OR equalities.
  expression:=pg_get_expr(check_row.conbin,target);
  select array_agg(match[1]) into literals from regexp_matches(expression,$literal$'([^']*)'$literal$,'g') as matches(match);
  shape:=lower(regexp_replace(replace(regexp_replace(expression,$literal$'([^']*)'$literal$,'?','g'),'::text',''),'[[:space:]()]','','g'));
  if shape='status=anyarray['||array_to_string(array_fill('?'::text,array[coalesce(array_length(literals,1),0)]),',')||']' then
    enum_states:=literals;
  elsif shape='status=any?[]' and array_length(literals,1)=1 then
    begin enum_states:=literals[1]::text[];
    exception when others then raise exception 'Investigation status repair stopped: the status enum array needs review. Nothing was changed';end;
  else
    foreach clause in array regexp_split_to_array(shape,'or') loop
      if clause not in ('status=?','?=status','statusisnull') then
        raise exception 'Investigation status repair stopped: the current CHECK contains a custom status rule. Review this expression before changing it: %',left(expression,600);
      end if;
    end loop;
    enum_states:=literals;
  end if;
  if coalesce(array_length(enum_states,1),0)=0 or exists(select 1 from unnest(enum_states) as states(state)
    where state is null or not(state=any(supported))) then
    raise exception 'Investigation status repair stopped: the existing CHECK allows statuses outside the six supported workflow states. Review it instead of discarding custom states';
  end if;
  if exists(select 1 from public.investigations where status is not null and not(status=any(supported))) then
    raise exception 'Investigation status repair stopped: existing records contain an unsupported status. Review DISTINCT status values; do not rewrite records to force installation. Nothing was changed';
  end if;
  select count(*) into rows_before from public.investigations;
  select array_agg(state order by state) into sorted_supported from unnest(supported) as states(state);

  if (select array_agg(distinct state order by state) from unnest(enum_states) as states(state)) is distinct from sorted_supported then
    alter table public.investigations drop constraint investigations_status_check;
    alter table public.investigations add constraint investigations_status_check check (
      status in ('open','submitted','revision_requested','in_progress','completed','closed')
    );
  elsif not check_row.convalidated then
    alter table public.investigations validate constraint investigations_status_check;
  end if;

  if not exists(select 1 from pg_constraint where conrelid=target and conname='investigations_status_check'
    and contype='c' and convalidated and conkey=array[status_attnum]::smallint[]) then
    raise exception 'Investigation status validation failed. The complete transaction will roll back';
  end if;
  select count(*) into rows_after from public.investigations;
  if rows_before<>rows_after or not exists(select 1 from pg_class where oid=target and relrowsecurity
      and relforcerowsecurity=original_force_rls and relowner=original_owner and relacl::text is not distinct from original_acl)
    or (select attnotnull from pg_attribute where attrelid=target and attnum=status_attnum) is distinct from original_not_null
    or (select pg_get_expr(adbin,adrelid) from pg_attrdef where adrelid=target and adnum=status_attnum) is distinct from original_default then
    raise exception 'Investigation status validation failed: record count or access/column settings changed. The complete transaction will roll back';
  end if;
end;
$investigation_status$;

commit;
