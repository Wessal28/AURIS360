const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-users-roles-static.css'), 'utf8');
const start = index.indexOf('<div id="page-users"');
const end = index.indexOf('<div id="page-admin"', start);
const section = index.slice(start, end);

test('Users & Roles has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-users-roles-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-users-roles-s-[a-f0-9]{10}/g) || []).length >= 90);
  assert.ok((css.match(/^\.auris-users-roles-s-[a-f0-9]{10}\{/gm) || []).length >= 65);
});

test('Invitations, roles, tenant access and credential states remain runtime-controlled', () => {
  for (const id of ['utab-users', 'utab-roles', 'utab-invite', 'uview-roles', 'uview-invite', 'cu-mode-hint', 'cu-synthetic-row', 'cu-password-row', 'cu-company-row', 'cu-result', 'pw-change-modal', 'user-profile-modal', 'user-edit-modal', 'uem3contractor-row', 'uem3temp-reset-box', 'uem3temp-reset-result']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-users-roles-s-|<[^>]*class="[^"]*auris-users-roles-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-users-roles-s-[a-f0-9]{10}\\{`));
  }
  for (const id of ['users-list', 'roles-matrix-table', 'ur-role', 'cu-role', 'cu-company', 'uem3role', 'uem3status']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /grid-template-columns:/);
  assert.doesNotMatch(css, /!important/i);
});
