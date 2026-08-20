const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'bootstrap-staging-test-tenant.sql'),
  'utf8'
);

test('staging bootstrap is explicit, guarded and does not create Auth users', () => {
  assert.match(sql, /REPLACE_WITH_STAGING_TEST_EMAIL/);
  assert.match(sql, /v_auth_user_count > 5/);
  assert.match(sql, /contains a non-staging company/);
  assert.doesNotMatch(sql, /insert\s+into\s+auth\.users/i);
  assert.doesNotMatch(sql, /update\s+auth\.users/i);
  assert.doesNotMatch(sql, /delete\s+from\s+auth\.users/i);
});

test('staging bootstrap is repeatable for its labelled company and site', () => {
  assert.match(sql, /where name = v_company_name/);
  assert.match(sql, /if v_company_id is null then[\s\S]*insert into public\.companies/i);
  assert.match(sql, /if not exists \([\s\S]*from public\.sites[\s\S]*Staging Office/i);
  assert.match(sql, /where id = v_user_id/);
  assert.match(sql, /role = 'admin'/);
});
