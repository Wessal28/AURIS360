const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sql=read('supabase/migrations/20261021010000_people_user_linking.sql');
const {verifyTarget}=require('../scripts/verify-people-user-link-concurrency.cjs');

test('complete People linking migration can be rerun without an automatic account backfill',()=>{
  assert.match(sql,/^begin;/m);assert.match(sql,/commit;\s*$/);
  assert.match(sql,/add column if not exists person_id uuid references public\.people/);
  assert.match(sql,/create unique index if not exists profiles_person_id_unique/);
  assert.ok(!/^create function |^create (?:unique )?index (?!if not exists)/m.test(sql),'Functions and indexes must be rerunnable');
  assert.doesNotMatch(sql,/^(?:insert into|update|delete from) public\./m);
  assert.match(sql,/People\/user linking prerequisites are incomplete/);
});

test('only trusted service provisioning can invoke the atomic RPC',()=>{
  assert.match(sql,/revoke all on function public\.admin_link_user_person\(uuid,uuid,uuid,jsonb,uuid,boolean,boolean\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.admin_link_user_person\(uuid,uuid,uuid,jsonb,uuid,boolean,boolean\) to service_role/);
  assert.match(sql,/actor\.status is distinct from 'active'/);
  assert.match(sql,/actor\.company_id is distinct from p_company_id/);
  assert.ok(sql.indexOf("pg_advisory_xact_lock(hashtextextended('people-user-link/'")<sql.indexOf('into actor from public.profiles'));
  assert.match(sql,/source_table,source_id,decision,selected_person_id/);
  assert.doesNotMatch(sql,/create.*trigger.*auth\.users/i);
});

test('existing People and account privileges are retained and ambiguous identities require review',()=>{
  assert.doesNotMatch(sql,/update public\.people set/);
  const update=sql.slice(sql.indexOf('update public.profiles set person_id='),sql.indexOf('returning * into target;',sql.indexOf('update public.profiles set person_id=')));
  assert.doesNotMatch(update,/\b(?:role|status|permissions|must_change_password|synthetic_email)\s*=/);
  assert.match(sql,/cardinality\(person_ids\)>1/);
  assert.match(sql,/person_match_required/);
  assert.match(sql,/Names alone are not identity proof/);
  assert.match(sql,/A synthetic address can identify an existing login, but never a Person/);
  assert.match(sql,/person_company is distinct from new\.company_id/);
});

test('disposable PostgreSQL replay exercises real matching, rollback and caller permissions',()=>{
  const fixture=read('tests/sql/people_user_linking.sql');
  for(const proof of ['Preview did not identify the manual person without writes','User creation duplicated or modified manually entered People','Conflicting email and phone matches were silently combined','A name-only match linked or wrote an identity without confirmation','Reconciliation changed an existing role, permissions or inactive status','A synthetic login retry did not resolve its existing account','Cross-company account conflict leaked private candidates or linked users','Create-only provisioning changed Auth metadata or could not finalize its new account'])assert.ok(fixture.includes(proof),proof);
  assert.match(fixture,/set local role service_role/);
  assert.match(fixture,/set local role authenticated/);
  assert.match(fixture,/rollback;\s*$/);
  assert.match(read('scripts/replay-migrations.cjs'),/tests', 'sql', 'people_user_linking\.sql'/);
});

test('competing account fixture is restricted to the disposable localhost database',()=>{
  assert.equal(verifyTarget('postgresql://postgres:fictional@127.0.0.1:5432/auris360_migration_replay').hostname,'127.0.0.1');
  for(const target of ['postgresql://postgres:fictional@db.example.test/auris360_migration_replay','postgresql://postgres:fictional@localhost/postgres','https://localhost/auris360_migration_replay'])assert.throws(()=>verifyTarget(target),/disposable localhost/);
  const script=read('scripts/verify-people-user-link-concurrency.cjs');
  assert.match(script,/AURIS360_MIGRATION_REPLAY_CONFIRM/);
  assert.match(script,/wait_event_type='Lock' and lower\(wait_event\)='advisory'/);
  assert.match(script,/one Person, one profile link, one audit event; no overwrite/);
  assert.match(read('scripts/replay-migrations.cjs'),/verify-people-user-link-concurrency\.cjs/);
});
