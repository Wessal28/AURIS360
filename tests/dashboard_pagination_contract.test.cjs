const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'auris-core.js'), 'utf8');
const start = source.indexOf('async function apiAllRows(');
const end = source.indexOf('// Shared reciprocal relationship service', start);
assert.ok(start >= 0 && end > start);

test('dashboard, executive and AI totals share exhaustive reads', () => {
  for (const name of ['loadDash', 'loadExecutive', 'getCtx']) {
    const body = source.slice(source.indexOf('function ' + name + '('), source.indexOf('\nfunction ', source.indexOf('function ' + name + '(') + 1));
    for (const table of ['events', 'action_tracker', 'inspections', 'legal_requirements']) {
      assert.match(body, new RegExp("apiAllRows\\('/" + table + "\\?"), name + ' must page ' + table);
    }
  }
  assert.match(source, /select=id,event_date[^\n]*previousEvents/);
});

test('shared figures include every page in stable order', async () => {
  const requested = [];
  const rows = Array.from({ length: 1201 }, (_, i) => ({ id: i + 1 }));
  const context = {
    api: async query => {
      requested.push(query);
      const offset = Number(new URLSearchParams(query.split('?')[1]).get('offset'));
      return rows.slice(offset, offset + 500);
    }
  };
  vm.runInNewContext(source.slice(start, end), context);
  const result = await context.apiAllRows('/events?select=id&company_id=eq.company&limit=500');
  assert.equal(result.length, 1201);
  assert.deepEqual(Array.from(result, row => row.id), rows.map(row => row.id));
  assert.deepEqual(requested.map(query => Number(new URLSearchParams(query.split('?')[1]).get('offset'))), [0, 500, 1000]);
  assert.ok(requested.every(query => query.includes('order=id.asc') && query.includes('company_id=eq.company')));
});

test('a failed later page cannot produce a misleading partial count', async () => {
  const context = {
    api: async query => {
      const offset = Number(new URLSearchParams(query.split('?')[1]).get('offset'));
      if (offset) throw new Error('second page unavailable');
      return Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
    }
  };
  vm.runInNewContext(source.slice(start, end), context);
  await assert.rejects(context.apiAllRows('/action_tracker?select=id'), /second page unavailable/);
});
