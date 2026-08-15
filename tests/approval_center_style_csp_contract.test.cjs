const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-approval-center-static.css'), 'utf8');
const start = index.indexOf('<div id="page-approvals"');
const end = index.indexOf('<div id="page-audit"', start);
const section = index.slice(start, end);

test('Approval Center has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-approval-center-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-approval-center-s-[a-f0-9]{10}/g) || []).length >= 34);
  assert.ok((css.match(/^\.auris-approval-center-s-[a-f0-9]{10}\{/gm) || []).length >= 21);
});

test('Approval scope, workflow coverage, filters and record queue remain intact', () => {
  for (const id of ['approvals-count', 'approvals-pending-count', 'approvals-shown-count', 'approvals-scope-label', 'approvals-search', 'approvals-filter-status', 'approvals-filter-module', 'approvals-table-body']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(section, /Workflow settings/);
  assert.match(section, /Approval coverage:/);
  assert.match(section, /Permit to Work, Document Control, Risk, Incident, Legal, SWMS/);
  assert.match(section, /pending_approval/);
  assert.match(section, /Status \/ Stage/);
  assert.match(css, /grid-template-columns:/);
  assert.doesNotMatch(css, /!important/i);
});
