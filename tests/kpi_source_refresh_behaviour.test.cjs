const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'kpi-data-source.js'), 'utf8');

function harness(options = {}) {
  let now = new Date(2026, 8, 8, 12).getTime();
  let company = 'company-a';
  const year = {value: '2026'};
  const calls = [], warnings = [], notices = [], handlers = {};
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = {Date: Clock, console: {warn: (...args) => warnings.push(args)}, setTimeout,
    navigator: {onLine: true}, prof: {id: 'user-a', role: 'sephs_admin'}, ccid: () => company,
    activeRole: () => context.prof.role, canAccessPage: () => true,
    document: {readyState: 'loading', addEventListener: (name, handler) => {handlers[name] = handler;}, getElementById: id => id === 'year-sel' ? year : null},
    kpiConfigPublished: {sources: {refresh_frequency: options.frequency || 'real_time'}},
    kpiKPIs: [{id: 'kpi-a', company_id: company, year: 2026, approval_status: 'draft'}],
    kpiIndicators: [{id: 'indicator-a', kpi_id: 'kpi-a', company_id: company, source_mode: 'module', source_metric: 'toolbox.completed', source_revision: 1}],
    kpiMonthlyData: {}, kpiXRenderAll: () => { context.renders++; }, renders: 0,
    toast: (message, ok) => notices.push({message, ok}), kpiLoadAll: options.load || (async () => {})};
  function saved(body, extra = {}) { return Object.assign({id: 'result-a', company_id: body.p_company_id, kpi_id: 'kpi-a', indicator_id: body.p_indicator_id, year: body.p_year, month: body.p_month, actual: 0, entry_mode: 'automatic', calculated_at: new Clock().toISOString(), source_metric: 'toolbox.completed', source_evidence: {source_revision: body.p_expected_source_revision}}, extra); }
  context.api = async (url, request) => {calls.push({url, request}); return options.reply ? options.reply(request.b, saved) : saved(request.b);};
  context.window = context;
  vm.createContext(context);
  if (options.lexicalProfile) vm.runInContext('let prof=window.prof; delete window.prof; window.activeRole=()=>prof.role;',context);
  vm.runInContext(source, context);
  return {context, year, calls, warnings, notices, saved, install: () => handlers.DOMContentLoaded(), run: () => context.KpiDataSources.autoRefreshCurrent(), advance: ms => {now += ms;}, switchCompany(value) {company = value;}, existing(extra = {}) {context.kpiMonthlyData['indicator-a'] = {9: saved({p_company_id: company, p_indicator_id: 'indicator-a', p_year: 2026, p_month: 9, p_expected_source_revision: 1}, extra)};}};
}

