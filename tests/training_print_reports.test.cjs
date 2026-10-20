const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','training-print-reports.js'),'utf8');
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-20T12:00:00+04:00']));}}
function runtime(){
 let company='client',denied=false;const calls=[],tables={
  training_plan:[{id:'p1',company_id:'client',year:2026,training_ref:'TRN-2026-01',training_topic:'First aid & <rescue>',training_type:'external',status:'planned',planned_date:'2026-10-24',trainer:'Trainer',location:'Room 1'},{id:'p2',company_id:'client',year:2025,training_topic:'Previous year',training_type:'internal'}],
  training_followup:[{id:'r1',company_id:'client',person_name:'Learner',training_topic:'First aid',passed:null,attendance_status:'pending',evidence_review_status:'pending',training_date:'2026-10-24'}],
  authorisations:[{id:'c1',company_id:'client',person_name:'Learner',authorisation_type:'First aid',status:'active',expiry_date:'2026-10-19'}],
  people:[{id:'worker',company_id:'client',first_name:'Asha',last_name:'Shah',status:'active'},{id:'inactive',company_id:'client',status:'inactive'}],
  competencies:[{id:'first-aid',company_id:'client',name:'First aid'},{id:'height',company_id:'client',name:'Work at height'},{id:'fire',company_id:'client',name:'Fire safety'}],
  competency_matrix:[{id:'cm1',company_id:'client',person_id:'worker',competency_id:'first-aid',current_level:0,required_level:2},{id:'cm2',company_id:'client',person_id:'worker',competency_id:'height',current_level:null,required_level:2}],
  learning_practical_assessments:[{id:'pa',company_id:'client',reference:'PRA-1',candidate_name:'Learner',competency_name:'Height',result:'not_yet_competent',status:'draft',critical_failure:true,verification_status:'pending'}],
  induction_records:[],training_needs:[],elearning_courses:[],elearning_enrolments:[]
 };
 const c={Date:FixedDate,Intl,URL,Map,console,location:{href:'https://example.test/',origin:'https://example.test'},document:{getElementById:()=>null},prof:{id:'admin',role:'sephs_admin',company_id:'sephs'},co:{id:'sephs',name:'SEPHS Consulting',logo_url:'/wrong-logo.png'},saCompanyList:[{id:'client',name:'Client Engineering <Ltd>',logo_url:'/client-logo.png'}],ccid:()=>company,AurisUserAccess:{sectionAllowed:()=>!denied},apiAllRows:async url=>{calls.push(url);const key=url.split(/[/?]/)[1];return JSON.parse(JSON.stringify(tables[key]||[]));}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c);return {api:c.AurisTrainingPrint,c,tables,calls,company:value=>company=value,deny:()=>denied=true};
}
test('switched administrators print the selected client name and logo without SEPHS branding',async()=>{
 const h=runtime(),s=await h.api.capture('plan',{scope:'company',year:2026,paper:'A4'},h.api.context()),html=h.api.documentHtml(s);
 assert.equal(s.count,1);assert.equal(s.company.name,'Client Engineering <Ltd>');assert.match(html,/Client Engineering &lt;Ltd&gt;/);assert.match(html,/src="https:\/\/example.test\/client-logo.png"/);assert.doesNotMatch(html,/SEPHS|wrong-logo/);assert.match(html,/First aid &amp; &lt;rescue&gt;/);assert.doesNotMatch(html,/Previous year/);assert.match(html,/24\/10\/2026/);
});
test('a missing selected-company identity does not borrow the administrator brand',()=>{
 const h=runtime();h.company('unknown');assert.throws(()=>h.api.brand(h.api.context()),/selected company details/);h.company('');assert.throws(h.api.context,/select one company/);
});

test('portfolio mode requires an explicit company instead of printing the administrator fallback',()=>{
 const h=runtime();h.c.isSA=()=>true;h.c.sephsCompanyContext=null;h.company('sephs');assert.throws(h.api.context,/Select one company/);h.c.sephsCompanyContext='client';h.company('client');assert.equal(h.api.brand(h.api.context()).name,'Client Engineering <Ltd>');
});

