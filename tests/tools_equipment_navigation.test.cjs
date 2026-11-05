const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const routes = [
  ['dashboard', 'Dashboard', 'teu-view-dashboard', /Work-readiness blockers/, ''],
  ['equipment-register', 'Equipment Register', 'tools-view-register', /Company [AB] equipment/, 'Add equipment'],
  ['issue-return', 'Issue & Return', 'teu-view-custody', /Issue, return and custody history/, 'Issue equipment'],
  ['pre-use-inspection', 'Pre-use & Inspection', 'tools-view-inspection', /Inspection Records/, 'Record inspection'],
  ['assurance', 'Assurance', 'teu-view-assurance', /Equipment assurance profiles/, 'Add assurance record'],
  ['maintenance-release', 'Maintenance & Release', 'teu-view-maintenance', /Maintenance and return to service/, 'New maintenance'],
  ['defects-quarantine', 'Defects & Quarantine', 'teu-view-defects', /Defects, quarantine and disposition/, 'Report defect'],
  ['personal-custody', 'Personal Custody', 'tools-view-personal', /Personal Tool Assignments/, ''],
  ['lifting-accessories', 'Lifting Accessories', 'tools-view-lifting', /Lifting Accessories Inspection/, 'Add lifting equipment'],
  ['statutory-verification', 'Statutory Verification', 'tools-view-statutory', /Statutory Verification Register/, ''],
  ['rcd-testing', 'RCD Testing', 'tools-view-rcd', /RCD Monthly Testing Register/, 'Add RCD / DB'],
];

