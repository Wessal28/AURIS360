const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const routes = [
  ['dashboard', 'Dashboard', 'cmu-view-dashboard', 'Register contractor'],
  ['contractor-register', 'Contractor Register', 'con-view-register', 'Register contractor'],
  ['qualification', 'Qualification', 'con-view-preassess', 'New pre-assessment'],
  ['work-packages', 'Work Packages', 'cmu-view-packages', 'New work package'],
  ['mobilisation', 'Mobilisation', 'cmu-view-mobilisation', 'New work package'],
  ['documents', 'Documents', 'cmu-view-documents', 'Add document reference'],
  ['performance', 'Performance', 'con-view-score', ''],
  ['evaluations', 'Evaluations', 'con-view-eval', 'New evaluation'],
  ['authorisations', 'Authorisations', 'con-view-atw', 'New authorisation'],
  ['incidents', 'Incidents', 'con-view-incidents', 'Report incident']
];

function fixture() {
  const nodes = new Map(), handlers = new Map(), denied = new Set(), calls = [];
  const html = read('index.html').split('<div id="page-contractor"')[1].split('<!-- end page-contractor -->')[0];
  let apiGate = null;
  function add(id) {
    const classes = new Set(), node = {
      id, style: {display: id === 'con-view-register' ? 'block' : 'none'}, dataset: {},
      hidden: false, options: [], classList: classes, addEventListener: (event, fn) => handlers.set(id + ':' + event, fn),
      closest: () => null,
      insertAdjacentHTML(_, markup) {registerIds(markup);}
    };
    classes.remove = name => classes.delete(name);
    Object.defineProperty(node, 'innerHTML', {
      get() {return this.html || '';},
      set(markup) {
        this.html = markup;
        if (id === 'cmu-page-select') {
          this.options = [...markup.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)]
            .map(match => ({value: match[1], textContent: match[2]}));
        }
      }
    });
    nodes.set(id, node);
    return node;
  }
  function registerIds(markup) {for (const [, id] of markup.matchAll(/\bid="([^"]+)"/g)) if (!nodes.has(id)) add(id);}
  registerIds(html);
  const oldTabs = add('cmu-legacy-tabs');
  const hero = add('hero'), primary = add('primary');
  nodes.get('con-tab-register').parentElement = oldTabs;
  const page = add('page-contractor');
  page.querySelector = selector => selector === '.page-header' ? hero : null;
  const context = {
    document: {
      body: {insertAdjacentHTML(_, markup) {registerIds(markup);}},
      getElementById: id => nodes.get(id),
      querySelector: selector => selector === '.cmu-hero .cmu-actions .primary' ? primary : null,
      querySelectorAll: selector => [...nodes.values()].filter(node =>
        selector.endsWith('.cmu-view') ? node.id.startsWith('cmu-view-') : node.id.startsWith('con-tab-'))
    },
    console, prof: {id: 'fictional-reviewer', role: 'manager'}, conAllData: [], ccid: () => 'fictional-company',
    cf: () => '&company_id=eq.fictional-company', isMgr: () => true,
    api: (request, options) => {
      assert.match(request, /[&?]company_id=eq\.fictional-company(?:&|$)/);
      assert.ok(!options || options.m === 'GET', 'Navigation is read-only');
      return apiGate || Promise.resolve([]);
    },
    AurisUserAccess: {
      sectionAllowed: (profile, module, id) => module === 'contractor' && !denied.has(id),
      firstSection: () => {throw Error('A forbidden route should not reach the legacy fallback');}
    },
    conLoadRegister: () => {calls.push('register'); return apiGate || Promise.resolve([]);},
    conLoadSafetyScore: () => calls.push('score'), cpaLoad: () => calls.push('preassess'),
    cevLoad: () => calls.push('eval'), catwLoad: () => calls.push('atw'), cirLoad: () => calls.push('incidents'),
    conNew: () => calls.push('new contractor')
  };
  context.window = context;
  const runtime = vm.createContext(context), core = read('auris-core.js');
  for (const [start, end] of [['async function loadContractors(', '// -- INVESTIGATION MODULE'], ['function conSwitchTab(', '// -- CONTRACTOR REGISTER']]) {
    const from = core.indexOf(start);
    vm.runInContext(core.slice(from, core.indexOf(end, from)), runtime);
  }
  vm.runInContext(read('contractor-management-upgrade.js'), runtime);
  return {
    context, primary, denied, nodes, calls,
    defer() {let finish; apiGate = new Promise(resolve => {finish = resolve;}); return () => {apiGate = null; finish([]);};},
    choose(key) {nodes.get('cmu-page-select').value = key; handlers.get('cmu-page-select:change')();}
  };
}

function assertRoute(f, route) {
  const [key, , target, action] = route;
  assert.equal(f.nodes.get('cmu-page-select').value, key);
  assert.deepEqual(routes.map(route => f.nodes.get(route[2])).filter(node => node.style.display === 'block').map(node => node.id), [target]);
  assert.equal(f.primary.hidden, !action);
  assert.equal(f.primary.innerHTML.replace(/<[^>]+>/g, ''), action);
}

test('Contractors opens all ten keyed destinations while first-entry data loads', async () => {
  const f = fixture(), finish = f.defer(), ready = f.context.loadContractors();
  const picker = f.nodes.get('cmu-page-select');
  assert.deepEqual(picker.options.map(option => [option.value, option.textContent]), routes.map(route => route.slice(0, 2)));
  assertRoute(f, routes[0]);
  for (const route of [routes[9], ...routes.slice(0, 9)]) {
    assert.notEqual(picker.value, route[0]);
    f.choose(route[0]);
    assertRoute(f, route);
  }
  assert.equal(f.calls.filter(call => call === 'register').length, 1, 'Register preload is shared during first entry');
  f.choose('documents');
  assert.match(f.nodes.get('cmu-view-documents').innerHTML, /Loading contractor records/);
  finish(); await ready;
  assertRoute(f, routes[5]);
  assert.match(f.nodes.get('cmu-view-documents').innerHTML, /Controlled contractor evidence/);
  assert.equal(f.primary.disabled, false);
  f.context.cmuPrimaryAction();
  assert.equal(f.nodes.get('cmu-drawer-title').textContent, 'Add contractor document reference');
  for (const key of ['work-packages', 'mobilisation']) {
    f.context.cmuCloseDrawer();
    f.choose(key);
    f.context.cmuPrimaryAction();
    assert.equal(f.nodes.get('cmu-drawer-title').textContent, 'New work package');
    assert.ok(f.nodes.get('cmu-drawer-bg').classList.has('open'));
  }
});

test('Contractors retains legacy callers and rejects unavailable destinations without changing the view', async () => {
  const f = fixture();
  f.denied.add('preassess');
  await f.context.loadContractors();
  assert.equal(f.nodes.get('cmu-page-select').options.some(option => option.value === 'qualification'), false);
  assert.equal(f.context.conSwitchTab('score'), true);
  assertRoute(f, routes[6]);
  assert.equal(f.context.cmuSwitch('packages'), true);
  assertRoute(f, routes[3]);
  f.choose('qualification');
  assertRoute(f, routes[3]);
  assert.equal(f.context.cmuSwitch('constructor'), false);
  assert.equal(f.context.cmuSwitch(undefined), false);
  assertRoute(f, routes[3]);
});
