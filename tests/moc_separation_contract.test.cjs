const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'moc_change_requests_upgrade.sql'), 'utf8');

assert.match(sql, /create table if not exists public\.moc_change_requests/i);
for (const stage of ['draft','screening','impact_assessment','pending_approval','approved','implementation','verification','closed','rejected','cancelled']) {
  assert.ok(sql.includes(`'${stage}'`), `missing MOC lifecycle stage: ${stage}`);
}
assert.match(sql, /legacy_action_id uuid unique/i);
assert.match(sql, /join public\.action_tracker a on a\.id=m\.legacy_action_id/i);
assert.match(sql, /'generated_action'/i);

assert.match(html, /api\('\/moc_change_requests\?select=\*'/);
assert.match(html, /table:'moc_change_requests',page:'moc'/);
assert.match(html, /moc:'moc_change_requests'/);
assert.match(html, /function mocCreateCorrectiveAction\(\)/);
assert.match(html, /source_table:'moc_change_requests'/);
assert.match(html, /relationshipEndpoint\('moc','moc_change_requests'/);
assert.match(html, /id="moc-connected-records"/);

// Legacy fallback is intentional, but dedicated saves must target the MOC table.
assert.match(html, /mocLegacyMode=true/);
assert.match(html, /api\('\/moc_change_requests',\{m:'POST'/);

console.log('MOC separation contract passed.');
