const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page(companyId, records) {
  const host = { innerHTML: '', addEventListener() {} };
  const calls = [];
  const window = {};
  const context = {
    window,
    document: { readyState: 'loading', addEventListener() {}, getElementById(id) { return id === 'safety-awareness-root' ? host : null; } },
    ccid: () => companyId,
    isMgr: () => false,
    api: async path => { calls.push(path); return records; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'safety-awareness.js'), 'utf8'), context);
  return { window, host, calls };
}

test('awareness plan reads only the selected company and escapes stored discussion text', async () => {
  const app = page('11111111-1111-4111-8111-111111111111', [{
    id: 'topic-1', planned_month: 3, theme: '<script>alert(1)</script>',
    discussion_points: ['Check <unsafe> equipment']
  }]);
  await app.window.AurisSafetyAwareness.load();
  assert.match(app.calls[0], /company_id=eq\.11111111-1111-4111-8111-111111111111/);
  assert.match(app.host.innerHTML, /March/);
  assert.match(app.host.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(app.host.innerHTML, /Check &lt;unsafe&gt; equipment/);
  assert.doesNotMatch(app.host.innerHTML, /<script>/);
});

test('awareness plan does not query records without a selected company', async () => {
  const app = page(null, []);
  await app.window.AurisSafetyAwareness.load();
  assert.equal(app.calls.length, 0);
  assert.match(app.host.innerHTML, /Select a company/);
});
