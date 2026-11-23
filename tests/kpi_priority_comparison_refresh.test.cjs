const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const comparison=require('../kpi-year-comparison.js');

const source=fs.readFileSync(path.join(__dirname,'..','kpi-module-upgrade.js'),'utf8');
const boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";
// The owner-control case records September as the last compiled month. Keep
// that scenario fixed rather than changing it when the real calendar advances.
class FixtureDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-22T12:00:00Z']));}static now(){return new Date('2026-10-22T12:00:00Z').getTime();}}

function runtime(options={}){
  const calls=[],dashboard={innerHTML:'',querySelectorAll:()=>[]},panel={outerHTML:''};
  let company=options.company??'company-a';
  const year={value:'2026'};
  const document={readyState:'loading',addEventListener(){},getElementById(id){return id==='year-sel'?year:id==='kpi-x-dashboard'?dashboard:null;},querySelector(selector){return selector==='#kpi-x-dashboard > .kpi-x-comparison'?panel:null;}};
  const read=async url=>{calls.push(url);if(options.fail)throw new Error('Network unavailable');return options.api?options.api(url):[];};
  const c={window:null,document,Date:FixtureDate,console,ccid:()=>company,api:read,AurisKpiYearComparison:comparison,kpiKPIs:[],kpiIndicators:[],kpiMonthlyData:{},kpiObjectives:[],kpiConfigPublished:{},isMgr:()=>true};
  if(options.paginated)c.apiAllRows=read;
  c.window=c;vm.createContext(c);vm.runInContext(source.replace(boot,'window.qa={comparison:kpiXComparisonHtml,dashboard:kpiXRenderDashboard,loadHistory:kpiXLoadHistory,data:kpiXComparisonData};'),c);
  return {c,calls,dashboard,panel,year,company:value=>company=value};
}

test('year comparison replaces loading after company-scoped history completes',async()=>{
  const h=runtime();
  assert.match(h.c.qa.comparison(5),/Loading previous-year results/);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.calls.length,3);
  assert.ok(h.calls.every(url=>url.includes('company_id=eq.company-a')));
  assert.match(h.panel.outerHTML,/No KPI indicators are available/);
  assert.doesNotMatch(h.panel.outerHTML,/Loading previous-year results/);
});

test('historical results load independently of a reused KPI definition year',async()=>{
  const h=runtime({paginated:true,api:url=>url.startsWith('/kpi_monthly_data')
    ?[{company_id:'company-a',year:2025,month:1,kpi_id:'same-kpi',indicator_id:'same-indicator',actual:3}]
    :[]});
  h.c.api=()=>assert.fail('history must use the paginated API reader');
  h.c.kpiKPIs=[{company_id:'company-a',id:'same-kpi',year:2026,code:'K1',name:'Shared KPI'}];
  h.c.kpiIndicators=[{company_id:'company-a',id:'same-indicator',kpi_id:'same-kpi',name:'Count',unit:'cases',ytd_method:'sum'}];
  h.c.kpiMonthlyData={'same-indicator':{1:{month:1,actual:4}}};
  await h.c.qa.loadHistory(2026,'company-a');
  const data=h.c.qa.data();
  assert.equal(data.rows[0].prior[2025].value,3);
  assert.equal(data.rows[0].delta,1);
  const monthlyUrl=h.calls.find(url=>url.startsWith('/kpi_monthly_data'));
  assert.match(monthlyUrl,/year=in\.\(2025,2024\)/);
  assert.doesNotMatch(monthlyUrl,/kpi_id=in/);
  assert.ok(h.calls.every(url=>url.endsWith('&order=id.asc')));
});

