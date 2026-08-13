const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.resolve(__dirname, '..', 'core_control_live_gate_verification.sql'), 'utf8');

assert.match(sql, /set transaction read only/i);
assert.match(sql, /company_rollout_cohorts/);
assert.match(sql, /rollout_cohort_transitions/);
assert.match(sql, /company_rollout_cohort_transition_audit/);
assert.match(sql, /relrowsecurity/);
assert.match(sql, /enabled_without_all_gates/);
assert.match(sql, /resolved_at is null and severity in \('error','critical'\)/i);
for (const table of ['action_tracker', 'events', 'inspections', 'risk_assessments']) {
  assert.match(sql, new RegExp(`public\\.${table}`), `live verification is missing ${table}`);
}
assert.match(sql, /missing company_id/);
assert.match(sql, /'OVERALL'/);
assert.match(sql, /rollback;\s*$/i);

// A verification file must never mutate production state.
const withoutComments = sql.replace(/--[^\n]*/g, '');
assert.doesNotMatch(withoutComments, /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);

console.log('Live release-gate verification contract passed (read-only schema, rollout, health and Core Control checks).');
