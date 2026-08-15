const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const stylesheets = [
  'auris-base.css',
  'auris-meeting-tabs.css',
  'auris-document-control.css',
  'auris-brand-drop.css',
  'auris-mobile-final-polish.css',
  'auris-premium-3d-sidebar.css'
];

test('page-level inline style blocks are externalized in cascade order', () => {
  assert.doesNotMatch(html, /<style\b/i);
  let previous = -1;
  for (const stylesheet of stylesheets) {
    const position = html.indexOf(`href="${stylesheet}"`);
    assert.ok(position > previous, `${stylesheet} is missing or out of order`);
    assert.ok(fs.statSync(path.join(root, stylesheet)).size > 0, `${stylesheet} is empty`);
    previous = position;
  }
});

test('stylesheet origins are enforced while legacy dynamic attributes remain temporarily allowed', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const globalRule = config.headers.find((rule) => rule.source === '/(.*)');
  const enforced = globalRule.headers.find((header) => header.key === 'Content-Security-Policy').value;
  const reportOnly = globalRule.headers.find((header) => header.key === 'Content-Security-Policy-Report-Only').value;
  assert.match(enforced, /style-src-elem 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(enforced, /style-src-attr/);
  assert.match(reportOnly, /style-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(reportOnly, /style-src-attr/);
  assert.doesNotMatch(reportOnly, /style-src[^;]*https?:\/\/(?!cdn\.jsdelivr\.net)/);
});
