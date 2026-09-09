const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),css=read('kpi-module-upgrade.css');
test('monthly scroll panel provides its own named inline-size query context',()=>{
 assert.match(css,/#page-kpi \.kpi-x-month-scroll\s*\{[^}]*container-type:\s*inline-size[^}]*container-name:\s*kpi-monthly-table/s);
});
test('narrow panels release only the two wide horizontal frozen columns',()=>{
 assert.match(css,/@container kpi-monthly-table \(max-width:\s*760px\)\s*\{\s*#page-kpi #kpi-monthly-table \.kpi-x-sticky-2,\s*#page-kpi #kpi-monthly-table \.kpi-x-sticky-3\s*\{\s*left:\s*auto!important;?\s*\}\s*\}/s);
});
test('older browsers have a scoped narrow-viewport fallback',()=>{
 assert.match(css,/@supports not \(container-type:\s*inline-size\)\s*\{\s*@media\s*\(max-width:\s*1100px\)\s*\{\s*#page-kpi #kpi-monthly-table \.kpi-x-sticky-2,\s*#page-kpi #kpi-monthly-table \.kpi-x-sticky-3\s*\{\s*left:\s*auto!important;?\s*\}\s*\}\s*\}/s);
});
test('vertical sticky headers, code pinning and native keyboard scrolling are retained',()=>{
 assert.match(css,/#page-kpi #kpi-monthly-table th\s*\{[^}]*position:sticky!important;top:0!important/);
 assert.match(css,/#page-kpi #kpi-monthly-table \.kpi-x-sticky-1\s*\{[^}]*left:0/);
 assert.match(css,/#page-kpi \.kpi-x-month-scroll\s*\{[^}]*overflow:auto!important[^}]*scrollbar-gutter:stable both-edges/);
 const source=read('kpi-module-upgrade.js');assert.match(source,/scroll\.setAttribute\('tabindex','0'\)/);assert.match(source,/Scroll vertically or horizontally to view all periods/);
});
function render(period,editable=true){
 const head={innerHTML:''},body={innerHTML:''},c={console,Date,document:{readyState:'loading',addEventListener(){},getElementById:id=>({'year-sel':{value:'2025'},'kpi-monthly-table':{querySelector:()=>head},'kpi-monthly-body':body}[id]||null)},localStorage:{getItem:()=>null},kpiCanEdit:()=>editable,kpiObjectives:[{id:'o',code:'1',name:'Synthetic objective'}],kpiKPIs:[{id:'k',code:'1.1',objective_id:'o',name:'Synthetic KPI',frequency:'monthly'},{id:'annual',code:'1.2',objective_id:'o',name:'Annual KPI',frequency:'annual'}],kpiIndicators:[{id:'i',kpi_id:'k',name:'Reported value',target_value:100,target_operator:'gte'},{id:'ia',kpi_id:'annual',name:'Annual value',target_value:1,target_operator:'gte'}],kpiMonthlyData:{i:{12:{month:12,actual:0,ytd:0}},ia:{}},kpiConfigPublished:{targets:{critical_override:true}}};
 c.window=c;vm.createContext(c);const source=read('kpi-module-upgrade.js'),boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";assert.ok(source.includes(boot));vm.runInContext(source.replace(boot,'window.qa={render:kpiXRenderMonthly,state:kpiXState};'),c);c.qa.state.period=period;const before=JSON.stringify(c.kpiMonthlyData);c.qa.render();assert.equal(JSON.stringify(c.kpiMonthlyData),before);return {head:head.innerHTML,body:body.innerHTML};
}
for(const [period,count,label] of [['monthly',23,'Dec'],['quarterly',15,'Q4'],['annual',12,'Annual']])test(period+' keeps all headers and row identity',()=>{
 const r=render(period);assert.equal((r.head.match(/<th(?:\s|>)/g)||[]).length,count);assert.match(r.head,new RegExp('>'+label+'</th>'));assert.match(r.body,/data-kpi-id="k"/);assert.match(r.body,/class="kpi-x-sticky-3">Reported value/);assert.match(r.body,/<strong>0<\/strong>/);
});
test('editable cells keep the existing period-specific entry routes',()=>{
 const r=render('monthly');assert.match(r.body,/data-indicator-id="i" data-kpi-id="k" data-month="12"/);assert.match(r.body,/role="button" tabindex="0"/);assert.match(r.body,/>N\/A<\/td>/);
});
test('read-only users do not acquire entry controls through a layout change',()=>{
 assert.doesNotMatch(render('monthly',false).body,/data-kpi-month-entry=/);
});
test('browser fixture uses actual page markup and complete local stylesheet order',()=>{
 const server=read('scripts/serve-kpi-table-fixture.cjs'),fixture=read('tests/fixtures/kpi-monthly-table.html');assert.match(server,/index\.slice\(start,end\)/);assert.match(server,/index\.matchAll/);assert.match(server,/\.listen\(0,'127\.0\.0\.1'/);assert.match(fixture,/APP_STYLES/);assert.match(fixture,/Tenant API is forbidden/);assert.doesNotMatch(fixture,/#kpi-monthly-table[^<]*\{/);
});
