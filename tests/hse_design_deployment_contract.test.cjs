const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('corrected HSE design release has a verifiable build marker', () => {
  assert.match(index, /name="auris-build" content="2026-08-21-stability-phase-9-callouts"/);
});

test('all corrected design assets use the same release cache key', () => {
  const assets = [
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
    const expected = asset.startsWith('tools-equipment-upgrade') || asset === 'contractor-management-upgrade.css' || asset === 'auris-core.js' ? '20260821-4' : '20260821-3';
    assert.match(index, new RegExp(`${escaped}\\?v=${expected}`), `${asset} must be cache-versioned`);
  }
});
