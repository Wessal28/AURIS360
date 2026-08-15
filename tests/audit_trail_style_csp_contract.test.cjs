const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-audit-trail-static.css'), 'utf8');
const start = index.indexOf('<div id="page-audit"');
const end = index.indexOf('<div id="page-settings"', start);
const section = index.slice(start, end);

test('Audit Trail has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-audit-trail-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-audit-trail-s-[a-f0-9]{10}/g) || []).length >= 30);
  assert.ok((css.match(/^\.auris-audit-trail-s-[a-f0-9]{10}\{/gm) || []).length >= 18);
});

test('Audit scope, counts, filters, export and exact record queue remain intact', () => {
  for (const id of ['audit-count', 'audit-shown-count', 'audit-scope-label', 'audit-today-count', 'auditlog-search', 'audit-filter-action', 'audit-filter-module', 'audit-table-body']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(section, /Export CSV/);
  assert.match(section, /Current company/);
  assert.match(section, /Search user, module, action, details/);
  assert.match(section, /Record ID/);
  assert.match(section, /value="export"/);
  assert.match(css, /grid-template-columns:/);
  assert.doesNotMatch(css, /!important/i);
});
