const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'auris-module-event-handlers-batch-3.js'), 'utf8');
const modules = ['kpi-module-upgrade.js', 'swms-upgrade.js', 'contractor-management-upgrade.js', 'tools-equipment-upgrade.js'];

test('third module batch has no executable inline event attributes', () => {
  const eventAttribute = /\s(on[a-z]+)=(?:"[^"]*"|'[^']*')/i;
  for (const moduleName of modules) {
    const source = fs.readFileSync(path.join(root, moduleName), 'utf8');
    assert.doesNotMatch(source, eventAttribute, moduleName);
    assert.doesNotMatch(source, /on[a-z]+=\\["']/i, moduleName);
  }
  assert.match(html, /src="auris-module-event-handlers-batch-3\.js\?v=20260814-1"/);
});

test('third module registry contains only precompiled handlers', () => {
  assert.doesNotMatch(registry, /\beval\s*\(|new\s+Function\s*\(/);
  assert.match(registry, /"d0001": function/);
  assert.match(registry, /"d0076": function/);
});

test('third batch dispatches dynamic arguments and control values', () => {
  const listeners = {};
  const calls = [];
  const sandbox = {
    document: { addEventListener(type, listener) { listeners[type] = listener; } },
    kpiXFilterStatus(value) { calls.push(['argument', value]); },
    kpiXSetSearch(value) { calls.push(['value', value]); }
  };
  vm.runInNewContext(registry, sandbox);

  const argumentNode = {
    nodeType: 1,
    parentElement: null,
    value: '',
    getAttribute(name) {
      if (name === 'data-auris-module-onclick') return 'd0001';
      if (name === 'data-auris-module-args') return encodeURIComponent(JSON.stringify(['off_track']));
      return null;
    }
  };
  listeners.click({ target: argumentNode, cancelBubble: false, preventDefault() {} });

  const valueNode = {
    nodeType: 1,
    parentElement: null,
    value: 'inspection',
    getAttribute(name) { return name === 'data-auris-module-oninput' ? 'd0013' : null; }
  };
  listeners.input({ target: valueNode, cancelBubble: false, preventDefault() {} });
  assert.deepEqual(calls, [['argument', 'off_track'], ['value', 'inspection']]);
});
