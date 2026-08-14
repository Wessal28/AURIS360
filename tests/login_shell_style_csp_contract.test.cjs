const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-login-shell.css'), 'utf8');
const start = index.indexOf('<div id="login-screen"');
const end = index.indexOf('<div id="app"', start);
const loginShell = index.slice(start, end);

test('login shell uses the external generated stylesheet', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-login-shell\.css\?v=\d+-\d+">/);
  assert.equal((loginShell.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((loginShell.match(/auris-login-s-[a-f0-9]{10}/g) || []).length >= 43);
  assert.ok((css.match(/\.auris-login-s-[a-f0-9]{10}\{/g) || []).length >= 30);
});

test('critical login states remain class-based and script-overridable', () => {
  assert.match(loginShell, /id="panel-signin"/);
  assert.match(loginShell, /<[^>]*class="[^"]*auris-login-s-[^"]*"[^>]*id="panel-forgot"[^>]*>/);
  assert.match(loginShell, /<[^>]*class="[^"]*auris-login-s-[^"]*"[^>]*id="login-success"[^>]*>/);
  assert.match(css, /display:none/);
  assert.doesNotMatch(css, /!important/i);
});
