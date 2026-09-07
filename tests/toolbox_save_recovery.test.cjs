const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const saveSource = core.slice(core.indexOf('var tbtSavePending=false;'), core.indexOf('function tbtCurrentFormData()'));
const aiSource = core.slice(core.indexOf('async function aiSaveToolboxTalkToAuris()'), core.indexOf('function aiDownloadToolboxWord()'));

function editor(options = {}) {
  const fields = Object.fromEntries(Object.entries({
    'tbtf-title': 'Safe handling of chemicals', 'tbtf-date': '2026-09-07',
    'tbtf-category': 'chemical', 'tbtf-presenter': 'Wesley Salomon',
    'tbtf-location': 'Flic en Flac SS', 'tbtf-dept': 'Operations', 'tbtf-duration': '20',
    'tbtf-key-points': 'Read the label', 'tbtf-hazards': 'Splashes',
    'tbtf-incidents': 'INC-001', 'tbtf-notes': 'Keep the container closed', 'tbtf-status': 'completed',
    'tbt-form3ref': ''
  }).map(([id, value]) => [id, { value, textContent: '' }]));
  const calls = [], errors = [], messages = [], records = [];
  let backCount = 0;
  const row = (values) => ({ offsetParent: {}, dataset: {}, querySelector: (name) => ({ value: values[name] || '' }) });
  const context = vm.createContext({
    document: {
      getElementById: (id) => fields[id] || null,
      querySelectorAll: (selector) => selector === '.tbt-att-row'
        ? [row({ '.tbt-att-name': 'Worker One', '.tbt-att-dept': 'Operations' })]
        : selector === '.tbt-act-row' && options.actions
          ? [row({ '.tbt-act-desc': 'Replace damaged gloves', '.tbt-act-assigned': 'Supervisor', '.tbt-act-due': '2026-09-09' })] : []
    },
    ccid: () => 'company-a', prof: { id: 'actor', full_name: 'Wesley Salomon' },
    tbtEditId: options.editId || null,
    personFromValue: () => ({ id: 'person-a' }),
    tbtSelectedWork: () => null, tbtStripLinkedWork: (value) => value, tbtLinkedWorkMarker: () => '',
    tbtAttendeeConfirmedAt: () => '2026-09-07T08:00:00Z',
    nextCompanyRef: async () => 'TBT-2026-001',
    toast: (message, success) => messages.push({ message, success }),
    toastActionError: (_action, _label, error) => errors.push(error.message),
    actionErrorMessage: (_action, _label, error) => error.message,
    tbtBack: () => { backCount++; if (options.failNavigation) throw new Error('Navigation failed'); },
    aiCurrentToolboxTalk: { input: { topic: 'Chemical handling' }, content: 'Read the label' },
    aiToolboxRender: () => {},
    api: async (url, request) => {
      calls.push({ url, method: request.m, body: structuredClone(request.b) });
      if (options.pause) await options.pause;
      if (options.missingColumn && Object.hasOwn(request.b, options.missingColumn)) {
        throw new Error(`Could not find the '${options.missingColumn}' column of 'toolbox_talks' in the schema cache`);
      }
      if (request.m === 'POST' && url === '/toolbox_talks') {
        const saved = { ...request.b, id: 'saved-talk' }; records.push(saved); return [saved];
      }
      return [];
    }
  });
  vm.runInContext(saveSource + '\n' + aiSource, context);
  return { context, fields, calls, errors, messages, records, backCount: () => backCount };
}

test('new toolbox talk saves its reference and all entered details in one write', async () => {
  const app = editor({ actions: true }); await app.context.tbtSave();
  const talkCalls = app.calls.filter((call) => call.url.startsWith('/toolbox_talks'));
  assert.equal(talkCalls.length, 1); assert.equal(talkCalls[0].method, 'POST');
  const body = talkCalls[0].body;
  assert.equal(body.tbt_ref, 'TBT-2026-001'); assert.equal(body.company_id, 'company-a');
  assert.equal(body.presenter, 'Wesley Salomon'); assert.equal(body.duration_mins, 20);
  assert.equal(body.topic_category, 'chemical'); assert.equal(body.incidents_referenced, 'INC-001');
  assert.equal(body.attendees[0].name, 'Worker One'); assert.equal(body.actions_raised.length, 1);
  const action = app.calls.find((call) => call.url === '/action_tracker');
  assert.equal(action.body.source_id, 'saved-talk'); assert.equal(action.body.source_ref, body.tbt_ref);
  assert.equal(app.context.tbtEditId, 'saved-talk'); assert.equal(app.backCount(), 1);
  assert.deepEqual(app.errors, []);
});

