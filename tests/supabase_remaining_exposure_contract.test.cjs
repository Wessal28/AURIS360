const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const audit=fs.readFileSync(path.resolve(__dirname,'..','supabase_remaining_exposure_review.sql'),'utf8');
const remediation=fs.readFileSync(path.resolve(__dirname,'..','supabase_remaining_exposure_remediation.sql'),'utf8');

assert.match(audit,/set transaction read only/i);
assert.match(audit,/pol\.cmd in \('SELECT','ALL'\)/i);
assert.match(audit,/owner\.rolname as owner_role/i);
assert.match(remediation,/revoke all privileges on function %s from public, anon, authenticated/i);
assert.match(remediation,/grant execute on function %s to authenticated, service_role/i);
assert.match(remediation,/revoke select on table %s from anon/i);
assert.match(remediation,/revoke maintain on table %s from anon/i);
assert.match(remediation,/alter default privileges for role postgres in schema public/i);
assert.doesNotMatch(remediation,/alter default privileges for role supabase_admin/i);
assert.match(remediation,/platform-owned schemas and supabase_admin defaults are managed/i);
assert.match(remediation,/exposed_non_privileged_rpcs/i);
assert.match(remediation,/anon_reads_without_policy/i);
assert.match(remediation,/risky_public_defaults/i);
console.log('Remaining Supabase exposure contract passed (RPC, anonymous reads, maintenance and public defaults).');
