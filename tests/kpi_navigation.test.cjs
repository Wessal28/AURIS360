const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-09-08T12:00:00Z']));}}
function harness(){
  const element=()=>({value:'all',innerHTML:'',style:{},focus(){this.focused=true;},querySelector:()=>null,querySelectorAll:()=>[]});
  const nodes={'year-sel':{value:'2025'},'kpi-objectives-container':element(),'kpi-x-dashboard':element(),'kpi-monthly-body':element(),'kpi-x-filters':element()},listeners={};
  ['search','status','owner','frequency','objective'].forEach(key=>nodes['kpi-x-'+key]=element());nodes['kpi-x-search'].value='';
  const head=element();nodes['kpi-monthly-table']={querySelector:()=>head};
  const c={console,Date:FixedDate,document:{readyState:'loading',addEventListener(type,fn){listeners[type]=fn;},getElementById:id=>nodes[id]||null,querySelector:()=>null,querySelectorAll:()=>[]},sessionStorage:{setItem(){}},localStorage:{getItem:()=>null},kpiCanEdit:()=>false,kpiKPIs:[],kpiObjectives:[{id:'o',name:'Safety'},{id:'p',name:'People'}],kpiIndicators:[],kpiMonthlyData:{},kpiConfigPublished:{targets:{critical_override:true},cycles:{current_period_excluded:true}}};
  c.window=c;vm.createContext(c);
  const source=fs.readFileSync(path.join(root,'kpi-module-upgrade.js'),'utf8'),marker="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";
  assert.ok(source.includes(marker));vm.runInContext(source.replace(marker,'window.qa={state:kpiXState,filtered:kpiXFilteredKpis,compute:kpiXCompute};'),c);
  vm.runInContext(fs.readFileSync(path.join(root,'auris-module-event-handlers-batch-3.js'),'utf8'),c);
  function dispatch(id,{type='click',value='',args=[]}={}){
    const node={nodeType:1,parentElement:null,value,getAttribute(name){return name==='data-auris-module-on'+type?id:name==='data-auris-module-args'?encodeURIComponent(JSON.stringify(args)):null;}};
    listeners[type]({target:node,cancelBubble:false,preventDefault(){}});
  }
  function ids(){return Array.from(c.qa.filtered(),k=>k.id);}
  function stale(){Object.assign(c.qa.state,{status:'on_track',objective:'p',owner:'Ghost',frequency:'annual',search:'absent'});['status','objective','owner','frequency','search'].forEach(key=>nodes['kpi-x-'+key].value=c.qa.state[key]);}
  return {c,nodes,head,dispatch,ids,stale,state:c.qa.state};
}
function add(h,id,actual,extra={}){
  const k={id,name:id,objective_id:'o',frequency:'monthly',owner:'Alice',...extra},ind={id:'ind-'+id,kpi_id:id,name:id+' result',target_operator:'gte',target_value:100};
  h.c.kpiKPIs.push(k);h.c.kpiIndicators.push(ind);if(actual!==undefined)h.c.kpiMonthlyData[ind.id]={12:{month:12,actual}};h.c.qa.compute();return k;
}
function mixed(){const h=harness();add(h,'off',0);add(h,'risk',90);add(h,'missing');add(h,'on',100);return h;}

