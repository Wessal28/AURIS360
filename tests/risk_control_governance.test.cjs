const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'auris-core.js'), 'utf8');
function sourceBetween(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing ${start}`);
  return source.slice(from, to);
}

test('submission requires a documented and assigned basis for a reduced residual score', () => {
  const validate = vm.runInNewContext(
    `${sourceBetween('function raControlSubmissionIssue(', 'async function raSave(')}; raControlSubmissionIssue`,
    {raEditingType:'task'},
  );
  const row = {rr: 20, res_rr: 5, further_controls: '', hoc_level: '', action_by: '', target_date: ''};
  assert.match(validate([row]), /additional controls/);
  row.further_controls = 'Install an interlocked guard';
  assert.match(validate([row]), /hierarchy/);
  row.hoc_level = 'engineering';
  assert.match(validate([row]), /owner and target date/);
  row.action_by = 'Supervisor';
  row.target_date = '2026-10-20';
  assert.equal(validate([row]), '');
  assert.equal(validate([{rr: 5, res_rr: 5}]), '');
  assert.match(validate([{rr: 0, res_rr: 0}]), /choose both likelihood and severity/);
});

test('saving the same high-risk assessment twice does not duplicate a linked action', async () => {
  const actions = [];
  const context = {
    raAllData: [{id: 'ra-1', ra_ref: 'RA-001'}],
    raRecordRef: record => record.ra_ref,
    ccid: () => 'company-1',
    cf: () => '&company_id=eq.company-1',
    prof: {id: 'user-1'},
    encodeURIComponent,
    api: async (url, options) => {
      if (!options) return actions.map(action => ({id: action.id, action_no:action.action_no, description: action.description, responsible:action.responsible, target_date:action.target_date, status:action.status}));
      if (options.m === 'PATCH') {Object.assign(actions.find(action => url.includes(action.id)), options.b);return [];}
      actions.push({...options.b, id: `action-${actions.length + 1}`});
      return [];
    },
  };
  const sync = vm.runInNewContext(
    `${sourceBetween('async function raSyncToMAP(', 'function raClearForm(')}; raSyncToMAP`,
    context,
  );
  const rows = [{hazard: 'Unguarded machine', res_rl: 'High', action_by: 'Supervisor', target_date: '2026-10-20'}];
  await sync('ra-1', rows);
  await sync('ra-1', rows);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].target_date, '2026-10-20');
  assert.equal(actions[0].source_id, 'ra-1');
});
