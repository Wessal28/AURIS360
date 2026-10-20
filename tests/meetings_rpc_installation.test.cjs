const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {OPTIONAL_TABLES,transactionBody,buildMeetingsRpcIsolationFixture}=require('../scripts/meetings-rpc-isolation-fixture.cjs');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const canonical=read('supabase/migrations/20261018030000_meetings_reliability.sql');
const repair=read('supabase/migrations/20261020020000_meetings_rpc_installation_repair.sql');
function body(sql){const match=sql.match(/function public\.save_hse_minutes\([\s\S]*?\bas \$\$([\s\S]*?)\$\$/i);assert.ok(match,'Minutes transaction body missing');return match[1].replace(/\r\n/g,'\n');}
function helperBody(sql,name){const match=sql.match(new RegExp('function public\\.'+name+'\\([\\s\\S]*?\\bas \\$\\$([\\s\\S]*?)\\$\\$','i'));assert.ok(match,name+' body missing');return match[1].replace(/\r\n/g,'\n');}

test('repair retains the reviewed atomic save and fails closed for linked action permissions',()=>{
  const repairedBody=body(repair);
  for(const invariant of [
    "perform pg_advisory_xact_lock(hashtextextended('meeting/'||p_id::text,0));",
    'old_m.updated_at is distinct from p_expected_updated_at',
    "if action_row.id is not null and action_status is not distinct from coalesce(old_rec->>'status','open') then action_status:=action_row.status;end if;",
    "meeting_timezone=p_minutes->>'meeting_timezone'",
    "return jsonb_build_object('minutes',to_jsonb(m),'actions',actions_json);"
  ]){assert.ok(body(canonical).includes(invariant));assert.ok(repairedBody.includes(invariant));}
  assert.match(repair,/create or replace function public\.save_hse_minutes\(p_id uuid,p_minutes jsonb,p_expected_updated_at timestamptz default null\) returns jsonb/i);
  assert.doesNotMatch(repair.slice(repair.indexOf('create or replace function public.save_hse_minutes')),/security definer/i);
  assert.match(repair,/pg_advisory_xact_lock/);
  assert.match(repair,/old_m\.updated_at is distinct from p_expected_updated_at/);
  assert.doesNotMatch(body(repair),/delete from public\.action_tracker/i);
  for(const action of ['view','create','edit'])assert.ok(repairedBody.includes("if not public.user_access_allowed('actions','"+action+"') then raise exception"));
  for(const operation of ['locked','created','updated'])assert.ok(repairedBody.includes("if not found or action_row.id is null then raise exception 'The linked Master Action could not be "+operation+". No minutes were saved' using errcode='42501';end if;"));
  assert.match(repairedBody,/meeting_recommendation_key=key;/);
  assert.match(repairedBody,/where id=action_row\.id and company_id=c for update;/);
  assert.match(repairedBody,/if public\.user_access_allowed\('actions','view'\) then[\s\S]*else actions_json:='\[\]'::jsonb;end if;/);
});

test('repair is transactional, rerunnable and requests a committed PostgREST schema refresh',()=>{
  assert.match(repair,/^begin;/m);assert.match(repair,/commit;\s*$/i);
  assert.match(repair,/add column if not exists meeting_timezone text/i);
  assert.match(repair,/add column if not exists meeting_recommendation_key uuid/i);
  assert.match(repair,/create unique index if not exists meeting_action_identity/i);
  assert.doesNotMatch(repair,/^drop (?:policy|trigger) (?!if exists)/im);
  assert.match(repair,/alter table public\.hse_meetings drop constraint if exists/i);
  const functionIndex=repair.indexOf('create or replace function public.save_hse_minutes');
  const notifyIndex=repair.indexOf("notify pgrst,'reload schema'");
  assert.ok(notifyIndex>functionIndex&&notifyIndex<repair.lastIndexOf('commit;'));
});

test('minutes repair never alters or depends on optional communication tables',()=>{
  for(const table of OPTIONAL_TABLES)assert.doesNotMatch(repair,new RegExp('\\bpublic\\.'+table+'\\b','i'));
  assert.doesNotMatch(repair,/safety_awareness_topics_access|plan_year|planned_month|safety_awareness_topics_status/i);
});

test('metadata preflight reports missing core schema and incompatible existing helpers before changing the schema',()=>{
  const start=repair.indexOf('do $minutes_preflight$'),end=repair.indexOf('end $minutes_preflight$;',start);
  assert.ok(start>=0&&end>start&&end<repair.indexOf('alter table public.hse_meetings'));
  const preflight=repair.slice(start,end);
  for(const table of ['profiles','people','hse_meetings','action_tracker','meeting_series'])assert.match(preflight,new RegExp("\\('"+table+"',array\\["));
  for(const signature of ['auth.uid()','public.user_access_allowed(text,text)','public.guard_module_user_access()'])assert.ok(preflight.includes(signature));
  assert.match(preflight,/to_regclass\('public\.'\|\|item\.table_name\)/);
  assert.match(preflight,/not attisdropped/);
  assert.match(preflight,/atttypid<>item\.column_type/);
  assert.match(preflight,/foreach signature in array array\['auth\.uid\(\)'\]/);
  assert.match(preflight,/oid=to_regprocedure\(item\.signature\).*prorettype<>item\.return_type/);
  assert.match(preflight,/Minutes repair prerequisites are incomplete/);
  assert.match(preflight,/detail=array_to_string\(missing,'; '\)/);
  assert.doesNotMatch(preflight,/\b(?:create|alter|drop|insert|update|delete|grant|revoke)\s+(?:table|function|policy|trigger|into|from|on)\b/i);
});

test('missing permission helpers use exactly the reviewed section-aware implementations',()=>{
  assert.equal(helperBody(repair,'user_access_allowed'),helperBody(read('supabase/migrations/20260927020000_module_section_access.sql'),'user_access_allowed'));
  assert.equal(helperBody(repair,'guard_module_user_access'),helperBody(read('supabase/migrations/20260927010000_people_onboarding_user_access.sql'),'guard_module_user_access'));
  const install=repair.slice(repair.indexOf('do $minutes_access_install$'),repair.indexOf('end $minutes_access_install$;'));
  for(const [name,signature] of [['user_access_allowed','text,text'],['guard_module_user_access','']]){
    assert.ok(install.includes("if to_regprocedure('public."+name+'('+signature+")') is null then"));
    assert.ok(install.includes('revoke all on function public.'+name+'('+signature+') from public,anon'));
    assert.ok(install.includes('grant execute on function public.'+name+'('+signature+') to authenticated'));
    assert.doesNotMatch(install,new RegExp('create or replace function public\\.'+name));
  }
});

test('only missing action user restrictions are installed and current company policies remain intact',()=>{
  const install=repair.slice(repair.indexOf('do $minutes_actions_access$'),repair.indexOf('end $minutes_actions_access$;'));
  assert.match(repair,/alter table public\.action_tracker enable row level security;/);
  for(const [name,action] of [['view','select'],['create','insert'],['edit','update'],['delete','delete']]){
    assert.ok(install.includes("if not exists(select 1 from pg_policy where polrelid='public.action_tracker'::regclass and polname='user_module_"+name+"') then"));
    assert.ok(install.includes('create policy user_module_'+name+' on public.action_tracker as restrictive for '+action+' to authenticated'));
  }
  assert.match(install,/if not exists\(select 1 from pg_trigger[\s\S]*tgname='module_user_access_guard'/);
  assert.match(install,/execute function public\.guard_module_user_access\('actions'\)/);
  assert.doesNotMatch(install,/drop policy|drop trigger|as permissive/i);
});

test('disposable replay restores both missing helpers and RPC while preserving existing helper definitions',()=>{
  const fixture=buildMeetingsRpcIsolationFixture({repair,installationAssertions:read('tests/sql/meetings_rpc_installation.sql'),behaviorAssertions:read('tests/sql/meetings_rpc_optional_modules.sql')});
  assert.equal((fixture.match(/^begin;$/gm)||[]).length,1);
  assert.equal((fixture.match(/^rollback;$/gm)||[]).length,1);
  assert.doesNotMatch(fixture,/^commit;/im);
  assert.doesNotMatch(fixture,/\bcascade\b/i);
  const helpersMissing=fixture.indexOf('alter function public.user_access_allowed(text,text) rename');
  const isolatedInstall=fixture.indexOf('create or replace function public.save_hse_minutes',helpersMissing);
  for(const table of OPTIONAL_TABLES){
    assert.match(fixture,new RegExp('alter table public\\.'+table+' rename to __fixture_missing_'+table+';'));
    assert.ok(fixture.indexOf('alter table public.'+table)<isolatedInstall);
  }
  assert.equal((fixture.match(/create or replace function public\.save_hse_minutes/g)||[]).length,3);
  assert.match(fixture,/drop function public\.save_hse_minutes\(uuid,jsonb,timestamptz\);/);
  assert.match(fixture,/alter function public\.user_access_allowed\(text,text\) rename to __fixture_missing_user_access_allowed;/);
  assert.match(fixture,/alter function public\.guard_module_user_access\(\) rename to __fixture_missing_guard_module_user_access;/);
  for(const name of ['view','create','edit','delete'])assert.match(fixture,new RegExp('drop policy user_module_'+name+' on public\\.action_tracker;'));
  assert.match(fixture,/drop trigger module_user_access_guard on public\.action_tracker;/);
  assert.match(fixture,/both helpers and the minutes RPC absent/);
  assert.match(fixture,/Restored user access helper does not preserve its reviewed caller contract/);
  assert.match(fixture,/Restored trigger helper does not preserve its reviewed caller contract/);
  assert.match(fixture,/Minutes repair changed an existing permission helper definition, settings, ownership or grants/);
  assert.match(fixture,/Fictional deployment-specific helper marker: retain this definition/);
  assert.match(fixture,/pg_get_functiondef\(installed\.oid\) is distinct from previous\.definition/);
  assert.match(fixture,/installed\.proacl is distinct from previous\.acl/);
  assert.match(fixture,/installed\.proowner is distinct from previous\.owner_id/);
  assert.match(fixture,/Minutes repair changed an existing action permission policy or trigger/);
  assert.match(fixture,/routine\.proargnames is distinct from array\['p_id','p_minutes','p_expected_updated_at'\]/);
  assert.match(fixture,/result:=public\.save_hse_minutes\(minutes_id,payload,null\)/);
  assert.match(fixture,/Isolated minutes update duplicated its linked action/);
  assert.match(fixture,/Isolated minutes repair accepted a stale save/);
  assert.match(fixture,/Isolated completed minutes did not advance their schedule/);
  assert.match(fixture,/Restored helper allowed a revoked minutes save/);
  assert.match(fixture,/Restored trigger helper allowed a revoked direct edit/);
  assert.match(fixture,/Restored trigger helper allowed a definer routine to bypass revoked minutes access/);
  assert.match(fixture,/Restored helper ignored a parent module restriction/);
  assert.match(fixture,/A revoked linked action write left partial minutes or duplicate actions/);
  assert.match(fixture,/Revoked linked action creation left partial minutes or actions/);
  assert.match(fixture,/An action row policy rejection left partial minutes or duplicate actions/);
  assert.match(fixture,/A suppressed linked action update left partial minutes or duplicate actions/);
  assert.match(fixture,/Restored action policies allowed a revoked direct creation/);
  assert.match(fixture,/Restored action policies allowed a revoked direct edit/);
  assert.match(fixture,/A minutes-only save disclosed hidden linked action records/);
  const replay=read('scripts/replay-migrations.cjs');
  assert.match(replay,/input: options\.input/);
  assert.match(replay,/run\(psql, \[\.\.\.commonArgs, '--file', '-'\]/);
  assert.ok(replay.indexOf('buildMeetingsRpcIsolationFixture({')<replay.indexOf('const inventorySql'));
  assert.ok(replay.indexOf('const allowedHosts')<replay.indexOf('buildMeetingsRpcIsolationFixture({'));
});

test('rollback fixture rejects nested commits and psql escape commands before any SQL execution',()=>{
  assert.equal(transactionBody('-- Header\nbegin;\nselect 1;\ncommit;\n','commit','Fixture'),'select 1;');
  for(const source of ['begin;\nselect 1;\ncommit;\ncommit;','begin;\n\\i other.sql\ncommit;','select 1;\nbegin;\nselect 2;\ncommit;']){
    assert.throws(()=>transactionBody(source,'commit','Fixture'),/transaction|psql commands/);
  }
  assert.throws(()=>transactionBody('begin;\nselect 1;\ncommit;','rollback','Fixture'),/BEGIN\/ROLLBACK/);
});

test('installed RPC grants preserve authenticated company and section checks',()=>{
  assert.match(repair,/revoke all on function public\.save_hse_minutes\(uuid,jsonb,timestamptz\) from public,anon/i);
  assert.match(repair,/grant execute on function public\.save_hse_minutes\(uuid,jsonb,timestamptz\) to authenticated/i);
  assert.match(repair,/role='sephs_admin' or \(company_id=c and role in/);
  assert.match(repair,/user_access_allowed\('meetings.minutes','edit'\)/);
  assert.match(repair,/Action owner must be a person in this company/);
});

test('frontend RPC argument names agree with the installation and saved results are confirmed',()=>{
  const core=read('auris-core.js'),start=core.indexOf('async function mtgSaveMom(){'),end=core.indexOf('async function mtgDeleteMom',start),save=core.slice(start,end);
  assert.match(save,/api\('\/rpc\/save_hse_minutes',\{m:'POST',b:\{p_id:savedId,p_minutes:body,p_expected_updated_at:form\.dataset\.savedUpdatedAt\|\|null\}\}/);
  assert.match(save,/result\?\.minutes\?\.id/);
  assert.doesNotMatch(save,/api\('\/hse_meetings[^\n]*m:'(?:POST|PATCH)'/);
  assert.match(read('tests/sql/meetings_rpc_installation.sql'),/routine\.proargnames is distinct from array\['p_id','p_minutes','p_expected_updated_at'\]/);
});
