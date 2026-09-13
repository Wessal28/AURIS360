const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const core=read('auris-core.js');

function runtime(){
  let mounted;
  const home={id:'home',name:'Administrator company'},client={id:'client',name:'Selected client'};
  const ctx={prof:{id:'admin',company_id:'home',role:'sephs_admin',full_name:'Administrator'},co:home,tok:'test-session',
    sephsCompanyContext:'client',saCompanyList:[home,client],
    isSA:()=>ctx.prof?.role==='sephs_admin',activeRole:()=>ctx.prof?.role||'',canAccessPage:()=>true,
    AurisViewEngine:{mount:(host,rows,options)=>{mounted={rows,options};return mounted;}}};
  ctx.window=ctx;vm.createContext(ctx);
  for(const name of ['cf','ccid','sidebarViewedCompany']){
    const start=core.indexOf('function '+name+'(');
    vm.runInContext(core.slice(start,core.indexOf('\n}',start)+2),ctx);
  }
  vm.runInContext(read('auris-platform-services.js'),ctx);
  const start=core.indexOf('if(window.AurisPlatformServices){\n  window.AurisPlatformServices.configure(');
  assert.notEqual(start,-1);
  vm.runInContext(core.slice(start,core.indexOf('\nif(window.AurisGovernancePersistence',start)),ctx);
  vm.runInContext(read('auris-action-list-workspace.js'),ctx);
  return {ctx,services:ctx.AurisPlatformServices,mounted:()=>mounted};
}

test('selected administrator company is consistent between authentication and API context',()=>{
  const {ctx,services}=runtime();
  assert.equal(services.api.companyId(),'client');
  assert.equal(services.auth.current().company.id,services.api.companyId());
  assert.equal(services.auth.current().company.name,'Selected client');
  assert.equal(services.auth.current().profile.company_id,'home');
  assert.equal(ctx.co.id,'home');
});

test('action register displays selected-client records and rejects callbacks after switching companies',async()=>{
  const r=runtime(),opened=[];
  const rows=[{id:'client-action',company_id:'client',title:'Selected client action'},{id:'home-action',company_id:'home',title:'Home action'}];
  r.ctx.AurisActionListWorkspace.mount({},rows,{openRecord:(id,session)=>opened.push([id,session.companyId])});
  const m=r.mounted();
  assert.deepEqual(Array.from(m.rows,row=>row.id),['client-action']);
  await m.options.onAction('open',m.rows[0]);
  assert.deepEqual(opened,[['client-action','client']]);
  r.ctx.sephsCompanyContext='another-client';
  await assert.rejects(m.options.onAction('open',m.rows[0]),/company changed/);
  assert.equal(opened.length,1);
});

test('missing selected-company metadata never falls back to the administrator home company',()=>{
  const {ctx,services}=runtime();ctx.saCompanyList=[];
  assert.equal(services.auth.current().company.id,'client');
  assert.equal(services.auth.current().company.name,undefined);
});

test('ordinary users and all-company administrator fallback keep their assigned company context',()=>{
  const {ctx,services}=runtime();ctx.sephsCompanyContext=null;
  assert.equal(services.auth.current().company.id,'home');
  ctx.prof.role='company_admin';ctx.sephsCompanyContext='client';
  assert.equal(services.auth.current().company.id,'home');
});

test('signed-out platform context cannot expose stale company metadata',()=>{
  const {ctx,services}=runtime();ctx.prof=null;ctx.tok=null;
  assert.equal(services.auth.isAuthenticated(),false);
  assert.equal(services.auth.current().company,null);
});
