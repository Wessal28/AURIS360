const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'auris-core.js'), 'utf8');
function load(start, end, context) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  vm.createContext(context);
  vm.runInContext(source.slice(from, to), context);
}

test('only open inspections inside their reminder window appear with exact record links', () => {
  const panel = { hidden: true, innerHTML: '', dataset: {}, addEventListener() {} };
  const context = {
    document: { getElementById: id => id === 'audit-due-reminders' ? panel : null },
    auditLocalDate: () => '2026-10-12', escH: String,
    auditAllData: [
      { id: 'due', reference_no: 'WI-2026-001', site: 'Site A', planned_date: '2026-10-15', reminder_days: 7, status: 'open' },
      { id: 'later', planned_date: '2026-11-12', reminder_days: 7, status: 'open' },
      { id: 'done', planned_date: '2026-10-12', reminder_days: 7, status: 'completed' }
    ]
  };
  load('function auditRenderDueReminders()', 'function auditFilter()', context);
  context.auditRenderDueReminders();
  assert.equal(panel.hidden, false);
  assert.match(panel.innerHTML, /data-id="due"/);
  assert.doesNotMatch(panel.innerHTML, /data-id="later"|data-id="done"/);
});

test('repeat finding review shows the previous corrective action and can stop saving', async () => {
  let confirmation;
  const context = {
    auditEditId: null, auditAllData: [{ id: 'previous', site: 'Site A', equipment_asset_id: 'asset-a' }],
    ccid: () => 'company-a', encodeURIComponent, auditFormFeedback() {},
    api: async () => [{ id: 'finding-a', inspection_id: 'previous', finding_ref: 'F001', clause: '8.1', description: 'Missing guard', corrective_action: 'Install guard', status: 'in_progress' }],
    appConfirmAction: async options => { confirmation = options; return false; }
  };
  load('async function auditReviewPossibleRepeats(', '// Save inspection', context);
  const accepted = await context.auditReviewPossibleRepeats([{ description: 'Missing guard', clause: '8.1' }], 'Site A', 'asset-a');
  assert.equal(accepted, false);
  assert.match(confirmation.detail, /Install guard/);
});
