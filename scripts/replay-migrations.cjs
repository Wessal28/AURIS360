const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildMeetingsRpcIsolationFixture } = require('./meetings-rpc-isolation-fixture.cjs');
const { buildSchemaValidationSql, assertSchemaValidationResult } = require('./verify-print-catalogue-schema.cjs');

const root = path.resolve(__dirname, '..');
const migrationDir = path.join(root, 'supabase', 'migrations');
const manifestPath = path.join(migrationDir, 'manifest.json');
const expectationsPath = path.join(migrationDir, 'replay-expectations.json');
const bootstrapPath = path.join(root, 'scripts', 'migration-replay-bootstrap.sql');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');

function option(name, fallback = '') {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function fail(message) {
  console.error(`Migration replay: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path.relative(root, filePath)}: ${error.message}`);
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    input: options.input,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const label = options.label || command;
    const diagnostic = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (process.env.GITHUB_ACTIONS === 'true' && diagnostic) {
      const escaped = diagnostic.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
      console.error(`::error title=${label}::${escaped}`);
    }
    if (diagnostic) console.error(diagnostic);
    fail(`${label} failed with exit code ${result.status}.`);
  }
  if (!options.capture && !options.quiet) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return options.capture ? result.stdout.trim() : '';
}

const databaseUrl = option('--database-url', process.env.MIGRATION_REPLAY_DATABASE_URL || '');
if (!databaseUrl) fail('MIGRATION_REPLAY_DATABASE_URL or --database-url is required.');

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  fail('database URL is invalid.');
}

const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) fail('only PostgreSQL URLs are accepted.');
if (!allowedHosts.has(parsedUrl.hostname)) fail('target must be a disposable PostgreSQL server on localhost.');
if (databaseName !== 'auris360_migration_replay') fail('target database must be named auris360_migration_replay.');
if (!checkOnly && process.env.AURIS360_MIGRATION_REPLAY_CONFIRM !== 'REPLAY LOCAL MIGRATIONS') {
  fail('AURIS360_MIGRATION_REPLAY_CONFIRM must equal "REPLAY LOCAL MIGRATIONS".');
}

const manifest = readJson(manifestPath);
const expectations = readJson(expectationsPath);
if (expectations.format_version !== 1) fail('unsupported replay expectations format.');
for (const key of ['tables', 'policies', 'routines']) {
  if (!Number.isInteger(expectations[key]) || expectations[key] < 0) fail(`invalid expected ${key} count.`);
}

run(process.execPath, ['scripts/validate-migrations.cjs'], { label: 'ordered migration validation' });

for (const entry of manifest.migrations || []) {
  const filePath = path.join(migrationDir, entry.file);
  if (!filePath.startsWith(migrationDir + path.sep) || !fs.existsSync(filePath)) fail(`missing migration ${entry.file}.`);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath, 'utf8')).digest('hex');
  if (hash !== entry.sha256) fail(`checksum mismatch for ${entry.file}.`);
}

if (checkOnly) {
  console.log(`Migration replay plan valid: ${manifest.migrations.length} migration(s), localhost-only target.`);
  process.exit(0);
}

const psql = process.env.PSQL_COMMAND || 'psql';
const commonArgs = [databaseUrl, '--set', 'ON_ERROR_STOP=1', '--no-psqlrc'];
const existingTableCount = run(psql, [...commonArgs, '--tuples-only', '--no-align', '--command',
  "select count(*) from pg_catalog.pg_tables where schemaname='public';"
], { capture: true, label: 'clean-target check' });
if (existingTableCount !== '0') fail(`target is not empty (${existingTableCount} public table(s)).`);

run(psql, [...commonArgs, '--file', bootstrapPath], { label: 'local Supabase compatibility bootstrap' });
for (const entry of manifest.migrations) {
  run(psql, [...commonArgs, '--file', path.join(migrationDir, entry.file)], { label: entry.file, quiet: true });
  console.log(`Applied ${entry.file}`);
}

run(psql, [...commonArgs, '--file', path.join(migrationDir, '20261021010000_people_user_linking.sql')], {
  label: 'idempotent People/account linking installation', quiet: true
});

// Reapply the repair against a fully upgraded schema: it must restore the RPC
// without duplicate policies, routines or constraints, and without data writes.
run(psql, [...commonArgs, '--file', path.join(migrationDir, '20261020020000_meetings_rpc_installation_repair.sql')], {
  label: 'idempotent HSE minutes RPC installation repair', quiet: true
});

