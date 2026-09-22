const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sidebarCss = fs.readFileSync(path.join(root, 'auris-premium-3d-sidebar.css'), 'utf8');
const stylesheets = [
  'auris-base.css',
  'auris-meeting-tabs.css',
  'auris-document-control.css',
  'auris-brand-drop.css',
  'auris-premium-3d-sidebar.css',
  'auris-mobile-final-polish.css'
];

test('page-level inline style blocks are externalized in cascade order', () => {
  assert.doesNotMatch(html, /<style\b/i);
  let previous = -1;
  for (const stylesheet of stylesheets) {
    const position = html.indexOf(`href="${stylesheet}`);
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

test('company branding has balanced space beside the AURIS logo', () => {
  assert.match(sidebarCss, /\.sidebar-top \.co-logo\{[\s\S]*width:90px!important[\s\S]*height:58px!important[\s\S]*object-fit:contain!important/);
  assert.match(html, /auris-premium-3d-sidebar\.css\?v=20260818-1/);
});


test('mobile overrides remain the final stylesheet outside module content', () => {
  const links = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)];
  assert.match(links.at(-1)[0], /href="auris-mobile-final-polish\.css\?v=/);
  assert.equal(links.filter(link => /href="auris-mobile-final-polish\.css/.test(link[0])).length, 1);
  const tail = html.slice(links.at(-1).index + links.at(-1)[0].length).trim();
  assert.match(tail, /^<\/body>\s*<\/html>$/i, 'global overrides must not be nested inside a module');
});