test('legacy tables without reliable company provenance cannot be printed as current lists',async()=>{
 const h=runtime();h.c.AurisTrainingReportState=()=>({tab:'inductions',company:'client'});await assert.rejects(h.api.capture('inductions',{scope:'current',paper:'A4'},h.api.context()),/Open this Training page/);assert.equal(h.calls.length,0);
 const fresh=await h.api.capture('inductions',{scope:'company',paper:'A4'},h.api.context());assert.match(fresh.html,/No matching/);
});
test('all company-data reads are explicitly scoped and foreign rows are rejected',async()=>{
 const h=runtime(),before=JSON.stringify(h.tables);await h.api.capture('matrix',{scope:'company',paper:'A3'},h.api.context());assert.ok(h.calls.every(u=>u.includes('company_id=eq.client')&&u.includes('order=id.asc')));assert.equal(JSON.stringify(h.tables),before);
 h.tables.training_plan.push({id:'foreign',company_id:'other',year:2026});await assert.rejects(h.api.capture('plan',{scope:'company',paper:'A4'},h.api.context()),/did not match the selected company/);
});
test('session and section access changes stop pending report generation',async()=>{
 const h=runtime(),ctx=h.api.context();h.deny();await assert.rejects(h.api.capture('plan',{scope:'company'},ctx),/do not have access/);assert.equal(h.calls.length,0);
 const x=runtime(),expected=x.api.context();x.c.apiAllRows=async()=>{x.company('other');return x.tables.training_plan;};await assert.rejects(x.api.capture('plan',{scope:'company',paper:'A4'},expected),/account or company changed/);
});
test('matrix reports preserve zero, null and absent levels and show recorded gaps only',async()=>{
 const h=runtime(),s=await h.api.capture('matrix',{scope:'company',paper:'A4'},h.api.context());assert.equal(s.count,1);assert.match(s.html,/0 \/ 2/);assert.match(s.html,/— \/ 2/);assert.match(s.html,/— \/ —/);assert.match(s.html,/Not assessed/);assert.match(s.html,/<small>Gap<\/small>/);assert.doesNotMatch(s.html,/inactive/);assert.match(s.html,/Missing levels are never counted as zero/);
 h.tables.competency_matrix.push({...h.tables.competency_matrix[0],id:'duplicate',current_level:4});const conflict=await h.api.capture('matrix',{scope:'company',paper:'A4'},h.api.context());assert.match(conflict.html,/Multiple records<br>Review required/);
});
test('wide matrices split into readable labelled competency groups',()=>{
 const h=runtime(),data={...h.tables,competencies:Array.from({length:19},(_,i)=>({id:'c'+i,name:'Competency '+i,company_id:'client'}))};assert.equal((h.api.buildRows('matrix',data,null,'A4').html.match(/trp-matrix-block/g)||[]).length,3);assert.equal((h.api.buildRows('matrix',data,null,'A3').html.match(/trp-matrix-block/g)||[]).length,2);
});
test('pending, failed and critical outcomes cannot become a passed or authorised document',async()=>{
 const h=runtime();assert.equal(h.api.outcome(null),'Pending assessment');assert.equal(h.api.outcome(false),'Fail');assert.equal(h.api.outcome('true'),'Pending assessment');
 const pending=await h.api.capture('records',{scope:'company',paper:'A4'},h.api.context());assert.match(pending.html,/Pending assessment/);assert.match(pending.html,/Pending/);
 const practical=await h.api.capture('assessments',{scope:'company',paper:'A4'},h.api.context());assert.match(practical.html,/Not Yet Competent/);assert.match(practical.html,/Yes/);assert.match(practical.html,/Draft/);assert.match(practical.html,/Pending/);
 const cert=await h.api.capture('certificates',{scope:'company',paper:'A4'},h.api.context());assert.match(cert.html,/Expired/);assert.match(cert.html,/Active/);assert.match(cert.note,/not an issued certificate/);
});
test('every offered report builds a named register or an explicit empty-data message',async()=>{
 const h=runtime();for(const kind of Object.keys(h.api.reports)){const s=await h.api.capture(kind,{scope:'company',paper:'A4'},h.api.context());assert.ok(s.title);assert.match(s.html,/<table|No matching|No active/);}
});
test('custom Training tabs map correctly without relying on stale legacy tab buttons',()=>{
 const h=runtime();for(const [tab,kind] of Object.entries({sessions:'plan',records:'records',certificates:'certificates',competency:'matrix',gaps:'gaps',inductions:'inductions',assessments:'assessments',external:'external'})){h.c.AurisTrainingReportState=()=>({tab});assert.equal(h.api.currentKind(),kind);}
});
