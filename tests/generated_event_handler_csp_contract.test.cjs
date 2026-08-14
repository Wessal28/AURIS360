const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'auris-generated-event-handlers.js'), 'utf8');

test('generated static handlers use the precompiled delegated registry', () => {
  assert.match(html, /src="auris-generated-event-handlers\.js\?v=20260814-1"/);
  assert.match(core, /data-auris-generated-onclick="g\d{4}"/);
  assert.doesNotMatch(registry, /\beval\s*\(|new\s+Function\s*\(/);
  assert.match(registry, /handlers\[handlerId\]\.call\(node, event\)/);
  assert.match(registry, /eventType === 'error'/);
});

test('no inline handlers remain in core generated markup', () => {
  const remaining = [...core.matchAll(/\s(on[a-z]+)=(?:"([^"]*)"|'([^']*)')/gi)];
  assert.equal(remaining.length, 0);
});

test('generated delegated handler executes with the originating element as this', () => {
  const opacityHandler = registry.match(/"(g\d{4})": function \(event\) \{\s*this\.style\.opacity=0\.8/);
  assert.ok(opacityHandler, 'expected the generated hover handler');
  const listeners = {};
  const document = {
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  vm.runInNewContext(registry, { document });
  const node = {
    nodeType: 1,
    style: { opacity: '1' },
    parentElement: null,
    getAttribute(name) {
      return name === 'data-auris-generated-onmouseover' ? opacityHandler[1] : null;
    }
  };
  listeners.mouseover({ target: node, cancelBubble: false, preventDefault() {} });
  assert.equal(node.style.opacity, 0.8);
});