// A small DOM fixture for the native select, shared header and lazy module. The
// application supplies both the legacy markup and the upgraded page markup.
function makeDom() {
  const frames = [], observers = [];
  const selectorCache = new Map();
  let records = [];
  const mutate = (type, attributeName) => records.push({type, attributeName});
  function match(node, {tag, tests}) {
    if (tag && node.tagName !== tag) return false;
    for (const [, id, name, attr, operator, value] of tests) {
      if (id && node.id !== id || name && !node.className.split(/\s+/).includes(name)) return false;
      if (attr) {
        const actual = node.getAttribute(attr);
        if (actual == null || operator === '=' && actual !== value || operator === '^=' && !actual.startsWith(value)) return false;
      }
    }
    return true;
  }
  function matches(node, selector) {
    if (!selectorCache.has(selector)) {
      selectorCache.set(selector, selector.split(/,\s*/).map(part => part.trim().split(/\s+(?![^\[]*\])/).reverse().map(component => ({
        tag: component.match(/^[\w-]+/)?.[0].toUpperCase(), tests: [...component.matchAll(/#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)],
      }))));
    }
    return selectorCache.get(selector).some(([target, ...ancestors]) => {
      if (!match(node, target)) return false;
      let ancestor = node.parentElement;
      return ancestors.every(name => {
        while (ancestor && !match(ancestor, name)) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
        return true;
      });
    });
  }
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.dataset = {};
      this.listeners = {};
      this._text = '';
      this._value = undefined;
      this.style = new Proxy({getPropertyValue(key) {return this[key] || '';}, removeProperty(key) {delete this[key]; mutate('attributes', 'style');}}, {
        set(target, key, value) {target[key] = value; mutate('attributes', 'style'); return true;},
      });
    }
    get id() {return this.getAttribute('id') || '';}
    set id(value) {this.setAttribute('id', value);}
    get className() {return this.getAttribute('class') || '';}
    set className(value) {this.setAttribute('class', value);}
    get classList() {
      const tokens = new Set(this.className.split(/\s+/).filter(Boolean));
      const toggle = (token, force = !tokens.has(token)) => {
        if (force) tokens.add(token); else tokens.delete(token);
        this.className = [...tokens].join(' ');
        return force;
      };
      return {contains: token => tokens.has(token), toggle, add: token => toggle(token, true), remove: token => toggle(token, false)};
    }
    get hidden() {return this.hasAttribute('hidden');}
    set hidden(value) {if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden');}
    get parentNode() {return this.parentElement;}
    get isConnected() {return this === document || !!this.parentElement?.isConnected;}
    get previousElementSibling() {return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null;}
    get options() {return this.children.filter(child => child.tagName === 'OPTION');}
    get selectedOptions() {return this.options.filter(option => option.value === this.value);}
    get value() {
      if (this.tagName === 'SELECT' && this._value === undefined) return (this.options.find(option => option.hasAttribute('selected')) || this.options[0])?.value || '';
      return this._value ?? this.getAttribute('value') ?? '';
    }
    set value(value) {this._value = this.tagName === 'SELECT' && !this.options.some(option => option.value === value) ? '' : value;}
    get textContent() {return this._text + this.children.map(child => child.textContent).join('');}
    set textContent(value) {this.replaceChildren(); this._text = String(value);}
    set innerHTML(markup) {this.replaceChildren(); parse(markup, this);}
    set outerHTML(markup) {this.insertAdjacentHTML('beforebegin', markup); this.remove();}
    insertAdjacentHTML(position, markup) {
      if (position === 'beforeend') return parse(markup, this);
      assert.equal(position, 'beforebegin');
      const fragment = new Element('fragment');
      parse(markup, fragment);
      for (const child of fragment.children.slice()) this.parentElement.insertBefore(child, this);
    }
    appendChild(child) {return this.insertBefore(child, null);}
    insertBefore(child, next) {
      child.remove(); child.parentElement = this;
      this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, child);
      mutate('childList');
      return child;
    }
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
      mutate('childList');
    }
    replaceChildren(...children) {
      this.children.forEach(child => {child.parentElement = null;});
      this.children = []; this._text = '';
      if (this.tagName === 'SELECT') this._value = undefined;
      children.forEach(child => this.appendChild(child));
      mutate('childList');
    }
    getAttribute(key) {return this.attributes.get(key) ?? null;}
    hasAttribute(key) {return this.attributes.has(key);}
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
      if (key === 'style') this.style.display = value.match(/(?:^|;)\s*display\s*:\s*([^;]+)/)?.[1].trim() || '';
      mutate('attributes', key);
    }
    removeAttribute(key) {if (this.attributes.delete(key)) mutate('attributes', key);}
    closest(selector) {return matches(this, selector) ? this : this.parentElement?.closest(selector) || null;}
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) {
      for (const child of this.children) {
        if (matches(child, selector)) return child;
        const result = child.querySelector(selector);
        if (result) return result;
      }
      return null;
    }
    getClientRects() {
      const cssHidden = this.classList.contains('page') && !this.classList.contains('active')
        || this.classList.contains('auris-tools-s-6aa34d7432') && !this.style.display
        || this.classList.contains('teu-view') && !this.classList.contains('active') && !this.style.display
        || this.classList.contains('auris-section-mirrored') || this.classList.contains('auris-section-tabs-hidden');
      return this.hidden || this.style.display === 'none' || cssHidden || this.parentElement && !this.parentElement.getClientRects().length ? [] : [{}];
    }
    addEventListener(type, handler) {(this.listeners[type] ||= []).push(handler);}
    dispatchEvent(event) {
      event.target ||= this;
      (this.listeners[event.type] || []).forEach(handler => handler.call(this, event));
      if (event.bubbles && !event.cancelBubble) this.parentElement?.dispatchEvent(event);
      return !event.defaultPrevented;
    }
    click() {this.dispatchEvent(new Event('click', {bubbles: true}));}
  }
  function parse(markup, parent) {
    const stack = [parent], voidTags = new Set(['AREA', 'BR', 'HR', 'IMG', 'INPUT', 'LINK', 'META']);
    for (const [token] of String(markup).matchAll(/<!--[\s\S]*?-->|<\/?[a-z][\w-]*(?:\s+[^<>]*?)?\s*\/?>|[^<]+/gi)) {
      if (token.startsWith('<!--')) continue;
      const container = stack.at(-1);
      if (!token.startsWith('<')) {container._text += token.replace(/&amp;/g, '&'); continue;}
      if (token.startsWith('</')) {if (stack.length > 1) stack.pop(); continue;}
      const [, tag, attrs] = token.match(/^<([\w-]+)([\s\S]*)>$/);
      const node = new Element(tag);
      for (const [, key, double, single, plain] of attrs.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) node.setAttribute(key, double ?? single ?? plain ?? '');
      container.appendChild(node);
      if (!voidTags.has(node.tagName) && !token.endsWith('/>')) stack.push(node);
    }
  }
  // VM events model browser bubbling without relying on the Node Event target.
  class Event {
    constructor(type, init = {}) {this.type = type; this.bubbles = !!init.bubbles;}
    preventDefault() {this.defaultPrevented = true;}
  }
  const document = new Element('document');
  document.documentElement = document;
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.querySelector('#' + id);
  document.readyState = 'complete';
  document.body = document.appendChild(new Element('body'));
  function flush() {
    for (let index = 0; index < 15; index++) {
      const batch = records;
      records = [];
      for (const {fn, config} of observers) if (batch.some(record => config[record.type] && (!record.attributeName || !config.attributeFilter || config.attributeFilter.includes(record.attributeName)))) fn();
      frames.splice(0).forEach(fn => fn());
      if (!records.length && !frames.length) return;
    }
    assert.fail('The page and section observers must settle');
  }
  return {document, Event, flush, requestAnimationFrame: fn => frames.push(fn), getComputedStyle: el => el.style, MutationObserver: class {constructor(fn) {this.fn = fn;} observe(_, config) {observers.push({fn: this.fn, config});}}};
}

