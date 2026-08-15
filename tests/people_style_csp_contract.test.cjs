const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-people-static.css'), 'utf8');
const start = index.indexOf('<div id="page-people"');
const end = index.indexOf('<div id="page-users"', start);
const section = index.slice(start, end);

test('People has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-people-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-people-s-[a-f0-9]{10}/g) || []).length >= 15);
  assert.ok((css.match(/^\.auris-people-s-[a-f0-9]{10}\{/gm) || []).length >= 9);
});

test('Employee, contractor and register states remain runtime-controlled', () => {
  for (const id of ['people-form', 'contractor-fields', 'pe-emp', 'pe-con', 'pe-sub', 'filter-ptype', 'filter-pstatus']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-people-s-|<[^>]*class="[^"]*auris-people-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-people-s-[a-f0-9]{10}\\{`));
  }
  for (const id of ['pef-type', 'pef-dept', 'pef-site', 'pef-contract', 'pef-induction', 'pef-medical', 'pef-status', 'people-list']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(css, /display:none/);
  assert.doesNotMatch(css, /!important/i);
});
