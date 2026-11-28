-- A generated investigation corrective-action key identifies one existing MAP
-- record. This index changes no action, evidence, approval or workflow guard.
begin;
set local lock_timeout = '5s';

do $preflight$
declare relation_id regclass:=to_regclass('public.action_tracker'); index_id regclass;
  expected_predicate text:='((source_module = ''investigation''::text) AND (company_id IS NOT NULL) AND (source_id IS NOT NULL) AND (action_no ~* ''^(ca-|action-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''::text))';
  duplicate_groups bigint;
begin
  if relation_id is null or exists(select 1 from (values
      ('company_id','uuid'::regtype),('source_module','text'::regtype),
      ('source_id','uuid'::regtype),('action_no','text'::regtype)
    ) required(column_name,column_type) where not exists(select 1 from pg_attribute
      where attrelid=relation_id and attname=required.column_name and atttypid=required.column_type
        and attnum>0 and not attisdropped)) then
    raise exception 'Investigation action identity requires the reviewed action_tracker company, source and action-number columns';
  end if;
  -- Hold the write lock through duplicate checking and index installation.
  -- Readers can continue; a busy database fails after the bounded lock timeout.
  lock table public.action_tracker in share mode;
  select count(*) into duplicate_groups from (
    select company_id,source_module,source_id,action_no from public.action_tracker
    where source_module='investigation' and company_id is not null and source_id is not null
      and action_no ~* '^(ca-|action-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by company_id,source_module,source_id,action_no having count(*)>1
  ) duplicated;
  if duplicate_groups>0 then
    raise exception 'Investigation action identity installation stopped: % generated source-action key(s) already have duplicate Master Actions. Review their exact links before installing; no actions were changed.',duplicate_groups
      using errcode='23505';
  end if;
  index_id:=to_regclass('public.investigation_generated_action_identity');
  if index_id is not null and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
      join pg_am am on am.oid=c.relam where i.indexrelid=index_id and i.indrelid=relation_id
      and i.indisunique and i.indisvalid and i.indisready and i.indnkeyatts=4 and i.indnatts=4
      and i.indexprs is null and am.amname='btree'
      and (select array_agg(a.attname::text order by k.position)
        from unnest(i.indkey) with ordinality k(attnum,position)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum)
        =array['company_id','source_module','source_id','action_no']::text[]
      and regexp_replace(pg_get_expr(i.indpred,i.indrelid),'\s+','','g')
        =regexp_replace(expected_predicate,'\s+','','g')) then
    raise exception 'Existing investigation_generated_action_identity differs from the reviewed unique source-action index. No actions were changed; review the existing index before installing.';
  end if;
end;
$preflight$;

create unique index if not exists investigation_generated_action_identity
  on public.action_tracker(company_id,source_module,source_id,action_no)
  where source_module='investigation' and company_id is not null and source_id is not null
    and action_no ~* '^(ca-|action-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

commit;
