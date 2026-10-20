const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
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
  for(const table of ['hse_meetings','toolbox_talks'])assert.match(repair,new RegExp('alter table public\\.'+table+' drop constraint if exists','i'));
  const functionIndex=repair.indexOf('create or replace function public.save_hse_minutes');
  const notifyIndex=repair.indexOf("notify pgrst,'reload schema'");
  assert.ok(notifyIndex>functionIndex&&notifyIndex<repair.lastIndexOf('commit;'));
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
