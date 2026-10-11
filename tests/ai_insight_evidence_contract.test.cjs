const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'auris-core.js'), 'utf8');
const start = source.indexOf('function aiVerifiedInsightFindings(');
const end = source.indexOf('// -- Full HSE insights', start);
assert.ok(start >= 0 && end > start);
const context = {};
vm.runInNewContext(source.slice(start, end), context);

test('AI suggestions retain only exact IDs from the governed snapshot', () => {
  const snapshot = { evidence: { actions: [{ id: 'a-1', ref: 'ACT-1', target_date: '2026-10-12' }], incidents: [{ id: 'e-1', event_ref: 'INC-1' }] } };
  const response = { findings: [
    { source_type: 'actions', source_id: 'a-1', title: 'Review action', interpretation: 'Check the overdue work', next_step: 'Open it' },
    { source_type: 'actions', source_id: 'a-2', title: 'Invented action' },
    { source_type: 'other', source_id: 'e-1', title: 'Wrong type' }
  ] };
  const found = context.aiVerifiedInsightFindings(response, snapshot);
  assert.equal(found.length, 1);
  assert.equal(found[0].ref, 'ACT-1');
  assert.equal(found[0].page, 'actions');
});

test('malformed or unsupported AI output yields no record-backed finding', () => {
  assert.equal(context.aiVerifiedInsightFindings(null, { evidence: {} }).length, 0);
  assert.equal(context.aiVerifiedInsightFindings({ findings: [{ source_type: 'incidents', source_id: 'e-1' }] }, { evidence: { incidents: [] } }).length, 0);
  assert.match(source, /legal_gaps_current:legalGaps\.length/);
  assert.doesNotMatch(source, /Sources are bounded to 500 records each/);
  assert.match(source, /async function safetyOSFetch\(path\)\{return apiAllRows\(path\);\}/);
  assert.match(source, /async function safetyOSPopulateSelectors\([\s\S]*?apiAllRows\('\/people\?select=\*'/);
});
