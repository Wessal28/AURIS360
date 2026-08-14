const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-tools-equipment-static.css'), 'utf8');
const start = index.indexOf('<div id="page-tools"');
const end = index.indexOf('<div id="page-permit"', start);
const section = index.slice(start, end);

test('Tools & Equipment has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-tools-equipment-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-tools-s-[a-f0-9]{10}/g) || []).length >= 131);
  assert.ok((css.match(/^\.auris-tools-s-[a-f0-9]{10}\{/gm) || []).length >= 66);
});

test('Equipment, inspection, assurance and release states remain runtime-controlled', () => {
  for (const id of ['tools-add-btn', 'tools-view-personal', 'tools-view-inspection', 'tools-insp-new-btn', 'tools-view-lifting', 'tools-view-statutory', 'tools-view-vehicles', 'tools-view-rcd', 'tools-form', 'teq-vehicle-section', 'teq-statutory-fields', 'tools-insp-form', 'tools-rcd-form']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-tools-s-|<[^>]*class="[^"]*auris-tools-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-tools-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(5,1fr\)/);
  assert.match(css, /letter-spacing:2px/);
  assert.doesNotMatch(css, /!important/i);
});
