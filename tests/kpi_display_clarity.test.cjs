const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function harness(){
  const element=()=>({innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]});
  const nodes={'year-sel':{value:'2025'},'kpi-objectives-container':element(),'kpi-x-dashboard':element(),'kpi-x-config-view':element()};
  const c={console,Date,document:{readyState:'loading',addEventListener(){},getElementById:id=>nodes[id]||null},localStorage:{getItem:()=>null},kpiKPIs:[],kpiObjectives:[],kpiIndicators:[],kpiMonthlyData:{}};
  c.window=c;vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root,'kpi-configuration.js'),'utf8'),c);
  const source=fs.readFileSync(path.join(root,'kpi-module-upgrade.js'),'utf8'),marker="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker,'window.qa={evaluate:kpiXEvaluate,snapshot:kpiXKpiSnapshot,scorecard:kpiXRenderScorecard,dashboard:kpiXRenderDashboard};'),c);
  return {c,nodes,q:c.qa};
}
function add(c,id,actual,objective='objective-a'){
  const k={id,name:id,objective_id:objective,frequency:'monthly'},ind={id:'ind-'+id,kpi_id:id,name:id,target_operator:'gte',target_value:100};
  c.kpiKPIs.push(k);c.kpiIndicators.push(ind);
  if(actual!==undefined)c.kpiMonthlyData[ind.id]={12:{month:12,actual}};return {k,ind};
}
test('configuration labels the actual aggregation level without changing persisted values',()=>{
  const {c,nodes}=harness(),before=JSON.stringify(c.kpiConfigPublished);c.kpiConfigSection('calculations');
  assert.match(nodes['kpi-x-config-view'].innerHTML,/Indicator aggregation within each KPI/);
  assert.match(nodes['kpi-x-config-view'].innerHTML,/Average indicator achievement/);
  assert.match(nodes['kpi-x-config-view'].innerHTML,/Lowest indicator achievement/);
  assert.match(nodes['kpi-x-config-view'].innerHTML,/Objective totals remain the average/);
  assert.equal(JSON.stringify(c.kpiConfigPublished),before);
});
test('source default uses the actual evidence label and preserves the integration key',()=>{
  const {c,nodes}=harness();c.kpiConfigSection('sources');
  assert.match(nodes['kpi-x-config-view'].innerHTML,/<option value="integration"[^>]*>Evidence \/ document<\/option>/);
  assert.doesNotMatch(nodes['kpi-x-config-view'].innerHTML,/>External integration</);
  assert.match(nodes['kpi-x-config-view'].innerHTML,/does not connect an external service/);
});
test('threshold help distinguishes KPI percentage rules from indicator target checks',()=>{
  const {c,nodes}=harness();c.kpiConfigSection('targets');
  assert.match(nodes['kpi-x-config-view'].innerHTML,/Use worst indicator status for KPI/);
  assert.match(nodes['kpi-x-config-view'].innerHTML,/Applies when worst-indicator status is disabled/);
  assert.match(nodes['kpi-x-config-view'].innerHTML,/Indicators still use their target operator/);
});
test('objectives without reported results disclose no data in scorecard and dashboard',()=>{
  const {c,nodes,q}=harness();c.kpiObjectives=[{id:'objective-a',name:'No results objective'}];add(c,'missing',undefined);
  q.scorecard();q.dashboard();
  assert.match(nodes['kpi-objectives-container'].innerHTML,/kpi-x-objective-score[^>]*>No reported results</);
  assert.doesNotMatch(nodes['kpi-objectives-container'].innerHTML,/kpi-x-objective-score[^>]*>0%</);
  assert.match(nodes['kpi-x-dashboard'].innerHTML,/kpi-x-objective-row no-data/);
  assert.match(nodes['kpi-x-dashboard'].innerHTML,/No reported results/);
});
test('a genuinely reported zero retains zero percent achievement',()=>{
  const {c,nodes,q}=harness();c.kpiObjectives=[{id:'objective-a',name:'Zero objective'}];add(c,'zero',0);
  q.scorecard();q.dashboard();
  assert.match(nodes['kpi-objectives-container'].innerHTML,/kpi-x-objective-score[^>]*>0%</);
  assert.doesNotMatch(nodes['kpi-objectives-container'].innerHTML,/No reported results/);
  assert.doesNotMatch(nodes['kpi-x-dashboard'].innerHTML,/kpi-x-objective-row no-data/);
});
test('missing results in one objective do not hide another objective measured at zero',()=>{
  const {c,nodes,q}=harness();c.kpiObjectives=[{id:'objective-a',name:'Missing'},{id:'objective-b',name:'Zero'}];add(c,'missing',undefined);add(c,'zero',0,'objective-b');q.scorecard();
  assert.equal((nodes['kpi-objectives-container'].innerHTML.match(/No reported results/g)||[]).length,1);
  assert.equal((nodes['kpi-objectives-container'].innerHTML.match(/kpi-x-objective-score[^>]*>0%</g)||[]).length,1);
});
test('partial data retains existing average of reported KPI scores with honest scope text',()=>{
  const {c,nodes,q}=harness();c.kpiObjectives=[{id:'objective-a',name:'Partial'}];add(c,'reported',100);add(c,'missing',undefined);q.scorecard();q.dashboard();
  assert.match(nodes['kpi-objectives-container'].innerHTML,/kpi-x-objective-score[^>]*>100%</);
  assert.match(nodes['kpi-x-dashboard'].innerHTML,/Average of reported KPI scores/);
});
test('worst aggregation still changes only within-KPI scores, not objective policy',()=>{
  const {c,nodes,q}=harness();c.kpiObjectives=[{id:'objective-a',name:'Average'}];add(c,'high',100);add(c,'low',20);c.kpiConfigPublished.calculations.aggregation='worst';q.scorecard();
  assert.match(nodes['kpi-objectives-container'].innerHTML,/kpi-x-objective-score[^>]*>60%</);
});
test('display changes preserve existing target, zero tolerance and critical override behaviour',()=>{
  const {c,q}=harness(),{k,ind}=add(c,'kpi-a',96);c.kpiConfigPublished.targets.critical_override=false;
  assert.equal(q.evaluate(ind,96,null).status,'at_risk');assert.equal(q.snapshot(k,12).status,'on_track');
  assert.equal(q.evaluate({target_operator:'zero',target_value:0},1,null).status,'off_track');
});
test('objective names remain escaped in missing-result displays',()=>{
  const {c,nodes,q}=harness();c.kpiObjectives=[{id:'objective-a',name:'<img src=x onerror=alert(1)>'}];add(c,'missing',undefined);q.scorecard();q.dashboard();
  for(const id of ['kpi-objectives-container','kpi-x-dashboard']){assert.doesNotMatch(nodes[id].innerHTML,/<img src=x/);assert.match(nodes[id].innerHTML,/&lt;img/);}
});
