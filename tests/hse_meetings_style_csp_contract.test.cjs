const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-hse-meetings-static.css'), 'utf8');
const start = index.indexOf('<div id="page-meetings"');
const end = index.indexOf('<div id="page-training"', start);
const section = index.slice(start, end);

test('HSE Meetings has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-hse-meetings-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-meetings-s-[a-f0-9]{10}/g) || []).length >= 240);
  assert.ok((css.match(/^\.auris-meetings-s-[a-f0-9]{10}\{/gm) || []).length >= 126);
});

test('Minutes, toolbox, alert, bulletin and editor states remain runtime-controlled', () => {
  for (const id of ['mtg-view-minutes', 'mtg-view-tbt', 'mtg-view-alerts', 'mtg-view-bulletins', 'mtg-series-form', 'mtg-mom3form', 'tbt-form', 'alert-form', 'bulletin-form']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-meetings-s-|<[^>]*class="[^"]*auris-meetings-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-meetings-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(4,1fr\)/);
  assert.match(css, /accent-color:var\(--red\)/);
  assert.doesNotMatch(css, /!important/i);
});
