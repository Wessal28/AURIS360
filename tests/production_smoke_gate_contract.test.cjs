const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { expectedReleaseMatches } = require('../scripts/verify-production-smoke.cjs');

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
  for (const asset of ['auris-module-registry.js', 'auris-module-runtime.js', 'auris-core.js', 'incident-management-upgrade.js', 'risk-assessment-upgrade.js', 'sw.js']) {
    assert.match(source, new RegExp(asset.replace(/\./g, '\\.')));
  }
  assert.match(source, /status: 'passed'/);
  assert.match(source, /duration_ms/);
});

test('runtime configuration exposes only the public deployment SHA as release identity', () => {
  const runtime = read('api/runtime-config.js');
  assert.match(runtime, /releaseSha: String\(process\.env\.VERCEL_GIT_COMMIT_SHA/);
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
