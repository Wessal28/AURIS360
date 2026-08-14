const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sharedRegistry = fs.readFileSync(path.join(root, 'auris-module-event-handlers-batch-1.js'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'auris-module-event-handlers-batch-4.js'), 'utf8');
const modules = ['learning-competency-upgrade.js', 'bbs-observations.js'];

test('fourth module batch has no executable inline event attributes', () => {
  const eventAttribute = /\s(on[a-z]+)=(?:"[^"]*"|'[^']*')/i;
  for (const moduleName of modules) {
    const source = fs.readFileSync(path.join(root, moduleName), 'utf8');
    assert.doesNotMatch(source, eventAttribute, moduleName);
    assert.doesNotMatch(source, /on[a-z]+=\\["']/i, moduleName);
  }
  assert.match(html, /src="auris-module-event-handlers-batch-4\.js\?v=20260814-1"/);
});

test('fourth module registry is precompiled and BBS commands are namespace restricted', () => {
  assert.doesNotMatch(registry, /\beval\s*\(|new\s+Function\s*\(/);
  assert.match(registry, /"e0054": function/);
  assert.match(sharedRegistry, /namespace === 'bbs'/);
  assert.match(sharedRegistry, /\^bbs\[A-Z\]/);
});

test('learning arguments and BBS commands dispatch without evaluation', () => {
  const listeners = {};
  const calls = [];
  const sandbox = {
    document: { addEventListener(type, listener) { (listeners[type] ||= []).push(listener); } },
    lcuSwitch(value) { calls.push(['learning', value]); }
  };
  sandbox.window = { bbsRefresh() { calls.push(['bbs']); } };
  vm.runInNewContext(sharedRegistry, sandbox);
  vm.runInNewContext(registry, sandbox);

  const learningNode = {
    nodeType: 1,
    parentElement: null,
    getAttribute(name) {
      if (name === 'data-auris-module-onclick') return 'e0003';
      if (name === 'data-auris-module-args') return encodeURIComponent(JSON.stringify(['catalogue']));
      return null;
    }
  };
  listeners.click.forEach((listener) => listener({ target: learningNode, cancelBubble: false, preventDefault() {} }));

  const bbsNode = {
    nodeType: 1,
    parentElement: null,
    getAttribute(name) {
      if (name === 'data-auris-module-onclick') return 'e0054';
      if (name === 'data-auris-module-command') return encodeURIComponent('bbsRefresh()');
      return null;
    }
  };
  listeners.click.forEach((listener) => listener({ target: bbsNode, cancelBubble: false, preventDefault() {} }));
  assert.deepEqual(calls, [['learning', 'catalogue'], ['bbs']]);
});
