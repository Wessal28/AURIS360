'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadCatalogueDefinitions, collectSchemaContracts, buildSchemaValidationSql,
  assertSchemaValidationResult, validateReplayUrl, verifyDatabase } = require('../scripts/verify-print-catalogue-schema.cjs');
const root = path.resolve(__dirname, '..');
const definition = report => [{ moduleKey: 'test', key: 'saved', report }];

test('loads every catalogue group with registration-only globals and includes the restricted OH RPC', () => {
  const definitions = loadCatalogueDefinitions();
  assert.ok(definitions.length >= 117);
  for (const moduleKey of ['people', 'documents', 'risk', 'inspection', 'noise', 'ohealth']) {
    assert.ok(definitions.some(definition => definition.moduleKey === moduleKey), moduleKey);
  }
  assert.equal(new Set(definitions.map(({ moduleKey, key }) => `${moduleKey}.${key}`)).size, definitions.length);
  const contracts = collectSchemaContracts(definitions);
  assert.equal(contracts.reportCount, definitions.length);
  assert.ok(contracts.tables.some(contract => contract.relation === 'risk_assessment_items'));
  assert.ok(contracts.relationships.some(contract => contract.relation === 'risk_assessment_items' && contract.field === 'assessment_id' && contract.parent === 'risk_assessments'));
  assert.equal(contracts.routines.length, 1);
  assert.equal(contracts.routines[0].name, 'occupational_fitness_summaries');
  assert.equal(contracts.routines[0].argument_types, 'uuid');
  assert.deepEqual(Array.from(contracts.routines[0].argument_names), ['p_company_id']);
  assert.deepEqual(contracts.routines[0].outputs.at(-1), { name: 'restrictions', type: 'text' });
});

test('collects table, exact select, tenant, row-key, child-key and lookup contracts', () => {
  const contracts = collectSchemaContracts(definition({ table: 'saved_reports', select: 'id,company_id,title,owner_id',
    lookups: [{ table: 'people', as: 'owner', foreignKey: 'owner_id', select: 'id,company_id,first_name' }],
    children: [{ table: 'saved_rows', foreignKey: 'report_id', scopeViaParent: true, select: 'id,report_id,result' }] }));
  assert.deepEqual(contracts.tables.map(contract => contract.relation), ['saved_reports', 'people', 'saved_rows']);
  assert.ok(contracts.fields.some(contract => contract.relation === 'saved_reports' && contract.field === 'company_id' && contract.purpose === 'company scope'));
  assert.ok(contracts.fields.some(contract => contract.relation === 'saved_reports' && contract.field === 'owner_id' && contract.purpose === 'lookup reference'));
  assert.ok(contracts.fields.some(contract => contract.relation === 'people' && contract.field === 'first_name'));
  assert.ok(contracts.fields.some(contract => contract.relation === 'saved_rows' && contract.field === 'report_id' && contract.purpose === 'parent reference'));
  assert.ok(!contracts.fields.some(contract => contract.relation === 'saved_rows' && contract.field === 'company_id'));
  assert.deepEqual(contracts.relationships, [{ report: 'test.saved.child1', relation: 'saved_rows', field: 'report_id', parent: 'saved_reports', parent_field: 'id' }]);
});

test('supports selected-company entity reads and company-keyed settings without inventing an id', () => {
  const company = collectSchemaContracts(definition({ table: 'companies', companyEntity: true, select: 'id,name' }));
  assert.ok(!company.fields.some(contract => contract.field === 'company_id'));
  const settings = collectSchemaContracts(definition({ table: 'company_settings', rowKey: 'company_id', select: 'company_id,ai_enabled' }));
  assert.ok(settings.fields.some(contract => contract.field === 'company_id'));
  assert.ok(!settings.fields.some(contract => contract.field === 'id'));
});

test('recognizes completed snapshot reports without silently exempting a missing persisted source', () => {
  const snapshot = collectSchemaContracts(definition({ snapshot() { throw Error('Snapshot must not be evaluated during schema checks.'); } }));
  assert.equal(snapshot.reportCount, 1);
  assert.deepEqual(snapshot.tables, []);
  assert.throws(() => collectSchemaContracts(definition({ snapshot() {}, table: 'reports' })), /snapshot cannot also configure a database source/);
  assert.throws(() => collectSchemaContracts(definition({ title: 'Missing database source' })), /table identifier/);
});

