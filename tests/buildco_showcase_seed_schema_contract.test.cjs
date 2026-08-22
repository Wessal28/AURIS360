const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const baseline = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260820000000_production_schema_baseline.sql'),
  'utf8'
);
const seed = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260822030000_buildco_mauritius_showcase_seed.sql'),
  'utf8'
);

function tableColumns(table) {
  const pattern = new RegExp(`CREATE TABLE public\\.${table} \\(\\n([\\s\\S]*?)\\n\\);`, 'i');
  const match = baseline.match(pattern);
  assert.ok(match, `baseline must define public.${table}`);
  return new Set(
    match[1]
      .split('\n')
      .map((line) => line.match(/^\s{4}([a-z][a-z0-9_]*)\s+/i)?.[1])
      .filter(Boolean)
  );
}

function splitSqlList(input) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "'") {
      if (quoted && input[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted && char === '(') depth += 1;
    else if (!quoted && char === ')') depth -= 1;
    else if (!quoted && depth === 0 && char === ',') {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}

function insertedRows() {
  const rows = [];
  const insertPattern = /insert into public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*values\s*([\s\S]*?)\s*on conflict/gi;
  for (const match of seed.matchAll(insertPattern)) {
    const columns = match[2].split(',').map((value) => value.trim());
    let valuesText = match[3].trim();
    if (valuesText.endsWith(';')) valuesText = valuesText.slice(0, -1);
    for (const tuple of splitSqlList(valuesText)) {
      assert.ok(tuple.startsWith('(') && tuple.endsWith(')'), `must parse values for public.${match[1]}`);
      const values = splitSqlList(tuple.slice(1, -1));
      assert.equal(values.length, columns.length, `value count must match columns for public.${match[1]}`);
      rows.push({ table: match[1], values: Object.fromEntries(columns.map((column, index) => [column, values[index]])) });
    }
  }
  return rows;
}

test('BuildCo seed names only columns present in the production baseline', () => {
  const insertPattern = /insert into public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*values/gi;
  const problems = [];
  for (const match of seed.matchAll(insertPattern)) {
    const [, table, rawColumns] = match;
    const available = tableColumns(table);
    for (const column of rawColumns.split(',').map((value) => value.trim())) {
      if (!available.has(column)) problems.push(`public.${table}.${column}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('BuildCo seed respects baseline enum-style check constraints', () => {
  const problems = [];
  for (const row of insertedRows()) {
    const tablePattern = new RegExp(`CREATE TABLE public\\.${row.table} \\(\\n([\\s\\S]*?)\\n\\);`, 'i');
    const tableSql = baseline.match(tablePattern)?.[1] || '';
    const checkPattern = /CHECK \(\(([a-z][a-z0-9_]*) = ANY \(ARRAY\[([^\]]+)\]\)\)\)/gi;
    for (const check of tableSql.matchAll(checkPattern)) {
      const [, column, rawAllowed] = check;
      const value = row.values[column];
      if (!value || !value.startsWith("'")) continue;
      const actual = value.slice(1, -1).replace(/''/g, "'");
      const allowed = [...rawAllowed.matchAll(/'([^']*)'::text/g)].map((item) => item[1]);
      if (!allowed.includes(actual)) problems.push(`public.${row.table}.${column}=${actual} (allowed: ${allowed.join(', ')})`);
    }
  }
  assert.deepEqual(problems, []);
});
