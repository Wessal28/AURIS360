const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = fs.readFileSync(path.join(__dirname, '..', 'auris-core.js'), 'utf8');
function between(start, end) {
  const a = core.indexOf(start), b = core.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing authentication boundary: ' + start);
  return core.slice(a, b);
}
const source = [
  between('// -- Auth state', 'async function authLoadCompanyDropdown'),
  between('async function loadProf(', 'function pwChangeShow('),
].join('\n');

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const companyId = '33333333-3333-4333-8333-333333333333';
const user = {id: userId, email: 'workspace-user@example.test'};
const company = {id: companyId, name: 'Fictional Engineering'};
const profile = {id: userId, company_id: companyId, companies: company, role: 'admin', status: 'active', full_name: 'Fictional User', email: user.email};
function session(overrides = {}) {
  return {access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at: Date.now()/1000 + 3600, ...overrides};
}

function harness(stored = session({user_id: userId})) {
  const nodes = new Map(), storage = new Map(), paints = [], calls = [], timers = [], requests = [];
  let profileRead = async () => [profile], authUserRead = async () => user, reloads = 0;
  function element(id) {
    const classes = new Set(), attrs = new Map();
    return {
      id, value: '', textContent: '', innerHTML: '', dataset: {}, style: {}, hidden: false, disabled: false,
      classList: {
        add(...names) { for (const name of names) { classes.add(name); if (id === 'app' && /auris-display-(?:block|flex)/.test(name)) paints.push('workspace'); } },
        remove(...names) { for (const name of names) classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const enabled = force ?? !classes.has(name); if (enabled) classes.add(name); else classes.delete(name); return enabled; },
      },
      setAttribute(key, value) { attrs.set(key, String(value)); }, getAttribute: key => attrs.get(key), removeAttribute: key => attrs.delete(key),
      addEventListener() {}, appendChild() {}, insertAdjacentElement() {}, querySelector() { return null; }, focus() {},
    };
  }
  function node(id) { if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); }
  if (stored) storage.set('auris360_session', JSON.stringify(stored));
  node('app').classList.add('auris-display-none');
  node('login-email').value = user.email;
  node('login-pw').value = 'fictional-password';
  node('sb-user').textContent = '-';
  node('sb-role').textContent = '-';
  node('sb-company').textContent = 'AURIS360';
  const c = {
    tok: null, prof: null, co: null, rolePreview: null, people: [], sephsCompanyContext: null, saCompanyList: [],
    AURIS_RUNTIME_CONFIG_READY: true, SB: 'https://auth.fixture.test', KEY: 'fixture-public-key',
    URL, URLSearchParams, Date, atob, AbortController, navigator: {},
    console: {error() {}, warn() {}, log() {}},
    location: {pathname: '/', search: '', hash: '', reload() { reloads++; }}, history: {replaceState() {}},
    document: {getElementById: node, createElement: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element('body')},
    addEventListener() {},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)},
    setTimeout(fn, delay) { const timer = {fn, delay, cleared: false}; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    fetch: async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      requests.push({pathname, method: options.method || 'GET', authorized: options.headers?.Authorization === 'Bearer fixture-access'});
      assert.equal(pathname, '/auth/v1/user', 'Only legacy identity verification may call Auth in this test');
      const response = await authUserRead();
      if (response && response.ok === false) return response;
      return {ok: true, status: 200, json: async () => response};
    },
    authQ: async () => session({user}),
    authLoadCompanyDropdown() {},
    api: async (route, opts = {}) => {
      const url = new URL(route, 'https://db.fixture.test');
      calls.push({route: url.pathname, id: url.searchParams.get('id'), method: opts.m || 'GET'});
      if (url.pathname === '/profiles' && (!opts.m || opts.m === 'GET')) {
        if (url.searchParams.get('select') !== '*,companies:companies!profiles_company_id_fkey(*)') {
          throw Object.assign(new Error('The profiles–companies relationship is ambiguous without the owning-company foreign key'), {code: 'PGRST201'});
        }
        return profileRead(url, opts);
      }
      return [];
    },
    loadRolloutRuntimeConfig: async () => {},
    applyRoles() { calls.push('roles'); },
    sidebarApplyState() {}, sidebarGetState() {}, devModeUpdateUI() {}, sbInitRoleSelect() {},
    isPersonalDashRole: () => false, isSA: () => false, activeRole: () => c.prof?.role || 'employee',
    ccid: () => c.prof?.company_id,
    Brand: {loadFromCompany() {}, reset() {}}, sidebarApplyCompanyLogo() {}, myProfileRenderAvatar() {}, myProfileOpenDialog() {},
    dashRouteView() {}, dashRenderControlCentre() {}, saCompanyInit: async () => {}, workflowHydrateTenant: async () => {},
    loadPeopleCache: async () => {}, loadLocationSitesCache: async () => {}, loadDash: async () => { calls.push('dashboard'); },
    genDashAI() {}, auditLogEvent() {}, deepLinkScheduleResume() {}, wsFinishWindowLoading() {},
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(source, c, {filename: 'auris-core.js (authentication)'});
  return {
    c, node, paints, calls, requests, timers,
    readProfile(fn) { profileRead = fn; }, readAuthUser(fn) { authUserRead = fn; },
    stored: () => JSON.parse(storage.get('auris360_session') || 'null'), reloads: () => reloads,
  };
}
function profileReads(h) { return h.calls.filter(call => call?.route === '/profiles' && call.method === 'GET'); }
function assertRecovery(h) {
  assert.deepEqual(h.paints, [], 'The unverified workspace must never be exposed, even briefly');
  assert.equal(h.node('app').classList.contains('auris-display-none'), true);
  assert.equal(h.node('login-screen').classList.contains('auris-display-flex'), true);
  assert.match(h.node('login-err').textContent, /profile|account|workspace|connection|sign in|session/i);
  assert.equal(h.node('login-panels').inert, false, 'Sign-in or recovery controls must be available');
  assert.equal(h.calls.includes('roles'), false);
  assert.equal(h.calls.includes('dashboard'), false);
  assert.equal(h.calls.some(call => call?.method && call.method !== 'GET'), false);
  assert.equal(h.c.prof, null);
  assert.equal(h.reloads(), 0);
}

