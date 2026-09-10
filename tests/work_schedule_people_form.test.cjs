const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = fs.readFileSync(path.resolve(__dirname, '..', 'auris-core.js'), 'utf8');
const source = core.slice(
  core.indexOf('async function wsEnsureWorkOrderPeople()'),
  core.indexOf('function wsPopulateTeamSelect', core.indexOf('async function wsEnsureWorkOrderPeople()'))
);

function harness({ initial = [], loaded = [], switchCompany = false } = {}) {
  let company = 'company-1';
  let people = initial;
  let loads = 0;
  const messages = [];
  const select = {
    _options: [], _value: '',
    set innerHTML(_value) { this._options = [{ value: '', textContent: 'Select supervisor...' }]; this._value = ''; },
    get options() { return this._options; },
    appendChild(option) { this._options.push(option); },
    set value(value) { this._value = this._options.some((option) => String(option.value) === String(value)) ? value : ''; },
    get value() { return this._value; }
  };
  const context = vm.createContext({
    ccid: () => company,
    tenantPeople: () => people,
    loadPeopleCache: async () => { loads += 1; people = loaded; if (switchCompany) company = 'company-2'; },
    toast: (message, success) => messages.push({ message, success }),
    document: {
      getElementById: (id) => id === 'wsf-supervisor' ? select : null,
      createElement: () => ({ value: '', textContent: '', disabled: false })
    },
    String
  });
  vm.runInContext(source, context);
  return { context, select, messages, loads: () => loads };
}

test('work-order form refreshes empty people cache before populating supervisors', async () => {
  const app = harness({ loaded: [{ id: 'person-1', company_id: 'company-1', first_name: 'Wesley', last_name: 'Salomon', job_title: 'Supervisor', status: 'active' }] });
  assert.equal(await app.context.wsEnsureWorkOrderPeople(), true);
  app.context.wsPopulateSupervisorSelect('', '');
  assert.equal(app.loads(), 1);
  assert.equal(app.select.options[1].value, 'person-1');
  assert.match(app.select.options[1].textContent, /Salomon, Wesley - Supervisor/);
});

test('editing retains a saved supervisor who is no longer in the active people list', () => {
  const app = harness();
  app.context.wsPopulateSupervisorSelect('person-old', 'Former Supervisor');
  assert.equal(app.select.value, 'person-old');
  assert.equal(app.select.options[1].textContent, 'Former Supervisor (saved)');
});

test('company change while people load blocks the work-order form', async () => {
  const app = harness({ switchCompany: true });
  assert.equal(await app.context.wsEnsureWorkOrderPeople(), false);
  assert.equal(app.messages.length, 1);
  assert.match(app.messages[0].message, /Company changed while loading people/);
});
