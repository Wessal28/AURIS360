const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-09-08T12:00:00Z']));}static now(){return new FixedDate().getTime();}}
function harness(year='2025'){
  const element=()=>({innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]});
  const nodes={'year-sel':{value:year},'kpi-objectives-container':element(),'kpi-x-dashboard':element(),'kpi-x-reports-view':element()};
  const c={console,Date:FixedDate,document:{readyState:'loading',addEventListener(){},getElementById:id=>nodes[id]||null},localStorage:{getItem:()=>null},kpiKPIs:[],kpiObjectives:[{id:'o',name:'Objective'}],kpiIndicators:[],kpiMonthlyData:{},kpiConfigPublished:{targets:{critical_override:true},calculations:{aggregation:'average'},cycles:{current_period_excluded:true}}};
  c.window=c;vm.createContext(c);
  const source=fs.readFileSync(path.join(root,'kpi-module-upgrade.js'),'utf8'),marker="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker,'window.qa={metrics:kpiXMetrics,dashboard:kpiXRenderDashboard,reports:kpiXRenderReports};'),c);
  return {c,nodes,q:c.qa};
}
function add(c,id,actual,month=12){
  const k={id,name:id,objective_id:'o',frequency:'monthly'},ind={id:'ind-'+id,kpi_id:id,name:id,target_operator:'gte',target_value:100};
  c.kpiKPIs.push(k);c.kpiIndicators.push(ind);
  if(actual!==undefined)c.kpiMonthlyData[ind.id]={[month]:{month,actual}};return {k,ind};
}
function views(h){h.q.dashboard();h.q.reports();return {dashboard:h.nodes['kpi-x-dashboard'].innerHTML,reports:h.nodes['kpi-x-reports-view'].innerHTML};}

