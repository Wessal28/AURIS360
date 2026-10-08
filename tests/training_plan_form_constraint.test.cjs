const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261009020000_training_plan_form_values.sql'), 'utf8');

function formValues(id) {
  const select = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)<\\/select>`));
  assert.ok(select, `${id} select exists`);
  return [...select[1].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
}

function allowedValues(constraint) {
  const check = sql.match(new RegExp(`add constraint ${constraint}[\\s\\S]*?check \\([^\\s]* in \\(\\s*([\\s\\S]*?)\\s*\\)\\);`, 'i'));
  assert.ok(check, `${constraint} is defined`);
  return [...check[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('every Training Plan form choice is accepted by its database constraint', () => {
  for (const [field, constraint] of [
    ['tp-type', 'training_plan_training_type_check'],
    ['tp-status', 'training_plan_status_check'],
  ]) {
    const allowed = new Set(allowedValues(constraint));
    for (const value of formValues(field)) assert.ok(allowed.has(value), `${field} value ${value} must be accepted`);
  }
  const types = new Set(allowedValues('training_plan_training_type_check'));
  assert.ok(types.has('e-learning') && types.has('on-the-job'), 'legacy values remain accepted');
});

test('training type normalization preserves Toolbox talk and On-the-job selections', () => {
  const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
  const source = core.match(/function tpNormalizeType\(v\)\{[\s\S]*?\n\}/);
  assert.ok(source);
  const normalize = vm.runInNewContext(`${source[0]}; tpNormalizeType`);
  assert.equal(normalize('toolbox'), 'toolbox');
  assert.equal(normalize('on-the-job'), 'on-the-job');
  assert.equal(normalize('e-learning'), 'online');
});
