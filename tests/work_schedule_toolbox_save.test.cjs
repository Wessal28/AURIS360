const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const handlers = fs.readFileSync(path.join(root, 'auris-static-event-handlers.js'), 'utf8');
const source = core.slice(
  core.indexOf('function wsTbtAddAttendee()'),
  core.indexOf('// -- ADD / EDIT WORK ORDER', core.indexOf('function wsTbtAddAttendee()'))
);

function workspace() {
  const values = {
    'tbt-title': 'Toolbox Talk - Replace damaged guard',
    'tbt-date': '2026-09-10',
    'tbt-by': 'person-1',
    'tbt-duration': '20',
    'tbt-activity': 'Replace damaged guard',
    'tbt-location': 'Workshop',
    'tbt-topics': 'Isolation and PPE',
    'tbt-hazards': 'Stored energy',
    'tbt-controls': 'Lock out and tag out',
    'tbt-ppe': 'Gloves and eye protection',
    'tbt-emergency': 'Stop work and call supervisor',
    'tbt-sign-name': 'Wesley Salomon',
    'tbt-sign-dt': '2026-09-10T06:46',
    'tbt-new-attendee': ''
  };
  const fields = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }]));
  fields['tbt-by'].selectedOptions = [{ textContent: 'Salomon, Wesley' }];
  fields['tbt-confirmed'] = { checked: true };
  const calls = [], messages = [], errors = [];
  const work = { id: 'work-1', title: 'Replace damaged guard' };
  const context = vm.createContext({
    document: { getElementById: (id) => fields[id] || null },
    wsTbtSavePending: false, wsTbtSavedId: null, wsCurrentId: 'work-1',
    wsTbtAttendees: [{ name: 'Worker One', signed: true }],
    tenantPeople: () => [{ id: 'person-1', first_name: 'Wesley', last_name: 'Salomon' }],
    wsTeamMemberName: (p) => `${p.first_name} ${p.last_name}`,
    personFromValue: () => ({ id: 'worker-1' }), ccid: () => 'company-1',
    prof: { id: 'profile-1' }, nextCompanyRef: async () => 'TBT-2026-001',
    wsGetCurrent: () => work, wsBackToDetail: () => {}, wsShowDetail: async () => {},
    toast: (message, success) => messages.push({ message, success }),
    toastActionError: (_action, _module, error) => errors.push(error.message),
    api: async (url, request) => {
      calls.push({ url, method: request.m, body: structuredClone(request.b) });
      if (url === '/toolbox_talks' && request.m === 'POST') return [{ id: 'talk-1' }];
      return [];
    },
    Date, encodeURIComponent, parseInt
  });
  vm.runInContext(source, context);
  return { context, calls, messages, errors, work };
}

test('Work Schedule and standalone Toolbox Talk saves use separate handlers', () => {
  assert.match(index, /id="ws-tbt-form"[\s\S]*?data-auris-onclick="h0175"[\s\S]*?id="tbt-title"/);
  assert.match(index, /id="tbt-form"[\s\S]*?data-auris-onclick="h1264"[\s\S]*?id="tbtf-title"/);
  assert.match(handlers, /"h0175"[\s\S]*?wsSaveToolboxTalk\(\)/);
  assert.match(handlers, /"h1264"[\s\S]*?tbtSave\(\)/);
});

test('prefilled Work Schedule title saves the briefing and links it to its work order', async () => {
  const app = workspace();
  await app.context.wsSaveToolboxTalk();

  assert.deepEqual(app.errors, []);
  assert.equal(app.calls[0].url, '/toolbox_talks');
  assert.equal(app.calls[0].body.title, 'Toolbox Talk - Replace damaged guard');
  assert.equal(app.calls[0].body.tbt_ref, 'TBT-2026-001');
  assert.equal(app.calls[0].body.work_schedule_id, 'work-1');
  assert.equal(app.calls[0].body.status, 'completed');
  assert.equal(app.calls[0].body.attendees[0].name, 'Worker One');
  assert.equal(app.calls[1].url, '/work_schedule?id=eq.work-1');
  assert.equal(app.calls[1].body.toolbox_talk_id, 'talk-1');
  assert.match(app.calls[2].url, /^\/work_schedule_links\?/);
  assert.equal(app.work.toolbox_talk_id, 'talk-1');
  assert.match(app.messages[0].message, /completed and linked/);
});

test('embedded form validates its own visible title field', async () => {
  const app = workspace();
  app.context.document.getElementById('tbt-title').value = '   ';
  await app.context.wsSaveToolboxTalk();
  assert.equal(app.calls.length, 0);
  assert.equal(app.messages[0].message, 'Please enter a toolbox talk title');
});
