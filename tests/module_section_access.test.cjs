const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const access=require('../auris-user-access.js');
test('management navigation is reserved for company and SEPHS administrators for every other role',()=>{
 for(const role of ['employee','user','hse_manager','hse_officer','executive','supervisor','contractor'])for(const key of ['people','users','admin','integrations','approvals','audit','settings','master-data'])assert.equal(access.pageAllowed({role},key),false,role+' '+key);
 for(const role of ['admin','sephs_admin'])for(const key of ['people','users','settings'])assert.equal(access.pageAllowed({role},key),true);
 assert.equal(access.pageAllowed({role:'employee'},'inspection'),true);
});
test('section restrictions inherit module restrictions and all hidden sections remove the module',()=>{
 const p={role:'employee',permissions:{access_v1:{'ppe.issuance':{view:false},ppe:{edit:false}}}};
 assert.equal(access.sectionAllowed(p,'ppe','issuance'),false);assert.equal(access.sectionAllowed(p,'ppe','catalogue'),true);assert.equal(access.allowed(p,'ppe.catalogue','edit'),false);
 assert.ok(access.firstSection(p,'ppe'));for(const s of access.sections.ppe)p.permissions.access_v1['ppe.'+s.id]={view:false};assert.equal(access.pageAllowed(p,'ppe'),false);assert.equal(access.firstSection(p,'ppe'),undefined);
 p.permissions.access_v1.ppe={view:false};assert.equal(access.sectionAllowed(p,'ppe','catalogue'),false);
});
test('section keys are validated explicitly and cannot grant arbitrary section privileges',()=>{
 const keys=access.sectionKeys();assert.ok(keys.includes('training.elearning'));assert.deepEqual(access.validate({'training.elearning':{view:false}},keys),{'training.elearning':{view:false}});assert.throws(()=>access.validate({'training.fake':{view:true}},keys));
});
test('company selector renders one company and preserves selection through refresh and company removal',()=>{
 const c={console};c.globalThis=c;for(const file of ['auris-module-registry.js','auris-module-runtime.js','auris-applications-admin.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),c);
 const picker={value:'',addEventListener(kind,fn){this.change=fn;}};
 const host={innerHTML:'',querySelector(s){return s==='[data-app-company]'?picker:null;},querySelectorAll(){return[];}};
 const companies=[{id:'a',name:'Alpha',module_access:['dashboard']},{id:'b',name:'Beta',module_access:['dashboard']}];
 c.AurisApplicationsAdmin.renderPortfolio(host,companies,{companyId:'b'});assert.equal((host.innerHTML.match(/class="auris-app-company"/g)||[]).length,1);assert.ok(host.innerHTML.includes('data-company-id="b"'));
 picker.value='a';picker.change();assert.ok(host.innerHTML.includes('data-company-id="a"'));c.AurisApplicationsAdmin.renderPortfolio(host,companies,{});assert.ok(host.innerHTML.includes('data-company-id="a"'));
 c.AurisApplicationsAdmin.renderPortfolio(host,[companies[1]],{});assert.ok(host.innerHTML.includes('data-company-id="b"'));
});

test('section controls read the real global lexical session, not only window properties',()=>{
 const c={console};c.globalThis=c;vm.runInNewContext("let prof={role:'employee',permissions:{access_v1:{'ppe.issuance':{view:false}}}};",c);vm.runInNewContext(fs.readFileSync('auris-user-access.js','utf8'),c);
 assert.equal(c.prof,undefined);assert.equal(c.AurisUserAccess.currentProfile().role,'employee');assert.equal(c.AurisUserAccess.sectionAllowed(c.AurisUserAccess.currentProfile(),'ppe','issuance'),false);
});
