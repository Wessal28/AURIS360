const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-sop-generator-static.css'), 'utf8');
const start = index.indexOf('<div id="page-sop"');
const end = index.indexOf('<div id="page-swms"', start);
const section = index.slice(start, end);

test('SOP Generator has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-sop-generator-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-sop-s-[a-f0-9]{10}/g) || []).length >= 61);
  assert.ok((css.match(/^\.auris-sop-s-[a-f0-9]{10}\{/gm) || []).length >= 41);
});

test('Upload, extraction, generation, review and preview states remain runtime-controlled', () => {
  for (const id of ['sop-view-create', 'sop-drop-zone', 'sop-video-input', 'sop-video-info', 'sop-video-preview', 'sop-to-frames-btn', 'sop-step-2', 'sop-step-3', 'sop-step-4', 'sop-step-5', 'sop-step-bar', 'sop-gen-bar', 'sop-preview-container']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-sop-s-|<[^>]*class="[^"]*auris-sop-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-sop-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /max-width:100%/);
  assert.doesNotMatch(css, /!important/i);
});
