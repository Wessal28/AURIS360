const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { deployedLazyAssetUrl } = require('../scripts/deployed-lazy-asset.cjs');
const registrySource = fs.readFileSync('auris-module-registry.js', 'utf8');
const extractionSource = fs.readFileSync('auris-module-extraction.js', 'utf8');
const options = { registrySource, extractionSource, base: new URL('https://auris360.app/'), moduleKey: 'events', fileName: 'incident-management-upgrade.js', requiredVersion: 'incident-ui-20261128-1' };

test('deployed lazy URL validation uses the current literal registry and loader versions on either deployment origin', () => {
  for (const base of ['https://auris360.app/', 'https://review-preview.vercel.app/']) {
    const asset = new URL(deployedLazyAssetUrl({ ...options, base }));
    assert.equal(asset.origin, new URL(base).origin);
    assert.equal(asset.pathname, '/incident-management-upgrade.js');
    assert.equal(asset.searchParams.get('v'), '20260901-12');
    assert.ok(asset.searchParams.has('incident-ui-20261128-1'));
  }
  for (const [fileName, moduleKey] of [['incident-record-reports.js', 'events'], ['inspection-print-reports.js', 'inspection']]) {
    assert.ok(new URL(deployedLazyAssetUrl({ ...options, fileName, moduleKey, requiredVersion: 'record-views-20261128-1' })).searchParams.has('record-views-20261128-1'));
  }
});

test('missing module declarations and stale or absent extraction version tags fail closed', () => {
  assert.throws(() => deployedLazyAssetUrl({ ...options, registrySource: registrySource.replace("'incident-management-upgrade.js'", "'removed-upgrade.js'") }), /not declared exactly once/);
  assert.throws(() => deployedLazyAssetUrl({ ...options, extractionSource: extractionSource.replaceAll('incident-ui-20261128-1', 'incident-ui-20261004-1') }), /release version/);
  assert.throws(() => deployedLazyAssetUrl({ ...options, extractionSource: extractionSource.replace("'?v=20260901-12'", "'?build=20260901-12'") }), /extraction URL version/);
  assert.throws(() => deployedLazyAssetUrl({ ...options, fileName: 'inspection-print-reports.js', moduleKey: 'inspection', requiredVersion: 'record-views-20261128-1', registrySource: registrySource.replace("extractionMap.inspection.assets.push('inspection-print-reports.js');", '') }), /not declared exactly once/);
});

test('deployed sources are parsed without execution and cannot supply arbitrary asset URLs', () => {
  assert.throws(() => deployedLazyAssetUrl({ ...options, fileName: 'https://other.example/incident-management-upgrade.js' }), /invalid identity/);
  assert.throws(() => deployedLazyAssetUrl({ ...options, fileName: '../incident-management-upgrade.js' }), /invalid identity/);
  const original = globalThis.__lazyVerifierExecuted;
  try {
    deployedLazyAssetUrl({ ...options, registrySource: registrySource + '\nglobalThis.__lazyVerifierExecuted=true; throw Error("Fetched code must never run");' });
    assert.equal(globalThis.__lazyVerifierExecuted, original);
  } finally { if (original === undefined) delete globalThis.__lazyVerifierExecuted; }
});

test('staging deployment verification fetches and checks the real lazy and static record-view assets', async () => {
  const source = fs.readFileSync('scripts/verify-staging-acceptance.cjs', 'utf8');
  const start = source.indexOf("  for (const [fileName, markers] of [\n    ['auris-navigation-trail.js'");
  const end = source.indexOf("  for (const [fileName, marker] of [['tools-print-reports.js'", start);
  assert.ok(start > 0 && end > start);
  const requests = [], assetSources = new Map([['auris-module-registry.js', registrySource], ['auris-module-extraction.js', extractionSource]]);
  const preview = new URL('https://review-preview.vercel.app/'), previewHeaders = { 'x-vercel-protection-bypass': 'fictional-preview-header' };
  const context = vm.createContext({ assetSources, preview, previewHeaders, deployedLazyAssetUrl,
    deployedAssetUrl: (_html, base, name) => new URL('/' + name, base).href, appHtml: '',
    fail: message => { throw Error(message); },
    requireMarkers: (text, label, markers) => { for (const marker of markers) assert.ok(text.includes(marker), label + ' missing ' + marker); },
    responseText: async (url, request) => { requests.push({ url, request }); return fs.readFileSync(new URL(url).pathname.slice(1), 'utf8'); }
  });
  await vm.runInContext(`(async function(){${source.slice(start, end)}})()`, context);
  assert.equal(requests.length, 5);
  for (const name of ['auris-navigation-trail.js', 'auris-source-action-sync.js', 'incident-management-upgrade.js', 'incident-record-reports.js', 'inspection-print-reports.js']) assert.ok(assetSources.has(name));
  assert.ok(requests.every(request => new URL(request.url).origin === preview.origin && request.request.headers === previewHeaders));
  assert.ok(requests.filter(request => /incident-|inspection-print/.test(request.url)).every(request => new URL(request.url).searchParams.has(request.url.includes('incident-management-upgrade') ? 'incident-ui-20261128-1' : 'record-views-20261128-1')));
});
