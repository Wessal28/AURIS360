const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'kpi-module-upgrade.js'),'utf8');
function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(field);field='';}else if(ch==='\r'&&text[i+1]==='\n'&&!quoted){row.push(field);rows.push(row);row=[];field='';i++;}else field+=ch;}
 row.push(field);rows.push(row);return rows;
}
function harness({date='2026-09-15T12:00:00Z',year=2026,excluded=true,frequency='monthly',data}={}){
 class Clock extends Date{constructor(...args){super(...(args.length?args:[date]));}}
 const element=()=>({innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]}),head=element(),nodes={'year-sel':{value:String(year)},'kpi-objectives-container':element(),'kpi-x-reports-view':element(),'kpi-monthly-body':element(),'kpi-monthly-table':{querySelector:()=>head}};
 let blob,clicked=0,removed=0,appended=0,revoked=0,anchor;
 const c={Date:Clock,Blob,URL:{createObjectURL(value){blob=value;return 'blob:synthetic';},revokeObjectURL(){revoked++;}},setTimeout:fn=>fn(),document:{readyState:'loading',addEventListener(){},getElementById:id=>nodes[id]||null,body:{appendChild(){appended++;}},createElement(tag){assert.equal(tag,'a');return anchor={click(){clicked++;},remove(){removed++;}};}},localStorage:{getItem:()=>null},kpiCanEdit:()=>true,kpiKPIs:[{id:'k',objective_id:'o',code:'1.1',name:'Test KPI',frequency,responsible:'Owner'}],kpiObjectives:[{id:'o',name:'Test objective'}],kpiIndicators:[{id:'i',kpi_id:'k',name:'Test indicator',target_operator:'gte',target_value:100,unit:'count'}],kpiMonthlyData:{i:data||{6:{month:6,actual:95,ytd:95},8:{month:8,actual:80,ytd:175},9:{month:9,actual:100,ytd:275},12:{month:12,actual:0,ytd:275}}},kpiConfigPublished:{cycles:{current_period_excluded:excluded}}};
 c.window=c;vm.createContext(c);const boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";assert.ok(source.includes(boot));
 vm.runInContext(source.replace(boot,'window.qa={spark:kpiXSpark,scorecard:kpiXRenderScorecard,monthly:kpiXRenderMonthly,reports:kpiXRenderReports,state:kpiXState};'),c);
 return {c,nodes,head,async csv(){c.kpiXExportCsv();return parseCsv(await blob.text());},download(){return {name:anchor.download,type:blob.type,clicked,removed,appended,revoked};}};
}
const scenarios=[
 ['excluded open September',{},'80','Off Track'],
 ['included open September',{excluded:false},'100','On Track'],
 ['no result for compiled August',{data:{7:{month:7,actual:70},9:{month:9,actual:100}}},'','Data Missing'],
 ['quarter ends after compiled August',{frequency:'quarterly'},'95','At Risk'],
 ['quarter includes September',{frequency:'quarterly',excluded:false},'100','On Track'],
 ['annual result in excluded month',{frequency:'annually',data:{9:{month:9,actual:100}}},'','Not Due'],
 ['backdated annual result',{frequency:'annually',data:{8:{month:8,actual:100}}},'100','On Track'],
 ['January has no compiled month',{date:'2026-01-15T12:00:00Z',data:{1:{month:1,actual:100},12:{month:12,actual:0}}},'','Not Due'],
 ['included January preserves zero',{date:'2026-01-15T12:00:00Z',excluded:false,data:{1:{month:1,actual:0},12:{month:12,actual:100}}},'0','Off Track'],
 ['past year compiles December',{year:2025},'0','Off Track'],
 ['future year never compiles',{year:2027},'','Not Due'],
 ['December excludes open result',{date:'2026-12-15T12:00:00Z',data:{11:{month:11,actual:100},12:{month:12,actual:0}}},'100','On Track'],
 ['December inclusion retains year end',{date:'2026-12-15T12:00:00Z',excluded:false},'0','Off Track']
];
for(const [name,options,actual,status] of scenarios)test('CSV agrees with compiled scorecard: '+name,async()=>{
 const h=harness(options),before=JSON.stringify(h.c.kpiMonthlyData),rows=await h.csv();assert.equal(rows[1][7],actual);assert.equal(rows[1][11],status);
 const snap=h.c.kpiKPIs[0]._kpiX.indicators[0];assert.equal(rows[1][7],snap.actual==null?'':String(snap.actual));assert.equal(JSON.stringify(h.c.kpiMonthlyData),before);
});
test('CSV retains twelve columns, escaping, full-register scope and download cleanup',async()=>{
 const h=harness();h.c.kpiObjectives[0].name='Safety, "quality"\r\nAnnual';h.c.qa.state.search='not a matching KPI';const beforeFilters=JSON.stringify(h.c.qa.state);
 h.c.kpiKPIs.push({id:'second',objective_id:'o',name:'Second KPI',frequency:'monthly'});h.c.kpiIndicators.push({id:'second-i',kpi_id:'second',name:'Second indicator',target_value:1});h.c.kpiMonthlyData['second-i']={8:{month:8,actual:1}};
 const rows=await h.csv();assert.equal(rows.length,3);assert.ok(rows.every(row=>row.length===12));assert.equal(rows[1][0],'Safety, "quality"\r\nAnnual');assert.equal(rows[2][7],'1');
 assert.equal(JSON.stringify(h.c.qa.state),beforeFilters);
 assert.deepEqual(h.download(),{name:'AURIS360-KPI-Scorecard-2026.csv',type:'text/csv;charset=utf-8',clicked:1,removed:1,appended:1,revoked:1});
});
test('Reports disclose the same compilation cutoff as export and year summary',()=>{
 const h=harness();h.c.qa.reports();assert.match(h.nodes['kpi-x-reports-view'].innerHTML,/Compiled through Aug 2026/);
 h.c.kpiConfigPublished.cycles.current_period_excluded=false;h.c.qa.reports();assert.match(h.nodes['kpi-x-reports-view'].innerHTML,/Compiled through Sep 2026/);
 h.nodes['year-sel'].value='2027';h.c.qa.reports();assert.match(h.nodes['kpi-x-reports-view'].innerHTML,/No compiled month in 2027/);
 h.nodes['year-sel'].value='2025';h.c.qa.reports();assert.match(h.nodes['kpi-x-reports-view'].innerHTML,/Compiled through Dec 2025/);
});
test('row trend labels disclose recorded full-year values rather than claim a six-month compiled score',()=>{
 const h=harness();h.c.qa.scorecard();h.c.qa.monthly();const chart=h.c.qa.spark(h.c.kpiIndicators[0]);
 assert.match(h.head.innerHTML,/Recorded trend/);assert.match(h.nodes['kpi-objectives-container'].innerHTML,/Recorded trend/);assert.doesNotMatch(h.nodes['kpi-objectives-container'].innerHTML,/6-month trend/);
 assert.match(chart,/role="img"/);assert.match(chart,/aria-label="Recorded results for 2026/);assert.match(chart,/Jan.*Dec/);assert.match(chart,/open or future/);assert.match(chart,/not a performance score/);
});
test('trend relabeling preserves all recorded points and never mutates or recompiles data',()=>{
 const h=harness(),before=JSON.stringify(h.c.kpiMonthlyData),chart=h.c.qa.spark(h.c.kpiIndicators[0]);
 assert.match(chart,/points="33\.5,4\.9 45\.7,7\.4 51\.8,4\.0 70\.1,21\.0"/);
 h.c.kpiConfigPublished.cycles.current_period_excluded=false;assert.equal(h.c.qa.spark(h.c.kpiIndicators[0]),chart);assert.equal(JSON.stringify(h.c.kpiMonthlyData),before);
});
test('single/no recorded trend has an explanatory label instead of an unexplained dash',()=>{
 for(const data of [{},{8:{month:8,actual:0}}]){const h=harness({data}),chart=h.c.qa.spark(h.c.kpiIndicators[0]);assert.match(chart,/At least two recorded results/);assert.doesNotMatch(chart,/<svg/);}
});
test('report actions retain a 44px touch target',()=>{
 const css=fs.readFileSync(path.join(root,'kpi-module-upgrade.css'),'utf8');assert.match(css,/#page-kpi #kpi-x-reports-view \.kpi-x-btn\{min-height:44px!important\}/);
});
