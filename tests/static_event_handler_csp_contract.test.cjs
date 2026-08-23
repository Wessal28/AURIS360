const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'auris-static-event-handlers.js'), 'utf8');

test('static HTML contains no executable inline event attributes', () => {
  assert.doesNotMatch(html, /\s(on[a-z]+)=(?:"[^"]*"|'[^']*')/i);
  assert.match(html, /src="auris-static-event-handlers\.js\?v=20260823-4"/);
});

test('static event registry delegates migrated event types without eval', () => {
  for (const eventType of ['click', 'change', 'input', 'mouseout', 'mouseover', 'keydown', 'drop', 'dragover', 'dragleave']) {
    assert.match(registry, new RegExp(`['"]${eventType}['"]`));
  }
  assert.doesNotMatch(registry, /\beval\s*\(|new\s+Function\s*\(/);
  assert.match(registry, /handlers\[handlerId\]\.call\(node, event\)/);
});
