#!/usr/bin/env node
'use strict';

// Metadata only. This verifies the schema produced by migration replay; it never
// reads a company record, calls the clinical RPC or changes database objects.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const repositoryRoot = path.resolve(__dirname, '..');
const identifier = /^[a-z_][a-z0-9_]*$/;
const rpcContracts = {
  occupational_fitness_summaries: {
    argumentNames: ['p_company_id'], argumentTypes: ['uuid'],
    outputs: [
      ['employee_name', 'text'], ['employee_id', 'text'], ['department', 'text'],
      ['exam_date', 'date'], ['next_exam_date', 'date'],
      ['fitness_status', 'text'], ['restrictions', 'text']
    ]
  }
};

function checkedIdentifier(value, label) {
  if (typeof value !== 'string' || !identifier.test(value)) throw Error(`Invalid ${label} identifier.`);
  return value;
}

function loadCatalogueDefinitions(root = repositoryRoot) {
  const definitions = [], modules = new Set();
  const files = fs.readdirSync(root).filter(file => file.endsWith('-print-catalogue.js') && file !== 'module-print-catalogue.js').sort();
  if (!files.length) throw Error('No print catalogue groups were found.');
  const context = { AurisPrintCatalogue: { register(moduleKey, definition) {
    if (modules.has(moduleKey)) throw Error(`Duplicate print catalogue module: ${moduleKey}.`);
    modules.add(moduleKey);
    for (const [key, report] of Object.entries(definition.reports || {})) definitions.push({ moduleKey, key, report });
  } } };
  context.window = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file, timeout: 1000 });
  if (!definitions.length) throw Error('No print report definitions were registered.');
  return definitions;
}

function selectedColumns(value, label) {
  if (value == null || value === '*') return null;
  if (typeof value !== 'string' || !value.trim()) throw Error(`Invalid select for ${label}.`);
  const fields = value.split(',').map(field => checkedIdentifier(field.trim(), `${label} selected column`));
  if (new Set(fields).size !== fields.length) throw Error(`Duplicate selected column for ${label}.`);
  return fields;
}

