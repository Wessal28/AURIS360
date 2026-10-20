const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function runtime(){
 const el=()=>({innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null});
 const nodes={'year-sel':{value:'2025'},'kpi-objectives-container':el(),'kpi-monthly-table':{querySelector:()=>head},'kpi-monthly-body':el()},head=el();
 let company='a';
 const c={console,Date,URL,Intl,location:{href:'https://example.test/',origin:'https://example.test'},document:{readyState:'loading',addEventListener(){},getElementById:id=>nodes[id]||null,querySelector:()=>null},localStorage:{getItem:()=>null},ccid:()=>company,isSA:()=>false,co:{id:'a',name:'Company <A>',logo_url:'/logo.png'},kpiCanEdit:()=>false,kpiObjectives:[{id:'o',name:'Safety & health'}],kpiKPIs:[{id:'k',year:2025,company_id:'a',objective_id:'o',name:'Recorded KPI',code:'1',frequency:'monthly'},{id:'other',year:2025,company_id:'a',objective_id:'o',name:'Other KPI',code:'2',frequency:'annual'}],kpiIndicators:[{id:'i',kpi_id:'k',name:'<count>',unit:'hours',target_operator:'gte',target_value:4}],kpiMonthlyData:{i:{1:{month:1,actual:0,ytd:0},12:{month:12,actual:4,ytd:4}}},kpiConfigPublished:{cycles:{current_period_excluded:true}},AurisKpiYearComparison:require('../kpi-year-comparison.js'),api:async url=>url.startsWith('/kpis_v2')?[{id:'old',year:2024,code:'1',name:'Recorded KPI'}]:url.startsWith('/kpi_indicators')?[{id:'oldi',kpi_id:'old',name:'<count>',unit:'hours'}]:[{year:2024,month:12,indicator_id:'oldi',actual:2}]};
 c.window=c;vm.createContext(c);vm.runInContext(read('kpi-module-upgrade.js').replace("if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();",'window.qa={state:kpiXState};'),c);vm.runInContext(read('kpi-print-reports.js'),c);
 return {c,nodes,head,company:value=>company=value};
}
test('scorecard and follow-up snapshots use the current layouts without rewriting the visible view or source records',async()=>{
 const h=runtime(),before=JSON.stringify(h.c.kpiMonthlyData);h.c.qa.state.search='recorded';
 const score=await h.c.AurisKpiReportSource.capture('scorecard',false);assert.match(score.html,/Objective \/ KPI \/ Indicator/);assert.match(score.html,/&lt;count&gt;/);assert.equal(score.kpis.length,1);assert.match(score.filters,/Search: recorded/);assert.equal(h.nodes['kpi-objectives-container'].innerHTML,'');
 const monthly=await h.c.AurisKpiReportSource.capture('monthly',false);for(const m of ['Jan','Dec','YTD','Variance','Status'])assert.ok(monthly.html.includes('>'+m+'</th>'));assert.match(monthly.html,/>0<\/td>/);assert.equal(h.head.innerHTML,'');assert.equal(h.nodes['kpi-monthly-body'].innerHTML,'');assert.equal(JSON.stringify(h.c.kpiMonthlyData),before);
 const all=await h.c.AurisKpiReportSource.capture('scorecard',true);assert.equal(all.kpis.length,2);assert.equal(all.filters,'All KPIs');assert.equal(h.c.qa.state.search,'recorded');
});
test('follow-up grouping and scorecard column choices carry into report sources',async()=>{
 const h=runtime();h.c.localStorage.getItem=()=>JSON.stringify({owner:false,trend:false});const s=await h.c.AurisKpiReportSource.capture('scorecard',true);assert.doesNotMatch(s.html,/data-kpi-col="owner"/);assert.doesNotMatch(s.html,/data-kpi-col="trend"/);
 for(const [period,expected,unexpected] of [['quarterly','Q4','Jan'],['annual','Annual','Q4']]){h.c.qa.state.period=period;const m=await h.c.AurisKpiReportSource.capture('monthly',true);assert.ok(m.html.includes('>'+expected+'</th>'));assert.ok(!m.html.includes('>'+unexpected+'</th>'));assert.equal(m.period,period);}
});
test('comparison waits for history and prints the complete matching-year table',async()=>{
 const h=runtime();const r=await h.c.AurisKpiReportSource.capture('comparison',true);assert.match(r.html,/Change vs 2024/);assert.match(r.html,/2023/);assert.match(r.html,/\+2 hours/);assert.match(r.html,/100%/);assert.doesNotMatch(r.html,/Loading previous-year/);assert.equal(r.filters,'All KPIs');
});
test('history failure and company/year changes cannot produce a stale report',async()=>{
 const h=runtime();h.c.api=async()=>{throw Error('offline');};await assert.rejects(h.c.AurisKpiReportSource.capture('comparison',true),/could not be loaded/);
 const x=runtime();x.c.api=async()=>{x.company('b');return [];};await assert.rejects(x.c.AurisKpiReportSource.capture('comparison',true),/company or year changed/);
 const y=runtime();y.c.kpiKPIs[0].year=2024;await assert.rejects(y.c.AurisKpiReportSource.capture('scorecard',true),/still changing/);
});
test('report metadata, logos, literal text, scoped summary and honest data notes are included',async()=>{
 const h=runtime(),snapshot=await h.c.AurisKpiReportSource.capture('scorecard',true),api=h.c.AurisKpiPrint;
 const result=api.build(snapshot,'scorecard',{paper:'A4',summary:true},api.company(),'<table><tr><td>Saved values</td></tr></table>');
 assert.match(result,/Company &lt;A&gt;/);assert.match(result,/AURIS360 logo/);assert.match(result,/src="https:\/\/example.test\/logo.png"/);assert.match(result,/January–Dec 2025/);assert.match(result,/Reporting snapshot/);assert.match(result,/KPIs in scope/);assert.match(result,/No Data: required result absent/);assert.doesNotMatch(result,/Page 1 of 1/);
 const plain=api.build(snapshot,'monthly',{paper:'A3',summary:false},api.company(),'<table></table>');assert.match(plain,/kpr-a3/);assert.doesNotMatch(plain,/class="kpr-summary"/);assert.match(plain,/open\/future recorded cells/);
 assert.equal(api.safeLogo('javascript:alert(1)'), '');assert.equal(api.safeLogo(''), '');
});
test('branding does not use another company logo in a selected-company or global report',()=>{
 const h=runtime();h.c.isSA=()=>true;h.company('b');h.c.saCompanyList=[{id:'b',name:'Selected B',logo_url:'/b.png'}];assert.equal(h.c.AurisKpiPrint.company().name,'Selected B');assert.equal(h.c.AurisKpiPrint.company().logo,'/b.png');h.company('');assert.equal(h.c.AurisKpiPrint.company().name,'All companies');assert.equal(h.c.AurisKpiPrint.company().logo,'');
});
test('a comparison with no matching history prints its honest no-data explanation',()=>{
 const h=runtime();h.c.document.createElement=()=>({set innerHTML(value){this.value=value;},content:{textContent:'No matching history',querySelector:s=>s==='.kpi-x-comparison-note'?{textContent:'No matching <recorded> results. Missing is not zero.'}:null}});
 assert.equal(h.c.AurisKpiPrint.cleanTable('<section>Missing</section>','comparison'),'<section class="kpr-empty">No matching &lt;recorded&gt; results. Missing is not zero.</section>');
});
test('SEPHS all-company scorecards retain the existing global scope without borrowing a company logo',async()=>{
 const h=runtime();h.company('');h.c.isSA=()=>true;h.c.kpiKPIs[1].company_id='b';const snapshot=await h.c.AurisKpiReportSource.capture('scorecard',true);assert.equal(snapshot.kpis.length,2);assert.equal(h.c.AurisKpiPrint.company().name,'All companies');assert.equal(h.c.AurisKpiPrint.company().logo,'');
});
