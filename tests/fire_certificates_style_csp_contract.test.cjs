const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-fire-certificates-static.css'), 'utf8');
const start = index.indexOf('<div id="page-fire"');
const end = index.indexOf('<!-- END page-fire -->', start);
const section = index.slice(start, end);

test('Fire Certificates has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-fire-certificates-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-fire-certificates-s-[a-f0-9]{10}/g) || []).length >= 108);
  assert.ok((css.match(/^\.auris-fire-certificates-s-[a-f0-9]{10}\{/gm) || []).length >= 59);
});

test('Certificates, inspections, equipment, layouts and dashboard remain runtime-controlled', () => {
  for (const id of ['fire-tab-certs', 'fire-tab-inspections', 'fire-tab-equipment', 'fire-tab-layout', 'fire-tab-dashboard', 'fire-cert-table-wrap', 'fire-cert-empty', 'fire-pane-inspections', 'fire-insp-empty', 'fire-pane-equipment', 'fire-equip-empty', 'fire-pane-layout', 'fire-layout-list-view', 'fire-layout-editor', 'fire-layout-sync-status', 'fire-symbol-sync-status', 'fire-symbol-list', 'fire-layout-canvas', 'fire-layout-empty', 'fire-layout-img', 'fire-layout-marker-layer', 'fire-pane-dashboard', 'fire-cert-modal', 'fire-insp-modal', 'fire-equip-modal']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-fire-certificates-s-|<[^>]*class="[^"]*auris-fire-certificates-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-fire-certificates-s-[a-f0-9]{10}\\{`));
  }
  for (const id of ['fire-cert-tbody', 'fire-insp-tbody', 'fire-equip-tbody', 'fire-layout-plan-select', 'fire-layout-equipment-select', 'fire-layout-details', 'fire-layout-legend', 'fc-expiry-date', 'fi-result', 'fe-next-service']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /position:relative/);
  assert.doesNotMatch(css, /!important/i);
});
