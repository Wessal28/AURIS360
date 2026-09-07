const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { expectedReleaseMatches, PRODUCTION_SHELL_MARKERS, main } = require('../scripts/verify-production-smoke.cjs');

const releaseSha = '537d2c780021326eef617bba589b42f51f5a51f7';
const productionEnv = { PRODUCTION_APP_URL: 'https://auris360.app', EXPECTED_DEPLOYMENT_SHA: releaseSha };
const quiet = { log() {} };

function fixture(overrides = {}) {
  const requests = [];
  const runtime = {
    environment: 'production', releaseSha,
    supabaseUrl: 'https://iarfxjhahzbhncsaohbg.supabase.co',
    supabaseAnonKey: 'do-not-retain-runtime-key',
    ...overrides.runtime
  };
  return {
    requests,
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://auris360.app');
      assert.equal(options.method || 'GET', 'GET');
      requests.push(url.pathname);
      if (overrides.networkError) throw new Error('simulated connection failure');
      if (url.pathname === '/') return new Response(overrides.html ?? read('index.html'), { headers: {
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'",
        ...overrides.headers
      } });
      if (url.pathname === '/api/runtime-config') return new Response(overrides.runtimeText ?? `window.AURIS_RUNTIME_CONFIG = Object.freeze(${JSON.stringify(runtime)});`);
      const file = url.pathname.slice(1);
      assert.match(file, /^[a-z0-9-]+\.js$/);
      return new Response(overrides.assets?.[file] ?? read(file));
    }
  };
}

function evidenceFile(t) {
  const evidenceRoot = path.join(root, 'release-evidence');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(evidenceRoot, 'smoke-test-'));
  t.after(() => {
    assert.ok(directory.startsWith(evidenceRoot + path.sep + 'smoke-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return path.join(directory, 'report.json');
}

test('production shell checks use the registered Incident page and real application markup', () => {
  const context = {};
  vm.runInNewContext(read('auris-module-registry.js'), context);
  const incident = context.AurisModuleRegistry.list().find((entry) => entry.name === 'Incident Management');
  assert.equal(incident.key, 'events');
  assert.ok(PRODUCTION_SHELL_MARKERS.includes(`id="page-${incident.key}"`));
  for (const marker of PRODUCTION_SHELL_MARKERS) assert.ok(read('index.html').includes(marker), marker);
});

test('the complete smoke probe accepts the real application shell and all critical assets', async (t) => {
  const report = evidenceFile(t);
  const response = fixture();
  const result = await main({ env: productionEnv, fetchImpl: response.fetchImpl, logger: quiet, args: ['--report', report] });
  assert.equal(result.status, 'passed');
  assert.equal(result.stage, 'complete');
  assert.equal(result.deployed_release_sha, releaseSha);
  assert.equal(result.assets.length, 28);
  assert.ok(response.requests.includes('/auris-action-record-workspace.js'));
  assert.ok(response.requests.includes('/incident-management-upgrade.js'));
  assert.ok(response.requests.includes('/risk-assessment-upgrade.js'));
  assert.ok(response.requests.includes('/sw.js'));
  assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).status, 'passed');
  assert.doesNotMatch(fs.readFileSync(report, 'utf8'), /do-not-retain-runtime-key/);
});

test('real smoke failures remain blocking and retain stage-specific evidence', async (t) => {
  const cases = [
    { name: 'missing Incident page', overrides: { html: read('index.html').replace('id="page-events"', 'id="page-removed"') }, stage: 'shell', message: /page-events/ },
    { name: 'missing security header', overrides: { headers: { 'x-frame-options': '' } }, stage: 'security_headers', message: /X-Frame-Options/ },
    { name: 'wrong environment', overrides: { runtime: { environment: 'preview' } }, stage: 'runtime', message: /Expected the production runtime/ },
    { name: 'wrong database', overrides: { runtime: { supabaseUrl: 'https://beoutmqttgfyyzndcdxu.supabase.co' } }, stage: 'runtime', message: /approved Supabase project/ },
    { name: 'invalid runtime JSON', overrides: { runtimeText: 'Object.freeze({invalid});' }, stage: 'runtime', message: /invalid JSON/ },
    { name: 'old live commit', overrides: { runtime: { releaseSha: 'b6db71ef9f856392569f79b1e37afec552cd9409' } }, stage: 'release_identity', message: /Canonical production is serving/ },
    { name: 'broken critical asset', overrides: { assets: { 'incident-management-upgrade.js': 'invalid'.repeat(30) } }, stage: 'critical_assets', message: /incident-management-upgrade.js is missing/ },
    { name: 'request failure', overrides: { networkError: true }, stage: 'shell', message: /simulated connection failure/ }
  ];
  for (const scenario of cases) await t.test(scenario.name, async (t) => {
    const report = evidenceFile(t);
    const response = fixture(scenario.overrides);
    await assert.rejects(main({ env: productionEnv, fetchImpl: response.fetchImpl, logger: quiet, args: ['--report', report] }), scenario.message);
    const saved = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.equal(saved.status, 'failed');
    assert.equal(saved.stage, scenario.stage);
    assert.match(saved.error, scenario.message);
    assert.doesNotMatch(fs.readFileSync(report, 'utf8'), /do-not-retain-runtime-key/);
    if (scenario.stage === 'release_identity') assert.equal(saved.deployed_release_sha, scenario.overrides.runtime.releaseSha);
    if (scenario.stage === 'critical_assets') {
      assert.equal(saved.checking_asset, 'incident-management-upgrade.js');
      assert.ok(saved.assets.length > 0);
    }
  });
});

test('CLI failures exit nonzero and save evidence even before the first request', (t) => {
  const report = evidenceFile(t);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-production-smoke.cjs'), '--report', report], {
    env: { ...process.env, ...productionEnv, PRODUCTION_APP_URL: 'https://not-production.example' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical AURIS360 production domain/);
  assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).stage, 'configuration');
});

