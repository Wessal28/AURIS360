const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'kpi-configuration.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function harness({ draft = true, validated = false, intercept, lexicalProfile = false } = {}) {
  const calls = [], messages = [], host = { innerHTML: '' };
  const published = { id: 'published-a', company_id: 'company-a', version_no: 1, status: 'published', configuration: {} };
  const saved = { id: 'draft-a', company_id: 'company-a', version_no: 2, status: validated ? 'validated' : 'draft', configuration: {}, validation: { valid: validated } };
  const rows = draft ? [saved, published] : [published];
  let company = 'company-a';
  const ctx = { console, Date, document: { getElementById: id => id === 'kpi-x-config-view' ? host : null },
    prof: { id: 'user-a', role: 'admin', full_name: 'Test Administrator' },
    ccid: () => company, activeRole: () => ctx.prof.role, toast: (message, ok) => messages.push({ message, ok }),
    prompt: () => 'Test-only publication', kpiKPIs: [],
    api: async (url, options = {}) => {
      calls.push({ url, options: copy(options) });
      if (intercept) { const result = intercept(url, options, ctx); if (result !== undefined) return result; }
      if (url.startsWith('/kpi_config_audit')) return [];
      if (url.startsWith('/rpc/')) { const row = rows.find(row => row.id === options.b.p_config_id); if (!row) return {}; rows.forEach(row => { if (row.status === 'published') row.status = 'archived'; }); row.status = 'published'; return copy(row); }
      if (!options.m) return copy(rows.filter(row => row.company_id === company));
      if (options.m === 'POST') { const row = Object.assign({ id: 'new-draft' }, copy(options.b)); rows.unshift(row); return [copy(row)]; }
      if (options.m === 'PATCH') { const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]); const row = rows.find(row => row.id === id); if (!row) return []; Object.assign(row, copy(options.b)); return [copy(row)]; }
      throw new Error('Unexpected API operation');
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (lexicalProfile) vm.runInContext('let prof = window.prof; delete window.prof; window.activeRole = () => prof.role;', ctx);
  vm.runInContext(source, ctx);
  const change = value => ctx.kpiConfigChange({ dataset: { cfg: 'targets.on_track_percent' }, type: 'number', value: String(value) });
  return { ctx, calls, messages, host, change, company: value => { company = value; } };
}

test('validation persists a new unchanged draft before using its record ID', async () => {
  const h = harness({ draft: false }); await h.ctx.kpiConfigLoad(); assert.equal(await h.ctx.kpiConfigValidate(), true);
  assert.ok(h.calls.some(call => call.options.m === 'POST' && call.url === '/kpi_config_versions'));
  assert.ok(!h.calls.some(call => call.url.includes('undefined')));
});
test('configuration uses the production lexical profile, not a required window property', async () => {
  const h=harness({draft:false,lexicalProfile:true});assert.equal(h.ctx.prof,undefined);
  assert.equal(await h.ctx.kpiConfigLoad(),true);assert.equal(await h.ctx.kpiConfigValidate(),true);
  assert.equal(h.calls.find(call=>call.options.m==='POST'&&call.url==='/kpi_config_versions').options.b.created_by,'user-a');
});

test('editing a validated draft invalidates publication until saved and revalidated', async () => {
  const h = harness({ validated: true }); await h.ctx.kpiConfigLoad(); h.change(97); await h.ctx.kpiConfigPublish();
  assert.equal(h.calls.filter(call => call.url.startsWith('/rpc/')).length, 0);
  assert.match(h.host.innerHTML, /Unsaved changes/);
  assert.doesNotMatch(h.host.innerHTML, /Validation passed/);
});

test('empty validation response cannot be reported as validated', async () => {
  const h = harness({ intercept: (url, opts) => opts.b?.status === 'validated' ? [] : undefined });
  await h.ctx.kpiConfigLoad(); await h.ctx.kpiConfigValidate(); await h.ctx.kpiConfigPublish();
  assert.equal(h.calls.filter(call => call.url.startsWith('/rpc/')).length, 0);
  assert.ok(!h.messages.some(item => item.ok !== false && /Configuration validated/.test(item.message)));
});

test('editing during a draft save preserves the later edit and dirty state', async () => {
  const pending = deferred();
  const h = harness({ intercept: (url, opts) => opts.m === 'PATCH' && opts.b?.status === 'draft' ? pending.promise : undefined });
  await h.ctx.kpiConfigLoad(); h.change(96); const saving = h.ctx.kpiConfigSave();
  h.change(98);
  const request = h.calls.find(call => call.options.m === 'PATCH');
  pending.resolve([{ id: 'draft-a', ...request.options.b }]); await saving;
  assert.match(h.host.innerHTML, /Unsaved changes/);
  assert.match(h.host.innerHTML, /value="98"/);
});

