const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('emergency reminder worker requires cron authorization before queuing', async () => {
  const handler = require('../api/process-emergency-reminders.js');
  const before = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'contract-test-secret';
  try {
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, response);
    assert.equal(response.code, 401);
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});

test('scheduled reminders cover only actionable dated emergency records and respect preferences', () => {
  const sql = read('supabase/migrations/20261013010000_emergency_due_reminders.sql');
  for (const source of ['emergency_plans', 'emergency_drills', 'ert_members', 'emergency_equipment']) assert.match(sql, new RegExp(source));
  assert.match(sql, /status='active' and review_date is not null/);
  assert.match(sql, /status='planned' and drill_date is not null/);
  assert.match(sql, /coalesce\(pref\.email_enabled,true\)/);
  assert.match(sql, /on conflict do nothing/);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/);
  assert.match(sql, /milestone/);
});

test('ERT training prefill uses current authorisations; plan resources retain equipment IDs', () => {
  const js = read('auris-emergency-workflow.js');
  assert.match(js, /person_id=eq\./);
  assert.match(js, /status=eq\.active/);
  assert.match(js, /row\.expiry_date>=today/);
  assert.match(js, /equipment_id:id/);
  assert.match(js, /status==='operational'/);
  assert.match(js, /Use Training certificates/);
  assert.match(js, /Add linked equipment/);
});