test('Review Exceptions includes missing-only KPIs through the actual click handler',()=>{const h=harness();add(h,'missing');h.dispatch('d0004');assert.equal(h.state.status,'attention');assert.deepEqual(h.ids(),['missing']);assert.equal(h.state.tab,'scorecard');});
test('Review Exceptions shows the union of Off Track, At Risk and Data Missing',()=>{const h=mixed();h.dispatch('d0004');assert.deepEqual(h.ids(),['off','risk','missing']);assert.match(h.nodes['kpi-objectives-container'].innerHTML,/>3<\/strong> KPIs shown/);});
test('Review Exceptions clears stale filters and synchronizes every visible control',()=>{const h=mixed();h.stale();h.dispatch('d0004');assert.deepEqual(h.ids(),['off','risk','missing']);for(const key of ['objective','owner','frequency'])assert.equal(h.nodes['kpi-x-'+key].value,'all');assert.equal(h.nodes['kpi-x-search'].value,'');assert.equal(h.nodes['kpi-x-status'].value,'attention');});
test('no exceptions shows an honest empty scorecard instead of unrelated records',()=>{const h=harness();add(h,'on',100);h.dispatch('d0004');assert.deepEqual(h.ids(),[]);assert.equal(h.state.tab,'scorecard');assert.match(h.nodes['kpi-objectives-container'].innerHTML,/No KPI matches the selected filters/);});
test('dashboard metric clears stale restrictions and matches its full status count',()=>{const h=mixed();h.stale();h.dispatch('d0001',{args:['on_track']});assert.deepEqual(h.ids(),['on']);assert.equal(h.nodes['kpi-x-status'].value,'on_track');});
test('Overall Achievement opens the full scorecard including unscored KPIs',()=>{const h=mixed();h.stale();h.dispatch('d0001',{args:['all']});assert.equal(h.state.tab,'scorecard');assert.deepEqual(h.ids(),['off','risk','missing','on']);});
test('zero-count status metric does not fall back to unrelated results',()=>{const h=harness();add(h,'on',100);h.dispatch('d0001',{args:['off_track']});assert.equal(h.state.tab,'scorecard');assert.deepEqual(h.ids(),[]);});
test('Open scorecard dashboard shortcut also clears stale restrictions',()=>{const h=mixed();h.stale();h.dispatch('d0005');assert.equal(h.state.tab,'scorecard');assert.equal(h.ids().length,4);});
test('objective dashboard drill-down clears unrelated filters and retains its objective',()=>{const h=mixed();add(h,'other',100,{objective_id:'p'});h.stale();h.dispatch('d0002',{args:['o']});assert.equal(h.state.tab,'scorecard');assert.equal(h.nodes['kpi-x-objective'].value,'o');assert.deepEqual(h.ids(),['off','risk','missing','on']);});
test('Review Missing synchronizes the status and clears unrelated restrictions',()=>{const h=mixed();h.stale();h.dispatch('d0006');assert.deepEqual(h.ids(),['missing']);assert.equal(h.nodes['kpi-x-status'].value,'data_missing');});
test('All Statuses in the scorecard retains other filters without returning to dashboard',()=>{const h=mixed();add(h,'other-owner',100,{owner:'Bob'});h.state.tab='scorecard';h.state.owner='Alice';h.dispatch('d0016',{type:'change',value:'all'});assert.equal(h.state.tab,'scorecard');assert.equal(h.state.owner,'Alice');assert.equal(h.ids().length,4);});
test('status dropdown filters Monthly Follow-up in place, including All Statuses',()=>{const h=mixed();h.c.kpiXSwitchTab('monthly');h.dispatch('d0016',{type:'change',value:'data_missing'});assert.equal(h.state.tab,'monthly');assert.match(h.nodes['kpi-monthly-body'].innerHTML,/data-kpi-id="missing"/);assert.doesNotMatch(h.nodes['kpi-monthly-body'].innerHTML,/data-kpi-id="on"/);h.dispatch('d0016',{type:'change',value:'all'});assert.equal(h.state.tab,'monthly');assert.match(h.nodes['kpi-monthly-body'].innerHTML,/data-kpi-id="on"/);});
test('search, objective, owner and frequency filters update the active monthly table together',()=>{
  const h=mixed();add(h,'other',100,{owner:'Bob',objective_id:'p',frequency:'annual'});h.c.kpiXSwitchTab('monthly');
  for(const [id,value] of [['d0014','p'],['d0015','Bob'],['d0017','annual'],['d0013','other']]){h.dispatch(id,{type:id==='d0013'?'input':'change',value});assert.equal(h.state.tab,'monthly');assert.match(h.nodes['kpi-monthly-body'].innerHTML,/data-kpi-id="other"/);assert.doesNotMatch(h.nodes['kpi-monthly-body'].innerHTML,/data-kpi-id="on"/);}
  h.dispatch('d0013',{type:'input',value:'absent'});assert.doesNotMatch(h.nodes['kpi-monthly-body'].innerHTML,/data-kpi-id=/);
});
test('normal attention dropdown combines with owner and objective filters',()=>{const h=mixed();add(h,'other',0,{owner:'Bob',objective_id:'p'});h.state.tab='scorecard';h.state.owner='Bob';h.state.objective='p';h.dispatch('d0016',{type:'change',value:'attention'});assert.deepEqual(h.ids(),['other']);});
test('reset stays in Monthly and preserves reporting year and period',()=>{const h=mixed();h.c.kpiXSwitchTab('monthly');h.state.period='quarterly';h.stale();h.dispatch('d0018');assert.equal(h.state.tab,'monthly');assert.equal(h.state.period,'quarterly');assert.equal(h.nodes['year-sel'].value,'2025');assert.equal(h.ids().length,4);assert.match(h.head.innerHTML,/>Q1</);});
test('dashboard navigation moves focus to the matching visible filter, ordinary changes do not steal focus',()=>{const h=mixed();h.dispatch('d0001',{args:['on_track']});assert.equal(h.nodes['kpi-x-status'].focused,true);h.nodes['kpi-x-status'].focused=false;h.dispatch('d0016',{type:'change',value:'all'});assert.equal(h.nodes['kpi-x-status'].focused,false);h.dispatch('d0002',{args:['o']});assert.equal(h.nodes['kpi-x-objective'].focused,true);});
test('navigation does not mutate KPI definitions, monthly values or published configuration',()=>{const h=mixed();const before=JSON.stringify([h.c.kpiKPIs,h.c.kpiMonthlyData,h.c.kpiConfigPublished]);h.dispatch('d0004');h.dispatch('d0001',{args:['all']});h.dispatch('d0002',{args:['o']});assert.equal(JSON.stringify([h.c.kpiKPIs,h.c.kpiMonthlyData,h.c.kpiConfigPublished]),before);});