function collectSchemaContracts(definitions = loadCatalogueDefinitions()) {
  const tables = [], fields = [], relationships = [], routines = [];
  function tableContract(def, label, parent) {
    const table = checkedIdentifier(def.table, `${label} table`);
    const rowKey = checkedIdentifier(def.rowKey || 'id', `${label} row key`);
    if (def.companyEntity && table !== 'companies') throw Error(`Company entity ${label} must read companies.`);
    if (def.scopeViaParent && !parent) throw Error(`Parent scope is missing for ${label}.`);
    const selected = selectedColumns(def.select, label);
    const required = new Map([[rowKey, 'record identity']]);
    if (!def.companyEntity && !def.scopeViaParent) required.set('company_id', 'company scope');
    if (parent) required.set(checkedIdentifier(def.foreignKey, `${label} parent key`), 'parent reference');
    for (const field of selected || []) if (!required.has(field)) required.set(field, 'selected column');
    for (const [field, purpose] of required) {
      if (selected && !selected.includes(field)) throw Error(`${label} select omits ${purpose} column ${field}.`);
      fields.push({ report: label, relation: table, field, purpose });
    }
    tables.push({ report: label, relation: table });
    if (def.scopeViaParent) relationships.push({ report: label, relation: table, field: def.foreignKey, parent: parent.table, parent_field: parent.rowKey || 'id' });
    for (const [index, lookup] of (def.lookups || []).entries()) {
      const lookupLabel = `${label}.lookup${index + 1}`;
      const foreignKey = checkedIdentifier(lookup.foreignKey, `${lookupLabel} foreign key`);
      checkedIdentifier(lookup.as, `${lookupLabel} alias`);
      if (selected && !selected.includes(foreignKey)) throw Error(`${label} select omits lookup reference column ${foreignKey}.`);
      fields.push({ report: label, relation: table, field: foreignKey, purpose: 'lookup reference' });
      tableContract(lookup, lookupLabel);
    }
    return { table, rowKey };
  }
  for (const { moduleKey, key, report } of definitions) {
    const label = `${moduleKey}.${key}`;
    // A completed, context-bound AI snapshot has no persisted schema contract.
    // Do not silently exempt an ordinary report whose data source is missing.
    if (typeof report.snapshot === 'function') {
      if (report.table || report.rpc || report.children?.length || report.lookups?.length) throw Error(`${label} snapshot cannot also configure a database source.`);
      continue;
    }
    if (report.rpc) {
      const name = checkedIdentifier(report.rpc, `${label} RPC`), expected = rpcContracts[name];
      if (!expected) throw Error(`No reviewed schema contract for RPC ${name}.`);
      if (report.table) throw Error(`${label} cannot configure both a table and RPC.`);
      const company = '00000000-0000-0000-0000-000000000001';
      const args = typeof report.rpcArgs === 'function' ? report.rpcArgs({ company }) : {};
      if (Object.keys(args).sort().join(',') !== expected.argumentNames.slice().sort().join(',') || args.p_company_id !== company) throw Error(`${label} RPC arguments do not match the company-scoped contract.`);
      const outputs = expected.outputs.map(([name, type]) => ({ name, type }));
      if (!Array.isArray(report.rpcFields) || report.rpcFields.join(',') !== outputs.map(output => output.name).join(',')) throw Error(`${label} RPC fields do not match the restricted output contract.`);
      routines.push({ report: label, name, argument_names: expected.argumentNames, argument_types: expected.argumentTypes.join(', '), outputs });
      continue;
    }
    const parent = tableContract(report, label);
    for (const [index, child] of (report.children || []).entries()) tableContract(child, `${label}.child${index + 1}`, parent);
  }
  // Deduplication keeps repeated category reports useful in diagnostics without
  // multiplying identical metadata checks within one report.
  const unique = values => Array.from(new Map(values.map(value => [JSON.stringify(value), value])).values());
  return { reportCount: definitions.length, tables: unique(tables), fields: unique(fields), relationships: unique(relationships), routines: unique(routines) };
}

function sqlJson(value) { return "'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb"; }

function buildSchemaValidationSql(contracts = collectSchemaContracts()) {
  return `-- Print catalogue schema metadata contract; no business data is read.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH required_tables AS (
  SELECT * FROM jsonb_to_recordset(${sqlJson(contracts.tables)}) AS x(report text, relation text)
), required_fields AS (
  SELECT * FROM jsonb_to_recordset(${sqlJson(contracts.fields)}) AS x(report text, relation text, field text, purpose text)
), required_relationships AS (
  SELECT * FROM jsonb_to_recordset(${sqlJson(contracts.relationships)}) AS x(report text, relation text, field text, parent text, parent_field text)
), required_routines AS (
  SELECT * FROM jsonb_to_recordset(${sqlJson(contracts.routines)}) AS x(report text, name text, argument_names text[], argument_types text, outputs jsonb)
), relations AS (
  SELECT c.oid, c.relname FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
), columns AS (
  SELECT r.oid, r.relname, a.attname, a.attnum FROM relations r
  JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
), issues AS (
  SELECT r.report, 'missing_table' AS code, r.relation AS object
  FROM required_tables r WHERE NOT EXISTS (SELECT 1 FROM relations a WHERE a.relname = r.relation)
  UNION ALL
  SELECT r.report, 'missing_column', r.relation || '.' || r.field || ' (' || r.purpose || ')'
  FROM required_fields r WHERE EXISTS (SELECT 1 FROM relations a WHERE a.relname = r.relation)
    AND NOT EXISTS (SELECT 1 FROM columns a WHERE a.relname = r.relation AND a.attname = r.field)
  UNION ALL
  SELECT r.report, 'missing_parent_relationship', r.relation || '.' || r.field || ' -> ' || r.parent || '.' || r.parent_field
  FROM required_relationships r WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint k
    JOIN columns child ON child.oid = k.conrelid AND child.attnum = k.conkey[1]
    JOIN columns parent ON parent.oid = k.confrelid AND parent.attnum = k.confkey[1]
    WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1 AND array_length(k.confkey, 1) = 1
      AND child.relname = r.relation AND child.attname = r.field
      AND parent.relname = r.parent AND parent.attname = r.parent_field
  )
  UNION ALL
  SELECT r.report, 'invalid_rpc_signature', r.name || '(' || r.argument_types || ')'
  FROM required_routines r WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.name AND p.prokind = 'f'
      AND pg_catalog.oidvectortypes(p.proargtypes) = r.argument_types
      AND p.proargnames[1:cardinality(r.argument_names)] = r.argument_names AND p.proretset
      AND (SELECT jsonb_agg(jsonb_build_object('name', p.proargnames[i], 'type', pg_catalog.format_type(p.proallargtypes[i], NULL)) ORDER BY i)
           FROM generate_subscripts(p.proargnames, 1) i WHERE p.proargmodes[i] IN ('o', 'b', 't')) = r.outputs
  )
)
SELECT jsonb_build_object('reports', ${Number(contracts.reportCount)}, 'issues',
  COALESCE((SELECT jsonb_agg(jsonb_build_object('report', report, 'code', code, 'object', object) ORDER BY report, code, object) FROM issues), '[]'::jsonb))::text;
ROLLBACK;
`;
}

