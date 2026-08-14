const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sql=fs.readFileSync(path.resolve(__dirname,'..','core_control_rollout_evidence_snapshot.sql'),'utf8');
assert.match(sql,/set transaction read only/i);assert.match(sql,/rollback;\s*$/i);
for(const table of ['action_tracker','events','inspections','risk_assessments','company_rollout_cohorts','rollout_health_events','rollout_cohort_transitions'])assert.match(sql,new RegExp(`public\\.${table}`));
for(const field of ['snapshot_fingerprint','gates_passed','open_findings','blocking_findings','transition_count','rollback_transition_count','exercise_readiness'])assert.match(sql,new RegExp(field));
const withoutComments=sql.replace(/--[^\n]*/g,'');assert.doesNotMatch(withoutComments,/\b(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
console.log('Rollout evidence snapshot contract passed (read-only gates, health, history and Core Control counts).');
