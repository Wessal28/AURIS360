const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-incident-management-static.css'), 'utf8');
const start = index.indexOf('<div id="page-events"');
const end = index.indexOf('<div id="page-observation"', start);
const section = index.slice(start, end);

test('Incident Management has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-incident-management-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-incident-s-[a-f0-9]{10}/g) || []).length >= 330);
  assert.ok((css.match(/^\.auris-incident-s-[a-f0-9]{10}\{/gm) || []).length >= 161);
});

test('Incident reporting, investigation and action states remain runtime-controlled', () => {
  for (const id of ['ims-view-report', 'ims-del-btn', 'ev-serious-warning', 'ims-view-investigate', 'ims-inv-form', 'inv-release-btn', 'inv-rca', 'inv-ca', 'ims-view-actions', 'ims-view-evidence']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-incident-s-|<[^>]*class="[^"]*auris-incident-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-incident-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /background:linear-gradient\(135deg,#7F1D1D,#DC2626\)/);
  assert.match(css, /accent-color:#5B21B6/);
  assert.doesNotMatch(css, /!important/i);
});
