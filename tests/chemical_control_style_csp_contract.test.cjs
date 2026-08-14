const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-chemical-control-static.css'), 'utf8');
const start = index.indexOf('<div id="page-chemical"');
const end = index.indexOf('<div id="page-legal"', start);
const section = index.slice(start, end);

test('Chemical Control has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-chemical-control-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-chemical-s-[a-f0-9]{10}/g) || []).length >= 107);
  assert.ok((css.match(/^\.auris-chemical-s-[a-f0-9]{10}\{/gm) || []).length >= 42);
});

test('SDS, chemical risk and review states remain runtime-controlled', () => {
  for (const id of ['chem3form3view', 'chem3del-btn', 'chem3sds-msg', 'chem3sds-file', 'chem3risk-preview', 'chem3ai-panel', 'chem3status']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-chemical-s-|<[^>]*class="[^"]*auris-chemical-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-chemical-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /background:#f9fafb/);
  assert.match(css, /min-width:220px/);
  assert.doesNotMatch(css, /!important/i);
});