// Reproduce a partial deployment without optional communication features. The
// single rollback-only connection restores renamed tables, RPC, data and ACLs
// before inventory and all remaining behavior checks run.
run(psql, [...commonArgs, '--file', '-'], {
  label: 'HSE minutes repair without optional communication tables',
  quiet: true,
  input: buildMeetingsRpcIsolationFixture({
    repair: fs.readFileSync(path.join(migrationDir, '20261020020000_meetings_rpc_installation_repair.sql'), 'utf8'),
    installationAssertions: fs.readFileSync(path.join(root, 'tests', 'sql', 'meetings_rpc_installation.sql'), 'utf8'),
    behaviorAssertions: fs.readFileSync(path.join(root, 'tests', 'sql', 'meetings_rpc_optional_modules.sql'), 'utf8')
  })
});

const inventorySql = [
  "select json_build_object(",
  "  'tables', (select count(*) from pg_catalog.pg_tables where schemaname='public'),",
  "  'policies', (select count(*) from pg_catalog.pg_policies where schemaname='public'),",
  "  'routines', (select count(*) from information_schema.routines where routine_schema='public')",
  ")::text;"
].join('\n');
const inventory = JSON.parse(run(psql, [...commonArgs, '--tuples-only', '--no-align', '--command', inventorySql], {
  capture: true,
  label: 'schema inventory check'
}));

const drift = ['tables', 'policies', 'routines']
  .filter((key) => Number(inventory[key]) !== expectations[key])
  .map((key) => `${key}: expected ${expectations[key]}, replayed ${inventory[key]}`);
if (drift.length) fail(`schema drift detected (${drift.join('; ')}).`);

console.log(assertSchemaValidationResult(JSON.parse(run(psql, [...commonArgs, '--quiet', '--tuples-only', '--no-align', '--file', '-'], {
  capture: true, label: 'print catalogue schema contract', input: buildSchemaValidationSql()
}))));

console.log(`Migration replay passed: ${inventory.tables} tables, ${inventory.policies} policies, ${inventory.routines} routines.`);
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'inspection_follow_up.sql')], {label: 'recurring inspection and finding verification'});
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'permit_reference_snapshot.sql')], {label: 'approval-bound permit snapshots and same-company revision protection'});
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'people_user_access.sql')], {label: 'People onboarding and user access protection'});
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'people_user_linking.sql')], {label: 'atomic account/People linking, ambiguity, history and company protection'});
run(process.execPath, ['scripts/verify-people-user-link-concurrency.cjs'], {label: 'competing account/People identity links'});
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'kpi_atomic_definition.sql')], {
  label: 'atomic KPI transaction behavior'
});
run(process.execPath, ['scripts/verify-kpi-definition-concurrency.cjs'], {label: 'competing KPI transaction sessions'});
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'objective_definition.sql')], {label: 'objective transaction behavior'});
run(process.execPath, ['scripts/verify-objective-concurrency.cjs'], {label: 'competing objective transaction sessions'});
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'kpi_monthly_atomic.sql')], {label: 'monthly KPI transaction behavior'});
run(process.execPath, ['scripts/verify-kpi-monthly-concurrency.cjs'], {label: 'competing monthly KPI transaction sessions'});

run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'kpi_monthly_review.sql')], {label: 'monthly review workflow and protection'});
run(process.execPath, ['scripts/verify-kpi-review-concurrency.cjs'], {label: 'competing monthly review sessions'});

run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'environmental_followup.sql')], {label: 'environmental reminder scope and emissions assurance'});

run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'noise_assurance.sql')], {label: 'noise approval, immutable evidence, revisions and reports'});

run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'meetings_reliability.sql')], {label: 'meeting timezone, stable action identity, atomic saves and awareness access'});
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'meetings_rpc_installation.sql')], {label: 'HSE minutes RPC named arguments, invoker policy and execution grants'});

run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'training_workflow.sql')], {label: 'linked training attendance, evidence review and explicit competency decisions'});

run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'action_closure.sql')], {label: 'action closure integrity and bounded notification cleanup'});
run(process.execPath, ['scripts/verify-action-closure-concurrency.cjs'], {label: 'action closure timeout rollback and retry'});

run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'legal_assurance.sql')], {label: 'legal source, provisional assessments, approval, remediation and evidence decisions'});

run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'sop_workspace_drafts.sql')], {label: 'incomplete SOP drafts, metadata, consent and atomic evidence recovery'});
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'swms_controlled_release.sql')], {label: 'SWMS atomic rendition, independent approval, controlled release and exact work-pack revision'});
run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'document_control_workflows.sql')], {label: 'PDF uploads, review decisions, revision history, distribution and recipient acknowledgement'});

run(psql, [...commonArgs, '--file', path.join(root, 'tests', 'sql', 'settings_reliability.sql')], {label: 'atomic approval routes, tenant boundaries and personal notification preferences'});
