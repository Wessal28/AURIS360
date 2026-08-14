const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-ppe-static.css'), 'utf8');
const start = index.indexOf('<div id="page-ppe"');
const end = index.indexOf('<div id="page-noise"', start);
const section = index.slice(start, end);

test('PPE has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-ppe-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-ppe-s-[a-f0-9]{10}/g) || []).length >= 224);
  assert.ok((css.match(/^\.auris-ppe-s-[a-f0-9]{10}\{/gm) || []).length >= 103);
});

test('Catalogue, inventory, issuance, inspection, replacement and expiry states remain runtime-controlled', () => {
  for (const id of ['ppe-view-catalogue', 'ppe-view-inventory', 'ppe-view-issuance', 'ppe-view-inspections', 'ppe-view-replacements', 'ppe-view-expiry', 'ppe-cat-form', 'ppe-iss-form', 'ppe-insp-form', 'ppe-rep-form']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-ppe-s-|<[^>]*class="[^"]*auris-ppe-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-ppe-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(6,1fr\)/);
  assert.match(css, /accent-color:var\(--green\)/);
  assert.doesNotMatch(css, /!important/i);
});
