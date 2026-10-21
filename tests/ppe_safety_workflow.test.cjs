const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, 'auris-ppe-workflow.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014020000_ppe_safety_workflow.sql'), 'utf8');

test('inspection cannot be saved without an exact issued item', () => {
  let saved = 0;
  const messages = [];
  const elements = new Map([['piif-issuance-id', { value: '', focus() { this.focused = true; } }]]);
  const context = {
    document: { getElementById: id => elements.get(id), addEventListener() {} },
    ppeInspSave() { saved++; },
    toast: (message, success) => messages.push([message, success]),
  };
  context.window = context;
  vm.runInNewContext(workflow, context);
  context.ppeInspSave();
  assert.equal(saved, 0);
  assert.match(messages[0][0], /exact issued item/);
  assert.equal(elements.get('piif-issuance-id').focused, true);
});

test('database keeps stock and failure decisions in the same transaction', () => {
  assert.match(migration, /create trigger ppe_issuance_stock after insert or update of status,returned,return_condition/i);
  assert.match(migration, /coalesce\(c\.quantity_available,0\)\+available_delta>=0/i);
  assert.match(migration, /create trigger ppe_inspection_guard before insert or update/i);
  assert.match(migration, /Every inspection check needs an explicit result/i);
  assert.match(migration, /A failed check cannot be cleared for use/i);
  assert.match(migration, /create trigger ppe_inspection_quarantine after insert or update/i);
  assert.match(migration, /status in \('active','returned','quarantined'\)/i);
  assert.match(migration, /New replacement requests start pending/i);
  assert.match(migration, /Fulfilment requires a linked new issuance and date/i);
});
