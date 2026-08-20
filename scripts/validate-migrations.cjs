const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const requestedDir = option('--dir', 'supabase/migrations');
const migrationDir = path.resolve(root, requestedDir);
const writeManifest = args.includes('--write-manifest');

if (!migrationDir.startsWith(root + path.sep)) {
  throw new Error('Migration directory must stay inside the repository.');
}
if (!fs.existsSync(migrationDir)) {
  throw new Error(`Migration directory does not exist: ${path.relative(root, migrationDir)}`);
}

const migrationFiles = fs.readdirSync(migrationDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error('No ordered migration files exist yet. Capture the staging schema baseline first.');
}

const errors = [];
const entries = [];
let previousTimestamp = '';

function withoutFunctionBodies(sql) {
  return sql
    .replace(/\$(?<tag>[A-Za-z_][A-Za-z0-9_]*)\$[\s\S]*?\$\k<tag>\$/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '');
}

for (const [index, name] of migrationFiles.entries()) {
  const match = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/.exec(name);
  if (!match) {
    errors.push(`${name}: expected YYYYMMDDHHMMSS_lower_snake_case.sql.`);
    continue;
  }

  const timestamp = match[1];
  if (timestamp <= previousTimestamp) {
    errors.push(`${name}: migration timestamps must be unique and strictly increasing.`);
  }
  previousTimestamp = timestamp;

  const filePath = path.join(migrationDir, name);
  const sql = fs.readFileSync(filePath, 'utf8');
  if (Buffer.byteLength(sql) < 100) errors.push(`${name}: migration is unexpectedly small.`);
  if (/\[YOUR-PASSWORD\]|postgres(?:ql)?:\/\/[^\s]+:[^@\s]+@/i.test(sql)) {
    errors.push(`${name}: contains a database credential or password placeholder.`);
  }
  if (/^\s*drop\s+schema\s+public\s+cascade/im.test(sql)) {
    errors.push(`${name}: destructive DROP SCHEMA public CASCADE is forbidden.`);
  }

  const executableSql = withoutFunctionBodies(sql);
  const dataStatements = executableSql.match(/^\s*(?:copy\s+[^\r\n]+\s+from\s+stdin|insert\s+into|update\s+[^\r\n]+\s+set|delete\s+from|truncate\b)/gim) || [];
  const isBaseline = name.endsWith('_schema_baseline.sql');
  if (isBaseline && /^CREATE SCHEMA public;$/im.test(sql)) {
    errors.push(`${name}: use CREATE SCHEMA IF NOT EXISTS public so the baseline replays on Supabase.`);
  }
  if (isBaseline && dataStatements.length > 0) {
    errors.push(`${name}: a schema baseline must not contain table data changes.`);
  } else if (!isBaseline && dataStatements.length > 0 && !/^\s*--\s*auris360:\s*allow-data-migration\s*$/im.test(sql)) {
    errors.push(`${name}: data-changing SQL requires the explicit "-- auris360: allow-data-migration" review marker.`);
  }

  entries.push({
    order: index + 1,
    file: name,
    sha256: crypto.createHash('sha256').update(sql).digest('hex')
  });
}

const baselines = migrationFiles.filter((name) => name.endsWith('_schema_baseline.sql'));
if (baselines.length !== 1) errors.push(`Expected exactly one schema baseline; found ${baselines.length}.`);
if (baselines.length === 1 && migrationFiles[0] !== baselines[0]) {
  errors.push('The schema baseline must be the first ordered migration.');
}

if (errors.length > 0) {
  for (const error of errors) console.error(`Migration validation: ${error}`);
  process.exitCode = 1;
} else {
  const manifest = { format_version: 1, baseline: baselines[0], migrations: entries };
  const manifestPath = path.join(migrationDir, 'manifest.json');
  if (writeManifest) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Migration manifest written: ${path.relative(root, manifestPath)}`);
  } else if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
      console.error('Migration validation: manifest.json does not match the ordered SQL files and checksums.');
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) console.log(`Migration baseline valid: ${entries.length} ordered file(s).`);
}
