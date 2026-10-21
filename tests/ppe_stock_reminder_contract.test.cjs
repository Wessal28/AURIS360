const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014030000_ppe_stock_and_reminders.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'auris-ppe-workflow.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const handler = require('../api/process-ppe-reminders.js');

test('stock movement is manager-only, tenant-scoped and records immutable before/after balances', () => {
  assert.match(migration, /for update;\s*if not found then raise exception 'PPE item is unavailable in this company'/i);
  assert.match(migration, /actor\.role not in \('sephs_admin','admin','manager','hse_manager','site_manager'\)/i);
  assert.match(migration, /Stock adjustment would make the balance negative/i);
  assert.match(migration, /PPE stock movements are immutable/i);
  assert.match(migration, /Use a PPE stock receipt or adjustment to change stock balances/i);
  assert.match(migration, /available_before,available_after,total_before,total_after,recorded_by/i);
  assert.match(workflow, /Suggested minimum receipt: /);
  assert.match(workflow, /rpc\/record_ppe_stock_movement/);
});

test('PPE reminder queue uses due milestones and idempotent in-app links', () => {
  assert.match(migration, /process_ppe_due_reminders/);
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/i);
  assert.match(migration, /ppe_inspection_due/);
  assert.match(migration, /ppe_replacement_due/);
  assert.match(migration, /ppe_reorder_suggestion/);
  assert.match(migration, /on conflict do nothing/g);
  assert.ok(vercel.crons.some(cron => cron.path === '/api/process-ppe-reminders'));
});

test('PPE reminder endpoint rejects unauthorised requests and calls only the service RPC', async () => {
  const old = { secret: process.env.CRON_SECRET, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY, fetch: global.fetch };
  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  const calls = [];
  global.fetch = async (url, options) => { calls.push([url, options]); return { ok: true, json: async () => ({ notifications_queued: 2 }) }; };
  const reply = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  try {
    const denied = reply();
    await handler({ method: 'GET', headers: {} }, denied);
    assert.equal(denied.code, 401);
    assert.equal(calls.length, 0);
    const allowed = reply();
    await handler({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } }, allowed);
    assert.equal(allowed.code, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'https://supabase.example/rest/v1/rpc/process_ppe_due_reminders');
    assert.equal(calls[0][1].headers.Authorization, 'Bearer test-service-key');
  } finally {
    if (old.secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old.secret;
    if (old.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = old.url;
    if (old.key === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = old.key;
    global.fetch = old.fetch;
  }
});
