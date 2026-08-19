const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const check = childProcess.spawnSync(process.execPath, ['scripts/generate-sw-manifest.cjs', '--check'], { cwd: root, encoding: 'utf8' });
assert.strictEqual(check.status, 0, check.stderr || check.stdout);
const generator = read('scripts/generate-sw-manifest.cjs');
assert(generator.includes("replace(/\\r\\n?/g, '\\n')"), 'manifest hashing must normalize text line endings across Windows and Linux');

const sandbox = { self: {} };
vm.runInNewContext(read('sw-assets.js'), sandbox, { filename: 'sw-assets.js' });
const manifest = sandbox.self.AURIS_SW_ASSET_MANIFEST;
assert.match(manifest.version, /^[a-f0-9]{16}$/, 'cache version must be content-derived');
assert.strictEqual(new Set(manifest.assets).size, manifest.assets.length, 'asset routes must be unique');

const requiredAssets = [
  '/', '/index.html', '/manifest.json', '/auris-icon-system.css', '/auris-icon-system.js',
  '/assets/auris-icon-system-final.png', '/assets/auris360-logo-final.png',
  '/kpi-module-upgrade.css', '/kpi-module-upgrade.js', '/safety-engagement.css', '/safety-engagement.js',
  '/bbs-observations.css', '/bbs-observations.js', '/noise-management.css', '/noise-management.js',
  '/incident-management-upgrade.css', '/incident-management-upgrade.js',
  '/document-control-upgrade.css', '/document-control-upgrade.js', '/swms-upgrade.css', '/swms-upgrade.js',
  '/legal-compliance-upgrade.css', '/legal-compliance-upgrade.js',
  '/risk-assessment-upgrade.css', '/risk-assessment-upgrade.js', '/sop-video-upgrade.css', '/sop-video-upgrade.js',
  '/learning-competency-upgrade.css', '/learning-competency-upgrade.js',
  '/chemical-control-upgrade.css', '/chemical-control-upgrade.js',
  '/contractor-management-upgrade.css', '/contractor-management-upgrade.js',
  '/tools-equipment-upgrade.css', '/tools-equipment-upgrade.js'
];
for (const asset of requiredAssets) assert(manifest.assets.includes(asset), `offline manifest is missing ${asset}`);
for (const asset of manifest.assets.filter((item) => item !== '/')) {
  assert(fs.existsSync(path.join(root, asset.slice(1))), `manifest route does not exist: ${asset}`);
}

const sw = read('sw.js');
assert(sw.includes("importScripts('/sw-assets.js')"), 'service worker must load the generated manifest');
assert(sw.includes('Promise.allSettled(OPTIONAL_ASSETS'), 'optional asset failure must not abort installation');
assert(sw.includes("event.request.mode === 'navigate'"), 'navigation requests need an offline fallback');
assert(sw.includes("cache.match('/index.html')"), 'offline navigation must fall back to the application shell');
assert(sw.includes('networkFirstVersionedAsset'), 'versioned assets must refresh without forcing a second page load');
assert(sw.includes("url.search ? networkFirstVersionedAsset(event.request) : cacheFirstAsset(event.request)"), 'versioned assets must prefer the network and retain offline fallback');
assert(sw.includes("url.pathname.startsWith('/api/')"), 'application APIs must bypass caches');
assert(sw.includes("url.hostname.includes('supabase.co')"), 'Supabase requests must bypass caches');
assert(sw.includes("event.tag === 'sync-incidents'"), 'incident background sync must remain registered');
assert(sw.includes("event.tag === 'sync-observations'"), 'BBS observation background sync must remain registered');
assert(sw.includes("type: 'SYNC_REQUEST'"), 'background sync must request authenticated queue processing from the app');

console.log(`Offline asset contract passed (${manifest.assets.length} routes, version ${manifest.version}).`);
