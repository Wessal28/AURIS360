const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const start = core.indexOf('function hseVerifiedHours(');
const end = core.indexOf('\nvar execData =', start);
assert.ok(start >= 0 && end > start, 'verified-hours calculator is present');
const calculate = vm.runInNewContext(core.slice(start, end) + '\nhseVerifiedHours');
const row = (month, hours, year = 2026) => ({reporting_year: year, reporting_month: month, exposure_hours: hours, source_reference: 'Signed timesheet'});

test('rates use only a complete sourced reporting period', () => {
  assert.equal(calculate([row(1, 120), row(2, 80)], 2026, 2), 200);
  assert.equal(calculate([row(1, 120)], 2026, 2), null);
  assert.equal(calculate([row(1, 120), {...row(2, 80), source_reference: ''}], 2026, 2), null);
  assert.equal(calculate([row(1, 0), row(2, 0)], 2026, 2), null);
  assert.equal(calculate([row(1, 120, 2025), row(2, 80)], 2026, 2), null);
});

test('dashboard and reports do not derive exposure hours from headcount', () => {
  assert.doesNotMatch(core, /people\.length\s*\*\s*2000/);
  assert.match(core, /Verified exposure hours: /);
  assert.match(core, /execGeneratedReport=\{text:/);
});
