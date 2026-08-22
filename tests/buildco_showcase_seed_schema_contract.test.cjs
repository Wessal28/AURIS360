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
