const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('modular foundation release has a verifiable build marker', () => {
  assert.match(index, /name="auris-build" content="2026-09-01-modular-foundation-9"/);
});

test('all corrected design assets use the same release cache key', () => {
  const assets = [
    'auris-base.css',
    'auris-core.js',
    'kpi-module-upgrade.css',
    'kpi-module-upgrade.js',
    'bbs-observations.css',
    'bbs-observations.js',
    'incident-management-upgrade.css',
    'incident-management-upgrade.js',
    'risk-assessment-upgrade.css',
    'risk-assessment-upgrade.js',
    'auris-audits-inspections-static.css',
    'contractor-management-upgrade.css',
    'tools-equipment-upgrade.css',
    'tools-equipment-upgrade.js'
  ];
  for (const asset of assets) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expected = asset === 'auris-core.js'
      ? '20260831-3'
      : ['kpi-module-upgrade.css','bbs-observations.css','bbs-observations.js','incident-management-upgrade.css','incident-management-upgrade.js','risk-assessment-upgrade.css','risk-assessment-upgrade.js','auris-audits-inspections-static.css'].includes(asset)
      ? (asset.startsWith('incident-management-upgrade.') ? '20260831-4' : '20260823-4')
      : ['auris-base.css'].includes(asset)
      ? '20260822-1'
      : asset === 'tools-equipment-upgrade.js' ? '20260822-3'
      : asset === 'tools-equipment-upgrade.css' || asset === 'contractor-management-upgrade.css' ? '20260821-4' : '20260821-3';
    assert.match(index, new RegExp(`${escaped}\\?v=${expected}`), `${asset} must be cache-versioned`);
  }
});
