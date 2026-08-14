const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-contractor-management-static.css'), 'utf8');
const start = index.indexOf('<div id="page-contractor"');
const end = index.indexOf('<div id="page-esg"', start);
const section = index.slice(start, end);

test('Contractor Management has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-contractor-management-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-contractor-s-[a-f0-9]{10}/g) || []).length >= 169);
  assert.ok((css.match(/^\.auris-contractor-s-[a-f0-9]{10}\{/gm) || []).length >= 81);
});

test('Onboarding, assessment, performance and access states remain runtime-controlled', () => {
  for (const id of ['con-add-btn', 'con-view-score', 'con-view-preassess', 'cpa-add-btn', 'con-view-eval', 'cev-add-btn', 'con-view-atw', 'catw-add-btn', 'con-view-incidents', 'cir-add-btn', 'con-form', 'cpa-form', 'cev-form', 'catw-form', 'cir-form']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-contractor-s-|<[^>]*class="[^"]*auris-contractor-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-contractor-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /display:inline-block;padding:8px 16px;border-radius:99px/);
  assert.match(css, /accent-color:var\(--red\)/);
  assert.doesNotMatch(css, /!important/i);
});