for (const [label, result] of [
  ['a missing record', []],
  ['a mismatched identity', [{...profile, id: otherId}]],
  ['an inactive account', [{...profile, status: 'inactive'}]],
  ['a suspended account', [{...profile, status: 'suspended'}]],
]) {
  test('loadProf rejects '+label+' without publishing account data', async () => {
    const h = harness();
    h.readProfile(async () => result);
    await assert.rejects(h.c.loadProf(userId), /profile|account|access/i);
    assert.equal(h.c.prof, null);
    assert.equal(h.c.co, null);
    assert.equal(h.node('sb-user').textContent, '-');
  });
}

test('a stored ID is never accepted with a mismatching returned profile', async () => {
  const h = harness(session({user_id: otherId}));
  h.readProfile(async () => [profile]);
  await h.c.authInitSession();
  assertRecovery(h);
  assert.deepEqual(profileReads(h).map(call => call.id), ['eq.' + otherId]);
  assert.equal(h.stored()?.user_id, otherId);
});

test('an existing signed-in profile can still reload itself without an explicit ID', async () => {
  const h = harness();
  h.c.prof = {...profile, full_name: 'Previous name'};
  await h.c.loadProf();
  assert.deepEqual(profileReads(h).map(call => call.id), ['eq.' + userId]);
  assert.equal(h.c.prof.full_name, profile.full_name);
});

for (const entry of ['stored', 'fresh']) {
  test(entry+' authentication keeps the workspace hidden until profile verification completes', async () => {
    const h = harness(entry === 'fresh' ? null : undefined);
    let releaseProfile, enterProfile;
    const requested = new Promise(resolve => { enterProfile = resolve; });
    h.readProfile(() => { enterProfile(); return new Promise(resolve => { releaseProfile = resolve; }); });
    const start = entry === 'fresh' ? h.c.doLogin() : h.c.authInitSession();
    await Promise.race([requested, start]);
    assert.equal(typeof releaseProfile, 'function');
    assert.deepEqual(h.paints, []);
    assert.equal(h.calls.includes('dashboard'), false);
    assert.equal(h.calls.some(call => call?.method && call.method !== 'GET'), false);
    releaseProfile([profile]);
    await start;
    assert.deepEqual(h.paints, ['workspace']);
    assert.equal(h.c.prof?.id, userId);
    assert.equal(h.c.co?.id, companyId);
    assert.equal(h.node('sb-user').textContent, profile.full_name);
    assert.equal(h.node('sb-company').textContent, company.name);
    assert.equal(h.calls.filter(call => call === 'dashboard').length, 1);
    assert.equal(profileReads(h).length, 1);
  });

  test(entry+' authentication recovers from a profile API failure without opening the shell', async () => {
    const h = harness(entry === 'fresh' ? null : undefined);
    h.readProfile(async () => { throw Error('Fictional connection failure'); });
    if (entry === 'fresh') await h.c.doLogin(); else await h.c.authInitSession();
    assertRecovery(h);
    assert.equal(profileReads(h).length, 1);
    assert.equal(h.stored()?.access_token, 'fixture-access', 'Transient profile failure must preserve the stored token');
    assert.equal(h.node('auth-retry-workspace').classList.contains('auris-display-block'), true, 'Retry Workspace must remain visible for a retained session');
    assert.equal(h.timers.some(timer => !timer.cleared && timer.delay === 12000), false, 'Loading indicator must not continue after recovery');
    h.readProfile(async () => [profile]);
    await h.c.authInitSession();
    assert.deepEqual(h.paints, ['workspace']);
    assert.equal(h.c.prof?.id, userId);
    assert.equal(profileReads(h).length, 2, 'An explicit retry should perform a fresh profile read');
    assert.equal(h.calls.filter(call => call === 'dashboard').length, 1);
  });
}

