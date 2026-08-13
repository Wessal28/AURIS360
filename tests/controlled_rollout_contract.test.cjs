const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'controlled_rollout_upgrade.sql'), 'utf8');

assert.match(sql, /create table if not exists public\.company_rollout_cohorts/i);
assert.match(sql, /cohort_key in \('core_control','controlled_content','people_health','specialist_operations'\)/i);
assert.match(sql, /status in \('disabled','pilot','enabled','paused'\)/i);
assert.match(sql, /compatibility_reads boolean not null default true/i);
assert.match(sql, /gate_results jsonb not null default '\{\}'::jsonb/i);
assert.match(sql, /create table if not exists public\.rollout_health_events/i);
assert.match(sql, /create table if not exists public\.rollout_cohort_transitions/i);
assert.match(sql, /create trigger company_rollout_cohort_transition_audit/i);
assert.match(sql, /old\.status is distinct from new\.status/i);
assert.match(sql, /previous_status,new_status,gate_results/i);
assert.match(sql, /revoke delete on public\.company_rollout_cohorts from authenticated/i);
assert.match(sql, /revoke insert,update,delete on public\.rollout_cohort_transitions from authenticated/i);
for (const event of ['module_error', 'orphan_relationship', 'failed_deep_link', 'approval_discrepancy']) {
  assert(sql.includes(`'${event}'`), `health taxonomy missing ${event}`);
}
assert.match(sql, /create or replace view public\.rollout_cohort_health_summary/i);
assert.match(sql, /company_rollout_cohorts enable row level security/i);
assert.match(sql, /rollout_health_events enable row level security/i);
assert.match(sql, /p\.role='sephs_admin'/i);
assert.match(sql, /p\.company_id=company_rollout_cohorts\.company_id/i);

const start = html.indexOf('var ROLLOUT_COHORTS=');
const end = html.indexOf('// Returns true if the current user', start);
assert(start >= 0 && end > start, 'runtime rollout contract is missing');
const context = { isSA: () => false, sephsCompanyContext: null, prof: { company_id: 'company-a' }, api: async () => [] };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);
assert.strictEqual(context.ROLLOUT_COHORTS.length, 4, 'four rollout cohorts are required');
assert.strictEqual(context.rolloutModuleAllowed('events'), true, 'unsaved tenants must remain compatible');
context.rolloutRuntimeRows = [{ cohort_key: 'core_control', status: 'disabled' }];
assert.strictEqual(context.rolloutModuleAllowed('events'), false, 'disabled cohort must be gated');
context.rolloutRuntimeRows[0].status = 'pilot';
assert.strictEqual(context.rolloutModuleAllowed('events'), true, 'pilot cohort must be available');
context.rolloutRuntimeRows[0].status = 'paused';
assert.strictEqual(context.rolloutModuleAllowed('events'), false, 'paused cohort must be gated');
assert.strictEqual(context.rolloutModuleAllowed('dashboard'), true, 'non-cohort platform pages remain compatible');

assert.match(html, /if\(!rolloutModuleAllowed\(pageKey\)\) return false/);
assert.match(html, /await loadProf\(authData\.user\.id\);\s*await loadRolloutRuntimeConfig\(\);/);
assert.match(html, /await loadProf\(stored\.user_id\);\s*await loadRolloutRuntimeConfig\(\);/);
assert.match(html, /status==='enabled'&&!ROLLOUT_RELEASE_GATES\.every/);
assert.match(html, /status==='pilot'&&!\['database','security','navigation'\]\.every/);
assert.match(html, /settings-rollout-control-card/);
assert.match(html, /rollout_cohort_health_summary\?select=\*/);
assert.match(html, /rolloutRecordHealthEvent\('failed_deep_link'/);
assert.match(html, /window\.addEventListener\('error'[\s\S]*rolloutRecordHealthEvent\('module_error'/);
assert.match(html, /companies\.module_access/);
assert.match(html, /rolloutEnsureSafeLanding\(\)/);
assert.match(html, /previous\.enabled_at\|\|new Date\(\)\.toISOString\(\)/);

console.log('Controlled rollout contract passed (4 cohorts, 8 gates, 4 monitored event types).');
