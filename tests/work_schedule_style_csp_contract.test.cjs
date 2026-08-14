const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-work-schedule.css'), 'utf8');
const start = index.indexOf('<div id="page-workschedule"');
const end = index.indexOf('<div id="page-events"', start);
const section = index.slice(start, end);

test('Work Schedule has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-work-schedule\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-work-s-[a-f0-9]{10}/g) || []).length >= 204);
  assert.ok((css.match(/^\.auris-work-s-[a-f0-9]{10}\{/gm) || []).length >= 128);
});

test('Work Schedule views, forms and inspections remain runtime-controlled', () => {
  for (const id of ['ws-add-btn', 'ws-week-view', 'ws-detail-view', 'ws-form3view', 'ws-del-btn', 'ws-tbt-form', 'ws-te-form', 'ws-te-checklist-view']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-work-s-|<[^>]*class="[^"]*auris-work-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-work-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(5,1fr\)/);
  assert.match(css, /transition:background \.15s/);
  assert.doesNotMatch(css, /!important/i);
});
