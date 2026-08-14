const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = require('./application_source.cjs')(root);
const sql = fs.readFileSync(path.join(root, 'person_identity_reconciliation_upgrade.sql'), 'utf8');

assert.match(sql, /create table if not exists public\.person_identity_decisions/i);
assert.match(sql, /create or replace view public\.person_duplicate_candidates/i);
assert.match(sql, /create or replace view public\.person_identity_reconciliation_summary/i);
assert.match(sql, /create or replace function public\.resolve_person_identity_review/i);
assert.match(sql, /create or replace function public\.refresh_person_identity_reconciliation/i);
assert.match(sql, /item\.source_table not in/i, 'resolution RPC must enforce a table allowlist');
assert.match(sql, /person_row\.id is null then raise exception/i, 'selected person must belong to the company');
assert.match(sql, /insert into public\.person_identity_decisions/i);
assert.match(sql, /insert into public\.audit_events/i);
assert.doesNotMatch(sql, /delete\s+from\s+public\.people/i, 'reconciliation must never delete People');
assert.doesNotMatch(sql, /update\s+public\.people\s+set/i, 'reconciliation must never silently merge People');

assert.match(html, /id="settings-person-identity-card"/);
assert.match(html, /function renderPersonIdentityReconciliation/);
assert.match(html, /function loadPersonIdentityReconciliation/);
assert.match(html, /function personIdentityResolve/);
assert.match(html, /rpc\/resolve_person_identity_review/);
assert.match(html, /AURIS never merges these automatically/);

console.log('Person identity reconciliation contract passed.');
