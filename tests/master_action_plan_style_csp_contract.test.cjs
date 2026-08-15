const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-master-action-plan-static.css'), 'utf8');
const start = index.indexOf('<div id="page-actions"');
const end = index.indexOf('<div id="page-sop"', start);
const section = index.slice(start, end);

test('Master Action Plan has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-master-action-plan-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-map-s-[a-f0-9]{10}/g) || []).length >= 154);
  assert.ok((css.match(/^\.auris-map-s-[a-f0-9]{10}\{/gm) || []).length >= 94);
});

test('Assignment, progress, verification, closure and escalation states remain runtime-controlled', () => {
  for (const id of ['map-form3view', 'map-fview-assignment', 'map-fview-progress', 'map-fview-verification', 'map-fview-closure', 'map-fview-log', 'map-escalation-banner', 'map-workflow-bar', 'map-action-btns', 'map-connected-records']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-map-s-|<[^>]*class="[^"]*auris-map-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-map-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(7,1fr\)/);
  assert.match(css, /accent-color:var\(--green\)/);
  assert.doesNotMatch(css, /!important/i);
});
