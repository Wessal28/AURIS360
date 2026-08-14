const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-emergency-management-static.css'), 'utf8');
const start = index.indexOf('<div id="page-emergency"');
const end = index.indexOf('<div id="page-ohealth"', start);
const section = index.slice(start, end);

test('Emergency Management has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-emergency-management-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-emergency-s-[a-f0-9]{10}/g) || []).length >= 298);
  assert.ok((css.match(/^\.auris-emergency-s-[a-f0-9]{10}\{/gm) || []).length >= 109);
});

test('Plans, teams, drills, activations, continuity and equipment remain runtime-controlled', () => {
  for (const id of ['em3view-plans', 'em3view-muster', 'em3view-ert', 'em3view-drills', 'em3view-activations', 'em3view-bcp', 'em3view-equipment', 'em3plan-form', 'em3muster-form', 'em3ert-form', 'em3drill-form', 'em3activation-form', 'em3bcp-form', 'em3eq-form']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-emergency-s-|<[^>]*class="[^"]*auris-emergency-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-emergency-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /grid-template-columns:/);
  assert.doesNotMatch(css, /!important/i);
});
