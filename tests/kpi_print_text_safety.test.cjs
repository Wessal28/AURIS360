const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),core=fs.readFileSync(path.join(root,'auris-core.js'),'utf8');
const start=core.indexOf('function kpiPrint() {'),end=core.indexOf('// FIX: Missing entry points for Contractor',start);
assert.ok(start>=0&&end>start);const source=core.slice(start,end);
const escape=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function harness(){
 const nodes={'page-kpi':{style:{display:'block'}},'kpi-tab-overview':{style:{display:'block'}},'kpi-tab-monthly':{style:{display:'none'}},'year-sel':{value:'2026'}},prints=[],messages=[];
 const c={document:{getElementById:id=>nodes[id]||null},isSA:()=>false,co:{name:'Synthetic company'},aurisPrint:(html,title)=>prints.push({html,title}),toast:(...args)=>messages.push(args),kpiObjectives:[{id:'o',code:'1',name:'Safety'}],kpiKPIs:[{id:'k',objective_id:'o',code:'1.1',name:'Toolbox talks',responsible:'Owner',frequency:'monthly',status:'off_track'}],kpiIndicators:[{id:'i',kpi_id:'k',name:'Talk count',target_value:4,target_operator:'eq',unit:'count'}],kpiMonthlyData:{i:{1:{actual:0,ytd:0},8:{actual:3,ytd:3},12:{actual:9,ytd:12}}}};
 vm.createContext(c);vm.runInContext(source,c);return {c,nodes,prints,messages};
}
const samples=['<b data-print-probe>text</b>','</td><td data-print-probe>extra','& < > " \' Équipe 東京','&lt;b&gt;literal entity&lt;/b&gt;'];
for(const value of samples){
 test('target formatter output is rendered as literal text: '+value,()=>{
  const h=harness();h.c.kpiFmtTarget=()=>value;assert.equal(h.c.kpiPrintFmtTarget(h.c.kpiIndicators[0]),escape(value));for(const build of [()=>h.c.kpiBuildPrintOverview(),()=>h.c.kpiBuildPrintMonthly(2026)]){const html=build();assert.ok(html.includes(escape(value)));assert.ok(!html.includes('<b data-print-probe>'));assert.ok(!html.includes('<td data-print-probe>'));}
 });
 test('unknown stored status is rendered as literal text in both layouts: '+value,()=>{
  const h=harness();h.c.kpiKPIs[0].status=value;assert.equal(h.c.kpiPrintStatusLabel(value),escape(value));assert.ok(h.c.kpiBuildPrintOverview().includes(escape(value)));assert.ok(h.c.kpiBuildPrintMonthly(2026).includes(escape(value)));h.c.kpiIndicators=[];assert.ok(h.c.kpiBuildPrintOverview().includes(escape(value)));
 });
 test('raw actual and YTD fields cannot become print markup: '+value,()=>{
  const h=harness();h.c.kpiMonthlyData={i:{1:{actual:value,ytd:value}}};const html=h.c.kpiBuildPrintMonthly(2026);assert.ok(html.includes('<td style="text-align:center">'+escape(value)+'</td>'));assert.ok(html.includes('<strong>'+escape(value)+'</strong>'));
 });
}
test('fallback target formatter escapes entered target/unit text',()=>{
 const h=harness();const ind={target_operator:'eq',target_value:'<b>4</b>',unit:'<em>count</em>'};assert.equal(h.c.kpiPrintFmtTarget(ind),escape('= <b>4</b> <em>count</em>'));
});
test('print header escapes selected-year text without changing dispatch title',()=>{
 const h=harness(),year='<b data-print-probe>2026</b>';h.nodes['year-sel'].value=year;h.c.kpiPrint();assert.ok(h.prints[0].html.includes(escape(year)));assert.ok(!h.prints[0].html.includes(year));assert.equal(h.prints[0].title,'KPI Scorecard - Synthetic company - '+year);
});
test('existing company/objective/KPI/indicator/owner escaping remains single-pass',()=>{
 const h=harness(),label='Safety & <quality> "team"';h.c.co.name=label;h.c.kpiObjectives[0].name=label;h.c.kpiKPIs[0].name=label;h.c.kpiKPIs[0].responsible=label;h.c.kpiIndicators[0].name=label;h.c.kpiPrint();const html=h.prints[0].html;assert.ok(html.includes(escape(label)));assert.ok(!html.includes('&amp;amp;'));
});
test('known statuses, zero/missing values and all twelve month columns are preserved',()=>{
 const h=harness();for(const [status,label] of Object.entries({on_track:'On Track',at_risk:'At Risk',off_track:'Off Track',not_started:'Not Started','':'--'}))assert.equal(h.c.kpiPrintStatusLabel(status),label);
 const html=h.c.kpiBuildPrintMonthly(2026);for(const month of ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])assert.ok(html.includes('>'+month+'</th>'));assert.ok(html.includes('>0</td>'));assert.ok(html.includes('>-</td>'));assert.ok(html.includes('<strong>12</strong>'));assert.ok(html.includes('Off Track'));
});
test('overview/monthly/Reports dispatch and selected company policy are unchanged',()=>{
 const h=harness();h.c.kpiPrint();assert.match(h.prints[0].html,/Overview/);assert.doesNotMatch(h.prints[0].html,/print-monthly/);h.nodes['kpi-tab-overview'].style.display='none';h.c.kpiPrint();assert.match(h.prints[1].html,/Monthly Follow-up/);assert.match(h.prints[1].html,/print-monthly/);
 h.c.isSA=()=>true;h.c.sephsCompanyContext='company';h.c.saCompanyList=[{id:'company',name:'Selected & company'}];h.c.kpiPrint();assert.match(h.prints[2].html,/Selected &amp; company/);h.c.sephsCompanyContext=null;h.c.kpiPrint();assert.match(h.prints[3].html,/All companies/);
});
test('no-open-page and empty-register handling do not open an invalid print',()=>{
 const h=harness();h.nodes['page-kpi'].style.display='none';h.c.kpiPrint();assert.equal(h.prints.length,0);assert.equal(h.messages.length,1);h.c.kpiObjectives=[];assert.match(h.c.kpiBuildPrintOverview(),/No objectives/);assert.match(h.c.kpiBuildPrintMonthly(2026),/No data/);
});
test('formatting and printing never rewrite source records',()=>{
 const h=harness(),before=JSON.stringify({o:h.c.kpiObjectives,k:h.c.kpiKPIs,i:h.c.kpiIndicators,data:h.c.kpiMonthlyData});h.c.kpiPrint();h.c.kpiBuildPrintMonthly(2026);assert.equal(JSON.stringify({o:h.c.kpiObjectives,k:h.c.kpiKPIs,i:h.c.kpiIndicators,data:h.c.kpiMonthlyData}),before);
});