test('discard is an unsaved draft change and is persisted before validation', async () => {
  const h = harness({ validated: true }); await h.ctx.kpiConfigLoad(); h.ctx.kpiConfigDiscard(); await h.ctx.kpiConfigValidate();
  const writes = h.calls.filter(call => call.options.m === 'PATCH');
  assert.equal(writes[0].options.b.status, 'draft');
  assert.equal(writes[1].options.b.status, 'validated');
});

test('failed company load does not retain the previous company draft', async () => {
  let fail = false;
  const h = harness({ intercept: () => fail ? Promise.reject(new Error('Read unavailable')) : undefined });
  await h.ctx.kpiConfigLoad(); h.change(99); h.company('company-b'); fail = true;
  await h.ctx.kpiConfigLoad();
  assert.doesNotMatch(h.host.innerHTML, /value="99"/);
  await h.ctx.kpiConfigValidate();
  assert.equal(h.calls.filter(call => call.options.m).length, 0);
});

test('slower old-company response cannot replace current-company configuration', async () => {
  const pending = deferred(); let initial = true;
  const h = harness({ draft: false, intercept: (url, opts) => {
    if (!opts.m && url.startsWith('/kpi_config_versions') && initial) { initial = false; return pending.promise; }
  } });
  const firstLoad = h.ctx.kpiConfigLoad(); h.company('company-b'); await h.ctx.kpiConfigLoad();
  pending.resolve([{ id: 'old', company_id: 'company-a', status: 'published', version_no: 1, configuration: { targets: { on_track_percent: 99 } } }]);
  await firstLoad;
  assert.equal(h.ctx.kpiConfigPublished.targets.on_track_percent, 95);
});

test('read-only roles cannot invoke validation or publication writes directly', async () => {
  const h = harness({ validated: true }); await h.ctx.kpiConfigLoad(); h.ctx.prof.role = 'inspector';
  await h.ctx.kpiConfigValidate(); await h.ctx.kpiConfigPublish();
  assert.equal(h.calls.filter(call => call.options.m).length, 0);
});

test('duplicate save clicks send one write and include company and revision filters', async () => {
  const pending = deferred();
  const h = harness({ intercept: (url, opts) => opts.m === 'PATCH' ? pending.promise : undefined });
  await h.ctx.kpiConfigLoad(); h.change(96);
  const first = h.ctx.kpiConfigSave(); await h.ctx.kpiConfigSave();
  const writes = h.calls.filter(call => call.options.m === 'PATCH');
  assert.equal(writes.length, 1); assert.match(writes[0].url, /company_id=eq.company-a/);
  assert.match(writes[0].url, /status=in\.\(draft,validated\)/);
  pending.resolve([{ id: 'draft-a', ...writes[0].options.b }]); await first;
});

test('empty draft save response retains edits and gives visible failure feedback', async () => {
  const h = harness({ intercept: (url, opts) => opts.m === 'PATCH' ? [] : undefined });
  await h.ctx.kpiConfigLoad(); h.change(96); assert.equal(await h.ctx.kpiConfigSave(), false);
  assert.match(h.host.innerHTML, /role="alert"/); assert.match(h.host.innerHTML, /Unsaved changes/);
});

test('an edit while the save audit is pending cannot be validated as the saved version', async () => {
  const pending = deferred();
  const h = harness({ intercept: (url, opts) => url.startsWith('/kpi_config_audit') && opts.m === 'POST' ? pending.promise : undefined });
  await h.ctx.kpiConfigLoad(); h.change(96); const validating = h.ctx.kpiConfigValidate();
  await new Promise(resolve => setImmediate(resolve)); h.change(99); pending.resolve([]); await validating;
  assert.equal(h.calls.filter(call => call.options.b?.status === 'validated').length, 0);
  assert.match(h.host.innerHTML, /Unsaved changes/);
});

test('an edit while validation is pending invalidates the local publish action', async () => {
  const pending = deferred();
  const h = harness({ intercept: (url, opts) => opts.b?.status === 'validated' ? pending.promise : undefined });
  await h.ctx.kpiConfigLoad(); const validating = h.ctx.kpiConfigValidate(); h.change(98);
  const request = h.calls.find(call => call.options.b?.status === 'validated');
  pending.resolve([{ id: 'draft-a', company_id: 'company-a', ...request.options.b }]); await validating;
  await h.ctx.kpiConfigPublish(); assert.equal(h.calls.filter(call => call.url.startsWith('/rpc/')).length, 0);
  assert.match(h.host.innerHTML, /value="98"/);
});

