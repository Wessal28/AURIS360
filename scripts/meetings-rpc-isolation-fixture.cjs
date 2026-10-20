// Generates rollback-only SQL for the localhost-only disposable migration replay.
// This module has no database connection or executable CLI of its own.
const OPTIONAL_TABLES = Object.freeze([
  'safety_awareness_topics', 'toolbox_talks', 'safety_alerts', 'safety_bulletins'
]);

function transactionBody(sql, closing, label) {
  const lines = String(sql).replace(/\r\n/g, '\n').split('\n');
  if (lines.some(line => /^\s*\\/.test(line))) throw Error(`${label} cannot contain psql commands`);
  const boundaries = lines.flatMap((line, index) => /^\s*(begin|commit|rollback)\s*;\s*(?:--.*)?$/i.test(line) ? [index] : []);
  if (boundaries.length !== 2 || !/^\s*begin\s*;/i.test(lines[boundaries[0]]) ||
    !new RegExp(`^\\s*${closing}\\s*;`, 'i').test(lines[boundaries[1]])) {
    throw Error(`${label} must have one BEGIN/${closing.toUpperCase()} transaction envelope`);
  }
  // Do not permit executable statements outside the one reviewed envelope.
  for (const line of [...lines.slice(0, boundaries[0]), ...lines.slice(boundaries[1] + 1)]) {
    if (line.trim() && !/^\s*--/.test(line)) throw Error(`${label} has statements outside its transaction`);
  }
  return lines.slice(boundaries[0] + 1, boundaries[1]).join('\n');
}