for (const column of ['tbt_ref', 'presenter', 'topic_category', 'duration_mins', 'incidents_referenced']) {
  test(`missing ${column} rejects the whole write and retains the form`, async () => {
    const app = editor({ missingColumn: column }); await app.context.tbtSave();
    assert.equal(app.calls.length, 1); assert.equal(app.records.length, 0);
    assert.equal(app.backCount(), 0); assert.equal(app.context.tbtEditId, null);
    assert.equal(app.context.tbtSavePending, false); assert.equal(app.errors.length, 1);
    assert.equal(app.fields['tbtf-title'].value, 'Safe handling of chemicals');
    assert.equal(app.fields['tbtf-presenter'].value, 'Wesley Salomon');
    assert.equal(app.messages.length, 0);
  });
}

test('repeated Save clicks while a request is pending create only one talk', async () => {
  let release; const pause = new Promise((resolve) => { release = resolve; });
  const app = editor({ pause }); const first = app.context.tbtSave();
  await app.context.tbtSave(); release(); await first;
  assert.equal(app.records.length, 1); assert.equal(app.context.tbtSavePending, false);
});

test('retry after a post-save display error updates the confirmed talk instead of inserting again', async () => {
  const app = editor({ failNavigation: true });
  await app.context.tbtSave(); await app.context.tbtSave();
  assert.equal(app.records.length, 1); assert.deepEqual(app.calls.map((call) => call.method), ['POST', 'PATCH']);
  assert.equal(app.calls[1].url, '/toolbox_talks?id=eq.saved-talk');
});

test('editing a talk preserves its reference without allocating another', async () => {
  const app = editor({ editId: 'existing-talk' });
  app.context.nextCompanyRef = () => { throw new Error('Should not allocate'); };
  await app.context.tbtSave();
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].method, 'PATCH');
  assert.equal(app.calls[0].url, '/toolbox_talks?id=eq.existing-talk');
  assert.equal(Object.hasOwn(app.calls[0].body, 'tbt_ref'), false);
  assert.deepEqual(app.errors, []);
});

test('AI toolbox draft saves its reference with the initial insert and reuses the saved ID', async () => {
  const app = editor(); await app.context.aiSaveToolboxTalkToAuris(); await app.context.aiSaveToolboxTalkToAuris();
  assert.deepEqual(app.calls.map((call) => call.method), ['POST', 'PATCH']);
  assert.equal(app.calls[0].body.tbt_ref, 'TBT-2026-001');
  assert.equal(app.calls[0].body.status, 'draft'); assert.equal(app.records.length, 1);
  assert.equal(app.context.aiCurrentToolboxTalk.savedId, 'saved-talk');
});

test('AI draft reports a missing reference column as a failed write, without claiming success', async () => {
  const app = editor({ missingColumn: 'tbt_ref' }); await app.context.aiSaveToolboxTalkToAuris();
  assert.equal(app.calls.length, 1); assert.equal(app.records.length, 0);
  assert.equal(app.context.aiCurrentToolboxTalk.savedId, undefined);
  assert.equal(app.context.aiCurrentToolboxTalk.ref, undefined);
  assert.equal(app.context.aiCurrentToolboxTalk.saving, false);
  assert.equal(app.messages[0].success, false);
});

test('baseline plus repair migration provide every field submitted by both toolbox editors', async () => {
  const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260820000000_production_schema_baseline.sql'), 'utf8');
  const table = schema.match(/CREATE TABLE public\.toolbox_talks \(([\s\S]*?)\n\);/)[1];
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260907010000_toolbox_talk_save_fields.sql'), 'utf8');
  const columns = new Set([...table.matchAll(/^    ([a-z_]+) /gm)].map((match) => match[1]));
  for (const match of migration.matchAll(/add column if not exists ([a-z_]+) /g)) columns.add(match[1]);
  for (const save of ['tbtSave', 'aiSaveToolboxTalkToAuris']) {
    const app = editor(); await app.context[save]();
    for (const key of Object.keys(app.calls[0].body)) assert.ok(columns.has(key), `Missing toolbox column: ${key}`);
  }
});
