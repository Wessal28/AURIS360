const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-occupational-noise-static.css'), 'utf8');
const start = index.indexOf('<div id="page-noise"');
const end = index.indexOf('<div id="page-meetings"', start);
const section = index.slice(start, end);

test('Occupational Noise Management has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-occupational-noise-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-noise-s-[a-f0-9]{10}/g) || []).length >= 42);
  assert.ok((css.match(/^\.auris-noise-s-[a-f0-9]{10}\{/gm) || []).length >= 36);
});

test('Survey, map, HPE and editor states remain runtime-controlled', () => {
  for (const id of ['noise-section-map', 'noise-section-hpe', 'noise-form', 'noise-del-btn', 'noise-plan-img']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-noise-s-|<[^>]*class="[^"]*auris-noise-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-noise-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /pointer-events:none/);
  assert.doesNotMatch(css, /!important/i);
});
