const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
    stdio: options.capture ? 'pipe' : 'inherit',
    env: process.env
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${options.label || command} failed with exit code ${result.status}.`);
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
  run(psql, [...commonArgs, '--file', path.join(migrationDir, entry.file)], { label: entry.file });
}

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

console.log(`Migration replay passed: ${inventory.tables} tables, ${inventory.policies} policies, ${inventory.routines} routines.`);
