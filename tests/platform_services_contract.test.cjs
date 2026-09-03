const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');

function context(){
  const sandbox={globalThis:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'auris-platform-services.js'),'utf8'),sandbox);
  return sandbox.globalThis;
}

test('platform services expose stable facades and readiness diagnostics',()=>{
  const window=context(),services=window.AurisPlatformServices;
  assert.equal(services.version,'1.0.0');
  assert.deepEqual(Array.from(services.names),['auth','api','rbac','audit','notifications']);
  assert.equal(services.ready(),false);
  assert.throws(()=>services.api.request('/events'),/not configured: api/);
  services.configure('api',{request:path=>'GET '+path,companyFilter:()=>'&company_id=eq.1',companyId:()=>'1'});
  assert.equal(services.api.request('/events'),'GET /events');
  assert.equal(services.api.companyId(),'1');
  assert.equal(services.get('api'),services.api);
  assert.equal(services.health().api,true);
});

test('service adapters can be installed together without replacing facade identities',()=>{
  const services=context().AurisPlatformServices,apiFacade=services.api,events=[];
  services.subscribe(detail=>events.push(detail.name));
  services.configure({
    auth:{current:()=>({profile:{id:'user-1'}}),isAuthenticated:()=>true,signIn:()=>{},signOut:()=>{},restore:()=>{}},
    api:{request:()=>[],companyFilter:()=>'',companyId:()=>'company-1'},
    rbac:{role:()=>'manager',can:()=>true,canAccess:key=>key==='events',requireAccess:key=>{if(key!=='events')throw new Error('denied');return true;}},
    audit:{log:()=>true},
    notifications:{queue:payload=>payload,relationship:payload=>payload.relationship,open:id=>id,recipientIssue:()=>''}
  });
  assert.equal(services.api,apiFacade);
  assert.equal(services.ready(),true);
  assert.deepEqual(events,['auth','api','rbac','audit','notifications']);
  assert.equal(services.rbac.canAccess('events'),true);
  assert.equal(services.notifications.queue({id:'n1'}).id,'n1');
});

test('application loads services before runtime and core compatibility adapters',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const core=fs.readFileSync(path.join(root,'auris-core.js'),'utf8');
  assert.ok(html.indexOf('auris-module-registry.js?v=20260903-28')<html.indexOf('auris-platform-services.js?v=20260831-3'));
  assert.ok(html.indexOf('auris-platform-services.js?v=20260831-3')<html.indexOf('auris-module-runtime.js?v=20260901-13'));
  assert.ok(html.indexOf('auris-module-runtime.js?v=20260901-13')<html.indexOf('auris-core.js?v=20260903-28'));
  assert.match(core,/AurisPlatformServices\.configure\(\{/);
  for(const name of ['auth','api','rbac','audit','notifications'])assert.match(core,new RegExp('\\n    '+name+':'));
});
