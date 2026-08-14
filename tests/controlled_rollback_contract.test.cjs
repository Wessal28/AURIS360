const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = require('./application_source.cjs')(root);
const sql = fs.readFileSync(path.join(root, 'controlled_rollout_upgrade.sql'), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} is missing`);
  const brace = html.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`function ${name} is incomplete`);
}

const runtimeStart = html.indexOf('var ROLLOUT_COHORTS=');
const runtimeEnd = html.indexOf('// Returns true if the current user', runtimeStart);
const context = { isSA: () => false, sephsCompanyContext: null, prof: { company_id: 'company-a' }, api: async () => [] };
vm.createContext(context);
vm.runInContext(html.slice(runtimeStart, runtimeEnd), context);

// Rollback states immediately gate cohort modules but leave the platform shell
// and all underlying operational data untouched.
context.rolloutRuntimeRows = [{ cohort_key: 'core_control', status: 'enabled' }];
assert.strictEqual(context.rolloutModuleAllowed('events'), true);
for (const rollbackStatus of ['paused', 'disabled']) {
  context.rolloutRuntimeRows[0].status = rollbackStatus;
  for (const page of ['events', 'inspection', 'risk', 'actions']) {
    assert.strictEqual(context.rolloutModuleAllowed(page), false, `${rollbackStatus} must gate ${page}`);
  }
  assert.strictEqual(context.rolloutModuleAllowed('dashboard'), true, `${rollbackStatus} must retain the safe landing page`);
}
context.rolloutRuntimeRows = [];
assert.strictEqual(context.rolloutModuleAllowed('events'), true, 'an unsaved legacy tenant remains in compatibility mode');

const save = functionSource('rolloutSaveCohort');
assert.match(save, /previous=.*rolloutRuntimeRows/);
assert.match(save, /previous\.enabled_at\|\|new Date\(\)\.toISOString\(\)/);
assert.match(save, /previous_status:previous\.status\|\|['"]compatibility['"]/);
assert.match(save, /rolloutEnsureSafeLanding\(\)/);
assert.doesNotMatch(save, /m:['"]DELETE['"]/);

const landing = functionSource('rolloutEnsureSafeLanding');
assert.match(landing, /\.page\.active/);
assert.match(landing, /!canAccessPage\(pageKey\)/);
assert.match(landing, /showPage\(['"]dashboard['"]/);
assert.match(functionSource('rolloutStatusAllowsModules'), /status===['"]pilot['"][\s\S]*status===['"]enabled['"]/);

// Status history is append-only to authenticated clients. The corrective
// migration is rerunnable and does not delete any application/business table.
assert.match(sql, /create table if not exists public\.rollout_cohort_transitions/i);
assert.match(sql, /after insert or update of status/i);
assert.match(sql, /auth\.uid\(\)/i);
assert.match(sql, /revoke delete on public\.company_rollout_cohorts from authenticated/i);
assert.match(sql, /revoke insert,update,delete on public\.rollout_cohort_transitions from authenticated/i);
assert.doesNotMatch(sql, /drop table/i);
assert.doesNotMatch(sql, /truncate\s/i);

console.log('Controlled rollback contract passed (Paused/Disabled safe landing, retained activation evidence and append-only transition history).');
