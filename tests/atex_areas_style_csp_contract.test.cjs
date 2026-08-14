const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-atex-areas-static.css'), 'utf8');
const start = index.indexOf('<div id="page-atex"');
const end = index.indexOf('<div id="page-tools"', start);
const section = index.slice(start, end);

test('ATEX Areas has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-atex-areas-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-atex-s-[a-f0-9]{10}/g) || []).length >= 36);
  assert.ok((css.match(/^\.auris-atex-s-[a-f0-9]{10}\{/gm) || []).length >= 25);
});

test('ATEX register, classification and control states remain runtime-controlled', () => {
  for (const id of ['atex-add-btn', 'atex-search', 'atex-filter-zone', 'atex-filter-status', 'atex-form', 'atex-del-btn', 'atex-ventilation', 'atex-ignition', 'atex-detection', 'atex-notes']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-atex-s-|<[^>]*class="[^"]*auris-atex-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-atex-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(150px,1fr\)\)/);
  assert.match(css, /grid-template-columns:2fr 1fr/);
  assert.doesNotMatch(css, /!important/i);
});
