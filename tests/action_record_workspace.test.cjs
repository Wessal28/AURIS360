const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const source = { module: 'actions', table: 'action_tracker', id: 'action-1', company_id: 'co-a' };
const current = { companyId: 'co-a', userId: 'user-a', role: 'hse_manager' };
const record = { id: 'action-1', company_id: 'co-a', title: 'Inspect guard', status: 'open', progress_pct: 25 };
function runtime(respond = () => []) {
  const calls = [], identity = { company: { id: 'co-a' }, profile: { id: 'user-a' }, role: 'hse_manager' };
  let adapter, options, clipboard;
  const context = { URL, console, navigator: { onLine: true, clipboard: { writeText: async text => { clipboard = text; } } },
    AurisPlatformServices: { ready: () => true, auth: { isAuthenticated: () => true, current: () => identity },
      rbac: { requireAccess: key => assert.equal(key, 'actions') }, api: { request: async (...args) => {
        assert.equal(args.length, 1, 'only read requests are allowed'); calls.push(args[0]);
        return respond(args[0], identity) ?? [];
      } } },
    AurisRecordWorkspace: { registerAdapter: value => { adapter = value; }, open: async value => { options = value; return value; } }
  };
  vm.runInNewContext(read('auris-action-record-workspace.js'), context);
  return { context, identity, calls, api: context.AurisActionRecordWorkspace,
    get adapter() { return adapter; }, get options() { return options; }, get clipboard() { return clipboard; } };
}
const withRecord = handler => (url, identity) => url.startsWith('/action_tracker?') ? [record] : handler(url, identity);

test('action overview reads an exact fresh company record before loading bounded history', async () => {
  const r = runtime(withRecord(() => []));
  const result = await r.api.load(source, current);
  assert.match(r.calls[0], /^\/action_tracker\?select=\*&company_id=eq.co-a&id=eq.action-1&limit=1$/);
  assert.equal(r.calls.length, 4);
  for (const url of r.calls.slice(1)) { assert.match(url, /company_id=eq.co-a/); assert.match(url, /action-1/); assert.match(url, /limit=101/); }
  assert.equal(result.record.progress_label, '25%'); assert.equal(result.record.responsible, 'Unassigned');
  assert.equal(result.notices.length, 0);
});

test('missing, duplicate, wrong-record and wrong-company payloads fail before history reads', async () => {
  for (const rows of [[], [record, record], [{ ...record, id: 'other' }], [{ ...record, company_id: 'co-b' }]]) {
    const r = runtime(() => rows);
    await assert.rejects(r.api.load(source, current), /unavailable/); assert.equal(r.calls.length, 1);
  }
});

test('authentication, module access and exact input identities are enforced before requests', async () => {
  const r = runtime();
  await assert.rejects(r.api.load({ ...source, company_id: 'co-b' }, current), /selected company/);
  await assert.rejects(r.api.load({ ...source, table: 'other' }, current), /selected company/);
  await assert.rejects(r.api.open('action-1&company_id=eq.co-b'), /exact action record/);
  r.context.AurisPlatformServices.auth.isAuthenticated = () => false;
  await assert.rejects(r.api.open('action-1'), /Sign in/);
  r.context.AurisPlatformServices.auth.isAuthenticated = () => true;
  r.context.AurisPlatformServices.rbac.requireAccess = () => { throw new Error('Access denied'); };
  await assert.rejects(r.api.open('action-1'), /Access denied/); assert.equal(r.calls.length, 0);
});

test('activity, evidence, requests and decisions remain tied to the exact action and tenant', async () => {
  const log = { id: 'log-1', company_id: 'co-a', action_id: 'action-1', notes: 'Guard inspected', performed_by: 'Reviewer', performed_at: '2026-09-08' };
  const work = { id: 'work-1', company_id: 'co-a', source_module: 'actions', source_table: 'action_tracker', source_record_id: 'action-1', activity_type: 'evidence', body: 'Evidence <script>', evidence: [{ label: 'Photo', url: 'https://example.invalid/photo' }] };
  const approval = { id: 'approval-1', company_id: 'co-a', module_name: 'actions', related_table: 'action_tracker', related_id: 'action-1', source_record_id: 'action-1', request_reason: 'Check closure' };
  const r = runtime(withRecord(url => {
    if (url.startsWith('/map_activity_log?')) return [log, { ...log, company_id: 'co-b' }, { ...log, action_id: 'other' }];
    if (url.startsWith('/work_activities?')) return [work, { ...work, source_table: 'incidents' }, { ...work, source_module: 'events' }, { ...work, company_id: 'co-b' }];
    if (url.startsWith('/approval_requests?')) return [approval, { ...approval, id: 'legacy', module_name: 'action' }, { ...approval, id: 'bad', related_id: 'other' }, { ...approval, company_id: 'co-b' }, { ...approval, module_name: 'events' }];
    if (url.startsWith('/approval_decisions?')) {
      assert.match(url, /request_id=in.\(approval-1,legacy\)/); assert.doesNotMatch(url, /bad/);
      return [{ id: 'decision-1', request_id: 'approval-1', decision: 'approved' }, { request_id: 'other', decision: 'rejected' }];
    }
    return [];
  }));
  const result = await r.api.load(source, current);
  assert.equal(result.activities.length, 3); assert.equal(result.approvals.length, 2);
  assert.equal(result.approvals[1].module_name, 'actions');
  assert.match(result.activities[1].body, /Photo: https:\/\/example.invalid\/photo/);
  assert.equal(result.activities[2].body, 'approved');
});

