const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = require('./application_source.cjs')(root);
const sql = fs.readFileSync(path.join(root, 'canonical_person_identity_upgrade.sql'), 'utf8');

const directTables = [
  'training_followup','competency_matrix','induction_records','elearning_enrolments',
  'ppe_issuance','medical_surveillance','audiometry_records','spirometry_records',
  'vaccination_records','occupational_diseases','doc_acknowledgements'
];
for (const table of directTables) {
  assert.match(sql, new RegExp(`alter table if exists public\\.${table} add column if not exists person_id`, 'i'), `missing canonical person_id on ${table}`);
}

assert.match(sql, /create table if not exists public\.person_identity_backfill_review/i);
assert.match(sql, /create or replace function public\.resolve_unique_person_id/i);
assert.match(sql, /array_length\(matches,1\),0\)=1/i, 'backfill must resolve only unique matches');
assert.match(sql, /person_name_snapshot/i);
assert.match(sql, /organization_snapshot/i);
assert.match(sql, /role_snapshot/i);
assert.match(sql, /attendee_person_ids uuid\[\]/i);

assert.match(html, /function personIdentityPayload\(/);
assert.match(html, /function personIdsFromText\(/);
assert.match(html, /Object\.assign\(body,personIdentityPayload\(personId\|\|name\)\)/);
assert.match(html, /Object\.assign\(body,personIdentityPayload\(emp\)\)/);
assert.match(html, /presenter_person_id:personFromValue/);
assert.match(html, /attendee_person_ids:attendees\.map/);
assert.match(html, /assignee_organization_snapshot/);
assert.match(html, /apiWriteWithMissingColumnFallback/);

console.log(`Person identity contract passed (${directTables.length} direct-link tables).`);
