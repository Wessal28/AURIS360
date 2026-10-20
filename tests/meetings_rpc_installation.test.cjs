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

test('repair installs the same reviewed atomic save without a weaker table fallback',()=>{
  assert.equal(body(repair),body(canonical));
  assert.match(repair,/create or replace function public\.save_hse_minutes\(p_id uuid,p_minutes jsonb,p_expected_updated_at timestamptz default null\) returns jsonb/i);
  assert.doesNotMatch(repair,/security definer/i);
  assert.match(repair,/pg_advisory_xact_lock/);
  assert.match(repair,/old_m\.updated_at is distinct from p_expected_updated_at/);
  assert.doesNotMatch(body(repair),/delete from public\.action_tracker/i);
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

test('metadata preflight reports missing core schema and permissions before changing the schema',()=>{
  const start=repair.indexOf('do $minutes_preflight$'),end=repair.indexOf('end $minutes_preflight$;',start);
  assert.ok(start>=0&&end>start&&end<repair.indexOf('alter table public.hse_meetings'));
  const preflight=repair.slice(start,end);
  for(const table of ['profiles','people','hse_meetings','action_tracker','meeting_series'])assert.match(preflight,new RegExp("\\('"+table+"',array\\["));
  for(const signature of ['auth.uid()','public.user_access_allowed(text,text)','public.guard_module_user_access()'])assert.ok(preflight.includes(signature));
  assert.match(preflight,/to_regclass\('public\.'\|\|item\.table_name\)/);
  assert.match(preflight,/not attisdropped/);
  assert.match(preflight,/atttypid<>item\.column_type/);
  assert.match(preflight,/Minutes repair prerequisites are incomplete/);
  assert.match(preflight,/detail=array_to_string\(missing,'; '\)/);
  assert.doesNotMatch(preflight,/\b(?:create|alter|drop|insert|update|delete|grant|revoke)\s+(?:table|function|policy|trigger|into|from|on)\b/i);
});

test('disposable replay proves a missing RPC can be restored twice with optional tables absent',()=>{
  const fixture=buildMeetingsRpcIsolationFixture({repair,installationAssertions:read('tests/sql/meetings_rpc_installation.sql'),behaviorAssertions:read('tests/sql/meetings_rpc_optional_modules.sql')});
  assert.equal((fixture.match(/^begin;$/gm)||[]).length,1);
  assert.equal((fixture.match(/^rollback;$/gm)||[]).length,1);
  assert.doesNotMatch(fixture,/^commit;/im);
  assert.doesNotMatch(fixture,/\bcascade\b/i);
  for(const table of OPTIONAL_TABLES){
    assert.match(fixture,new RegExp('alter table public\\.'+table+' rename to __fixture_missing_'+table+';'));
    assert.ok(fixture.indexOf('alter table public.'+table)<fixture.indexOf('create or replace function public.save_hse_minutes'));
  }
  assert.equal((fixture.match(/create or replace function public\.save_hse_minutes/g)||[]).length,2);
  assert.match(fixture,/drop function public\.save_hse_minutes\(uuid,jsonb,timestamptz\);/);
  assert.match(fixture,/alter function public\.user_access_allowed\(text,text\) rename to __fixture_missing_user_access_allowed;/);
  assert.match(fixture,/Minutes preflight accepted a missing permission helper/);
  assert.match(fixture,/get stacked diagnostics failure_detail=pg_exception_detail/);
  assert.match(fixture,/alter function public\.__fixture_missing_user_access_allowed\(text,text\) rename to user_access_allowed;/);
  assert.match(fixture,/routine\.proargnames is distinct from array\['p_id','p_minutes','p_expected_updated_at'\]/);
  assert.match(fixture,/result:=public\.save_hse_minutes\(minutes_id,payload,null\)/);
  assert.match(fixture,/Isolated minutes update duplicated its linked action/);
  assert.match(fixture,/Isolated minutes repair accepted a stale save/);
  assert.match(fixture,/Isolated completed minutes did not advance their schedule/);
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
