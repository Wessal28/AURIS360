const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),copy=value=>JSON.parse(JSON.stringify(value));
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-09-09T12:00:00Z']));}}
function harness({risk=85,track=95,year='2026',engine=true,validated=false}={}){
  const host={innerHTML:''},yearNode={value:year},calls=[];
  const live={targets:{at_risk_percent:85,on_track_percent:95,critical_override:false},calculations:{aggregation:'average'},cycles:{current_period_excluded:true}};
  const draft=copy(live);draft.targets.at_risk_percent=risk;draft.targets.on_track_percent=track;
  const rows=[{id:'draft-a',company_id:'a',status:validated?'validated':'draft',version_no:2,configuration:draft,validation:{valid:validated}},
    {id:'live-a',company_id:'a',status:'published',version_no:1,configuration:live}];
  const c={Date:FixedDate,console,prof:{id:'user-a',role:'admin'},ccid:()=> 'a',activeRole:()=> 'admin',prompt:()=> 'Synthetic reason',
    document:{readyState:'loading',activeElement:null,addEventListener(){},getElementById:id=>id==='kpi-x-config-view'?host:id==='year-sel'?yearNode:null},
    kpiKPIs:[],kpiIndicators:[],kpiMonthlyData:{},api:async(url,options={})=>{
      calls.push({url,options:copy(options)});
      if(url.startsWith('/kpi_config_audit'))return [];
      if(url.startsWith('/rpc/'))throw new Error('No publication in this fixture');
      if(!options.m)return copy(rows);
      Object.assign(rows[0],copy(options.b));return [copy(rows[0])];
    }};
  c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'kpi-configuration.js'),'utf8'),c);
  if(engine)vm.runInContext(fs.readFileSync(path.join(root,'kpi-module-upgrade.js'),'utf8'),c);
  const change=(key,value,type='number')=>c.kpiConfigChange({dataset:{cfg:key},type,value:String(value),checked:value});
  const add=(id,actual,month=8)=>{c.kpiKPIs.push({id,frequency:'monthly',_computed_status:'incorrect-cache',_kpiX:{score:999}});c.kpiIndicators.push({id:'i-'+id,kpi_id:id,target_operator:'gte',target_value:100});if(actual!==undefined)c.kpiMonthlyData['i-'+id]={[month]:{month,actual}};};
  return {c,host,calls,rows,change,add,yearNode};
}
for(const risk of [null,'','   ',false,[],{},-1,101,'not-a-number'])test('invalid risk threshold '+JSON.stringify(risk)+' cannot validate or publish',async()=>{
  const h=harness({risk});await h.c.kpiConfigLoad();assert.equal(await h.c.kpiConfigValidate(),false);
  await h.c.kpiConfigPublish();assert.equal(h.calls.filter(x=>x.options.b?.status==='validated'||x.url.startsWith('/rpc/')).length,0);
  assert.match(h.host.innerHTML,/Save and validate|threshold/);
});
for(const track of [null,'',-1,101,85])test('invalid On Track threshold '+JSON.stringify(track)+' cannot validate',async()=>{
  const h=harness({track});await h.c.kpiConfigLoad();assert.equal(await h.c.kpiConfigValidate(),false);
});
test('measured zero and fractional thresholds remain supported, with exact open upper band',async()=>{
  const h=harness({risk:0,track:94.55});await h.c.kpiConfigLoad();assert.equal(await h.c.kpiConfigValidate(),true);
  assert.match(h.host.innerHTML,/≥ 0% and &lt; 94\.55%/);assert.doesNotMatch(h.host.innerHTML,/94\.45/);
});
test('a previously validated invalid saved draft is checked before the publication RPC',async()=>{
  const h=harness({risk:null,validated:true});await h.c.kpiConfigLoad();assert.equal(await h.c.kpiConfigPublish(),false);
  assert.equal(h.calls.filter(x=>x.url.startsWith('/rpc/')).length,0);
});
test('preview recomputes draft aggregation from raw indicators, not cached scores',async()=>{
  const h=harness();await h.c.kpiConfigLoad();h.add('k',100);h.c.kpiIndicators.push({id:'second',kpi_id:'k',target_operator:'gte',target_value:100});h.c.kpiMonthlyData.second={8:{month:8,actual:80}};
  h.change('calculations.aggregation','worst','select-one');assert.equal(await h.c.kpiConfigValidate(),true);
  const p=h.rows[0].impact_summary;assert.equal(p.available,true);assert.equal(p.status_changes,1);assert.equal(p.score_changes,1);assert.equal(p.kpis_evaluated,1);
  assert.equal(p.reporting_year,2026);assert.equal(p.published_month,8);assert.equal(p.draft_month,8);assert.equal(p.periods_affected,undefined);
  assert.match(h.host.innerHTML,/Loaded KPIs compared/);assert.doesNotMatch(h.host.innerHTML,/Periods affected/);
});
test('draft thresholds reevaluate individual status under worst-indicator policy',async()=>{
  const h=harness();await h.c.kpiConfigLoad();h.add('k',90);h.c.kpiConfigPublished.targets.critical_override=true;
  const draft=copy(h.c.kpiConfigPublished);draft.targets.at_risk_percent=92;
  const result=h.c.kpiXPreviewConfiguration(draft);assert.equal(result.status_changes,1);assert.equal(result.score_changes,0);
});
test('preview compares each configuration at its own compilation cut-off',async()=>{
  const h=harness();await h.c.kpiConfigLoad();h.add('k',60);h.c.kpiMonthlyData['i-k'][9]={month:9,actual:100};
  const draft=copy(h.c.kpiConfigPublished);draft.cycles.current_period_excluded=false;
  const result=h.c.kpiXPreviewConfiguration(draft);assert.equal(result.status_changes,1);assert.equal(result.published_month,8);assert.equal(result.draft_month,9);
});
test('preview is read-only and leaves live config, cached KPI status, indicators and rows untouched',async()=>{
  const h=harness();await h.c.kpiConfigLoad();h.add('k',90);
  const config=h.c.kpiConfigPublished,draft=copy(config);draft.targets.at_risk_percent=94;
  const before=JSON.stringify([config,draft,h.c.kpiKPIs,h.c.kpiIndicators,h.c.kpiMonthlyData]),calls=h.calls.length;
  h.c.kpiXPreviewConfiguration(draft);
  assert.equal(h.c.kpiConfigPublished,config);assert.equal(JSON.stringify([config,draft,h.c.kpiKPIs,h.c.kpiIndicators,h.c.kpiMonthlyData]),before);assert.equal(h.calls.length,calls);
});
test('unchanged settings preserve partial-data priority and real zero scores',async()=>{
  const h=harness();await h.c.kpiConfigLoad();h.add('zero',0);h.add('missing');
  const p=h.c.kpiXPreviewConfiguration(copy(h.c.kpiConfigPublished));assert.equal(p.kpis_evaluated,2);assert.equal(p.status_changes,0);assert.equal(p.score_changes,0);
});
for(const year of ['2025','2027'])test('preview declares selected '+year+' year and its reporting cut-off',async()=>{
  const h=harness({year});await h.c.kpiConfigLoad();h.add('k',100,12);
  const p=h.c.kpiXPreviewConfiguration(copy(h.c.kpiConfigPublished));assert.equal(p.reporting_year,Number(year));assert.equal(p.published_month,year==='2025'?12:0);assert.equal(p.draft_month,p.published_month);
});
test('absent calculation engine discloses unavailable impact rather than manufactured zeros',async()=>{
  const h=harness({engine:false});await h.c.kpiConfigLoad();assert.equal(await h.c.kpiConfigValidate(),true);
  assert.equal(h.rows[0].impact_summary.available,false);assert.match(h.host.innerHTML,/Impact preview unavailable/);assert.doesNotMatch(h.host.innerHTML,/Status changes<\/span><strong>0/);
});
test('editing after validation removes the stale preview from the view',async()=>{
  const h=harness();await h.c.kpiConfigLoad();h.add('k',90);await h.c.kpiConfigValidate();h.change('targets.on_track_percent',96);
  assert.doesNotMatch(h.host.innerHTML,/Loaded KPIs compared/);assert.match(h.host.innerHTML,/Validate the draft/);
});
test('legacy impact counts without a declared basis are not displayed as a fresh preview',async()=>{
  const h=harness({validated:true});h.rows[0].impact_summary={kpis_evaluated:10,status_changes:0,periods_affected:0};await h.c.kpiConfigLoad();
  assert.doesNotMatch(h.host.innerHTML,/Periods affected|KPIs evaluated/);assert.match(h.host.innerHTML,/Validate again/);
});