test('an old stored session without a usable user ID resolves identity through Auth before reading its profile', async () => {
  const h = harness(session({user: null}));
  await h.c.authInitSession();
  assert.deepEqual(h.requests, [{pathname: '/auth/v1/user', method: 'GET', authorized: true}]);
  assert.deepEqual(profileReads(h).map(call => call.id), ['eq.' + userId]);
  assert.equal(h.stored()?.user_id, userId, 'Successful verification repairs the legacy session record');
  assert.equal(h.c.prof?.id, userId);
  assert.deepEqual(h.paints, ['workspace']);
});

test('failed verification of an old session leaves the shell hidden and does not query an undefined profile', async () => {
  const h = harness(session({user: null}));
  h.readAuthUser(async () => { throw Error('Fictional Auth connection failure'); });
  await h.c.authInitSession();
  assertRecovery(h);
  assert.equal(profileReads(h).length, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.stored()?.access_token, 'fixture-access');
});

test('an invite verifies the Auth identity and exact active profile before flagging password setup or opening the workspace', async () => {
  for (const status of ['active', 'inactive']) {
    const h = harness(null), order = [];
    h.c.location.hash = '#type=invite&access_token=fixture-access&refresh_token=fixture-refresh';
    h.readAuthUser(async () => { order.push('verified Auth user'); return user; });
    h.readProfile(async url => {
      assert.equal(url.searchParams.get('id'), 'eq.' + userId);
      order.push('exact profile');
      return [{...profile, status}];
    });
    const api = h.c.api;
    h.c.api = async (route, opts) => {
      if (opts?.m === 'PATCH' && opts.b?.must_change_password === true) {
        assert.equal(new URL(route, 'https://db.fixture.test').searchParams.get('id'), 'eq.' + userId);
        assert.deepEqual(h.paints, [], 'The workspace remains hidden while password setup is flagged');
        order.push('password setup flag');
      }
      return api(route, opts);
    };
    await h.c.authInitSession();
    assert.deepEqual(h.requests, [{pathname: '/auth/v1/user', method: 'GET', authorized: true}]);
    if (status === 'inactive') {
      assertRecovery(h);
      assert.deepEqual(order, ['verified Auth user', 'exact profile']);
    } else {
      assert.deepEqual(order, ['verified Auth user', 'exact profile', 'password setup flag']);
      assert.deepEqual(h.paints, ['workspace']);
      assert.equal(h.c.prof?.id, userId);
      assert.equal(h.c.prof?.must_change_password, true);
      assert.equal(h.stored()?.user_id, userId);
    }
  }
});

test('a stalled profile request aborts and leaves recovery available without a retry loop', async () => {
  const h = harness();
  let requested, signal;
  const profileRequested = new Promise(resolve => { requested = resolve; });
  h.readProfile((_url, options) => {
    signal = options.signal;
    requested();
    return new Promise((_resolve, reject) => {
      if (signal) signal.addEventListener('abort', () => reject(Object.assign(Error('Request aborted'), {name: 'AbortError'})), {once: true});
    });
  });
  const start = h.c.authInitSession();
  await Promise.race([profileRequested, start]);
  assert.ok(signal, 'The profile read must be abortable');
  const deadline = h.timers.find(timer => !timer.cleared && timer.delay === 15000);
  assert.ok(deadline, 'A bounded profile load should have a deadline');
  deadline.fn();
  await start;
  assert.equal(signal.aborted, true);
  assertRecovery(h);
  assert.equal(profileReads(h).length, 1);
  assert.equal(h.stored()?.user_id, userId);
  assert.equal(h.timers.some(timer => timer !== deadline && !timer.cleared && timer.delay <= 15000), false);
});

test('a refreshed session returned in the stored shape still opens the exact verified profile', async () => {
  const h = harness(session({expires_at: 1, user_id: userId}));
  h.c.authRefreshSession = async () => session({user_id: userId});
  await h.c.authInitSession();
  assert.deepEqual(h.paints, ['workspace']);
  assert.deepEqual(profileReads(h).map(call => call.id), ['eq.' + userId]);
  assert.equal(h.c.prof?.id, userId);
  assert.equal(h.calls.filter(call => call === 'dashboard').length, 1);
});

test('an expired session without a refresh token returns to usable sign-in controls', async () => {
  const h = harness(session({expires_at: 1, refresh_token: null, user_id: userId}));
  await h.c.authInitSession();
  assertRecovery(h);
  assert.equal(h.stored(), null);
  assert.equal(h.node('auth-retry-workspace').classList.contains('auris-display-block'), false);
  assert.equal(profileReads(h).length, 0);
});
