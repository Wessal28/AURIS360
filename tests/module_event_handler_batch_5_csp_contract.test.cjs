const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('active application scripts contain no inline event-handler attributes', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)(?:\?[^"']*)?["']/gi)]
    .map((match) => match[1].replace(/^\//, ''))
    .filter((name) => fs.existsSync(path.join(root, name)));
  for (const name of scripts) {
    const source = read(name);
    assert.doesNotMatch(source, /\son[a-z]+\s*=\s*(?:["']|\\["'])/i, name);
    assert.doesNotMatch(source, /setAttribute\s*\(\s*["']on[a-z]+["']/i, name);
  }
});

test('Safety Engagement uses the precompiled batch 5 registry and strict command namespace', () => {
  const html = read('index.html');
  const source = read('safety-engagement.js');
  const registry = read('auris-module-event-handlers-batch-5.js');
  const shared = read('auris-module-event-handlers-batch-1.js');
  assert.match(html, /auris-module-event-handlers-batch-5\.js/);
  assert.doesNotMatch(source, /\son[a-z]+\s*=\s*(?:["']|\\["'])/i);
  assert.match(registry, /"f0062"/);
  assert.match(registry, /aurisExecuteModuleCommand/);
  assert.match(shared, /namespace === 'se'/);
  assert.doesNotMatch(registry, /\beval\s*\(|\bnew\s+Function\b/);
});

test('production CSP blocks all script attributes', () => {
  const configuration = read('vercel.json');
  assert.match(configuration, /script-src-attr 'none'/);
  assert.doesNotMatch(configuration, /script-src-attr 'unsafe-inline'/);
});