test('comparison keeps current and earlier-year values when the adjacent prior year is missing',async()=>{
  const h=runtime({api:url=>url.startsWith('/kpi_monthly_data')
    ?[{company_id:'company-a',year:2024,month:1,kpi_id:'same-kpi',indicator_id:'same-indicator',actual:2}]
    :[]});
  h.c.kpiKPIs=[{company_id:'company-a',id:'same-kpi',year:2026,code:'K1',name:'Shared KPI'}];
  h.c.kpiIndicators=[{company_id:'company-a',id:'same-indicator',kpi_id:'same-kpi',name:'Count',unit:'cases',ytd_method:'sum'}];
  h.c.kpiMonthlyData={'same-indicator':{1:{month:1,actual:4}}};
  await h.c.qa.loadHistory(2026,'company-a');
  const html=h.c.qa.comparison(5);
  assert.match(html,/<table>/);
  assert.match(html,/4 cases/);
  assert.match(html,/2 cases/);
  assert.match(html,/>—<\/td>/);
  assert.match(html,/No comparable prior-year result/);
});

test('same-scope concurrent reads share one request and explicit reload refreshes history',async()=>{
  let release;
  const wait=new Promise(resolve=>release=resolve);
  let value=2;
  const h=runtime({api:async url=>{await wait;return url.startsWith('/kpi_monthly_data')
    ?[{company_id:'company-a',year:2025,month:1,kpi_id:'k',indicator_id:'i',actual:value}]:[];}});
  h.c.kpiKPIs=[{id:'k',company_id:'company-a',year:2026,name:'KPI'}];
  h.c.kpiIndicators=[{id:'i',company_id:'company-a',kpi_id:'k',name:'Count'}];
  h.c.kpiMonthlyData={i:{1:{month:1,actual:4}}};
  const first=h.c.qa.loadHistory(2026,'company-a');
  const second=h.c.qa.loadHistory(2026,'company-a',true);
  assert.equal(first,second);
  assert.equal(h.calls.length,3);
  release();await first;
  assert.equal(h.c.qa.data().rows[0].prior[2025].value,2);
  value=3;
  await h.c.qa.loadHistory(2026,'company-a',true);
  assert.equal(h.calls.length,6);
  assert.equal(h.c.qa.data().rows[0].prior[2025].value,3);
});

test('foreign historical rows and late company responses are excluded',async()=>{
  const h=runtime({api:url=>url.startsWith('/kpi_monthly_data')?[{company_id:'foreign',year:2025,actual:900}]:[]});
  await h.c.qa.loadHistory(2026,'company-a');
  assert.match(h.c.qa.comparison(),/Previous-year results could not be loaded/);
  let release;
  const wait=new Promise(resolve=>release=resolve);
  const changed=runtime({api:async()=>{await wait;return [];}});
  const pending=changed.c.qa.loadHistory(2026,'company-a');
  changed.company('company-b');release();await pending;
  assert.equal(changed.c.qa.data(),null);
});

test('year comparison replaces loading with an error if history is unavailable',async()=>{
  const h=runtime({fail:true});
  assert.match(h.c.qa.comparison(5),/Loading previous-year results/);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(h.panel.outerHTML,/Previous-year results could not be loaded/);
  assert.doesNotMatch(h.panel.outerHTML,/Loading previous-year results/);
});

test('priority Assign appears only for an editable KPI definition',()=>{
  const h=runtime();
  vm.runInContext(`
    kpiKPIs=[{id:'k',name:'Unassigned KPI',approval_status:'locked',frequency:'monthly'}];
    kpiIndicators=[{id:'i',kpi_id:'k',name:'Completion',target_value:100,target_operator:'gte',ytd_method:'last'}];
    kpiMonthlyData={i:{9:{month:9,actual:10}}};
    KpiGovernedWorkflow={canEdit:function(k){return k.approval_status==='draft';}};
  `,h.c);
  h.c.qa.dashboard();
  assert.equal(h.c.kpiKPIs[0]._computed_status,'off_track');
  assert.doesNotMatch(h.dashboard.innerHTML,/data-kpi-priority-assign/);
  assert.match(h.dashboard.innerHTML,/Owner can be assigned when the definition is editable/);
  h.c.kpiKPIs[0].approval_status='draft';
  h.c.qa.dashboard();
  assert.match(h.dashboard.innerHTML,/data-kpi-priority-assign="k"/);
  assert.match(h.dashboard.innerHTML,/kpi-x-priority-actions/);
});
