const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),copy=x=>JSON.parse(JSON.stringify(x));
function harness({year=2026,actual=20,frequency='monthly'}={}){
 class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-01-15T12:00:00Z']));}}
 const element=()=>({innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]}),head=element();
 const nodes={'year-sel':{value:String(year)},'kpi-x-config-view':element(),'kpi-monthly-body':element(),'kpi-monthly-table':{querySelector:()=>head}};
 const records=[{id:'live',company_id:'company',version_no:1,status:'published',configuration:{cycles:{current_period_excluded:true}}}],calls=[];
 const c={Date:Clock,document:{readyState:'loading',addEventListener(){},getElementById:id=>nodes[id]||null},prof:{id:'user',role:'admin'},ccid:()=> 'company',activeRole:()=> 'admin',prompt:()=> 'Synthetic publication',localStorage:{getItem:()=>null},
 kpiKPIs:[{id:'k',objective_id:'o',name:'KPI',frequency}],kpiObjectives:[{id:'o',name:'Objective'}],
 kpiIndicators:[{id:'i',kpi_id:'k',name:'Indicator',target_operator:'gte',target_value:100}],
 kpiMonthlyData:{i:{1:{month:1,actual,ytd:actual},12:{month:12,actual:99,ytd:159}}},kpiCanEdit:()=>true,
 api:async(url,opts={})=>{
  calls.push({url,opts:copy(opts)});
  if(url.startsWith('/kpi_config_audit'))return [];
  if(url.startsWith('/rpc/kpi_publish_config')){records.forEach(x=>{if(x.status==='published')x.status='archived';});const row=records.find(x=>x.id===opts.b.p_config_id);row.status='published';return copy(row);}
  if(!url.startsWith('/kpi_config_versions'))throw new Error('Non-configuration write forbidden');
  if(!opts.m)return copy(records.slice().reverse());
  if(opts.m==='POST'){const row={id:'draft',...copy(opts.b)};records.push(row);return [copy(row)];}
  const row=records.find(x=>x.id==='draft');Object.assign(row,copy(opts.b));return [copy(row)];
 }};
 c.window=c;vm.createContext(c);vm.runInContext(read('kpi-configuration.js'),c);
 const marker="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();",src=read('kpi-module-upgrade.js');assert.ok(src.includes(marker));
 vm.runInContext(src.replace(marker,'window.qa={metrics:kpiXMetrics,monthly:kpiXRenderMonthly,cutoff:kpiXCompilationMonth};'),c);
 c.kpiLoadAll=async()=>{c.qa.metrics();c.qa.monthly();};
 const change=()=>c.kpiConfigChange({dataset:{cfg:'cycles.current_period_excluded'},type:'checkbox',checked:false});
 const ytd=()=>{c.qa.monthly();const match=nodes['kpi-monthly-body'].innerHTML.match(/<td><strong>([^<]*)<\/strong><\/td><td>[^<]*<\/td><td>/);assert.ok(match);return match[1];};
 return {c,nodes,calls,change,ytd,records};
}
test('validating an included-January draft does not leak it or December history into the live monthly summary',async()=>{
 const h=harness();await h.c.kpiConfigLoad();const before=JSON.stringify(h.c.kpiMonthlyData);
 assert.equal(h.ytd(),'—');assert.equal(h.c.qa.metrics().achievement,null);h.change();
 assert.equal(await h.c.kpiConfigValidate(),true);
 const p=h.records.find(x=>x.id==='draft').impact_summary;assert.equal(p.available,true);assert.equal(p.published_month,0);assert.equal(p.draft_month,1);assert.equal(p.status_changes,1);assert.equal(p.score_changes,1);
 assert.equal(h.ytd(),'—');assert.equal(h.c.qa.metrics().achievement,null);assert.equal(JSON.stringify(h.c.kpiMonthlyData),before);
});
for(const actual of [0,20])test('synthetic publication compiles January '+actual+' across preview and monthly table without rewriting stored rows',async()=>{
 const h=harness({actual});await h.c.kpiConfigLoad();const before=JSON.stringify(h.c.kpiMonthlyData);h.change();await h.c.kpiConfigValidate();assert.equal(await h.c.kpiConfigPublish(),true);
 assert.equal(h.c.qa.cutoff(),1);assert.equal(h.ytd(),String(actual));assert.equal(h.c.qa.metrics().achievement,actual);assert.equal(JSON.stringify(h.c.kpiMonthlyData),before);
 assert.ok(h.calls.every(x=>x.url.startsWith('/kpi_config_')||x.url==='/rpc/kpi_publish_config'));
});
for(const year of [2025,2027])test('selected year '+year+' stays consistent between configuration preview and compiled summary',async()=>{
 const h=harness({year});await h.c.kpiConfigLoad();h.change();await h.c.kpiConfigValidate();
 const p=h.records.find(x=>x.id==='draft').impact_summary;assert.equal(p.reporting_year,year);assert.equal(p.published_month,year===2025?12:0);assert.equal(p.draft_month,p.published_month);
 assert.equal(await h.c.kpiConfigPublish(),true);assert.equal(h.ytd(),year===2025?'159':'—');assert.equal(h.c.qa.metrics().achievement,year===2025?99:null);
});
test('annual not-due state survives preview/publication when its recorded month is still later',async()=>{
 const h=harness({frequency:'annually'});delete h.c.kpiMonthlyData.i[1];await h.c.kpiConfigLoad();h.change();await h.c.kpiConfigValidate();await h.c.kpiConfigPublish();assert.equal(h.c.qa.metrics().achievement,null);assert.equal(h.c.kpiKPIs[0]._computed_status,'not_due');
});
test('integration retains editor action routing and both focus and narrow-table styles',()=>{
 const editor=read('kpi-definition-editor.js'),css=read('kpi-module-upgrade.css'),handlers=read('auris-generated-event-handlers.js'),html=read('index.html');
 assert.match(editor,/function kpiRemoveIndicatorRow/);assert.match(editor,/Measurement indicator /);assert.match(handlers,/kpiRemoveIndicatorRow/);
 assert.match(css,/container-name:kpi-monthly-table/);assert.match(css,/@container kpi-monthly-table/);assert.match(css,/kpi-indicator-status/);
 for(const asset of ['kpi-definition-editor.js','kpi-configuration.js','kpi-module-upgrade.js'])assert.equal(html.split('src="'+asset+'?').length-1,1);
 assert.ok(html.indexOf('src="kpi-definition-editor.js?')<html.indexOf('src="kpi-configuration.js?'));assert.ok(html.indexOf('src="kpi-configuration.js?')<html.indexOf('src="kpi-module-upgrade.js?'));
});
