const test=require('node:test'),assert=require('node:assert/strict');
const actorId='11111111-1111-4111-8111-111111111111',companyId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherCompany='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const personId='22222222-2222-4222-8222-222222222222',userId='33333333-3333-4333-8333-333333333333',existingId='44444444-4444-4444-8444-444444444444';
const handler=require('../api/user-administration.js');
function fixture(options={}){
 const actor={id:actorId,company_id:companyId,role:'admin',status:'active',...options.actor},person={id:personId,company_id:companyId,first_name:'Ada',last_name:'Example',email:'ada@example.test',phone:'+230 5123 4567',person_type:'employee',status:'active',job_title:'Technician',department:'Maintenance',site:'Depot',...options.person};
 const profiles=new Map([[actorId,actor]]);if(options.target)profiles.set(existingId,{id:existingId,company_id:companyId,person_id:null,full_name:'Persisted Account Name',email:'persisted@example.test',phone:'+23059990000',role:'manager',status:'active',permissions:{access_v1:{people:{edit:false}}},...options.target});
 const calls=[],response=(data,status=200)=>new Response(JSON.stringify(data),{status});let authCreated=false,committed=false,authRaced=false;
 const rpcCalls=()=>calls.filter(c=>c.path==='/rest/v1/rpc/admin_link_user_person');
 const authWrites=()=>calls.filter(c=>['/auth/v1/invite','/auth/v1/admin/users'].includes(c.path)&&c.method==='POST');
 const fetchImpl=async(input,init={})=>{
  const url=new URL(input),path=url.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):null,query=url.searchParams;calls.push({path,method,body,query,headers:init.headers});assert.equal(url.origin,'https://fixture.supabase.co');
  if(path==='/auth/v1/user'&&method==='GET')return response({id:actorId});
  if(path==='/rest/v1/profiles'&&method==='GET'){
   if(options.readbackError&&authCreated&&query.get('id')==='eq.'+userId)throw Error('Synthetic readback transport failure');
   const id=query.get('id')?.replace(/^eq\./,'');if(id)return response(profiles.has(id)?[structuredClone(profiles.get(id))]:[]);
   if(query.has('person_id'))return response([...profiles.values()].filter(p=>p.person_id===personId));
   return response([...profiles.values()].filter(p=>p.id!==actorId));
  }
  if(path==='/rest/v1/people'&&method==='GET')return response(query.get('id')&&query.get('id')!=='eq.'+personId?[]:[structuredClone(person)]);
  if(path==='/rest/v1/rpc/admin_link_user_person'&&method==='POST'){
   assert.equal(body.p_actor_id,actorId);assert.equal(body.p_company_id,companyId);assert.equal(typeof body.p_preview,'boolean');
   if(options.rpcMissing)return response({code:'PGRST202',message:'Function unavailable'},404);
   if(body.p_preview){if(options.previewError)return response(options.previewError);return response(options.preview||{ok:true,user_id:authRaced?existingId:committed?userId:null,person_id:personId,person_created:false,person_reused:true,existing:authRaced||committed,login:person.email});}
   if(options.denyExistingCommit&&body.p_user_id===existingId)return response({code:'42501',message:'Existing account editing is not permitted'},403);
   if(options.commitError||options.commitTransportError){if(options.committedDespiteError){profiles.set(userId,{id:userId,company_id:companyId,person_id:personId,status:'active',role:'employee'});committed=true;}if(options.commitTransportError)throw Error('Synthetic commit transport failure');return response({code:'23505',message:'Synthetic link conflict'},409);}
   const id=body.p_user_id||existingId;if(!options.skipCommitWrite){committed=true;if(!profiles.has(id))profiles.set(id,{id,company_id:companyId,...body.p_profile});profiles.get(id).person_id=personId;}
   return response(options.commit||{ok:true,user_id:id,person_id:personId,person_created:false,person_reused:true,existing:!!options.target,login:person.email});
  }
  if(['/auth/v1/invite','/auth/v1/admin/users'].includes(path)&&method==='POST'){
   if(options.authRaceExisting){authRaced=true;profiles.set(existingId,{id:existingId,company_id:companyId,full_name:'Race-winning persisted account',email:person.email,role:'manager',status:'active',person_id:null});return response({message:'Account already exists'},422);}
   if(options.authError)return response({message:'Synthetic Auth refusal'},422);authCreated=true;
   const meta=body.data||body.user_metadata||{};profiles.set(userId,{id:userId,company_id:meta.company_id,full_name:meta.full_name,email:body.email||null,phone:body.phone||null,role:meta.role,status:'active',person_id:options.triggerLinked?personId:null});
   return response({id:userId});
  }
  if(path==='/auth/v1/admin/users/'+userId&&method==='DELETE'){if(options.deleteError)return response({message:'Synthetic cleanup refusal'},503);profiles.delete(userId);return response({});}
  throw Error('Unexpected fixture request '+method+' '+path);
 };
 return {actor,person,profiles,calls,fetchImpl,rpcCalls,authWrites,get committed(){return committed;}};
}
async function invoke(f,body,request={}){
 const oldFetch=global.fetch,vars={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_KEY:'synthetic-service-secret',SUPABASE_ANON_KEY:'synthetic-public-key'},previous={};global.fetch=f.fetchImpl;
 for(const key of Object.keys(vars)){previous[key]=process.env[key];process.env[key]=vars[key];}
 const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 try{await handler({method:'POST',headers:{authorization:'Bearer synthetic-session'},body,...request},res);return res;}finally{global.fetch=oldFetch;for(const key of Object.keys(vars))if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
}
const creation=(extra={})=>({action:'invite_user',company_id:companyId,full_name:'Ada Example',email:'ada@example.test',role:'employee',...extra});
test('creation performs identity preview before Auth and finalizes the exact newly created identity',async()=>{
 const f=fixture(),r=await invoke(f,creation({person_id:personId,permissions:{all:true}}));assert.equal(r.code,200);assert.equal(r.body.person_id,personId);assert.equal(r.body.user_id,userId);
 const [preview,commit]=f.rpcCalls();assert.equal(preview.body.p_preview,true);assert.equal(commit.body.p_preview,false);assert.equal(commit.body.p_user_id,userId);assert.equal(commit.body.p_person_id,personId);
 assert.ok(f.calls.indexOf(preview)<f.calls.indexOf(f.authWrites()[0]));assert.ok(f.calls.indexOf(f.authWrites()[0])<f.calls.indexOf(commit));
 const invite=f.authWrites()[0];assert.equal(invite.path,'/auth/v1/invite');assert.equal(invite.body.data.company_id,companyId);assert.equal(invite.body.data.person_id,personId);assert.equal(invite.body.data.permissions,undefined);assert.equal(commit.body.p_profile.permissions,undefined);
});
test('ambiguity, contradictory identities and a missing identity RPC fail before any account or invitation',async()=>{
 for(const previewError of [{ok:false,code:'person_match_required',error:'Select an existing person',candidates:[{id:personId,first_name:'Ada'}]},{ok:false,code:'identity_conflict',error:'Email and phone identify different people'}]){
  const f=fixture({previewError}),r=await invoke(f,creation());assert.equal(r.code,409);assert.equal(r.body.code,previewError.code);assert.equal(f.authWrites().length,0);assert.equal(f.rpcCalls().length,1);
 }
 const f=fixture({rpcMissing:true}),r=await invoke(f,creation());assert.ok(r.code>=400);assert.equal(f.authWrites().length,0);assert.equal(f.rpcCalls().length,1);
});
test('an existing account is linked without invitation, credentials, role changes or access escalation',async()=>{
 const target={person_id:null,role:'manager',status:'inactive'},f=fixture({target,preview:{ok:true,user_id:existingId,person_id:personId,person_reused:true,existing:true,login:'persisted@example.test'}}),before=structuredClone(f.profiles.get(existingId));
 const r=await invoke(f,creation({role:'admin',password:'DoNotReturnMe1!'}));assert.equal(r.code,200);assert.equal(r.body.existing,true);assert.equal(r.body.user_id,existingId);assert.equal(f.authWrites().length,0);assert.equal(r.body.temporary_password,undefined);assert.equal(r.body.password,undefined);
 const after=f.profiles.get(existingId);assert.equal(after.role,before.role);assert.equal(after.status,before.status);assert.deepEqual(after.permissions,before.permissions);assert.ok(!f.calls.some(c=>c.path==='/rest/v1/profiles'&&c.method!=='GET'));assert.ok(!f.calls.some(c=>c.method==='DELETE'));
});
test('People onboarding uses persisted People details and ignores client identity and privileged role overrides',async()=>{
 const f=fixture(),r=await invoke(f,{action:'onboard_person',person_id:personId,email:'attacker@example.test',phone:'+1234567890',role:'sephs_admin',company_id:otherCompany,permissions:{all:true}});assert.equal(r.code,200);
 const invite=f.authWrites()[0];assert.equal(invite.body.email,'ada@example.test');assert.equal(invite.body.data.full_name,'Ada Example');assert.equal(invite.body.data.role,'employee');assert.equal(invite.body.data.company_id,companyId);assert.equal(invite.body.data.person_id,personId);assert.equal(invite.body.data.permissions,undefined);
});
test('direct-created accounts use the same identity preview and commit path without emailing an invitation',async()=>{
 const f=fixture(),r=await invoke(f,creation({action:'create_user',password:'SyntheticTemporary12!',person_id:personId}));assert.equal(r.code,200);assert.equal(f.authWrites().length,1);assert.equal(f.authWrites()[0].path,'/auth/v1/admin/users');assert.equal(f.authWrites()[0].body.email,'ada@example.test');assert.equal(f.authWrites()[0].body.password,'SyntheticTemporary12!');assert.equal(f.authWrites()[0].body.user_metadata.person_id,personId);assert.equal(f.rpcCalls()[0].body.p_preview,true);assert.equal(f.rpcCalls()[1].body.p_preview,false);
});
test('phone onboarding normalizes saved People phone and never trusts a client supplied password or contact',async()=>{
 const f=fixture({person:{email:''}}),r=await invoke(f,{action:'onboard_person',person_id:personId,channel:'phone',phone:'+1234567890',password:'ClientOverride1!',role:'admin'});assert.equal(r.code,200);const auth=f.authWrites()[0];assert.equal(auth.path,'/auth/v1/admin/users');assert.equal(auth.body.phone,'+23051234567');assert.notEqual(auth.body.password,'ClientOverride1!');assert.ok(auth.body.password.length>=12);assert.equal(auth.body.user_metadata.role,'employee');assert.equal(r.body.temporary_password,auth.body.password);assert.ok(!f.calls.some(c=>c.path.includes('/otp')));
});
test('linking and previewing an existing user derive identity from the persisted profile',async()=>{
 for(const action of ['preview_user_person','link_user_person']){
  const f=fixture({target:{},preview:{ok:true,user_id:existingId,person_id:personId,person_reused:true,existing:true,login:'persisted@example.test'}}),r=await invoke(f,{action,user_id:existingId,person_id:personId,full_name:'Attacker text',email:'attacker@example.test',role:'sephs_admin',company_id:otherCompany});assert.equal(r.code,200);assert.equal(f.authWrites().length,0);
  for(const call of f.rpcCalls()){assert.equal(call.body.p_company_id,companyId);assert.equal(call.body.p_user_id,existingId);assert.equal(call.body.p_profile.full_name,'Persisted Account Name');assert.equal(call.body.p_profile.email,'persisted@example.test');assert.equal(call.body.p_profile.role,'manager');}
 }
});
test('unauthorized actors, inaccessible People and foreign existing users cannot trigger linking or account creation',async()=>{
 for(const actor of [{status:'inactive'},{role:'employee'},{permissions:{access_v1:{users:{create:false,edit:false}}}},{permissions:{access_v1:{people:{view:false}}}}]){
  const f=fixture({actor}),r=await invoke(f,creation());assert.equal(r.code,403);assert.equal(f.authWrites().length,0);assert.equal(f.rpcCalls().length,0);
 }
 for(const person of [{company_id:otherCompany},{status:'inactive'},{status:'suspended'}]){const f=fixture({person}),r=await invoke(f,{action:'onboard_person',person_id:personId});assert.ok(r.code>=400);assert.equal(f.authWrites().length,0);assert.equal(f.rpcCalls().length,0);}
 const f=fixture({target:{company_id:otherCompany}}),r=await invoke(f,{action:'link_user_person',user_id:existingId,person_id:personId});assert.equal(r.code,403);assert.equal(f.authWrites().length,0);assert.equal(f.rpcCalls().length,0);
});
test('account-link listing requires both view permissions and an explicit authorized company scope',async()=>{
 for(const actor of [{status:'inactive'},{role:'employee'},{permissions:{access_v1:{users:{view:false}}}},{permissions:{access_v1:{people:{view:false}}}}]){
  const f=fixture({actor}),r=await invoke(f,{action:'list_account_links',company_id:companyId});assert.equal(r.code,403);assert.equal(f.authWrites().length,0);assert.equal(f.rpcCalls().length,0);
 }
 const f=fixture(),r=await invoke(f,{action:'list_account_links',company_id:otherCompany});assert.equal(r.code,403);assert.ok(!f.calls.some(c=>c.path==='/rest/v1/people'));
 const good=fixture({target:{person_id:personId}}),listed=await invoke(good,{action:'list_account_links',company_id:companyId});assert.equal(listed.code,200);assert.ok(!good.calls.some(c=>c.method!=='GET'));assert.ok(good.calls.some(c=>c.path==='/rest/v1/profiles'&&c.query.get('company_id')==='eq.'+companyId));assert.ok(!JSON.stringify(listed.body).includes('access_v1'));
});
test('final-link failure retains the new account for recovery and never returns credentials in an error',async()=>{
 const f=fixture({commitError:true}),r=await invoke(f,creation());assert.ok(r.code>=400);assert.equal(f.authWrites().length,1);assert.equal(r.body.code,'link_incomplete');assert.equal(r.body.account_created,true);assert.equal(r.body.user_id,userId);assert.ok(r.body.login);assert.equal(r.body.temporary_password,undefined);assert.equal(r.body.password,undefined);assert.ok(!f.calls.some(c=>c.method==='DELETE'));assert.match(r.body.error,/retained|link|recover/i);
});
test('an uncertain failure or an already committed link cannot delete a live Auth identity',async()=>{
 for(const options of [{commitTransportError:true,readbackError:true},{commitTransportError:true,committedDespiteError:true},{commitError:true,triggerLinked:true}]){
  const f=fixture(options),r=await invoke(f,creation());assert.ok(r.code>=400||r.body.ok);assert.ok(!f.calls.some(c=>c.method==='DELETE'),'Readback uncertainty or an exact saved link must preserve the account');if(!r.body.ok)assert.match(r.body.error,/retained|created|verify|recover|linked|retry/i);
 }
});
test('an Auth conflict re-previews identity and links the race-winning persisted account without another invitation',async()=>{
 const f=fixture({authRaceExisting:true}),r=await invoke(f,creation());assert.equal(r.code,200);assert.equal(r.body.existing,true);assert.equal(r.body.user_id,existingId);assert.equal(r.body.temporary_password,undefined);assert.equal(f.authWrites().length,1);assert.equal(f.rpcCalls().filter(c=>c.body.p_preview).length,2);assert.equal(f.rpcCalls().at(-1).body.p_user_id,existingId);assert.equal(f.profiles.get(existingId).role,'manager');assert.ok(!f.calls.some(c=>c.method==='DELETE'));
 const restricted=fixture({authRaceExisting:true,denyExistingCommit:true,actor:{permissions:{access_v1:{users:{create:true,edit:false}}}}}),denied=await invoke(restricted,creation());assert.equal(denied.code,403);assert.equal(restricted.profiles.get(existingId).person_id,null);assert.ok(!restricted.calls.some(c=>c.method==='DELETE'));
});
test('a retry after successful linking reuses the saved account and creates no second Auth identity',async()=>{
 const f=fixture();assert.equal((await invoke(f,creation())).code,200);const again=await invoke(f,creation());assert.equal(again.code,200);assert.equal(again.body.existing,true);assert.equal(again.body.user_id,userId);assert.equal(f.authWrites().length,1);assert.ok(!f.calls.some(c=>c.method==='DELETE'));
});
test('an RPC success without the exact persisted People link is rejected as incomplete',async()=>{
 const f=fixture({skipCommitWrite:true}),r=await invoke(f,creation());assert.equal(r.code,409);assert.equal(r.body.code,'link_incomplete');assert.equal(r.body.account_created,true);assert.equal(r.body.temporary_password,undefined);assert.ok(!f.calls.some(c=>c.method==='DELETE'));
});
test('new-People consent is explicit and boolean rather than inferred from a name or truthy input',async()=>{
 for(const [choice,expected] of [[undefined,false],['true',false],[true,true]]){const f=fixture(),r=await invoke(f,creation({allow_new_person:choice}));assert.equal(r.code,200);assert.ok(f.rpcCalls().every(c=>c.body.p_allow_new_person===expected));}
});
