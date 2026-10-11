const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const comparison=require('../kpi-year-comparison.js');

const source=fs.readFileSync(path.join(__dirname,'..','kpi-module-upgrade.js'),'utf8');
const boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";

function runtime(options={}){
  const calls=[],dashboard={innerHTML:'',querySelectorAll:()=>[]},panel={outerHTML:''};
  const document={readyState:'loading',addEventListener(){},getElementById(id){return id==='year-sel'?{value:'2026'}:id==='kpi-x-dashboard'?dashboard:null;},querySelector(selector){return selector==='#kpi-x-dashboard > .kpi-x-comparison'?panel:null;}};
  const c={window:null,document,Date,console,ccid:()=>options.company||'company-a',api:async url=>{calls.push(url);if(options.fail)throw new Error('Network unavailable');return [];},AurisKpiYearComparison:comparison,kpiKPIs:[],kpiIndicators:[],kpiMonthlyData:{},kpiObjectives:[],kpiConfigPublished:{},isMgr:()=>true};
  c.window=c;vm.createContext(c);vm.runInContext(source.replace(boot,'window.qa={comparison:kpiXComparisonHtml,dashboard:kpiXRenderDashboard};'),c);
  return {c,calls,dashboard,panel};
}

test('year comparison replaces loading after company-scoped history completes',async()=>{
  const h=runtime();
  assert.match(h.c.qa.comparison(5),/Loading previous-year results/);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.calls.length,1);
  assert.match(h.calls[0],/company_id=eq\.company-a/);
  assert.match(h.panel.outerHTML,/No matching recorded KPI results/);
  assert.doesNotMatch(h.panel.outerHTML,/Loading previous-year results/);
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