function assertSchemaValidationResult(result) {
  if (!result || !Number.isInteger(result.reports) || !Array.isArray(result.issues)) throw Error('Schema check returned invalid metadata.');
  if (result.issues.length) throw Error(`Print catalogue schema mismatch (${result.issues.length}):\n${result.issues.map(issue => `${issue.report}: ${issue.code}: ${issue.object}`).join('\n')}`);
  return `Print catalogue schema passed: ${result.reports} report definitions.`;
}

function validateReplayUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('A valid local migration replay database URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('Only PostgreSQL URLs are accepted.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Schema verification requires a disposable PostgreSQL server on localhost.');
  let database;
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { throw Error('Invalid migration replay database name.'); }
  if (database !== 'auris360_migration_replay') throw Error('Schema verification database must be named auris360_migration_replay.');
  if (url.search || url.hash) throw Error('Connection overrides are not accepted for schema verification.');
  return url;
}

function verifyDatabase(databaseUrl, options = {}) {
  const url = validateReplayUrl(databaseUrl);
  // Pass individual libpq fields in the child environment, never credentials in
  // command arguments/diagnostics, and clear inherited connection overrides.
  const env = { ...process.env, PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGHOSTADDR: '',
    PGPORT: url.port || '5432', PGDATABASE: 'auris360_migration_replay',
    PGUSER: decodeURIComponent(url.username || 'postgres'), PGPASSWORD: decodeURIComponent(url.password),
    PGSERVICE: '', PGSERVICEFILE: '', PGOPTIONS: '', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'auris360-print-schema-check' };
  const result = (options.spawnSync || spawnSync)(options.psql || process.env.PSQL_COMMAND || 'psql',
    ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align', '--file', '-'],
    { cwd: repositoryRoot, encoding: 'utf8', input: options.sql || buildSchemaValidationSql(), env, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw Error('Local replay metadata verification could not complete; check the disposable PostgreSQL service and schema.');
  let metadata;
  try { metadata = JSON.parse(result.stdout.trim()); } catch { throw Error('Schema check returned invalid metadata.'); }
  return assertSchemaValidationResult(metadata);
}

function main(args = process.argv.slice(2)) {
  if (args.includes('--sql')) { process.stdout.write(buildSchemaValidationSql()); return; }
  const index = args.indexOf('--database-url');
  const databaseUrl = index === -1 ? process.env.MIGRATION_REPLAY_DATABASE_URL : args[index + 1];
  console.log(verifyDatabase(databaseUrl));
}

module.exports = { loadCatalogueDefinitions, collectSchemaContracts, buildSchemaValidationSql, assertSchemaValidationResult, validateReplayUrl, verifyDatabase };
if (require.main === module) { try { main(); } catch (error) { console.error(`Print catalogue schema: ${error.message}`); process.exitCode = 1; } }
