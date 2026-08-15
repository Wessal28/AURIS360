const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-administration-static.css'), 'utf8');
const start = index.indexOf('<div id="page-admin"');
const end = index.indexOf('<div id="page-integrations"', start);
const section = index.slice(start, end);

test('Companies / Administration has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-administration-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-administration-s-[a-f0-9]{10}/g) || []).length >= 137);
  assert.ok((css.match(/^\.auris-administration-s-[a-f0-9]{10}\{/gm) || []).length >= 87);
});

test('Company, site, hierarchy, oversight and access states remain runtime-controlled', () => {
  for (const id of ['adm3view-companies', 'adm3view-sites', 'adm3view-hierarchy', 'adm3view-oversight', 'adm3view-access', 'adm3view-modules', 'oversight-ai-output', 'oversight-ai-placeholder', 'adm3company-modal', 'adm3co-logo-preview', 'adm3co-users-panel', 'adm3site-modal', 'adm3modules-modal', 'adm3access-modal']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-administration-s-|<[^>]*class="[^"]*auris-administration-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-administration-s-[a-f0-9]{10}\\{`));
  }
  for (const id of ['adm3ctx-company', 'adm3ctx-role', 'adm3companies-table', 'adm3sites-table', 'adm3hierarchy-tree', 'oversight-matrix', 'adm3access-list', 'adm3modules-list', 'adm3co-tier', 'adm3site-risk', 'adm3acc-level']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /grid-template-columns:/);
  assert.doesNotMatch(css, /!important/i);
});
