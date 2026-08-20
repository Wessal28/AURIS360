const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const replay = path.join(root, 'scripts', 'replay-migrations.cjs');

function run(databaseUrl) {
  return spawnSync(process.execPath, [replay, '--check', '--database-url', databaseUrl], {
    cwd: root,
    encoding: 'utf8'
  });
}

test('accepts only the named disposable local replay database', () => {
  const result = run('postgresql://postgres:test@127.0.0.1:5432/auris360_migration_replay');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /localhost-only target/i);
});

test('rejects production, staging and arbitrary remote database targets', () => {
  for (const url of [
    'postgresql://postgres:test@db.iarfxjhahzbhncsaohbg.supabase.co:5432/postgres',
    'postgresql://postgres:test@db.beoutmqttgfyyzndcdxu.supabase.co:5432/postgres',
    'postgresql://postgres:test@example.com:5432/auris360_migration_replay'
  ]) {
    const result = run(url);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /localhost/i);
  }
});

test('rejects a local database with any other name', () => {
  const result = run('postgresql://postgres:test@localhost:5432/postgres');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be named auris360_migration_replay/i);
});