function fixture() {
  const dom = makeDom(), doc = dom.document, get = id => doc.getElementById(id);
  const html = read('index.html'), start = html.indexOf('<div id="page-tools"'), end = html.indexOf('<!-- end page-tools -->', start);
  assert.ok(start >= 0 && end > start);
  doc.body.innerHTML = '<div id="app"><div><span id="auris-module-name"></span><span id="auris-module-crumb"></span><label id="auris-module-section-wrap" hidden><select id="auris-module-section"></select></label></div><div id="page-dashboard" class="page active"></div>' + html.slice(start, end) + '</div>';
  const ctx = vm.createContext({...dom, console, MODULES_DIR: [{k: 'tools', l: 'Tools & Equipment'}], isMgr: () => true, toolsAllData: [], toast() {}, prof: {id: 'reviewer', role: 'manager'}, innerWidth: 1200});
  ctx.window = ctx;
  ctx.activeRole = () => ctx.prof.role;
  ctx._authSessionGeneration = 1;
  const mirror = get('auris-module-section'), wrapper = get('auris-module-section-wrap'), tools = get('page-tools');
  let company = 'A', reads = [], gate, calls = [];
  ctx.ccid = () => company;
  ctx.cf = () => '&company_id=eq.' + company;
  ctx.api = (url, options) => {
    assert.ok(!options || options.m === 'GET', 'Navigation must not modify records');
    assert.match(url, new RegExp('company_id=eq\\.' + company + '(?:&|$)'));
    reads.push({url, company});
    return gate || Promise.resolve([]);
  };
  const loaders = ['Register', 'Personal', 'Inspections', 'LiftingAccessories', 'Statutory', 'Vehicles', 'RCD'];
  for (const suffix of loaders) ctx['toolsLoad' + suffix] = () => {
    if (suffix === 'Register') get('tools-register-list').textContent = 'Company ' + company + ' equipment';
  };
  ctx.toolsNew = () => calls.push('register');
  ctx.toolsNewInspection = () => calls.push('inspection');
  ctx.toolsNewLiftingAccessory = () => calls.push('lifting');
  ctx.toolsNewRCD = () => calls.push('rcd');
  ctx.toolsRenderInspections = () => {};
  const core = read('auris-core.js');
  const legacySwitch = core.indexOf('function toolsSwitchTab(');
  vm.runInContext(core.slice(legacySwitch, core.indexOf('// -- REGISTER', legacySwitch)), ctx);
  Object.assign(ctx, {toolsRcdData: [], toolsRcdTests: [], toolsIsRCD: () => true});
  vm.runInContext(core.slice(core.indexOf('async function toolsLoadRCD('), core.indexOf('function toolsRCDPrintShell(')), ctx);
  for (const name of ['activatePageNavigation', 'closeTransientOverlays', 'peopleCloseProfile', 'usersCloseModal', 'peopleFormVisible']) ctx[name] = () => {};
  ctx.canAccessPage = () => true;
  ctx.moduleLoaderFor = () => () => ctx.loadTools();
  vm.runInContext(core.slice(core.indexOf('function showPage(name,el)'), core.indexOf('function toggleForm(id)')), ctx);
  const load = file => vm.runInContext(read(file), ctx, {filename: file});
  load('auris-user-access.js');
  load('auris-section-picker.js');
  load('auris-universal-header.js');
  load('auris-module-event-handlers-batch-3.js');
  load('auris-static-event-handlers.js');
  dom.flush();
  function exposeToolsPage() {
    get('page-dashboard').classList.remove('active');
    tools.classList.add('active');
    dom.flush();
  }
  function choose(label) {
    const option = mirror.options.find(node => node.textContent === label);
    assert.ok(option, 'Missing route for ' + label);
    mirror.value = option.value;
    mirror.dispatchEvent(new dom.Event('change', {bubbles: true}));
    dom.flush();
  }
  return {...dom, ctx, get, load, mirror, wrapper, tools, exposeToolsPage, choose, reads, calls,
    deferLoads() {let release; gate = new Promise(resolve => {release = resolve;}); return () => {gate = null; release([]);};},
    switchCompany() {company = 'B'; return ctx.showPage('tools', null);},
  };
}