test('unavailable optional history and truncation are disclosed without inventing history', async () => {
  const r = runtime(withRecord(url => {
    if (url.startsWith('/map_activity_log?')) return Array.from({ length: 101 }, (_, n) => ({ id: String(n), company_id: 'co-a', action_id: 'action-1' }));
    throw new Error('private database details');
  }));
  const result = await r.api.load(source, current);
  assert.equal(result.activities.length, 100); assert.equal(result.notices.length, 3);
  assert.match(result.notices.join(' '), /older entries are not shown/);
  assert.match(result.notices.join(' '), /does not mean no history exists/);
  assert.doesNotMatch(result.notices.join(' '), /private database details/);
});

test('session changes during record or optional history requests fail closed', async () => {
  for (const changeAt of ['/action_tracker?', '/work_activities?']) {
    const r = runtime((url, identity) => {
      if (url.startsWith(changeAt)) identity.company.id = 'co-b';
      return url.startsWith('/action_tracker?') ? [record] : [];
    });
    await assert.rejects(r.api.load(source, current), /account or company changed/);
  }
});

test('explicit-only adapter offers honest actions and preserves editor failure for inline feedback', async () => {
  const r = runtime(); let handoff;
  await r.api.open('action-1', { reference: 'MAP-001', openEditor: async (...args) => { handoff = args; } });
  assert.equal(r.adapter.explicitOnly, true); assert.equal(r.options.adapterKey, 'master-action-record');
  assert.equal(r.options.availableActions.join(','), 'copy,edit,open'); assert.equal(r.options.source.ref, 'MAP-001');
  for (const [action, status, tab] of [['edit', 'open', 'details'], ['open', 'open', 'progress'], ['open', 'pending_verification', 'verification'], ['open', 'pending_closure', 'closure']]) {
    const result = await r.options.onAction(action, source, { ...record, status });
    assert.equal(handoff[0].id, 'action-1'); assert.equal(handoff[1], tab); assert.equal(handoff[2].companyId, 'co-a'); assert.equal(result.close, true);
  }
  await r.api.open('action-1', { openEditor: async () => { throw new Error('Editor unavailable'); } });
  await assert.rejects(r.options.onAction('edit', source, record), /Editor unavailable/);
});

test('copy is exact and editor handoff blocks changed identity, unsupported operations and offline state', async () => {
  const r = runtime(); await r.api.open('action-1', { openEditor: async () => {} });
  await r.options.onAction('copy', source, record);
  const url = new URL(r.clipboard); assert.equal(url.origin, 'https://auris360.app');
  assert.equal(url.searchParams.get('company'), 'co-a'); assert.equal(url.searchParams.get('record'), 'action-1'); assert.equal(url.searchParams.get('table'), 'action_tracker');
  await assert.rejects(r.options.onAction('comment', source, record), /not available/);
  await assert.rejects(r.options.onAction('edit', source, { ...record, id: 'other' }), /identity changed/);
  r.context.navigator.onLine = false;
  await assert.rejects(r.options.onAction('edit', source, record), /Reconnect/);
  r.context.navigator.onLine = true; r.identity.role = 'inspector';
  await assert.rejects(r.options.onAction('edit', source, record), /account or company changed/);
});

test('legacy editor rechecks company after loading people and before filling or displaying fields', async () => {
  const core = read('auris-core.js');
  const edit = core.slice(core.indexOf('async function mapEdit('), core.indexOf('async function mapPopulatePeopleSelects('));
  let release, writes = 0, company = 'co-a';
  const context = { mapAllData: [record], ccid: () => company, prof: { id: 'user-a' }, activeRole: () => 'hse_manager', canAccessPage: () => true,
    mapPopulatePeopleSelects: () => new Promise(resolve => { release = resolve; }), document: { getElementById: () => { writes++; return {}; } } };
  vm.runInNewContext(edit, context);
  const opening = context.mapEdit('action-1', current); company = 'co-b'; release();
  await assert.rejects(opening, /account or company changed/); assert.equal(writes, 0);
});

test('deployment and list navigation wire the reviewed adapter without replacing source links', () => {
  const html = read('index.html'), handlers = read('auris-runtime-event-handlers.js');
  assert.match(html, /src="auris-core\.js\?v=20260903-29-archive-safety-1"/);
  assert.ok(html.indexOf('src="auris-record-workspace.js?') < html.indexOf('src="auris-action-record-workspace.js?'));
  assert.ok(html.indexOf('src="auris-action-record-workspace.js?') < html.indexOf('src="auris-core.js?'));
  assert.match(handlers, /"r0088"[\s\S]*?mapOpenDetail\(args\[0\]\)/);
  assert.match(handlers, /"r0092"[\s\S]*?event.stopPropagation\(\);mapOpenDetail\(args\[0\]\)/);
  assert.match(handlers, /"r0089"[\s\S]*?mapOpenSourceRecord\(args\[0\]\)/);
  assert.match(read('sw-assets.js'), /auris-action-record-workspace\.js/);
  assert.doesNotMatch(read('auris-action-record-workspace.js'), /\bfetch\(|\bmapAllData\b|\bmapEdit\(|\bprof\b/);
});
