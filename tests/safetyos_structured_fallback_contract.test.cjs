const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'api', 'ai.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('SafetyOS requests enforced structured output with sufficient bounded capacity', () => {
  assert.match(core, /response_schema:\{name:'safetyos_decision',schema:schema\}/);
  assert.match(core, /max_tokens:4000/);
  assert.match(proxy, /type: 'json_schema'/);
  assert.match(proxy, /payload\.text = \{ format: responseFormat \}/);
  assert.match(proxy, /payload\.reasoning = \{ effort: 'low' \}/);
  assert.match(proxy, /OpenAI returned no usable output/);
});

test('SafetyOS degrades to a conservative live-record decision and never grants fallback GO', () => {
  const fallbackStart = core.indexOf('function safetyOSFallbackDecision');
  const runStart = core.indexOf('async function safetyOSRunCheck', fallbackStart);
  const fallback = core.slice(fallbackStart, runStart);
  assert.ok(fallbackStart >= 0 && runStart > fallbackStart);
  assert.match(fallback, /decision:blocking\.length\?'NO_GO':'CONDITIONAL_GO'/);
  assert.doesNotMatch(fallback, /decision:[^\n]*'GO'/);
  assert.match(fallback, /Supervisor and HSE representative must review/);
  assert.match(core, /safetyOSRenderDecision\(safetyOSFallbackDecision\(ctx,aiError\),ctx\)/);
  assert.match(core, /fallback_notice/);
});

test('the repaired SafetyOS client is cache-busted for deployment', () => {
  assert.match(html, /auris-core\.js\?v=20260823-4/);
});
