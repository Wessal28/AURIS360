const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-management-of-change-static.css'), 'utf8');
const start = index.indexOf('<div id="page-moc"');
const end = index.indexOf('<div id="page-actions"', start);
const section = index.slice(start, end);

test('Management of Change has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-management-of-change-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-moc-s-[a-f0-9]{10}/g) || []).length >= 31);
  assert.ok((css.match(/^\.auris-moc-s-[a-f0-9]{10}\{/gm) || []).length >= 23);
});

test('Register, review, action, AI and editor states remain runtime-controlled', () => {
  for (const id of ['moc-form3view', 'moc-ai-panel', 'moc-ai-btn', 'moc-create-action-btn', 'moc-connected-records']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-moc-s-|<[^>]*class="[^"]*auris-moc-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-moc-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(180px,1fr\)\)/);
  assert.doesNotMatch(css, /!important/i);
});
