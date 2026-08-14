const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-kpi-legacy.css'), 'utf8');
const start = index.indexOf('<div id="page-kpi"');
const end = index.indexOf('<div id="page-workschedule"', start);
const section = index.slice(start, end);

test('legacy KPI page has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-kpi-legacy\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-kpilegacy-s-[a-f0-9]{10}/g) || []).length >= 91);
  assert.ok((css.match(/^\.auris-kpilegacy-s-[a-f0-9]{10}\{/gm) || []).length >= 59);
});

test('legacy KPI tabs, editors and entry state remain runtime-controlled', () => {
  for (const id of ['kpi-add-obj-btn', 'kpi-tab-monthly', 'obj-modal', 'obj-delete-btn', 'kpi-edit-modal', 'kpi-delete-btn', 'kpi-entry-modal', 'kpi-clear-btn']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-kpilegacy-s-|<[^>]*class="[^"]*auris-kpilegacy-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-kpilegacy-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /position:fixed;inset:0/);
  assert.match(css, /overflow-x:auto/);
  assert.doesNotMatch(css, /!important/i);
});
