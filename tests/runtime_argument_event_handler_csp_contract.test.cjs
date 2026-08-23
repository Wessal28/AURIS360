const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'auris-runtime-event-handlers.js'), 'utf8');

test('core application has no executable inline event attributes', () => {
  const eventAttribute = /\s(on[a-z]+)=(?:"[^"]*"|'[^']*')/i;
  assert.doesNotMatch(html, eventAttribute);
  assert.doesNotMatch(core, eventAttribute);
  assert.doesNotMatch(core, /on[a-z]+=\\["']/i);
  assert.match(html, /src="auris-runtime-event-handlers\.js\?v=20260823-4"/);
});

test('runtime argument registry is precompiled and allowlisted', () => {
  assert.doesNotMatch(registry, /\beval\s*\(|new\s+Function\s*\(/);
  assert.match(registry, /JSON\.parse\(decodeURIComponent\(encodedArgs\)\)/);
  assert.match(registry, /var namedActions = \{/);
  assert.match(registry, /namedActions\[namedActionId\]\.call/);
});

test('runtime arguments and named actions dispatch without evaluating code strings', () => {
  const listeners = {};
  const calls = [];
  const document = {
    addEventListener(type, listener) { listeners[type] = listener; },
    getElementById() { return null; }
  };
  const sandbox = {
    document,
    window: { _raAISuggestions: [] },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    connectedRecordsTogglePicker(value) { calls.push(['runtime', value]); },
    obsNew(value) { calls.push(['named', value]); }
  };
  vm.runInNewContext(registry, sandbox);

  const runtimeNode = {
    nodeType: 1,
    parentElement: null,
    dataset: {},
    getAttribute(name) {
      if (name === 'data-auris-runtime-onclick') return 'r0001';
      if (name === 'data-auris-runtime-args') return encodeURIComponent(JSON.stringify(['mount-42']));
      return null;
    }
  };
  listeners.click({ target: runtimeNode, cancelBubble: false, preventDefault() {} });

  const namedNode = {
    nodeType: 1,
    parentElement: null,
    dataset: { observationType: 'positive_behaviour' },
    getAttribute(name) { return name === 'data-auris-named-action' ? 'obs-new' : null; }
  };
  listeners.click({ target: namedNode, cancelBubble: false, preventDefault() {} });
  assert.deepEqual(calls, [['runtime', 'mount-42'], ['named', 'positive_behaviour']]);
});
