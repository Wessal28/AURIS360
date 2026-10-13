const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261013030000_occupational_health_followup_links.sql'), 'utf8');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const handler = require('../api/process-occupational-health-reminders.js');

function response() {
  return { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test('OH reminder RPC keeps clinical details out of queued mail and limits recipients', () => {
  const queued = sql.slice(sql.indexOf('insert into public.notification_queue'));
  assert.match(sql, /auth\.role\(\) <> 'service_role'/);
  assert.match(sql, /revoke all on function public\.process_occupational_health_reminders\(date\) from public, anon, authenticated/);
  assert.match(queued, /p\.role in \('occupational_health','sephs_admin'\)/);
  assert.match(queued, /d\.follow_up_owner_id is null or p\.id=d\.follow_up_owner_id/);
  assert.doesNotMatch(queued, /employee_name|medical_notes|measurement_value|reaction_details|vaccine_name/);
  assert.match(queued, /'ohealth-due\/'\|\|d\.kind/);
});

test('automatic Occupational Health actions omit worker names and exposure values', () => {
  assert.doesNotMatch(core, /source_ref:'(?:Medical surveillance|Audiometry|Spirometry) - '\+name/);
  assert.doesNotMatch(core, /description:'OEL exceeded: '\+/);
  assert.match(core, /description:'Review the linked restricted exposure exceedance\.'/);
});

test('OH reminder endpoint rejects unauthenticated calls and invokes the service-only RPC', async () => {
  const old = { secret: process.env.CRON_SECRET, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY, fetch: global.fetch };
  try {
    process.env.CRON_SECRET = 'test-secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
    let called = false;
    global.fetch = async (url, options) => {
      called = true;
      assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/process_occupational_health_reminders');
      assert.equal(options.headers.Authorization, 'Bearer test-service-key');
      return { ok: true, json: async () => ({ notifications_queued: 1 }) };
    };
    const unauthorized = response();
    await handler({ method: 'GET', headers: {} }, unauthorized);
    assert.equal(unauthorized.code, 401);
    assert.equal(called, false);
    const authorized = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer test-secret' } }, authorized);
    assert.equal(authorized.code, 200);
    assert.equal(authorized.body.result.notifications_queued, 1);
  } finally {
    for (const [key, value] of [['CRON_SECRET', old.secret], ['SUPABASE_URL', old.url], ['SUPABASE_SERVICE_KEY', old.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    global.fetch = old.fetch;
  }
});
