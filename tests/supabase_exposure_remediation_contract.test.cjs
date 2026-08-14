const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sql=fs.readFileSync(path.resolve(__dirname,'..','supabase_exposure_security_remediation.sql'),'utf8');

assert.match(sql,/begin;[\s\S]*commit;/i);
assert.match(sql,/revoke insert, update, delete, truncate, references, trigger on table %s from anon/i);
assert.match(sql,/backfill_location_identity[\s\S]*queue_notification[\s\S]*resolve_unique_person_id/i);
assert.match(sql,/revoke all privileges on function %s from public, anon, authenticated/i);
assert.match(sql,/grant execute on function %s to service_role/i);
assert.match(sql,/grant execute on function %s to authenticated, service_role/i);
assert.match(sql,/p\.prorettype='trigger'::regtype/i);
assert.match(sql,/set search_path = pg_catalog, public, extensions/i);
assert.match(sql,/alter default privileges for role postgres in schema public/i);
assert.match(sql,/exposed_security_definer_functions/i);
assert.doesNotMatch(sql,/revoke all privileges on table %s from authenticated/i);
console.log('Supabase exposure remediation contract passed (targeted anon/RPC hardening with authenticated workflows preserved).');