test('evidence paths cannot escape the repository', async () => {
  await assert.rejects(main({ args: ['--report', '../outside-smoke-report.json'], logger: quiet }), /stay inside the repository/);
});

test('release identity accepts full or unambiguous abbreviated forms only', () => {
  const full = '3d0e91e9a85d91a3db91d09edd74b6f08e85e0d4';
  assert.equal(expectedReleaseMatches(full, full), true);
  assert.equal(expectedReleaseMatches(full, '3d0e91e'), true);
  assert.equal(expectedReleaseMatches('3d0e91e', full), true);
  assert.equal(expectedReleaseMatches(full, '9647d7b'), false);
  assert.equal(expectedReleaseMatches(full, '3d0e91'), false);
  assert.equal(expectedReleaseMatches('', full), false);
});

test('production smoke is read-only and restricted to canonical production', () => {
  const source = read('scripts/verify-production-smoke.cjs');
  assert.match(source, /PRODUCTION_HOSTS = new Set\(\['auris360\.app', 'www\.auris360\.app'\]\)/);
  assert.match(source, /PRODUCTION_REF = 'iarfxjhahzbhncsaohbg'/);
  assert.match(source, /method|fetch/);
  assert.doesNotMatch(source, /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(source, /SUPABASE_(ANON|SERVICE)_KEY/);
});

test('production smoke verifies release identity, runtime boundary, headers and critical assets', () => {
  const source = read('scripts/verify-production-smoke.cjs');
  for (const marker of ['EXPECTED_DEPLOYMENT_SHA', 'releaseSha', "runtime.environment !== 'production'", 'X-Content-Type-Options', 'X-Frame-Options', 'frame-ancestors']) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  for (const asset of ['auris-module-registry.js', 'auris-platform-services.js', 'auris-module-runtime.js', 'auris-application-lifecycle.js', 'auris-application-lifecycle-persistence.js', 'auris-command-centre.js', 'auris-view-engine.js', 'auris-record-workspace.js', 'auris-reporting-engine.js', 'auris-dashboard-designer.js', 'auris-automation-engine.js', 'auris-automation-centre.js', 'auris-integration-engine.js', 'auris-integration-centre.js', 'auris-module-layout.js', 'auris-workflow-service.js', 'auris-approval-centre.js', 'auris-priority-module-adapters.js', 'auris-applications-admin.js', 'auris-core.js', 'incident-management-upgrade.js', 'risk-assessment-upgrade.js', 'sw.js']) {
    assert.match(source, new RegExp(asset.replace(/\./g, '\\.')));
  }
  assert.match(source, /auris-integration-engine\.js[\s\S]*version:'1\.5\.0'[\s\S]*genericMappedRows:genericMappedRows/);
  assert.match(source, /status: 'passed'/);
  assert.match(source, /duration_ms/);
});

test('runtime configuration exposes only the public deployment SHA as release identity', () => {
  const runtime = read('api/runtime-config.js');
  assert.match(runtime, /releaseSha: String\(process\.env\.VERCEL_GIT_COMMIT_SHA/);
  assert.match(runtime, /platformVersion: '2\.0\.0'/);
  assert.match(runtime, /moduleRegistryVersion: '2\.2\.0'/);
  assert.doesNotMatch(runtime, /VERCEL_(TOKEN|ACCESS_TOKEN)/);
});

test('successful production deployments trigger smoke evidence retention', () => {
  const workflow = read('.github/workflows/production-smoke.yml');
  assert.match(workflow, /deployment_status:/);
  assert.match(workflow, /deployment\.environment == 'Production'/);
  assert.match(workflow, /EXPECTED_DEPLOYMENT_SHA/);
  assert.match(workflow, /npm run production:smoke/);
  assert.match(workflow, /upload-artifact@v4/);
  assert.match(workflow, /retention-days: 90/);
  assert.doesNotMatch(workflow, /secrets\./);
});
