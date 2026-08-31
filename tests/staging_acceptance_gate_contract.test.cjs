const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('staging acceptance rejects production and requires the approved staging project', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  assert.match(source, /::error title=Staging acceptance failed::/);
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

test('four previously blank modules verify deployed render and controlled empty-state contracts', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  for (const table of ['events', 'kpi_monthly_data', 'engagement_configuration_versions', 'documents']) {
    assert.match(source, new RegExp(`${table}\\?select=id`));
  }
  for (const asset of ['auris-module-registry.js', 'auris-module-runtime.js', 'auris-core.js', 'kpi-module-upgrade.js', 'safety-engagement.js', 'document-control-upgrade.js']) {
    assert.match(source, new RegExp(asset.replace(/\./g, '\\\.')));
  }
  for (const marker of ['No open incidents', 'No KPI data is available.', 'No engagement results for', 'No documents']) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /presentation_state: rows\.length \? 'populated' : 'controlled_empty'/);
});

test('deployed module navigation is verified through the canonical registry', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  for (const marker of ["key:'executive'", "loader:'loadExecutive'", "key:'kpi'", "loader:'kpiLoadAll'", "key:'engagement'", "loader:'loadSafetyEngagement'", "key:'documents'", "loader:'loadDocs'"]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /function moduleLoaderFor\(pageKey\)/);
  assert.match(source, /pageLoader=moduleLoaderFor\(name\)/);
  assert.doesNotMatch(source, /executive:loadExecutive/);
  for (const marker of ['activate:activate', 'readiness:readiness', "'auris:module-'+phase"]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('staging acceptance safely proves tenant-scoped write persistence', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /sites\?id=eq\.\$\{encodeURIComponent\(site\.id\)\}&\$\{companyFilter\}/);
  assert.match(source, /\{ name: site\.name \}/);
  assert.match(source, /same-value site PATCH/);
  const persistenceProbe = source.match(/const restWrite[\s\S]*?const profiles/);
  assert.ok(persistenceProbe, 'tenant write helper must remain identifiable');
  assert.doesNotMatch(persistenceProbe[0], /method:\s*'(POST|PUT|DELETE)'/);
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

test('protected Vercel previews use the automation bypass without exposing it in the URL', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  const workflow = read('.github/workflows/staging-acceptance.yml');
  assert.match(workflow, /secrets\.VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(source, /required\('VERCEL_AUTOMATION_BYPASS_SECRET'\)/);
  assert.match(source, /'x-vercel-protection-bypass': vercelBypassSecret/);
  assert.doesNotMatch(source, /x-vercel-protection-bypass=/);
});