test('rejects malformed identifiers and projections missing required scoped identities before executing SQL', () => {
  const invalid = [
    [{ table: 'reports; drop table people' }, /Invalid .* table identifier/],
    [{ table: 'reports', select: 'id,title' }, /omits company scope column company_id/],
    [{ table: 'reports', select: 'company_id,title' }, /omits record identity column id/],
    [{ table: 'reports', select: 'id,company_id,title as caption' }, /selected column identifier/],
    [{ table: 'reports', select: 'id,company_id,id' }, /Duplicate selected column/],
    [{ table: 'people', companyEntity: true }, /must read companies/],
    [{ table: 'rows', scopeViaParent: true }, /Parent scope is missing/],
    [{ table: 'reports', select: 'id,company_id', lookups: [{ table: 'people', as: 'person', foreignKey: 'person_id' }] }, /omits lookup reference column person_id/],
    [{ table: 'reports', children: [{ table: 'rows', foreignKey: 'report_id', select: 'id,company_id,result' }] }, /omits parent reference column report_id/]
  ];
  for (const [report, expected] of invalid) assert.throws(() => collectSchemaContracts(definition(report)), expected);
});

test('RPC checking never executes the RPC and rejects a changed input or broadened output contract', () => {
  const saved = loadCatalogueDefinitions().find(definition => definition.report.rpc).report;
  assert.throws(() => collectSchemaContracts(definition({ ...saved, rpc: 'unreviewed_function' })), /No reviewed schema contract/);
  assert.throws(() => collectSchemaContracts(definition({ ...saved, rpcArgs: () => ({ p_company_id: 'foreign-company' }) })), /company-scoped contract/);
  assert.throws(() => collectSchemaContracts(definition({ ...saved, rpcFields: [...saved.rpcFields, 'medical_notes'] })), /restricted output contract/);
  const sql = buildSchemaValidationSql(collectSchemaContracts(definition(saved)));
  assert.match(sql, /pg_catalog\.oidvectortypes\(p\.proargtypes\)/);
  assert.match(sql, /p\.proargnames\[1:cardinality\(r\.argument_names\)\] = r\.argument_names/);
  assert.match(sql, /p\.proretset/);
  assert.match(sql, /pg_catalog\.format_type\(p\.proallargtypes\[i\], NULL\)/);
  assert.doesNotMatch(sql, /(?:select|from)\s+public\.occupational_fitness_summaries\s*\(/i);
});

test('generated SQL only reads metadata in a bounded read-only transaction and verifies exact parent FK', () => {
  const sql = buildSchemaValidationSql(collectSchemaContracts(definition({ table: 'reports', children: [{ table: 'rows', foreignKey: 'report_id', scopeViaParent: true }] })));
  assert.match(sql, /BEGIN READ ONLY;/);
  assert.match(sql, /SET LOCAL statement_timeout = '15s';/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.match(sql, /n\.nspname = 'public'/);
  assert.match(sql, /array_length\(k\.conkey, 1\) = 1/);
  assert.match(sql, /child\.relname = r\.relation AND child\.attname = r\.field/);
  assert.match(sql, /parent\.relname = r\.parent AND parent\.attname = r\.parent_field/);
  assert.match(sql, /'missing_column'/);
  assert.doesNotMatch(sql, /\b(?:create|alter|drop|insert|update|delete|truncate|grant|revoke)\b/i);
  assert.doesNotMatch(sql, /\b(?:from|join)\s+public\./i);
});

test('reports every metadata mismatch with report identity without reading business rows', () => {
  assert.equal(assertSchemaValidationResult({ reports: 117, issues: [] }), 'Print catalogue schema passed: 117 report definitions.');
  assert.throws(() => assertSchemaValidationResult({ reports: 2, issues: [
    { report: 'people.register', code: 'missing_column', object: 'people.company_id (company scope)' },
    { report: 'risk.register.child2', code: 'missing_parent_relationship', object: 'risk_assessment_items.assessment_id -> risk_assessments.id' }
  ] }), error => /mismatch \(2\)/.test(error.message) && /people\.register: missing_column/.test(error.message) && /risk\.register\.child2: missing_parent_relationship/.test(error.message));
  assert.throws(() => assertSchemaValidationResult({ reports: 1 }), /invalid metadata/);
});

test('standalone verification rejects remote, wrong-name and connection-override targets before starting psql', () => {
  for (const value of [
    'postgresql://user:secret@production.example/auris360_migration_replay',
    'postgresql://localhost/production', 'postgresql://localhost/postgres',
    'https://localhost/auris360_migration_replay',
    'postgresql://localhost/auris360_migration_replay?host=production.example',
    'postgresql://localhost/auris360_migration_replay#override', 'not-a-url'
  ]) {
    let invoked = false;
    assert.throws(() => verifyDatabase(value, { spawnSync() { invoked = true; } }));
    assert.equal(invoked, false);
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(validateReplayUrl(`postgresql://${host}/auris360_migration_replay`).hostname, host);
});

test('standalone psql invocation keeps connection credentials out of arguments and clears inherited overrides', () => {
  let invocation;
  const result = verifyDatabase('postgresql://fixture-user:never-log-this@127.0.0.1:5433/auris360_migration_replay', {
    sql: 'BEGIN READ ONLY; SELECT metadata; ROLLBACK;',
    spawnSync(command, args, options) { invocation = { command, args, options }; return { status: 0, stdout: '{"reports":1,"issues":[]}' }; }
  });
  assert.equal(result, 'Print catalogue schema passed: 1 report definitions.');
  assert.doesNotMatch(invocation.args.join(' '), /never-log-this|fixture-user|postgresql:/);
  assert.equal(invocation.options.env.PGPASSWORD, 'never-log-this');
  assert.equal(invocation.options.env.PGHOST, '127.0.0.1');
  assert.equal(invocation.options.env.PGPORT, '5433');
  assert.equal(invocation.options.env.PGDATABASE, 'auris360_migration_replay');
  assert.equal(invocation.options.env.PGHOSTADDR, '');
  assert.equal(invocation.options.env.PGSERVICE, '');
  assert.equal(invocation.options.env.PGOPTIONS, '');
  assert.equal(invocation.options.input, 'BEGIN READ ONLY; SELECT metadata; ROLLBACK;');
});

test('psql failures do not echo raw diagnostic credentials and invalid response fails closed', () => {
  assert.throws(() => verifyDatabase('postgresql://localhost/auris360_migration_replay', {
    sql: 'SELECT metadata;', spawnSync: () => ({ status: 2, stderr: 'connection failed: postgres://user:SECRET_PASSWORD@localhost/' })
  }), error => /could not complete/.test(error.message) && !/SECRET_PASSWORD|postgres:\/\//.test(error.message));
  assert.throws(() => verifyDatabase('postgresql://localhost/auris360_migration_replay', {
    sql: 'SELECT metadata;', spawnSync: () => ({ status: 0, stdout: 'not-json' })
  }), /invalid metadata/);
});

test('--sql generates the complete contract without a database connection or credential output', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-print-catalogue-schema.cjs', '--sql'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, MIGRATION_REPLAY_DATABASE_URL: 'postgresql://fixture:SECRET_VALUE@production.invalid/production' }, maxBuffer: 8 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Print catalogue schema metadata contract/);
  assert.match(result.stdout, /risk_assessment_items/);
  assert.match(result.stdout, /occupational_fitness_summaries/);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET_VALUE|production\.invalid/);
});

test('replay verifies the real installed catalogue schema after inventory and before behavioral fixtures', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/replay-migrations.cjs'), 'utf8');
  const inventory = source.indexOf("if (drift.length) fail("), check = source.indexOf("label: 'print catalogue schema contract'"), fixture = source.indexOf("'inspection_follow_up.sql'");
  assert.ok(inventory >= 0 && check > inventory && fixture > check);
  assert.match(source, /assertSchemaValidationResult\(JSON\.parse\(run\(psql/);
  assert.match(source, /input: buildSchemaValidationSql\(\)/);
});
