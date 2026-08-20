const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const validator = path.join(root, 'scripts', 'validate-migrations.cjs');

function fixture(files) {
  const directory = fs.mkdtempSync(path.join(root, '.migration-test-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), sql);
  return directory;
}

function run(directory, ...args) {
  return spawnSync(process.execPath, [validator, '--dir', path.relative(root, directory), ...args], { cwd: root, encoding: 'utf8' });
}

test('accepts one schema-only baseline and writes a checksum manifest', (t) => {
  const directory = fixture({
    '20260820000000_production_schema_baseline.sql': `-- schema baseline\ncreate table public.example (\n  id uuid primary key,\n  name text not null,\n  created_at timestamptz not null default now()\n);\n`
  });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = run(directory, '--write-manifest');
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.migrations.length, 1);
  assert.match(manifest.migrations[0].sha256, /^[a-f0-9]{64}$/);
});

test('rejects unordered names, credentials and destructive schema resets', (t) => {
  const directory = fixture({
    'baseline.sql': `postgresql://postgres:secret@example.supabase.co/postgres\ndrop schema public cascade;\n${'x'.repeat(120)}`
  });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = run(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected YYYYMMDDHHMMSS|credential|DROP SCHEMA/i);
});

test('allows DML in function bodies but rejects table rows in a baseline', (t) => {
  const safeDirectory = fixture({
    '20260820000000_production_schema_baseline.sql': `create function public.demo() returns void language plpgsql as $$\nbegin\n  update public.example set name = 'safe definition';\nend;\n$$;\n`
  });
  const unsafeDirectory = fixture({
    '20260820000000_production_schema_baseline.sql': `create table public.example (id int, name text);\ninsert into public.example values (1, 'row');\n${' '.repeat(100)}`
  });
  t.after(() => fs.rmSync(safeDirectory, { recursive: true, force: true }));
  t.after(() => fs.rmSync(unsafeDirectory, { recursive: true, force: true }));
  assert.equal(run(safeDirectory).status, 0);
  const unsafe = run(unsafeDirectory);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /must not contain table data changes/i);
});