test('on-load refresh honors zero interval and accepts an actual value of zero', async () => {
  const h = harness(); h.existing(); await h.run();
  assert.equal(h.calls.length, 1); assert.equal(h.context.kpiMonthlyData['indicator-a'][9].actual, 0);
});
test('automatic refresh supports the production lexical profile', async () => {
  const h=harness({lexicalProfile:true});assert.equal(h.context.prof,undefined);await h.run();assert.equal(h.calls.length,1);
});
test('hourly mode can refresh again after the interval in the same session', async () => {
  const h = harness({frequency: 'hourly'}); await h.run(); h.advance(3600001); await h.run();
  assert.equal(h.calls.length, 2);
});
test('a transient failure may retry after bounded backoff', async () => {
  let fail = true; const h = harness({reply(body, saved) {if (fail) {fail = false; throw new Error('Network unavailable');} return saved(body);}});
  await h.run(); await h.run(); assert.equal(h.calls.length, 1);
  h.advance(60001); await h.run(); assert.equal(h.calls.length, 2);
});
test('historical and future reporting years do not generate automatic records', async () => {
  for (const value of ['2025', '2027']) {const h = harness(); h.year.value = value; h.context.kpiKPIs[0].year = Number(value); await h.run(); assert.equal(h.calls.length, 0);}
});
test('manual overrides are never silently overwritten by automatic load', async () => {
  const h = harness(); h.existing({entry_mode: 'override', actual: 12, calculated_at: null}); await h.run();
  assert.equal(h.calls.length, 0); assert.equal(h.context.kpiMonthlyData['indicator-a'][9].actual, 12);
});
test('a response from the previous company cannot populate current data', async () => {
  let resolve; const h = harness({reply: body => new Promise(done => {resolve = () => done(h.saved(body));})});
  const pending = h.run(); h.switchCompany('company-b'); h.context.kpiMonthlyData = {}; resolve(); await pending;
  assert.deepEqual(h.context.kpiMonthlyData, {}); assert.equal(h.context.renders, 0);
});
test('a response for the previous reporting year cannot populate the selected year', async () => {
  let resolve; const h = harness({reply: body => new Promise(done => {resolve = () => done(h.saved(body));})});
  const pending = h.run(); h.year.value = '2025'; resolve(); await pending;
  assert.equal(h.context.kpiMonthlyData['indicator-a'], undefined); assert.equal(h.context.renders, 0);
});
test('wrong-company result is rejected and disclosed', async () => {
  const h = harness({reply: (body, saved) => saved(body, {company_id: 'company-b'})}); await h.run();
  assert.equal(h.context.kpiMonthlyData['indicator-a'], undefined); assert.ok(h.notices.some(x => x.ok === false));
});
test('hourly/daily/monthly and unknown intervals suppress fresh calculations', async () => {
  for (const frequency of ['hourly', 'daily', 'monthly', 'unknown']) {const h = harness({frequency}); h.existing(); await h.run(); assert.equal(h.calls.length, 0);}
});
test('invalid timestamps and changed mapping revisions require a new calculation', async () => {
  for (const extra of [{calculated_at: 'invalid'}, {source_evidence: {source_revision: 0}}, {source_metric: 'events.reported'}]) {const h = harness({frequency: 'daily'}); h.existing(extra); await h.run(); assert.equal(h.calls.length, 1);}
});
test('concurrent refreshes send only one request per indicator', async () => {
  let resolve; const h = harness({reply: body => new Promise(done => {resolve = () => done(h.saved(body));})});
  const pending = h.run(); await h.run(); assert.equal(h.calls.length, 1); resolve(); await pending;
});
test('empty, multiple, mismatched, or malformed results never count as success', async () => {
  for (const reply of [(b,s)=>[], (b,s)=>[s(b),s(b)], (b,s)=>s(b,{year:2025}), (b,s)=>s(b,{month:8}), (b,s)=>s(b,{indicator_id:'other'}), (b,s)=>s(b,{source_evidence:{source_revision:2}}), (b,s)=>s(b,{actual:false}), (b,s)=>s(b,{actual:'  '}), (b,s)=>s(b,{calculated_at:null})]) {
    const h = harness({reply}); await h.run(); assert.equal(h.context.kpiMonthlyData['indicator-a'], undefined); assert.equal(h.notices.length, 1);
  }
});
test('signed-out, read-only, denied, and offline contexts issue no write', async () => {
  for (const mutate of [h=>{h.context.prof.id=null;}, h=>{h.context.prof.role='employee';}, h=>{h.context.canAccessPage=()=>false;}, h=>{h.context.navigator.onLine=false;}]) {const h=harness();mutate(h);await h.run();assert.equal(h.calls.length,0);}
});
test('missing or wrong tenant parents and unsupported mappings issue no write', async () => {
  for (const mutate of [h=>{h.context.kpiKPIs=[];},h=>{h.context.kpiKPIs[0].company_id='other';},h=>{h.context.kpiIndicators[0].company_id='other';},h=>{h.context.kpiIndicators[0].source_metric='arbitrary.table';}]) {const h=harness();mutate(h);await h.run();assert.equal(h.calls.length,0);}
});
test('same IDs in a new company are not suppressed by the former company retry', async () => {
  const h=harness({reply(){throw new Error('Transient');}}); await h.run(); h.switchCompany('company-b'); h.context.kpiKPIs[0].company_id='company-b';h.context.kpiIndicators[0].company_id='company-b';await h.run();assert.equal(h.calls.length,2);
});
test('newer local edits or overrides survive an in-flight refresh', async () => {
  let resolve; const h=harness({reply:body=>new Promise(done=>{resolve=()=>done(h.saved(body));})});h.existing({actual:7});
  const pending=h.run();h.context.kpiMonthlyData['indicator-a'][9].actual=12;h.context.kpiMonthlyData['indicator-a'][9].entry_mode='override';resolve();await pending;
  assert.equal(h.context.kpiMonthlyData['indicator-a'][9].actual,12);assert.equal(h.context.renders,0);
});
test('changed role, mapping or replaced data rejects a pending response', async () => {
  for(const mutate of [h=>{h.context.prof.role='employee';},h=>{h.context.kpiIndicators[0].source_revision=2;},h=>{h.context.kpiMonthlyData={};}]){
    let resolve;const h=harness({reply:body=>new Promise(done=>{resolve=()=>done(h.saved(body));})});const pending=h.run();mutate(h);resolve();await pending;assert.equal(h.context.kpiMonthlyData['indicator-a'],undefined);assert.equal(h.context.renders,0);
  }
});
test('sequential batch stops before its next write when company changes', async () => {
  let resolve;const h=harness({reply:body=>new Promise(done=>{resolve=()=>done(h.saved(body));})});
  h.context.kpiIndicators.push({...h.context.kpiIndicators[0],id:'indicator-b'});const pending=h.run();assert.equal(h.calls.length,1);h.switchCompany('company-b');resolve();await pending;assert.equal(h.calls.length,1);
});
test('company change during legacy load cannot start an automatic refresh', async () => {
  let resolve;const h=harness({load:()=>new Promise(done=>{resolve=done;})});h.install();const pending=h.context.kpiLoadAll();h.switchCompany('company-b');h.context.kpiKPIs[0].company_id='company-b';h.context.kpiIndicators[0].company_id='company-b';resolve();await pending;assert.equal(h.calls.length,0);
});
test('overlapping legacy loads only refresh the latest generation', async () => {
  const resolves=[];const h=harness({load:()=>new Promise(done=>resolves.push(done))});h.install();const first=h.context.kpiLoadAll(),second=h.context.kpiLoadAll();resolves[1]();await second;resolves[0]();await first;assert.equal(h.calls.length,1);
});
test('loading published frequency settings does not suppress the initial refresh', async () => {
  const h=harness({load:async()=>{h.context.kpiConfigPublished.sources.refresh_frequency='daily';}});h.install();await h.context.kpiLoadAll();assert.equal(h.calls.length,1);
});
