const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'canonical_location_relationships_upgrade.sql'), 'utf8');

assert.match(sql, /create table if not exists public\.location_identity_backfill_review/i);
assert.match(sql, /create or replace function public\.resolve_location_identity/i);
assert.match(sql, /create or replace function public\.backfill_location_identity/i);
assert.match(sql, /parent_site_id is not null/i, 'areas must remain child rows in the Sites hierarchy');
assert.match(sql, /candidate_location_ids uuid\[\]/i);
assert.match(sql, /resolution_status in \('unresolved','resolved','ignored'\)/i);
assert.match(sql, /alter table if exists public\.events add column if not exists site_id/i);
assert.match(sql, /alter table if exists public\.events add column if not exists area_id/i);
assert.match(sql, /site_name_snapshot text/i);
assert.match(sql, /area_name_snapshot text/i);
assert.match(sql, /select public\.backfill_location_identity\('safety_observations'/i);
assert.match(sql, /select public\.backfill_location_identity\('permits'/i);

assert.match(html, /function locationIdentityPayload\(/);
assert.match(html, /function locationAttachSearchableSelectors\(/);
assert.match(html, /Object\.assign\(body,locationIdentityPayload\(loc,null\)\)/);
assert.match(html, /Object\.assign\(body,locationIdentityPayload\(body\.site_name,body\.location\)\)/);
assert.match(html, /Object\.assign\(body,locationIdentityPayload\(body\.site,null\)\)/);
assert.match(html, /function smMatchMode\(/);
assert.match(html, /if\(row\.area_id\|\|row\.site_id\)return ''/, 'canonical IDs must prevent unrelated text fallback');
assert.match(html, /Legacy text match/);
assert.match(html, /smApiCompat\('\/safety_observations/);
assert.match(html, /smApiCompat\('\/permits/);

console.log('Location identity contract passed.');
