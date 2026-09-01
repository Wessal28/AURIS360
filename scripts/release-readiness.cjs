const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const testFiles = [
  'tests/index_inline_syntax.test.cjs',
  'tests/deployment_environment_isolation_contract.test.cjs',
  'tests/offline_asset_manifest_contract.test.cjs',
  'tests/cross_module_integration_contract.test.cjs',
  'tests/controlled_rollout_contract.test.cjs',
  'tests/controlled_rollback_contract.test.cjs',
  'tests/live_gate_verification_contract.test.cjs',
  'tests/core_control_role_matrix_contract.test.cjs',
  'tests/core_control_workflow_contract.test.cjs',
  'tests/core_control_resilience_contract.test.cjs',
  'tests/mobile_offline_acceptance_contract.test.cjs',
  'tests/audit_contract.test.cjs',
  'tests/moc_separation_contract.test.cjs',
  'tests/person_identity_contract.test.cjs',
  'tests/person_identity_reconciliation_contract.test.cjs',
  'tests/location_identity_contract.test.cjs',
  'tests/verified_operational_references_contract.test.cjs',
  'tests/pending_notifications_security_contract.test.cjs',
  'tests/migration_baseline_contract.test.cjs',
  'tests/migration_replay_contract.test.cjs',
  'tests/staging_acceptance_gate_contract.test.cjs',
  'tests/production_smoke_gate_contract.test.cjs'
  ,'tests/command_centre_contract.test.cjs'
  ,'tests/view_engine_contract.test.cjs'
  ,'tests/record_workspace_contract.test.cjs'
  ,'tests/application_lifecycle_contract.test.cjs'
];

function run(label, command, args) {
  const startedAt = new Date();
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  const output = [result.stdout, result.stderr].filter(Boolean).join('').trim();
  if (output) process.stdout.write(`${output}\n`);
  return {
    label,
    passed: result.status === 0,
    exit_code: result.status,
    duration_ms: new Date() - startedAt
  };
}

const results = [
  run('Offline manifest freshness', process.execPath, ['scripts/generate-sw-manifest.cjs', '--check']),
  run('Ordered migration baseline', process.execPath, ['scripts/validate-migrations.cjs']),
  run('Performance and accessibility budgets', process.execPath, ['scripts/verify-platform-quality.cjs']),
  run('Automated release contracts', process.execPath, ['--test', ...testFiles])
];
const passed = results.every((result) => result.passed);
const evidence = {
  generated_at: new Date().toISOString(),
  automated_status: passed ? 'passed' : 'failed',
  checks: results,
  manual_release_gates: {
    database: 'pending_environment_evidence',
    data_safety: 'pending_environment_evidence',
    security: 'pending_environment_evidence',
    navigation: 'pending_environment_evidence',
    resilience: 'pending_environment_evidence',
    workflow: 'pending_environment_evidence',
    mobile_offline: 'pending_environment_evidence',
    rollback: 'pending_environment_evidence'
  }
};

const reportIndex = process.argv.indexOf('--report');
if (reportIndex !== -1) {
  const requestedPath = process.argv[reportIndex + 1];
  if (!requestedPath) throw new Error('--report requires a file path');
  const reportPath = path.resolve(root, requestedPath);
  if (!reportPath.startsWith(root + path.sep)) throw new Error('Report path must stay inside the repository');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Release evidence written to ${path.relative(root, reportPath)}`);
}

console.log(`Release readiness: automated checks ${evidence.automated_status.toUpperCase()}; environment gates remain manual.`);
process.exitCode = passed ? 0 : 1;