test('missing audit history does not discard the available published configuration', async () => {
  const h = harness({ intercept: (url, opts) => !opts.m && url.startsWith('/kpi_config_audit') ? Promise.reject(new Error('History unavailable')) : undefined });
  await h.ctx.kpiConfigLoad(); assert.match(h.host.innerHTML, /audit history is unavailable/);
  assert.match(h.host.innerHTML, /Live version<\/span><strong>v1/);
});

test('cross-company responses and late saves are rejected without following writes', async () => {
  const pending = deferred();
  const h = harness({ intercept: (url, opts) => opts.m === 'PATCH' ? pending.promise : undefined });
  await h.ctx.kpiConfigLoad(); h.change(96); const saving = h.ctx.kpiConfigSave(); h.company('company-b'); await h.ctx.kpiConfigLoad();
  pending.resolve([{ id: 'draft-a', company_id: 'company-a', status: 'draft' }]); await saving;
  assert.equal(h.calls.filter(call => call.options.m === 'POST').length, 0);
  assert.equal(h.ctx.kpiConfigPublished.targets.on_track_percent, 95);
});

test('publication requires a confirmed exact company and version response', async () => {
  const h = harness({ validated: true, intercept: url => url.startsWith('/rpc/') ? {} : undefined }); await h.ctx.kpiConfigLoad();
  assert.equal(await h.ctx.kpiConfigPublish(), false);
  assert.match(h.host.innerHTML, /Publication failed/);
  assert.ok(!h.messages.some(item => item.ok !== false && /Configuration published/.test(item.message)));
});

test('successful publication blocks edits and duplicate publish while in flight', async () => {
  const pending = deferred(); let refreshes = 0;
  const h = harness({ validated: true, intercept: url => url.startsWith('/rpc/') ? pending.promise : undefined });
  h.ctx.kpiLoadAll = async () => { refreshes++; };
  await h.ctx.kpiConfigLoad(); const publishing = h.ctx.kpiConfigPublish();
  h.change(99); await h.ctx.kpiConfigPublish();
  assert.equal(h.calls.filter(call => call.url.startsWith('/rpc/')).length, 1);
  pending.resolve({ id: 'draft-a', company_id: 'company-a', status: 'published' });
  assert.equal(await publishing, true); assert.equal(refreshes, 1);
});

test('draft save and validation keep live thresholds unchanged until publication', async () => {
  const h = harness(); await h.ctx.kpiConfigLoad(); h.change(97);
  assert.equal(await h.ctx.kpiConfigValidate(), true);
  assert.equal(h.ctx.kpiConfigPublished.targets.on_track_percent, 95);
  assert.equal(await h.ctx.kpiConfigPublish(), true);
  assert.equal(h.ctx.kpiConfigPublished.targets.on_track_percent, 97);
});

test('invalid thresholds and cancellation cannot publish', async () => {
  const h = harness(); await h.ctx.kpiConfigLoad(); h.change(80);
  assert.equal(await h.ctx.kpiConfigValidate(), false); assert.match(h.host.innerHTML, /At Risk threshold must be lower/);
  await h.ctx.kpiConfigPublish(); assert.equal(h.calls.filter(call => call.url.startsWith('/rpc/')).length, 0);
  h.change(96); await h.ctx.kpiConfigValidate(); h.ctx.prompt = () => null;
  await h.ctx.kpiConfigPublish(); assert.equal(h.calls.filter(call => call.url.startsWith('/rpc/')).length, 0);
});

test('same-company refresh preserves the current unsaved draft', async () => {
  const h = harness(); await h.ctx.kpiConfigLoad(); h.change(97);
  const callsBefore = h.calls.length; await h.ctx.kpiConfigLoad();
  assert.equal(h.calls.length, callsBefore); assert.match(h.host.innerHTML, /value="97"/);
  assert.match(h.host.innerHTML, /Unsaved changes/);
});

test('self-approval synchronises people while invalidating the saved validation', async () => {
  const h = harness({ validated: true }); await h.ctx.kpiConfigLoad();
  h.ctx.kpiConfigChange({ dataset: { cfg: 'workflow.stage1' }, type: 'select-one', value: 'Alex Owner' });
  h.ctx.kpiConfigChange({ dataset: { cfg: 'workflow.self_approval' }, type: 'checkbox', checked: true });
  await h.ctx.kpiConfigSave();
  const workflow = h.calls.find(call => call.options.b?.configuration).options.b.configuration.workflow;
  assert.equal(workflow.stage1, 'Alex Owner'); assert.equal(workflow.stage2, 'Alex Owner'); assert.equal(workflow.stage3, 'Alex Owner');
  await h.ctx.kpiConfigPublish(); assert.equal(h.calls.filter(call => call.url.startsWith('/rpc/')).length, 0);
});
