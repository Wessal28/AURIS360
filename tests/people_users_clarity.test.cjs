const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('auris-core.js','utf8');
function source(name){const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(core);assert.ok(match,name);const tail=core.slice(match.index);for(const end of tail.matchAll(/^}\s*$/gm)){const candidate=tail.slice(0,end.index+end[0].length);try{new vm.Script(candidate);return candidate;}catch{}}throw Error('Incomplete function '+name);}
function fixture(names){
 const nodes={},notices=[],writes=[];let company='company-a',sa=true,confirmation=true;
 function node(id,value=''){return nodes[id]={id,value,textContent:'',innerHTML:'',style:{},classList:{contains:()=>true},selectedOptions:[],options:[],appendChild(o){this.options.push(o);}};}
 const context={console,String,Array,Object,Map,Set,Date,Promise,prof:{id:'actor',company_id:'company-a'},co:{name:'Fictional company A'},peAllData:[],peopleProfileRequest:0,usersAllData:[],usersCompanyScope:'',usersRoleSnapshot:null,usersRoleBusy:false,document:{getElementById:id=>nodes[id]||null,createElement:()=>({})},ccid:()=>company,cf:()=>'',isSA:()=>sa,isAdm:()=>true,usersCanEditUser:u=>!!u,usersCanAdminUser:u=>!!u&&u.id!=='actor',usersRoleChangeAllowed:(u,r)=>u.id!=='actor'||u.role===r,toast:m=>notices.push(m),toastActionError:(a,b,e)=>notices.push(e.message),escH:v=>String(v||'').replaceAll('<','&lt;'),auditLabel:v=>v,peopleName:p=>[p.first_name,p.last_name].filter(Boolean).join(' '),peopleProfileShell:p=>'PROFILE '+p.id,peopleProfileDetails:()=>'',peopleMiniTable:()=>'',peopleRowMatchesPerson:()=>false,peopleTextMatchesPerson:()=>false,bulletinChecks:()=>[],usersRender:rows=>{context.rendered=rows;},usersLoad:async()=>{},api:async()=>[],appConfirmAction:async x=>{context.confirmation=x;return confirmation;},adminFnCall:async(action,payload)=>{writes.push({action,payload});const u=context.usersAllData.find(u=>u.id===payload.user_id);if(u)Object.assign(u,payload);}};
 context.window=context;context.AurisUserAccess=require('../auris-user-access.js');
 vm.createContext(context);const a=core.indexOf('var ROLE_ALLOWED ='),b=core.indexOf('// Controlled rollout cohorts',a);vm.runInContext(core.slice(a,b),context);
 const r=core.indexOf('const HSE_ROLES ='),re=core.indexOf('// -- Role helper',r);vm.runInContext(core.slice(r,re),context);
 for(const name of names)vm.runInContext(source(name),context);
 return {c:context,nodes,node,notices,writes,setCompany:v=>{company=v;},setSA:v=>{sa=v;},setConfirmation:v=>{confirmation=v;}};
}
test('People search combines name/staff/contact matches with every supported status and type',()=>{
 const f=fixture(['peopleFilteredRows']);for(const id of ['filter-ptype','filter-pstatus','people-search'])f.node(id);
 f.c.peAllData=[{id:'one',first_name:'Ada',last_name:'Example',employee_number:'STAFF-21',email:'ada@example.test',phone:'+971 555',person_type:'employee',status:'suspended'},{id:'two',first_name:'Ada',person_type:'contractor',status:'inactive'}];
 f.nodes['filter-pstatus'].value='suspended';f.nodes['filter-ptype'].value='employee';
 for(const query of ['Ada','staff-21','example.test','971 555']){f.nodes['people-search'].value=query;assert.equal(f.c.peopleFilteredRows()[0].id,'one');}
 f.nodes['filter-pstatus'].value='inactive';assert.equal(f.c.peopleFilteredRows().length,0);
});
test('closing a loading People profile prevents its late response replacing another module',async()=>{
 const f=fixture(['peopleOpenProfile','peopleCloseProfile']);for(const id of ['page-people','user-profile-modal','upm3body'])f.node(id);
 f.c.peAllData=[{id:'one',first_name:'Fictional'}];let finish;f.c.api=()=>new Promise(resolve=>{finish=resolve;});
 // Resolve all six parallel reads together.
 const resolvers=[];f.c.api=()=>new Promise(resolve=>resolvers.push(resolve));const pending=f.c.peopleOpenProfile('one');
 assert.match(f.nodes.upm3body.innerHTML,/Loading linked activity/);f.c.peopleCloseProfile();f.nodes.upm3body.innerHTML='USER PROFILE';resolvers.forEach(r=>r([]));await pending;
 assert.equal(f.nodes.upm3body.innerHTML,'USER PROFILE');assert.equal(f.nodes['user-profile-modal'].style.display,'none');
});
test('a changed company invalidates the pending People profile response',async()=>{
 const f=fixture(['peopleOpenProfile']);for(const id of ['page-people','user-profile-modal','upm3body'])f.node(id);f.c.peAllData=[{id:'one'}];const done=[];f.c.api=()=>new Promise(r=>done.push(r));const pending=f.c.peopleOpenProfile('one');f.setCompany('company-b');f.nodes.upm3body.innerHTML='COMPANY B';done.forEach(r=>r([]));await pending;assert.equal(f.nodes.upm3body.innerHTML,'COMPANY B');
});
test('company, search, role and status filters compose; company admins never gain another company',()=>{
 const f=fixture(['usersScopedRows','usersFilteredRows']);for(const id of ['users-search','users-filter-role','users-filter-status'])f.node(id);
 f.c.usersAllData=[{id:'a',company_id:'company-a',full_name:'Fictional Ada',role:'hse_officer',status:'active'},{id:'b',company_id:'company-b',full_name:'Fictional Ada',role:'hse_officer',status:'active'},{id:'c',company_id:'company-a',full_name:'Fictional Ada',role:'employee',status:'inactive'}];
 f.c.usersCompanyScope='company-a';f.nodes['users-search'].value='ada';f.nodes['users-filter-role'].value='hse_officer';f.nodes['users-filter-status'].value='active';assert.deepEqual(Array.from(f.c.usersFilteredRows(),r=>r.id),['a']);
 f.setSA(false);f.c.usersCompanyScope='company-b';assert.deepEqual(Array.from(f.c.usersScopedRows(),r=>r.id),['a','c']);
});
test('permission display includes HSE Officer and does not turn View or unrestricted settings into approval grants',()=>{
 const f=fixture(['usersRoleModuleVisible','usersRestrictionLabel','usersRoleLabel','rolesRenderMatrix','usersRenderAccessSummary','usersScopedRows']);f.c.AurisModuleRegistry={list:()=>[{key:'inspection',name:'Audits and inspections'},{key:'users',name:'Users and roles'}]};for(const id of ['roles-matrix-head','roles-matrix-body','roles-access-legend','roles-account-select','roles-account-access'])f.node(id);
 f.c.rolesRenderMatrix();assert.match(f.nodes['roles-matrix-head'].innerHTML,/HSE Officer/);assert.doesNotMatch(f.nodes['roles-matrix-body'].innerHTML,/>\?</);assert.match(f.nodes['roles-access-legend'].textContent,/View never implies approval authority/);
 const user={id:'one',role:'hse_officer',permissions:{access_v1:{inspection:{edit:false}}}};assert.equal(f.c.usersRestrictionLabel(user,'inspection','view'),'View');assert.equal(f.c.usersRestrictionLabel(user,'inspection','edit'),'Restricted');assert.equal(f.c.usersRestrictionLabel(user,'inspection','create'),'Role / record rules');assert.equal(f.c.usersRoleModuleVisible('hse_officer','users'),false);
});
test('role changes use selected account ID and server administration; cancellation makes no request',async()=>{
 const f=fixture(['usersScopedRows','usersRoleLabel','updateRole']);for(const id of ['ur-user','ur-role','ur-job-title','ur-department'])f.node(id);
 f.c.usersAllData=[{id:'one',company_id:'company-a',full_name:'Fictional Ada',email:'fictional@example.test',role:'employee',companies:{name:'Fictional A'}}];f.nodes['ur-user'].value='one';f.nodes['ur-role'].value='hse_officer';f.c.usersRoleSnapshot={id:'one',role:'employee',actor:'actor',scope:'company-a'};
 f.setConfirmation(false);await f.c.updateRole();assert.equal(f.writes.length,0);
 f.setConfirmation(true);await f.c.updateRole();assert.equal(f.writes.length,1);assert.equal(f.writes[0].action,'update_user');assert.equal(f.writes[0].payload.user_id,'one');assert.equal(f.writes[0].payload.role,'hse_officer');
});
test('a role update cannot submit a stale account after company context changes',async()=>{
 const f=fixture(['usersScopedRows','usersRoleLabel','updateRole']);f.node('ur-user','one');f.node('ur-role','hse_officer');f.c.usersAllData=[{id:'one',role:'employee',company_id:'company-a'}];f.c.usersRoleSnapshot={id:'one',role:'employee',actor:'actor',scope:'company-a'};f.setCompany('company-b');await f.c.updateRole();assert.equal(f.writes.length,0);
});
test('legacy deactivate links and the labelled login action share the server-enforced path',async()=>{
 const f=fixture(['usersDelete','usersToggleStatus']);f.c.usersAllData=[{id:'one',full_name:'Fictional Ada',status:'active'}];await f.c.usersDelete('one');assert.equal(f.writes[0].action,'deactivate_user');assert.match(f.c.confirmation.detail,/reversible/);assert.ok(!f.writes.some(w=>w.action==='delete_user'));
});

test('People deactivation uses an accurately labelled reversible PATCH and never deletes history',async()=>{
 const f=fixture(['peopleDeactivate']);f.c.peopleCanManage=()=>true;f.c.loadPeople=async()=>{};f.c.loadPeopleCache=async()=>{};const writes=[];f.c.api=async(path,options)=>{writes.push({path,options});return [];};await f.c.peopleDeactivate('fictional-person');
 assert.equal(f.c.confirmation.title,'Deactivate person');assert.equal(f.c.confirmation.confirmText,'Deactivate');assert.match(f.c.confirmation.detail,/history are retained/);assert.equal(writes.length,1);assert.equal(writes[0].options.m,'PATCH');assert.equal(writes[0].options.b.status,'inactive');
});
