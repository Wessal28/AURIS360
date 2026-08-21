const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sharedRegistry = fs.readFileSync(path.join(root, 'auris-module-event-handlers-batch-1.js'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'auris-module-event-handlers-batch-2.js'), 'utf8');
const modules = ['document-control-upgrade.js', 'risk-assessment-upgrade.js', 'chemical-control-upgrade.js'];

test('second module batch has no executable inline event attributes', () => {
  const eventAttribute = /\s(on[a-z]+)=(?:"[^"]*"|'[^']*')/i;
  for (const moduleName of modules) {
    const source = fs.readFileSync(path.join(root, moduleName), 'utf8');
    assert.doesNotMatch(source, eventAttribute, moduleName);
    assert.doesNotMatch(source, /on[a-z]+=\\["']/i, moduleName);
  }
  assert.match(html, /src="auris-module-event-handlers-batch-2\.js\?v=20260822-2"/);
});

test('second module registry is precompiled and uses the strict shared dispatcher', () => {
  assert.doesNotMatch(registry, /\beval\s*\(|new\s+Function\s*\(/);
  assert.match(registry, /aurisExecuteModuleCommand/);
  assert.match(sharedRegistry, /namespace === 'dcx'/);
  assert.match(sharedRegistry, /\^dcx\[A-Z\]/);
});

test('document commands and dynamic module arguments dispatch without evaluation', () => {
  const listeners = {};
  const calls = [];
  const document = {
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); }
  };
  const sandbox = {
    document,
    dcxSwitch(value) { calls.push(['argument', value]); }
  };
  sandbox.window = {
    dcxOpenWizard() { calls.push(['command']); }
  };
  vm.runInNewContext(sharedRegistry, sandbox);
  vm.runInNewContext(registry, sandbox);

  const commandNode = {
    nodeType: 1,
    parentElement: null,
    getAttribute(name) {
      if (name === 'data-auris-module-onclick') return 'c0051';
      if (name === 'data-auris-module-command') return encodeURIComponent('dcxOpenWizard()');
      return null;
    }
  };
  listeners.click.forEach((listener) => listener({ target: commandNode, cancelBubble: false, preventDefault() {} }));

  const argumentNode = {
    nodeType: 1,
    parentElement: null,
    getAttribute(name) {
      if (name === 'data-auris-module-onclick') return 'c0001';
      if (name === 'data-auris-module-args') return encodeURIComponent(JSON.stringify(['register']));
      return null;
    }
  };
  listeners.click.forEach((listener) => listener({ target: argumentNode, cancelBubble: false, preventDefault() {} }));
  assert.deepEqual(calls, [['command'], ['argument', 'register']]);
});
