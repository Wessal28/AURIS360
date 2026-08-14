const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'auris-module-event-handlers-batch-1.js'), 'utf8');
const modules = [
  'kpi-configuration.js',
  'noise-management.js',
  'incident-management-upgrade.js',
  'legal-compliance-upgrade.js',
  'sop-video-upgrade.js',
  'elearning-course-path.js',
  'resilience-fault-simulation.js',
  'offline-sync-diagnostic.js',
  'rollback-rehearsal.js',
  'notification-centre.js'
];

test('first module batch has no executable inline event attributes', () => {
  const eventAttribute = /\s(on[a-z]+)=(?:"[^"]*"|'[^']*')/i;
  for (const moduleName of modules) {
    const source = fs.readFileSync(path.join(root, moduleName), 'utf8');
    assert.doesNotMatch(source, eventAttribute, moduleName);
  }
  assert.match(html, /src="auris-module-event-handlers-batch-1\.js\?v=20260814-1"/);
});

test('module handler registry is precompiled and rejects arbitrary commands', () => {
  assert.doesNotMatch(registry, /\beval\s*\(|new\s+Function\s*\(/);
  assert.match(registry, /Rejected module command/);
  assert.match(registry, /\^\(\?:noise\|imv2\)/);
});

test('module arguments and allowlisted button commands dispatch without evaluation', () => {
  const listeners = {};
  const calls = [];
  const document = { addEventListener(type, listener) { listeners[type] = listener; } };
  const sandbox = {
    document,
    imv2ConfigGroup(value) { calls.push(['configuration', value]); }
  };
  sandbox.window = {
    noiseSwitchTab(value) { calls.push(['command', value]); }
  };
  vm.runInNewContext(registry, sandbox);

  const commandNode = {
    nodeType: 1,
    parentElement: null,
    getAttribute(name) {
      if (name === 'data-auris-module-onclick') return 'b0066';
      if (name === 'data-auris-module-command') return encodeURIComponent("noiseSwitchTab('work')");
      return null;
    }
  };
  listeners.click({ target: commandNode, cancelBubble: false, preventDefault() {} });

  const argumentNode = {
    nodeType: 1,
    parentElement: null,
    getAttribute(name) {
      if (name === 'data-auris-module-onclick') return 'b0067';
      if (name === 'data-auris-module-args') return encodeURIComponent(JSON.stringify(['Forms & Fields']));
      return null;
    }
  };
  listeners.click({ target: argumentNode, cancelBubble: false, preventDefault() {} });
  assert.deepEqual(calls, [['command', 'work'], ['configuration', 'Forms & Fields']]);
});