const clean = value => value.replace(/\s+/g, ' ').trim();
function assertRoute(f, [key, label, viewId, content, action], loading = false) {
  assert.equal(f.mirror.value, key, 'Selected route');
  assert.equal(f.get('teu-page-select').value, key, 'Module route');
  assert.equal(f.get('auris-module-crumb').textContent, ' / Tools & Equipment / ' + label);
  const visibleViews = f.tools.querySelectorAll('[id^="tools-view-"],[id^="teu-view-"]').filter(view => view.getClientRects().length);
  assert.deepEqual(visibleViews.map(view => view.id), [viewId]);
  assert.match(clean(visibleViews[0].textContent), loading && viewId.startsWith('teu-view-') ? /Loading equipment records/ : content);
  const primary = f.tools.querySelector('.teu-hero .teu-actions .primary');
  if (key === 'rcd-testing') {
    const add = f.tools.querySelectorAll('button').filter(button => /^Add RCD(?: \/ DB)?$/.test(clean(button.textContent)) && button.getClientRects().length);
    assert.deepEqual(add.map(button => clean(button.textContent)), [action]);
    add[0].click();
    assert.equal(f.calls.at(-1), 'rcd');
  } else {
    assert.equal(primary?.getClientRects().length ? clean(primary.textContent) : '', action);
    if (action && !loading) {
      primary.click();
      const legacyAction = {'equipment-register': 'register', 'pre-use-inspection': 'inspection', 'lifting-accessories': 'lifting'}[key];
      if (legacyAction) assert.equal(f.calls.at(-1), legacyAction);
      else {
        assert.equal(f.get('teu-drawer-bg').classList.contains('open'), true);
        assert.equal(f.get('teu-drawer-title').textContent, action);
        f.ctx.teuCloseDrawer();
      }
    }
  }
}

function assertMenu(f) {
  assert.equal(f.wrapper.hidden, false);
  assert.equal(f.tools.querySelectorAll('.auris-section-picker').length, 1);
  assert.deepEqual(f.mirror.options.map(option => [option.value, option.textContent]), routes.map(([key, label]) => [key, label]));
}

function verifyEveryRoute(f, loading = false) {
  // Start on RCD to reproduce the original wrong-register case. Then visit
  // every destination from a different page, including the return to RCD.
  if (f.mirror.value !== 'rcd-testing') f.choose('RCD Testing');
  const transitions = [routes[1], routes[0], ...routes.slice(2)];
  for (const route of transitions) {
    assert.notEqual(f.mirror.value, route[0]);
    f.choose(route[1]);
    assertRoute(f, route, loading);
  }
}

test('Tools shows one stable set of keyed routes as soon as the lazy shell is ready', async () => {
  const f = fixture();
  f.exposeToolsPage();
  assert.equal(f.wrapper.hidden, true, 'Do not expose the six legacy routes during lazy loading');
  assert.equal(f.tools.querySelectorAll('.auris-section-picker').length, 0);
  const release = f.deferLoads();
  f.load('tools-equipment-upgrade.js');
  const ready = f.ctx.showPage('tools', null);
  f.flush();
  assertMenu(f);
  assertRoute(f, routes[0], true);
  verifyEveryRoute(f, true);
  f.choose('Lifting Accessories');
  assertRoute(f, routes[8]);
  release(); await ready; f.flush();
  assertMenu(f);
  assertRoute(f, routes[8]);
});

test('all eleven Tools routes match the selected option, breadcrumb, page and action before and after a company switch', async () => {
  const f = fixture();
  f.exposeToolsPage();
  f.load('tools-equipment-upgrade.js');
  await f.ctx.showPage('tools', null); f.flush();
  assertMenu(f);
  verifyEveryRoute(f);
  const release = f.deferLoads(), switchReady = f.switchCompany();
  f.flush();
  assertMenu(f);
  assertRoute(f, routes[10]);
  verifyEveryRoute(f, true);
  f.choose('Equipment Register');
  release(); await switchReady; f.flush();
  assertMenu(f);
  assertRoute(f, routes[1]);
  assert.match(f.get('tools-register-list').textContent, /Company B equipment/);
  assert.deepEqual([...new Set(f.reads.map(read => read.company))], ['A', 'B']);
  verifyEveryRoute(f);
  await f.ctx.toolsLoadRCD(); f.flush();
  assert.match(f.get('tools-rcd-list').textContent, /No RCDs registered yet/);
  assertRoute(f, routes[10]);
});

test('the shared dropdown sends changes to the visible picker it mirrored', () => {
  const f = fixture();
  f.get('page-dashboard').innerHTML = '<div hidden><label class="auris-section-picker"><select id="legacy-picker"><option value="dashboard">Old dashboard</option><option value="records">Old records</option></select></label></div><div><label class="auris-section-picker"><select id="current-picker"><option value="dashboard">Dashboard</option><option value="records">Saved records</option></select></label></div>';
  const changes = [];
  for (const id of ['legacy-picker', 'current-picker']) f.get(id).addEventListener('change', () => changes.push(id));
  f.flush();
  f.choose('Saved records');
  assert.deepEqual(changes, ['current-picker']);
  assert.equal(f.get('legacy-picker').value, 'dashboard');
  assert.equal(f.get('current-picker').value, 'records');
  assert.equal(f.mirror.value, 'records');
});
