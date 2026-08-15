const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-swms-static.css'), 'utf8');
const start = index.indexOf('<div id="page-swms"');
const end = index.indexOf('<div id="page-documents"', start);
const section = index.slice(start, end);

test('SWMS / Method Statements has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-swms-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-swms-s-[a-f0-9]{10}/g) || []).length >= 56);
  assert.ok((css.match(/^\.auris-swms-s-[a-f0-9]{10}\{/gm) || []).length >= 44);
});

test('Register, relationships, control steps and editor states remain runtime-controlled', () => {
  for (const id of ['swms-form3view', 'swms-ra-ref', 'swms-ptw-ref', 'swms-prestart', 'swms-review-triggers', 'swms-competency', 'swms-ppe', 'swms-plant', 'swms-emergency']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-swms-s-|<[^>]*class="[^"]*auris-swms-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-swms-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(3,1fr\)/);
  assert.match(css, /display:none/);
  assert.doesNotMatch(css, /!important/i);
});
