const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-fleet-management-static.css'), 'utf8');
const start = index.indexOf('<div id="page-fleet"');
const end = index.indexOf('<div id="page-atex"', start);
const section = index.slice(start, end);

test('Fleet Management has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-fleet-management-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-fleet-s-[a-f0-9]{10}/g) || []).length >= 16);
  assert.ok((css.match(/^\.auris-fleet-s-[a-f0-9]{10}\{/gm) || []).length >= 19);
});

test('Fleet metrics and access-controlled actions remain intact without redundant filters', () => {
  for (const id of ['fleet-add-vehicle-btn']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-fleet-s-|<[^>]*class="[^"]*auris-fleet-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-fleet-s-[a-f0-9]{10}\\{`));
  }
  assert.doesNotMatch(section, /id="fleet-filter-(?:status|check)"/);
  assert.match(section, /id="fleet-inspection-register"/);
  assert.match(section, /id="fleet-show-inspections"/);
  assert.match(fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8'), /id="fleet-check-date"/);
  assert.match(index, /id="fleet-inspection-list"/);
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(140px,1fr\)\)/);
  assert.match(css, /border-left:4px solid #185FA5/);
  assert.doesNotMatch(css, /!important/i);
});