function buildMeetingsRpcIsolationFixture({ repair, installationAssertions, behaviorAssertions }) {
  const repairBody = transactionBody(repair, 'commit', 'Minutes repair');
  const installationBody = transactionBody(installationAssertions, 'rollback', 'Minutes catalog assertions');
  const behaviorBody = transactionBody(behaviorAssertions, 'rollback', 'Minutes behavior assertions');
  const absent = OPTIONAL_TABLES.map(table => `
  if to_regclass('public.${table}') is not null or to_regclass('public.__fixture_missing_${table}') is null
  then raise exception 'Optional table ${table} must remain absent during the repair fixture';end if;`).join('');
  const assertAbsent = `do $optional_absence$ begin${absent}\nend $optional_absence$;`;
  const snapshotHelpers = `insert into __fixture_minutes_helpers
select p.oid,pg_get_functiondef(p.oid),p.proacl,p.proowner from pg_proc p
where p.oid in ('public.user_access_allowed(text,text)'::regprocedure,'public.guard_module_user_access()'::regprocedure);`;
  const assertHelpersUnchanged = `do $helper_preservation$ begin
  if (select count(*) from __fixture_minutes_helpers)<>2
    or exists(select 1 from __fixture_minutes_helpers previous left join pg_proc installed on installed.oid=previous.routine_id
      where installed.oid is null or pg_get_functiondef(installed.oid) is distinct from previous.definition
        or installed.proacl is distinct from previous.acl or installed.proowner is distinct from previous.owner_id)
  then raise exception 'Minutes repair changed an existing permission helper definition, settings, ownership or grants';end if;
end $helper_preservation$;`;
  const snapshotActionGuards = `insert into __fixture_action_guards
select 'policy',p.oid,p.polname,to_jsonb(p) from pg_policy p
where p.polrelid='public.action_tracker'::regclass and p.polname in ('user_module_view','user_module_create','user_module_edit','user_module_delete')
union all
select 'trigger',t.oid,t.tgname,to_jsonb(t) from pg_trigger t
where t.tgrelid='public.action_tracker'::regclass and t.tgname='module_user_access_guard';`;
  const assertActionGuardsUnchanged = `do $action_guard_preservation$ begin
  if (select count(*) from __fixture_action_guards)<>5
    or exists(select 1 from __fixture_action_guards previous where
      (previous.kind='policy' and not exists(select 1 from pg_policy p where p.oid=previous.object_id and to_jsonb(p)=previous.definition))
      or (previous.kind='trigger' and not exists(select 1 from pg_trigger t where t.oid=previous.object_id and to_jsonb(t)=previous.definition)))
  then raise exception 'Minutes repair changed an existing action permission policy or trigger';end if;
end $action_guard_preservation$;`;
  return [
    '-- Disposable CI database only. One connection; every fixture change is rolled back.',
    'begin;',
    "set local statement_timeout='30s';",
    '-- A fully upgraded deployment must retain its existing helper definitions and ACLs.',
    'create temporary table __fixture_minutes_helpers(routine_id oid,definition text,acl aclitem[],owner_id oid) on commit drop;',
    'create temporary table __fixture_action_guards(kind text,object_id oid,name text,definition jsonb) on commit drop;',
    snapshotHelpers,
    snapshotActionGuards,
    repairBody,
    assertHelpersUnchanged,
    assertActionGuardsUnchanged,
    '-- Reproduce a partially upgraded deployment lacking both permission helpers.',
    'alter function public.user_access_allowed(text,text) rename to __fixture_missing_user_access_allowed;',
    'alter function public.guard_module_user_access() rename to __fixture_missing_guard_module_user_access;',
    '-- Legacy deployments may also lack Action Tracker user restrictions.',
    ...['user_module_view','user_module_create','user_module_edit','user_module_delete'].map(name=>`drop policy ${name} on public.action_tracker;`),
    'drop trigger module_user_access_guard on public.action_tracker;',
    ...OPTIONAL_TABLES.map(table => `alter table public.${table} rename to __fixture_missing_${table};`),
    assertAbsent,
    'drop function public.save_hse_minutes(uuid,jsonb,timestamptz);',
    `do $helpers_absent$ begin
  if to_regprocedure('public.user_access_allowed(text,text)') is not null
    or to_regprocedure('public.guard_module_user_access()') is not null
    or to_regprocedure('public.save_hse_minutes(uuid,jsonb,timestamptz)') is not null
  then raise exception 'The isolated repair must start with both helpers and the minutes RPC absent';end if;
end $helpers_absent$;`,
    '-- Install the actual self-contained repair with both helpers and optional tables absent.',
    repairBody,
    installationBody,
    `do $restored_helpers$ declare helper pg_proc; begin
  select * into helper from pg_proc where oid='public.user_access_allowed(text,text)'::regprocedure;
  if helper.prorettype<>'boolean'::regtype or helper.proargnames is distinct from array['module_key','access_action']::text[]
    or helper.pronargdefaults<>1 or not helper.prosecdef or helper.provolatile<>'s'
    or not coalesce(helper.proconfig @> array['search_path=pg_catalog, public'],false)
    or has_function_privilege('anon',helper.oid,'execute') or not has_function_privilege('authenticated',helper.oid,'execute')
  then raise exception 'Restored user access helper does not preserve its reviewed caller contract';end if;
  select * into helper from pg_proc where oid='public.guard_module_user_access()'::regprocedure;
  if helper.prorettype<>'trigger'::regtype or not helper.prosecdef
    or not coalesce(helper.proconfig @> array['search_path=pg_catalog, public'],false)
    or has_function_privilege('anon',helper.oid,'execute') or not has_function_privilege('authenticated',helper.oid,'execute')
  then raise exception 'Restored trigger helper does not preserve its reviewed caller contract';end if;
end $restored_helpers$;`,
    '-- Save and update actual fictional minutes while the optional tables are absent.',
    behaviorBody,
    '-- Give the installed helpers harmless deployment-specific body markers.',
    '-- A subsequent repair must preserve those definitions, configuration and grants.',
    `do $mark_existing_helpers$ declare helper record; begin
  for helper in select p.prosrc,pg_get_functiondef(p.oid) as definition from pg_proc p
    where p.oid in ('public.user_access_allowed(text,text)'::regprocedure,'public.guard_module_user_access()'::regprocedure) loop
    execute replace(helper.definition,helper.prosrc,E'\\n-- Fictional deployment-specific helper marker: retain this definition.\\n'||helper.prosrc);
  end loop;
end $mark_existing_helpers$;`,
    'delete from __fixture_minutes_helpers;',
    'delete from __fixture_action_guards;',
    snapshotHelpers,
    snapshotActionGuards,
    repairBody,
    assertHelpersUnchanged,
    assertActionGuardsUnchanged,
    assertAbsent,
    'rollback;',
    ''
  ].join('\n');
}

module.exports = { OPTIONAL_TABLES, transactionBody, buildMeetingsRpcIsolationFixture };
