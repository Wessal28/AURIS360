const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-application-shell.css'), 'utf8');
const start = index.indexOf('<div id="app"');
const end = index.indexOf('<!-- DASHBOARD (Real-time HSE)', start);
const shell = index.slice(start, end);

test('authenticated application chrome has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-application-shell\.css\?v=\d+-\d+">/);
  assert.equal((shell.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((shell.match(/auris-shell-s-[a-f0-9]{10}/g) || []).length >= 27);
  assert.ok((css.match(/\.auris-shell-s-[a-f0-9]{10}\{/g) || []).length >= 21);
});

test('responsive and controlled shell states remain runtime-overridable', () => {
  for (const id of ['app', 'mobile-back-btn', 'mobile-search-overlay', 'sb-role-changer', 'nav-admin', 'pwa-install-btn', 'dev-mode-toggle']) {
    assert.match(shell, new RegExp(`<[^>]*class="[^"]*auris-shell-s-[^"]*"[^>]*id="${id}"|<[^>]*id="${id}"[^>]*class="[^"]*auris-shell-s-`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /#mobile-back-btn\.auris-shell-s-[a-f0-9]{10}\{display:none\}/);
  assert.match(css, /#app\.auris-shell-s-[a-f0-9]{10}\{display:none\}/);
  assert.doesNotMatch(css, /!important/i);
});
