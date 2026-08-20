const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('staging acceptance rejects production and requires the approved staging project', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  assert.match(source, /APPROVED_STAGING_REF = 'beoutmqttgfyyzndcdxu'/);
  assert.match(source, /PRODUCTION_REF = 'iarfxjhahzbhncsaohbg'/);
  assert.match(source, /Production application URLs are forbidden/);
  assert.match(source, /Expected a Preview deployment/);
});

test('staging acceptance authenticates without exposing credentials and verifies tenant scope', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  assert.match(source, /auth\/v1\/token\?grant_type=password/);
  assert.match(source, /AURIS360 Staging Test/);
  assert.match(source, /Authorization: `Bearer \$\{auth\.access_token\}`/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(password|access_token|anonKey)/i);
});

test('four previously blank module data sources are checked read-only', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  for (const table of ['events', 'kpi_monthly_data', 'engagement_configuration_versions', 'documents']) {
    assert.match(source, new RegExp(`${table}\\?select=id`));
  }
  assert.doesNotMatch(source, /method:\s*'(POST|PATCH|PUT|DELETE)'[^\n]*rest\/v1/i);
});

test('successful Preview deployments trigger the governed acceptance workflow', () => {
  const workflow = read('.github/workflows/staging-acceptance.yml');
  assert.match(workflow, /deployment_status:/);
  assert.match(workflow, /deployment\.environment != 'Production'/);
  assert.match(workflow, /environment: staging/);
  for (const secret of ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_TEST_EMAIL', 'STAGING_TEST_PASSWORD']) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
  assert.match(workflow, /upload-artifact@v4/);
});
