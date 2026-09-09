const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-runtime-state.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('shared runtime visibility uses a bounded class helper', () => {
  assert.match(index, /auris-runtime-state\.css\?v=\d+-\d+/);
  assert.match(index, /auris-core\.js\?v=\d{8}-\d+/);
  assert.match(core, /function aurisSetDisplay\(target, mode\)/);
  for (const mode of ['none', 'block', 'flex', 'inline-flex']) {
    assert.match(css, new RegExp(`\\.auris-display-${mode}\\{display:${mode}!important\\}`));
  }
  assert.match(core, /el\.classList\.add\('auris-display-'\+mode\)/);
  assert.match(core, /mode==='none'.*aria-hidden/s);
});

test('authentication shell visibility no longer writes display styles', () => {
  const start = core.indexOf('function authShowPanel(name)');
  const end = core.indexOf('async function loadProf(uid)', start);
  const auth = core.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(auth, /\.style\.display/);
  assert.match(auth, /aurisSetDisplay\('login-screen','none'\)/);
  assert.match(auth, /aurisSetDisplay\('app','block'\)/);
  assert.match(auth, /aurisSetDisplay\('login-screen','flex'\)/);
});

test('shared page routing relies on the existing active page contract', () => {
  const start = core.indexOf('function showPage(name,el)');
  const end = core.indexOf('function toggleForm(id)', start);
  const router = core.slice(start, end);
  assert.doesNotMatch(router, /\.style\.display/);
  assert.match(router, /querySelectorAll\('\.page'\)[\s\S]*classList\.remove\('active'\)/);
  assert.match(router, /target\.classList\.add\('active'\)/);
  const base = fs.readFileSync(path.join(root, 'auris-base.css'), 'utf8');
  assert.match(base, /\.page\{display:none/);
  assert.match(base, /\.page\.active\{display:block/);
});

test('programmatic routes keep the matching sidebar module active', () => {
  const helperStart = core.indexOf('function activatePageNavigation(pageKey, suppliedElement)');
  const routerStart = core.indexOf('function showPage(name,el)', helperStart);
  const helper = core.slice(helperStart, routerStart);
  const routerEnd = core.indexOf('function toggleForm(id)', routerStart);
  const router = core.slice(routerStart, routerEnd);

  assert.ok(helperStart > 0 && routerStart > helperStart);
  assert.match(helper, /sidebarEnhanceNavItems\(\)/);
  assert.match(helper, /querySelectorAll\('\.sidebar \.nav-item'\)/);
  assert.match(helper, /item\.dataset\.navKey===pageKey/);
  assert.match(helper, /classList\.toggle\('active',isActive\)/);
  assert.match(helper, /setAttribute\('aria-current','page'\)/);
  assert.match(helper, /removeAttribute\('aria-current'\)/);
  assert.match(router, /activatePageNavigation\(name,el\)/);
  assert.doesNotMatch(router, /if\(el&&el\.classList\)el\.classList\.add\('active'\)/);
});

test('shared toast visibility is class-based', () => {
  const start = core.indexOf('function toast(m,ok=true)');
  const end = core.indexOf('// Field voice capture', start);
  const toast = core.slice(start, end);
  assert.doesNotMatch(toast, /\.style\.display/);
  assert.match(toast, /aurisSetDisplay\(t,'block'\)/);
  assert.match(toast, /aurisSetDisplay\(t,'none'\)/);
});
