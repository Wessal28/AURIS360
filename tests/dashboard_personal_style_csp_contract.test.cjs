const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-dashboard-personal.css'), 'utf8');
const start = index.indexOf('<div id="page-dashboard"');
const end = index.indexOf('     ORG VIEW', start);
const section = index.slice(start, end);

test('dashboard header and personal view have no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-dashboard-personal\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-dash-s-[a-f0-9]{10}/g) || []).length >= 64);
  assert.ok((css.match(/^\.auris-dash-s-[a-f0-9]{10}\{/gm) || []).length >= 37);
});

test('dashboard visibility remains controlled and runtime-overridable', () => {
  for (const id of ['dash-control-centre', 'role-banner-dash', 'dash-alert-bar', 'dash-personal-view', 'dp-permits-section']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-dash-s-|<[^>]*class="[^"]*auris-dash-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-dash-s-[a-f0-9]{10}\\{[^}]*display:none`));
  }
  assert.doesNotMatch(css, /!important/i);
});
