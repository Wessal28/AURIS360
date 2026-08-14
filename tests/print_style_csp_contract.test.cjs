const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-print.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const printStart = core.indexOf('function aurisPrint(');
const printEnd = core.indexOf('function aurisPrintCSS(', printStart);
assert.ok(printStart >= 0 && printEnd > printStart, 'aurisPrint is missing');
const printSource = core.slice(printStart, printEnd);

test('shared print engine loads an external stylesheet before printing', () => {
  const source = printSource;
  assert.match(source, /href="\/auris-print\.css"/);
  assert.match(source, /addEventListener\('load',printWhenReady/);
  assert.match(source, /setTimeout\(printWhenReady,1200\)/);
  assert.doesNotMatch(source, /<style>/);
  assert.match(index, /href="auris-print\.css" media="print"/);
});

test('print brand variables accept only hexadecimal colour values', () => {
  const source = printSource;
  assert.match(source, /\^#\[0-9a-f\]\{3,8\}\$/i);
  assert.match(css, /var\(--auris-print-primary\)/);
  assert.match(css, /@page auris-landscape/);
});
