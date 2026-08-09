const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'verified_operational_references_upgrade.sql'), 'utf8');

assert.match(sql, /create table if not exists public\.reference_identity_backfill_review/i);
assert.match(sql, /create or replace function public\.backfill_verified_reference/i);
assert.match(sql, /p_source_table not in/i, 'dynamic backfill must enforce an allowlist');
assert.match(sql, /group by src\.id having count\(\*\)=1/i, 'only unique matches may be auto-linked');
assert.match(sql, /alter table if exists public\.atex_areas add column if not exists linked_permit_id/i);
assert.match(sql, /alter table if exists public\.ppe_issuance add column if not exists work_order_id/i);
assert.match(sql, /alter table if exists public\.compliance_calendar add column if not exists legal_requirement_id/i);
assert.match(sql, /alter table if exists public\.work_schedule add column if not exists risk_assessment_id/i);
assert.match(sql, /alter table if exists public\.permits add column if not exists method_statement_id/i);
assert.match(sql, /alter table if exists public\.documents add column if not exists linked_risk_assessment_id/i);

assert.match(html, /function verifiedReferenceSelection\(/);
assert.match(html, /function verifiedReferenceOption\(/);
assert.match(html, /function openVerifiedReferenceSelect\(/);
assert.match(html, /body\.risk_assessment_id=permitRa\.id/);
assert.match(html, /body\.work_order_id=verifiedReferenceSelection\('pif-wo-ref'\)\.id/);
assert.match(html, /linked_permit_id:permitLink\.id/);
assert.match(html, /linked_risk_assessment_id:swmsRa\.id/);
assert.match(html, /legal_requirement_id:req\.id,linked_action_id:act\.id/);
assert.match(html, /The selected Risk Assessment must be approved\/current before permit submission/);
assert.match(html, /Select an actual permit/);
assert.match(html, /calOpenLinked\('legal'\)/);

console.log('Verified operational references contract passed.');
