const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-document-control-static.css'), 'utf8');
const start = index.indexOf('<div id="page-documents"');
const end = index.indexOf('<div id="page-people"', start);
const section = index.slice(start, end);

test('Document Control has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-document-control-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-documents-s-[a-f0-9]{10}/g) || []).length >= 180);
  assert.ok((css.match(/^\.auris-documents-s-[a-f0-9]{10}\{/gm) || []).length >= 116);
});

test('Document workflows and viewer states remain runtime-controlled', () => {
  for (const id of ['dc-view-approval', 'dc-view-expiry', 'dc-view-copies', 'dc-view-ack', 'dc-form3view', 'dc-workflow-bar', 'dc-ai-review-panel', 'df-uploader-progress', 'dc-fview-versions', 'dc-ack-form', 'dc-copy-issue-form', 'dc-viewer-modal']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-documents-s-|<[^>]*class="[^"]*auris-documents-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-documents-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /grid-template-columns:/);
  assert.doesNotMatch(css, /!important/i);
});
