const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/process-equipment-reminders.js');

function response() {
  return { code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test('equipment reminder worker rejects unauthorised and unsupported requests without touching Supabase', async () => {
  const oldSecret = process.env.CRON_SECRET;
  const oldFetch = global.fetch;
  try {
    process.env.CRON_SECRET = 'test-cron-secret';
    global.fetch = () => assert.fail('unauthorised request reached Supabase');
    const unauthorised = response();
    await handler({ method: 'GET', headers: {} }, unauthorised);
    assert.equal(unauthorised.code, 401);
    const unsupported = response();
    await handler({ method: 'DELETE', headers: { authorization: 'Bearer test-cron-secret' } }, unsupported);
    assert.equal(unsupported.code, 405);
  } finally {
    if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
    global.fetch = oldFetch;
  }
});

test('authorised reminder run calls only the service-role RPC and returns its count', async () => {
  const previous = Object.fromEntries(['CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'].map(name => [name, process.env[name]]));
  const oldFetch = global.fetch;
  try {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.SUPABASE_URL = 'https://staging.example.supabase.co/';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
    let requests = 0;
    global.fetch = async (url, options) => {
      requests++;
      assert.equal(url, 'https://staging.example.supabase.co/rest/v1/rpc/process_equipment_due_reminders');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer test-service-key');
      assert.equal(options.body, '{}');
      return { ok: true, json: async () => ({ notifications_queued: 3 }) };
    };
    const res = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } }, res);
    assert.equal(requests, 1);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { ok: true, result: { notifications_queued: 3 } });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    global.fetch = oldFetch;
  }
});
