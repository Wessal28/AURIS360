const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-integrations-static.css'), 'utf8');
const start = index.indexOf('<div id="page-integrations"');
const end = index.indexOf('<div id="page-ai-insights"', start);
const section = index.slice(start, end);

test('Integrations has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-integrations-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-integrations-s-[a-f0-9]{10}/g) || []).length >= 67);
  assert.ok((css.match(/^\.auris-integrations-s-[a-f0-9]{10}\{/gm) || []).length >= 47);
});

test('Connector, testing, sync, mapping and API states remain runtime-controlled', () => {
  for (const id of ['integ-status-banner', 'itab-all', 'itab-erp', 'itab-hr', 'itab-iot', 'itab-security', 'itab-bi', 'itab-productivity', 'itab-api', 'integ-config-modal', 'integ-modal-status-row', 'integ-disconnect-btn', 'integ-sync-options', 'integ-sync-log-section', 'integ-data-mapping', 'integ-api-view']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-integrations-s-|<[^>]*class="[^"]*auris-integrations-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-integrations-s-[a-f0-9]{10}\\{`));
  }
  for (const id of ['integ-grid', 'integ-modal-fields', 'integ-test-btn', 'integ-connect-btn', 'integ-sync-freq', 'integ-webhook-url', 'api-base-url', 'api-endpoints-table', 'api-curl-example']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(css, /display:none/);
  assert.doesNotMatch(css, /!important/i);
});
