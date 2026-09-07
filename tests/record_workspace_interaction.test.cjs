const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = { module: 'actions', table: 'action_tracker', id: 'action-1', company_id: 'co-a', ref: 'ACT-001' };
const record = { id: 'action-1', company_id: 'co-a', title: 'Inspect guard', status: 'open' };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

// A small event/markup harness exercises the real engine without a browser dependency.
// Layout and real keyboard behavior are additionally checked in the browser fixture.
function runtime() {
  const listeners = {}, document = { activeElement: null };
  const launcher = { isConnected: true, focus() { document.activeElement = this; } };
  launcher.focus();
  let markup = '', buttons = [];
  function matches(button, selector) {
    if (selector === 'button:not(:disabled)') return !button.disabled;
    const parts = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    return parts && Object.hasOwn(button.attrs, parts[1]) && (parts[2] === undefined || button.attrs[parts[1]] === parts[2]);
  }
  const host = {
    isConnected: true, dataset: {},
    get innerHTML() { return markup; },
    set innerHTML(value) {
      buttons.forEach(button => { button.isConnected = false; });
      markup = value; buttons = [];
      for (const match of value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const attrs = {}, events = {};
        for (const attr of match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[attr[1]] = attr[2] || '';
        buttons.push({ attrs, disabled: Object.hasOwn(attrs, 'disabled'), isConnected: true,
          getAttribute(name) { return attrs[name] ?? null; },
          addEventListener(name, handler) { events[name] = handler; },
          click() { if (!this.disabled) return events.click?.(); },
          focus() { document.activeElement = this; }
        });
      }
    },
    querySelector(selector) { return buttons.find(button => matches(button, selector)) || null; },
    querySelectorAll(selector) { return buttons.filter(button => matches(button, selector)); },
    contains(element) { return buttons.includes(element); },
    addEventListener(name, handler) { listeners[name] = handler; },
    setAttribute() {}
  };
  document.querySelector = () => host;
  document.createElement = () => host;
  document.body = { appendChild() {} };
  const identity = { company: { id: 'co-a' }, profile: { id: 'user-a', company_id: 'co-a' }, role: 'hse_manager' };
  const window = { document, console, Date, URL, Promise, setTimeout, clearTimeout,
    AurisPlatformServices: { auth: { isReady: () => true, current: () => identity } },
    AurisWorkflowService: { policy: () => ({ statusField: 'status', transitions: [['open', 'closed']] }), explain: () => ({ allowed: true }) }
  };
  vm.runInNewContext(read('auris-record-workspace.js'), window);
  const api = window.AurisRecordWorkspace;
  function adapter(load, extra = {}) { return api.registerAdapter({ key: 'action', module: 'actions', table: 'action_tracker', fields: [{ key: 'title', label: 'Title' }], canEdit: () => true, load, ...extra }); }
  function open(extra = {}) { return api.open({ source, record, ...extra }); }
  const click = selector => { const button = host.querySelector(selector); assert.ok(button, selector); return button.click(); };
  return { window, document, launcher, host, identity, api, adapter, open, click, listeners };
}

test('explicit-only adapters cannot silently replace a different integration', async () => {
  const r = runtime(); let loads = 0;
  r.adapter(() => { loads++; return { record }; }, { explicitOnly: true });
  await r.open(); assert.equal(loads, 0);
  await r.open({ adapterKey: 'action' }); assert.equal(loads, 1);
});

test('adapter notices and handoff guidance are escaped and only supported actions are shown', async () => {
  const r = runtime(); r.adapter(() => ({ record, notices: ['History unavailable <script>'] }));
  await r.open({ availableActions: ['copy', 'edit', 'open'], actionLabels: { open: 'Manage action' }, workflowHelp: 'Use Manage action <help>', onAction: () => {} });
  assert.match(r.host.innerHTML, /History unavailable &lt;script&gt;/); assert.match(r.host.innerHTML, /Manage action/);
  for (const key of ['comment', 'evidence', 'delegate']) assert.equal(r.host.querySelector(`[data-record-action="${key}"]`), null);
  await r.click('[data-record-tab="governance"]');
  assert.match(r.host.innerHTML, /Use Manage action &lt;help&gt;/); assert.equal(r.host.querySelector('[data-record-transition="closed"]'), null);
  assert.match(r.host.innerHTML, /No approval entries could be displayed/);
  assert.doesNotMatch(r.host.innerHTML, /No approval request is linked/);
  await r.click('[data-record-tab="activity"]');
  assert.match(r.host.innerHTML, /No entries could be displayed/);
});

test('successful editor handoff closes the active panel but late handoff cannot close a newer one', async () => {
  const r = runtime(); await r.open({ onAction: () => ({ close: true }) });
  await r.click('[data-record-action="open"]'); assert.equal(r.api.diagnostics().open, false);
  const pending = deferred(); await r.open({ onAction: () => pending.promise });
  const handingOff = r.click('[data-record-action="open"]'); await r.open({ source: { ...source, id: 'action-2' } });
  pending.resolve({ close: true }); await handingOff; assert.equal(r.api.diagnostics().source.id, 'action-2');
});

test('rejects wrong tenant or adapter before calling a record loader', async () => {
  const r = runtime(); let loads = 0; r.adapter(() => { loads++; return { record }; });
  await assert.rejects(r.open({ source: { ...source, company_id: 'co-b' } }), /another company/);
  await assert.rejects(r.open({ adapterKey: 'missing' }), /adapter does not match/);
  await assert.rejects(r.open({ adapterKey: 'action', source: { ...source, module: 'events' } }), /adapter does not match/);
  await assert.rejects(r.open({ context: { companyId: 'co-b' }, source: { ...source, company_id: 'co-b' } }), /current account or company/);
  await assert.rejects(r.open({ context: { role: 'superadmin' } }), /current account or company/);
  assert.equal(loads, 0);
});

test('slow record responses cannot replace a newer record', async () => {
  const r = runtime(), first = deferred(), second = deferred();
  r.adapter(s => s.id === 'action-1' ? first.promise : second.promise);
  const a = r.open(); const b = r.open({ source: { ...source, id: 'action-2' }, record: { ...record, id: 'action-2' } });
  second.resolve({ record: { ...record, id: 'action-2', title: 'Latest record' } }); await b;
  first.resolve({ record: { ...record, title: 'Stale record' } }); assert.equal(await a, null);
  assert.equal(r.api.diagnostics().source.id, 'action-2');
  assert.match(r.host.innerHTML, /Latest record/); assert.doesNotMatch(r.host.innerHTML, /Stale record/);
});

test('closing a loading panel cancels presentation and restores focus', async () => {
  const r = runtime(), pending = deferred(); r.adapter(() => pending.promise);
  const result = r.open(); assert.equal(r.api.diagnostics().loading, true);
  await r.click('[data-record-close]'); pending.resolve({ record });
  assert.equal(await result, null); assert.equal(r.host.innerHTML, ''); assert.equal(r.document.activeElement, r.launcher);
});

test('obsolete load failures do not hide a newer successful panel', async () => {
  const r = runtime(), pending = deferred(); r.adapter(s => s.id === 'action-1' ? pending.promise : { record: { ...record, id: s.id } });
  const first = r.open(); await r.open({ source: { ...source, id: 'action-2' } });
  pending.reject(new Error('Old failure')); assert.equal(await first, null);
  assert.equal(r.api.diagnostics().source.id, 'action-2'); assert.doesNotMatch(r.host.innerHTML, /Old failure/);
});

test('loaded identity and changed sessions fail closed without showing record details', async () => {
  const r = runtime(), pending = deferred(); r.adapter(() => pending.promise);
  const opening = r.open(); r.identity.company.id = 'co-b'; pending.resolve({ record });
  await assert.rejects(opening, /account or company changed/); assert.doesNotMatch(r.host.innerHTML, /Inspect guard/);
  r.identity.company.id = 'co-a'; r.adapter(() => ({ record: { ...record, id: 'unrelated' } }));
  await assert.rejects(r.open(), /does not match the requested record/);
});

test('history rejects evidence from another table/module and supports persisted approval identity', () => {
  const r = runtime();
  const rows = [
    { company_id: 'co-a', source_record_id: 'action-1', source_table: 'action_tracker', source_module: 'actions' },
    { company_id: 'co-a', related_id: 'action-1', related_table: 'incident_events', module_name: 'events' },
    { company_id: 'co-a', related_id: 'action-1', related_table: 'action_tracker', module_name: 'events' },
    { company_id: 'co-a', source: { companyId: 'co-b', recordId: 'action-1', table: 'action_tracker' } },
    { company_id: 'co-a', source: { companyId: 'co-a', recordId: 'action-1', table: 'action_tracker', moduleKey: 'actions', page: 'action-detail' } }
  ];
  const model = r.api.model({ source, record, activities: rows, approvals: rows });
  assert.equal(model.activities.length, 2); assert.equal(model.approvals.length, 2);
});

test('async action errors stay in the panel, escape text, allow retry and block duplicate clicks', async () => {
  const r = runtime(), pending = deferred(); let calls = 0;
  await r.open({ onAction: () => { calls++; return calls === 1 ? pending.promise : { message: 'Saved successfully' }; } });
  const firstButton = r.host.querySelector('[data-record-action="comment"]');
  const action = firstButton.click(); firstButton.click();
  assert.equal(calls, 1); assert.match(r.host.innerHTML, /Working…/);
  pending.reject(new Error('Save failed <script>')); await action;
  assert.match(r.host.innerHTML, /role="alert">Save failed &lt;script&gt;/);
  assert.equal(r.api.diagnostics().open, true);
  await r.click('[data-record-action="comment"]');
  assert.match(r.host.innerHTML, /Saved successfully/); assert.equal(calls, 2);
});

test('account changes block actions and offline blocks workflow and custom mutations', async () => {
  const r = runtime(); let actions = 0, transitions = 0;
  r.adapter(null, { actions: [{ key: 'custom', label: 'Custom mutation' }] });
  await r.open({ onAction: () => { actions++; } }); r.identity.company.id = 'co-b';
  await r.click('[data-record-action="comment"]'); assert.equal(actions, 0); assert.match(r.host.innerHTML, /account or company changed/);
  r.identity.company.id = 'co-a';
  await r.open({ offline: true, onAction: () => { actions++; }, onTransition: () => { transitions++; } });
  for (const key of ['comment', 'evidence', 'delegate', 'custom']) { assert.equal(r.host.querySelector(`[data-record-action="${key}"]`).disabled, true); }
  await r.click('[data-record-tab="governance"]'); assert.equal(r.host.querySelector('[data-record-transition="closed"]').disabled, true);
  assert.equal(transitions, 0); await r.click('[data-record-action="copy"]'); assert.equal(actions, 1);
});

test('unbound actions are disabled, outside clicks do not close, keyboard focus stays within panel', async () => {
  const r = runtime(); await r.open();
  assert.equal(r.host.querySelector('[data-record-action="open"]').disabled, true);
  assert.doesNotMatch(r.host.innerHTML, /class="arw-backdrop" data-record-close/);
  const buttons = r.host.querySelectorAll('button:not(:disabled)'); let prevented = 0;
  buttons.at(-1).focus(); r.listeners.keydown({ key: 'Tab', preventDefault() { prevented++; } });
  assert.equal(r.document.activeElement, buttons[0]);
  r.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(r.document.activeElement, buttons.at(-1)); assert.equal(prevented, 2);
  r.listeners.keydown({ key: 'Escape', preventDefault() {} }); assert.equal(r.api.diagnostics().open, false); assert.equal(r.document.activeElement, r.launcher);
});

test('late action errors cannot appear on a different record', async () => {
  const r = runtime(), pending = deferred(); await r.open({ onAction: () => pending.promise });
  const action = r.click('[data-record-action="comment"]'); await r.open({ source: { ...source, id: 'action-2' } });
  pending.reject(new Error('Previous action failed')); await action;
  assert.equal(r.api.diagnostics().source.id, 'action-2'); assert.doesNotMatch(r.host.innerHTML, /Previous action failed/);
});

test('My Work passes rejected writes into the workspace and closes before exact-source navigation', async () => {
  const r = runtime(); let options, navigated = false;
  r.window.AurisPlatformServices.api = { companyId: () => 'co-a', request: async url => url.startsWith('/action_tracker?') ? [{ ...record }] : [] };
  r.window.navigator = { onLine: true }; r.window.localStorage = { setItem() {}, getItem() { return null; } };
  r.window.crypto = { randomUUID: () => 'test-id' }; r.window.prompt = () => 'My comment';
  r.window.deepLinkNormalise = value => value; r.window.deepLinkStore = () => {};
  r.window.deepLinkResume = () => { assert.equal(r.api.diagnostics().open, false); navigated = true; };
  r.window.AurisRecordWorkspace = { ...r.api, open: async input => { options = input; return r.api.open(input); } };
  vm.runInNewContext(read('auris-work-centre.js'), r.window);
  await r.window.AurisWorkCentre.refresh(); await r.window.AurisWorkCentre.openSource('action:action-1');
  r.window.AurisPlatformServices.api.request = async () => { throw new Error('Evidence service unavailable'); };
  await r.click('[data-record-action="comment"]'); assert.match(r.host.innerHTML, /Evidence service unavailable/);
  assert.equal(typeof options.onAction, 'function');
  await r.click('[data-record-action="open"]'); assert.equal(navigated, true);
});
