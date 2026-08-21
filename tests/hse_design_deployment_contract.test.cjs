const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('corrected HSE design release has a verifiable build marker', () => {
  assert.match(index, /name="auris-build" content="2026-08-21-stability-phase-9"/);
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
    'auris-audits-inspections-static.css'
  ];
  for (const asset of assets) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(index, new RegExp(`${escaped}\\?v=20260821-3`), `${asset} must be cache-versioned`);
  }
});
