const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = fs.readFileSync(path.join(__dirname, '../auris-core.js'), 'utf8');
const deleteCode = core.slice(core.indexOf('async function toolsDelete()'), core.indexOf('// -- PERSONAL TOOLS'));

function harness(record, apiOverride) {
  const calls = [];
  const notices = [];
  const ctx = {
    console: { warn() {} },
    Date,
    encodeURIComponent,
    ohIsArchivedText: value => /\[Archived/i.test(String(value || '')),
    ohArchivedText: value => /\[Archived/i.test(String(value || '')) ? String(value) : `[Archived 2026-09-10] ${value || ''}`.trim(),
    appConfirmAction: async () => true,
    appConfirmDelete: async () => true,
    toolsLoadRegister() {},
    toolsFilterRegister() {},
    toolsFormBack() {},
    toast: message => notices.push(message),
    toastActionError: (...args) => notices.push(args.join(' | ')),
    api: async (url, options) => {
      calls.push({ url, options });
      if (apiOverride) return apiOverride(url, options);
      return [];
    }
  };
  vm.createContext(ctx);
  vm.runInContext(`var toolsEditingId='eq-1'; var toolsAllData=${JSON.stringify([record])};`, ctx);
  vm.runInContext(deleteCode, ctx);
  return { ctx, calls, notices };
}

test('active equipment is retired even when its notes already contain an archive marker', async () => {
  const h = harness({ id: 'eq-1', status: 'active', notes: '[Archived 2026-09-01]' });
  await h.ctx.toolsDeleteFromList('eq-1');
  const patch = h.calls.find(call => call.options?.m === 'PATCH');
  assert.ok(patch);
  assert.equal(patch.options.b.status, 'out_of_service');
  assert.equal(h.calls.some(call => call.options?.m === 'DELETE'), false);
  assert.match(h.notices[0], /remains available for inspection and defect history/i);
});

test('linked defect history prevents permanent deletion with a clear message', async () => {
  const h = harness({ id: 'eq-1', status: 'out_of_service', notes: '[Archived 2026-09-01]' }, async url => {
    if (url.startsWith('/equipment_defects?')) return [{ id: 'defect-1' }];
    return [];
  });
  await h.ctx.toolsDeleteFromList('eq-1');
  assert.equal(h.calls.some(call => call.options?.m === 'DELETE'), false);
  assert.match(h.notices[0], /cannot be permanently deleted/i);
  assert.match(h.notices[0], /defect record/i);
});

test('foreign-key failures are translated when a pre-check is unavailable', async () => {
  const h = harness({ id: 'eq-1', status: 'out_of_service', notes: '[Archived 2026-09-01]' }, async (url, options) => {
    if (url.startsWith('/equipment_')) throw new Error('link check unavailable');
    if (options?.m === 'DELETE') throw new Error('violates foreign key constraint "equipment_defects_equipment_id_fkey"');
    return [];
  });
  await h.ctx.toolsDeleteFromList('eq-1');
  assert.match(h.notices[0], /cannot be permanently deleted/i);
  assert.doesNotMatch(h.notices[0], /foreign key constraint/i);
});