test('empty register has no manufactured achievement or reassuring completion claim',()=>{
  const h=harness(),m=h.q.metrics(),html=views(h);assert.equal(m.achievement,null);assert.equal(m.scored,0);
  assert.match(html.dashboard,/No KPIs are available for the selected year/);
  assert.match(html.reports,/No reported results/);assert.doesNotMatch(html.dashboard,/under control|All required results.*available/);
});
test('missing results remain unscored across dashboard and year summary',()=>{
  const h=harness();add(h.c,'missing');const m=h.q.metrics(),html=views(h);
  assert.equal(m.achievement,null);assert.equal(m.scored,0);assert.equal(m.data_missing,1);
  assert.match(html.dashboard,/No scored results are available/);assert.match(html.dashboard,/>0\/1<\/strong><span>KPIs with scores/);
  assert.match(html.dashboard,/0 KPIs Off Track or At Risk/);assert.doesNotMatch(html.dashboard,/0 KPIs require attention/);
  for(const value of Object.values(html)){assert.match(value,/No reported results/);assert.doesNotMatch(value,/>null%<|>0%<\/strong><span>Achievement/);}
});
test('measured zero stays a real zero percent and counts as a scored KPI',()=>{
  const h=harness();add(h.c,'zero',0);const m=h.q.metrics(),html=views(h);
  assert.equal(m.achievement,0);assert.equal(m.scored,1);assert.match(html.reports,/>0%<\/strong><span>Achievement/);
  assert.doesNotMatch(html.reports,/No reported results/);assert.match(html.dashboard,/>1\/1<\/strong><span>KPIs with scores/);
});
test('partial reporting preserves the existing average without claiming all records updated',()=>{
  const h=harness();add(h.c,'reported',100);add(h.c,'missing');const m=h.q.metrics(),html=views(h);
  assert.equal(m.achievement,100);assert.equal(m.scored,1);assert.equal(m.total,2);
  assert.match(html.dashboard,/Average of scored KPIs/);assert.match(html.dashboard,/>1\/2<\/strong><span>KPIs with scores/);
  assert.doesNotMatch(html.dashboard,/<span>Updated<|All required results.*available/);
});
test('future-year KPIs are not counted as updated or assigned zero achievement',()=>{
  const h=harness('2027');add(h.c,'future');const m=h.q.metrics(),html=views(h);
  assert.equal(m.achievement,null);assert.equal(m.scored,0);assert.equal(m.data_missing,0);
  assert.equal(h.c.kpiKPIs[0]._computed_status,'not_due');assert.match(html.dashboard,/>0\/1<\/strong><span>KPIs with scores/);
  assert.doesNotMatch(html.dashboard,/under control|All required results.*available/);
});
test('KPI without measurement indicators is not claimed as updated',()=>{
  const h=harness();h.c.kpiKPIs=[{id:'empty',name:'Needs setup',objective_id:'o'}];const m=h.q.metrics(),html=views(h);
  assert.equal(m.achievement,null);assert.equal(m.scored,0);assert.match(html.dashboard,/>0\/1<\/strong><span>KPIs with scores/);
});
test('current-period exclusion and inclusion keep their existing calculated values',()=>{
  const h=harness('2026'),{ind}=add(h.c,'current',50,8);h.c.kpiMonthlyData[ind.id][9]={month:9,actual:100};
  assert.equal(h.q.metrics().achievement,50);h.c.kpiConfigPublished.cycles.current_period_excluded=false;assert.equal(h.q.metrics().achievement,100);
});
test('average and worst indicator aggregation retain their existing arithmetic',()=>{
  const h=harness();add(h.c,'multi',100);h.c.kpiIndicators.push({id:'second',kpi_id:'multi',target_operator:'gte',target_value:100});h.c.kpiMonthlyData.second={12:{month:12,actual:20}};
  assert.equal(h.q.metrics().achievement,60);h.c.kpiConfigPublished.calculations.aggregation='worst';assert.equal(h.q.metrics().achievement,20);
});
test('dashboard status explanation follows the published worst-indicator setting',()=>{
  const h=harness();add(h.c,'reported',96);h.q.dashboard();assert.match(h.nodes['kpi-x-dashboard'].innerHTML,/KPI status uses the highest-priority indicator status/);
  h.c.kpiConfigPublished.targets.critical_override=false;h.q.dashboard();assert.match(h.nodes['kpi-x-dashboard'].innerHTML,/KPI status uses score thresholds; missing required data still takes precedence/);
  assert.doesNotMatch(h.nodes['kpi-x-dashboard'].innerHTML,/KPI status uses the highest-priority/);
});
test('partially scored KPI is disclosed as scored, not as a completed submission',()=>{
  const h=harness();add(h.c,'partial',100);h.c.kpiIndicators.push({id:'missing',kpi_id:'partial',target_value:100,target_operator:'gte'});
  const m=h.q.metrics(),html=views(h);assert.equal(m.scored,1);assert.equal(m.data_missing,1);assert.equal(m.achievement,100);
  assert.match(html.dashboard,/Having a score does not mean every required indicator is complete/);
  assert.doesNotMatch(html.dashboard,/All required results.*available/);
});
test('current-period entry without a prior compiled score stays unscored while excluded',()=>{
  const h=harness('2026');add(h.c,'open',100,9);assert.equal(h.q.metrics().achievement,null);
  h.c.kpiConfigPublished.cycles.current_period_excluded=false;assert.equal(h.q.metrics().achievement,100);
});
test('year summary never loses a genuine zero when changing from empty to reported data',()=>{
  const h=harness(),{ind}=add(h.c,'later');h.q.reports();assert.match(h.nodes['kpi-x-reports-view'].innerHTML,/No reported results/);
  h.c.kpiMonthlyData[ind.id]={12:{month:12,actual:0}};h.q.reports();assert.match(h.nodes['kpi-x-reports-view'].innerHTML,/>0%<\/strong><span>Achievement/);assert.doesNotMatch(h.nodes['kpi-x-reports-view'].innerHTML,/No reported results/);
});
