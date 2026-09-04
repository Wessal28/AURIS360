const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const handler = require(path.resolve(__dirname, '..', 'api', 'ai.js'));

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('structured AI responses receive a larger bounded budget and fail closed when incomplete', async () => {
  const originalFetch = global.fetch;
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    AI_PROVIDER: process.env.AI_PROVIDER
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  process.env.OPENAI_API_KEY = 'server-test-key';
  process.env.OPENAI_MODEL = 'gpt-5-test';
  process.env.AI_PROVIDER = 'openai';
  let providerBody;
  let incomplete = false;
  global.fetch = async function(url, options) {
    if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1', user_metadata: { role: 'sephs_admin' } }) };
    providerBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => incomplete
        ? { output_text: '{"objectives":[', incomplete_details: { reason: 'max_output_tokens' } }
        : { output_text: '{"objectives":[]}' }
    };
  };
  const request = { method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { max_tokens: 12000, messages: [{ role: 'user', content: 'extract' }], response_schema: { name: 'kpi_document_import', schema: { type: 'object', properties: { objectives: { type: 'array', items: { type: 'object' } } }, required: ['objectives'], additionalProperties: false } } } };
  try {
    const completeResponse = response();
    await handler(request, completeResponse);
    assert.equal(completeResponse.statusCode, 200);
    assert.equal(providerBody.max_output_tokens, 12000);
    assert.equal(providerBody.text.format.type, 'json_schema');

    incomplete = true;
    const incompleteResponse = response();
    await handler(request, incompleteResponse);
    assert.equal(incompleteResponse.statusCode, 422);
    assert.match(JSON.parse(incompleteResponse.body).error, /exceeded its output limit/);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
