const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'kpi-module-upgrade.js'),'utf8');
function parseCsv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if(ch==='\r'&&text[i+1]==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';i++;}else cell+=ch;}
 assert.equal(quoted,false);row.push(cell);rows.push(row);return rows;
}
function harness(){
 class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-09-15T12:00:00Z']));}}
 let blob,anchor,clicks=0,removed=0,revoked=0;const reports={innerHTML:''};
 const c={Date:Clock,Blob,URL:{createObjectURL(b){blob=b;return 'blob:fixture';},revokeObjectURL(){revoked++;}},setTimeout:f=>f(),document:{readyState:'loading',addEventListener(){},getElementById:id=>id==='year-sel'?{value:'2026'}:id==='kpi-x-reports-view'?reports:null,body:{appendChild(){}},createElement:()=>anchor={click(){clicks++;},remove(){removed++;}}},localStorage:{getItem:()=>null},kpiCanEdit:()=>true,kpiObjectives:[{id:'o',name:'Objective'}],kpiKPIs:[{id:'k',objective_id:'o',code:'1.1',name:'KPI',frequency:'monthly',responsible:'Owner'}],kpiIndicators:[{id:'i',kpi_id:'k',name:'Indicator',unit:'count',target_operator:'eq',target_value:100}],kpiMonthlyData:{i:{8:{month:8,actual:80},9:{month:9,actual:100}}},kpiConfigPublished:{cycles:{current_period_excluded:true}}};
 c.window=c;vm.createContext(c);const boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";assert.ok(source.includes(boot));vm.runInContext(source.replace(boot,'window.qa={reports:kpiXRenderReports};'),c);
 return {c,reports,async csv(){c.kpiXExportCsv();const text=await blob.text();return {text,rows:parseCsv(text)};},download:()=>({name:anchor.download,type:blob.type,clicks,removed,revoked})};
}
const risky=['=1+2','+1+2','-1+2','@SUM(1,2)','\t=1+2','\r=1+2','\n=1+2',' =1+2',' \t+1+2','\u0000=1+2','\u007f=1+2','\u00a0=1+2','\ufeff=1+2','＝1+2','＋1+2','－1+2','＠SUM(1,2)','\tPlain text',' \rPlain text'];
for(const value of risky)test('formula-like text is guarded in every entered export field: '+JSON.stringify(value),async()=>{
 const h=harness(),{c}=h;c.kpiObjectives[0].name=value;Object.assign(c.kpiKPIs[0],{code:value,name:value,responsible:value,frequency:value});Object.assign(c.kpiIndicators[0],{name:value,unit:value});
 const {rows}=await h.csv();assert.equal(rows.length,2);assert.equal(rows[1].length,12);for(const column of [0,1,2,3,5,9,10])assert.equal(rows[1][column],'\t'+value,'column '+column);
});
test('generated exact-target and signed unit-bearing variance labels are text too',async()=>{
 const h=harness(),{rows}=await h.csv();assert.equal(rows[1][6],'\t=100 count');assert.equal(rows[1][8],'\t-20 count');assert.equal(rows[1][7],'80');
});
test('positive unit-bearing variance is guarded without altering its displayed value',async()=>{
 const h=harness();h.c.kpiMonthlyData.i[8].actual=120;assert.equal((await h.csv()).rows[1][8],'\t+20 count');
});
test('finite negative actuals and plain numeric variance remain numeric',async()=>{
 const h=harness();h.c.kpiIndicators[0].unit='';h.c.kpiMonthlyData.i[8].actual=-12.5;const {rows}=await h.csv();assert.equal(rows[1][7],'-12.5');assert.equal(rows[1][8],'-112.5');
});
test('zero and signed positive numeric variance are not prefixed',async()=>{
 const h=harness();h.c.kpiIndicators[0].unit='';h.c.kpiMonthlyData.i[8].actual=0;let rows=(await h.csv()).rows;assert.equal(rows[1][7],'0');assert.equal(rows[1][8],'-100');h.c.kpiMonthlyData.i[8].actual=120;rows=(await h.csv()).rows;assert.equal(rows[1][8],'+20');
});
test('numeric-looking names are still treated as text, not numeric result columns',async()=>{
 const h=harness();h.c.kpiObjectives[0].name='-12.5';h.c.kpiKPIs[0].code='+20';const {rows}=await h.csv();assert.equal(rows[1][0],'\t-12.5');assert.equal(rows[1][1],'\t+20');
});
test('quotes, separators and embedded newlines cannot create additional CSV fields',async()=>{
 const h=harness(),value='=1+2";,=3+4\r\n@SUM(1,2)';h.c.kpiObjectives[0].name=value;const {rows,text}=await h.csv();assert.equal(rows.length,2);assert.ok(rows.every(r=>r.length===12));assert.equal(rows[1][0],'\t'+value);assert.ok(text.includes('"\t=1+2"";,=3+4\r\n@SUM(1,2)"'));
});
test('ordinary Unicode, embedded signs, quotes and multiline names retain original text',async()=>{
 const h=harness(),values=['Safety, "quality"\r\nAnnual','Équipe 東京','Safety = quality','O\'Brien','A+B','-12.5'];
 for(const value of values){h.c.kpiObjectives[0].name=value;assert.equal((await h.csv()).rows[1][0],value.startsWith('-')?'\t'+value:value);}
});
test('repeat exports do not accumulate prefixes or mutate source records/published policy',async()=>{
 const h=harness();h.c.kpiObjectives[0].name='=1+2';const before=JSON.stringify({o:h.c.kpiObjectives,i:h.c.kpiIndicators,data:h.c.kpiMonthlyData,config:h.c.kpiConfigPublished}),first=await h.csv(),second=await h.csv();assert.equal(second.text,first.text);assert.equal(JSON.stringify({o:h.c.kpiObjectives,i:h.c.kpiIndicators,data:h.c.kpiMonthlyData,config:h.c.kpiConfigPublished}),before);assert.equal(h.c.kpiKPIs[0].name,'KPI');
});
test('headers, filename, cleanup, compiled cutoff and missing actuals stay intact',async()=>{
 const h=harness();let rows=(await h.csv()).rows;assert.deepEqual(rows[0],['Objective','KPI Code','KPI','Indicator','Direction','Unit','Target','Current Actual','Variance','KPI Owner','Frequency','Status']);assert.equal(rows[1][7],'80');assert.deepEqual(h.download(),{name:'AURIS360-KPI-Scorecard-2026.csv',type:'text/csv;charset=utf-8',clicks:1,removed:1,revoked:1});delete h.c.kpiMonthlyData.i[8];rows=(await h.csv()).rows;assert.equal(rows[1][7],'');assert.equal(rows[1][11],'Data Missing');
});
test('reports explain export-only text protection and spreadsheet limitations',()=>{
 const h=harness();h.c.qa.reports();assert.match(h.reports.innerHTML,/leading tab/i);assert.match(h.reports.innerHTML,/saved KPI data is unchanged/i);assert.match(h.reports.innerHTML,/spreadsheet applications/i);
});
