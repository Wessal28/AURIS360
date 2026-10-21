const test=require('node:test'),assert=require('node:assert/strict');
const access=require('../auris-user-access.js');
const handler=require('../api/user-administration.js');
const actorId='11111111-1111-4111-8111-111111111111',personId='22222222-2222-4222-8222-222222222222',userId='33333333-3333-4333-8333-333333333333';
const companyId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherCompany='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('access restrictions preserve role defaults, support read-only, and cannot bypass a denied module',()=>{
 const p={role:'employee',permissions:{access_v1:{inspection:{view:true,create:false,edit:false,delete:false},people:{view:false,edit:true}}}};
 assert.equal(access.allowed(p,'inspection','view'),true);for(const a of ['create','edit','delete'])assert.equal(access.allowed(p,'inspection',a),false);
 assert.equal(access.allowed(p,'people','edit'),false);assert.equal(access.allowed(p,'meetings','view'),true);
 assert.equal(access.allowed({...p,role:'sephs_admin'},'people','view'),true);
});
test('Settings sections inherit module denial and support individual section restrictions',()=>{
 const p={role:'admin',permissions:{access_v1:{'settings.company':{view:false}}}};
 assert.equal(access.allowed(p,'settings.company','view'),false);assert.equal(access.allowed(p,'settings.personal','view'),true);
 p.permissions.access_v1.settings={view:false};assert.equal(access.allowed(p,'settings.personal','edit'),false);
 p.permissions.access_v1.settings={view:true,edit:false};assert.equal(access.allowed(p,'settings.personal','edit'),false);assert.equal(access.allowed(p,'settings.personal','view'),true);
});
test('access payload rejects unknown modules, actions and non-boolean values',()=>{
 for(const value of [{unknown:{view:true}},{people:{approve:true}},{people:{edit:'false'}},[]])assert.throws(()=>access.validate(value,['people']));
 assert.deepEqual(access.validate({people:{view:false}},['people']),{people:{view:false}});
});
function fixture(overrides={}){
 const actor={id:actorId,role:'admin',company_id:companyId,status:'active',...overrides.actor};
 const person={id:personId,company_id:companyId,first_name:'Ada',last_name:'Example',email:'ada@example.com',phone:'+230 5123 4567',job_title:'Technician',department:'Maintenance',site:'Depot',person_type:'employee',status:'active',...overrides.person};
 const existing=overrides.linked||overrides.contact,calls=[];let saved={id:userId,company_id:companyId,role:'employee',permissions:{legacy:true},...overrides.target,...existing};
 const request=async(url,options={})=>{const path=new URL(url).pathname,query=new URL(url).search;const body=options.body?JSON.parse(options.body):null;calls.push({path,query,body,method:options.method});
   let data;
   if(path==='/auth/v1/user')data={id:actorId};
   else if(path==='/rest/v1/people')data=[person];
   else if(path==='/rest/v1/profiles'&&options.method==='GET'){
     if(query.includes('id=eq.'+actorId))data=[actor];
     else if(query.includes('id=eq.'+userId))data=[saved];
     else if(query.includes('person_id=eq.'))data=overrides.linked?[overrides.linked]:[];
     else data=overrides.contact?[overrides.contact]:[];
   }else if(path==='/rest/v1/rpc/admin_link_user_person'){
     assert.equal(body.p_actor_id,actorId);assert.equal(body.p_company_id,person.company_id);
     if(existing&&existing.company_id!==person.company_id)return {ok:false,status:403,json:async()=>({code:'42501',message:'Contact identity is outside this company'})};
     if(body.p_preview)data={ok:true,user_id:existing?userId:null,person_id:personId,existing:!!existing,person_reused:true};
     else{
       if(overrides.saveFailure)return {ok:false,status:500,json:async()=>({message:'Database rejected link'})};
       if(!existing)saved={id:userId,company_id:person.company_id,...body.p_profile};saved.person_id=personId;
       data={ok:true,user_id:userId,person_id:personId,existing:!!existing,person_reused:true,login:body.p_profile.email||String(body.p_profile.phone||'').replace(/[\s().-]/g,'')};
     }
   }else if(path==='/auth/v1/invite'||path==='/auth/v1/admin/users')data={id:userId};
   else data=[];
   return {ok:true,status:200,json:async()=>data};
 };
 return {actor,person,calls,request};
}
async function invoke(f,input){
 const old=global.fetch;global.fetch=f.request;
 const env={};for(const [k,v] of Object.entries({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_KEY:'test-service',SUPABASE_ANON_KEY:'test-anon'})){env[k]=process.env[k];process.env[k]=v;}
 const res={status(v){this.code=v;return this;},json(v){this.body=v;return this;}};
 try{await handler({method:'POST',headers:{authorization:'Bearer session'},body:input},res);return res;}finally{global.fetch=old;for(const k of Object.keys(env)){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}}
}
test('onboarding copies person details and uses the saved email, ignoring client role and contact overrides',async()=>{
 const f=fixture();const r=await invoke(f,{action:'onboard_person',person_id:personId,email:'attacker@invalid.com',role:'sephs_admin'});assert.equal(r.code,200);
 const invite=f.calls.find(c=>c.path==='/auth/v1/invite');assert.equal(invite.body.email,'ada@example.com');assert.equal(invite.body.data.role,'employee');
 const commit=f.calls.find(c=>c.path==='/rest/v1/rpc/admin_link_user_person'&&c.body.p_preview===false).body,profile=commit.p_profile;
 assert.equal(commit.p_person_id,personId);assert.equal(commit.p_company_id,companyId);assert.equal(profile.department,'Maintenance');assert.equal(profile.phone,'+230 5123 4567');
 assert.ok(f.calls.some(c=>c.path==='/rest/v1/profiles'&&c.query.includes('company_id=eq.'+companyId)));
});
test('phone onboarding uses canonical phone, strong temporary password and forced password change without SMS',async()=>{
 const f=fixture({person:{email:''}});const r=await invoke(f,{action:'onboard_person',person_id:personId});assert.equal(r.code,200);assert.equal(r.body.login,'+23051234567');assert.ok(r.body.temporary_password.length>20);
 const created=f.calls.find(c=>c.path==='/auth/v1/admin/users');assert.equal(created.body.phone,'+23051234567');assert.equal(created.body.password,r.body.temporary_password);assert.equal(created.body.phone_confirm,true);
 assert.equal(f.calls.find(c=>c.path==='/rest/v1/rpc/admin_link_user_person'&&c.body.p_preview===false).body.p_profile.must_change_password,true);
 assert.ok(!f.calls.some(c=>c.path.includes('/otp')));
});
test('invalid phone and inactive people do not provision an account',async()=>{
 for(const person of [{email:'',phone:'51234567'},{status:'inactive'}]){const f=fixture({person});const r=await invoke(f,{action:'onboard_person',person_id:personId});assert.ok(r.code>=400);assert.ok(!f.calls.some(c=>c.path==='/auth/v1/invite'||c.path==='/auth/v1/admin/users'));}
});
test('onboarding is idempotent for linked people and refuses cross-company contact matches',async()=>{
 const linked=fixture({linked:{id:userId,company_id:companyId,email:'ada@example.com'}});const r=await invoke(linked,{action:'onboard_person',person_id:personId});assert.equal(r.body.existing,true);assert.ok(!linked.calls.some(c=>c.path==='/auth/v1/invite'));
 const cross=fixture({contact:{id:userId,company_id:otherCompany}});assert.equal((await invoke(cross,{action:'onboard_person',person_id:personId})).code,403);assert.ok(!cross.calls.some(c=>c.path==='/auth/v1/invite'));
});
test('unauthorised, inactive and restricted administrators cannot onboard or change access',async()=>{
 for(const actor of [{role:'employee'},{status:'inactive'},{permissions:{access_v1:{users:{create:false,edit:false}}}}]){const f=fixture({actor});assert.equal((await invoke(f,{action:'onboard_person',person_id:personId})).code,403);}
 const cross=fixture({person:{company_id:otherCompany}});assert.equal((await invoke(cross,{action:'onboard_person',person_id:personId})).code,403);
});
test('link-save failure retains the newly provisioned account and returns a recovery action without credentials',async()=>{
 const f=fixture({saveFailure:true});const r=await invoke(f,{action:'onboard_person',person_id:personId});assert.equal(r.code,409);assert.equal(r.body.code,'link_incomplete');assert.equal(r.body.account_created,true);assert.equal(r.body.user_id,userId);assert.equal(r.body.temporary_password,undefined);assert.match(r.body.error,/Link People profile/);assert.ok(!f.calls.some(c=>c.method==='DELETE'));
});
test('saving access preserves other permissions and protects self, SEPHS and cross-company accounts',async()=>{
 const f=fixture();const r=await invoke(f,{action:'set_access',user_id:userId,access:{inspection:{edit:false}}});assert.equal(r.code,200);assert.equal(r.body.permissions.legacy,true);assert.equal(r.body.permissions.access_v1.inspection.edit,false);
 for(const target of [{role:'sephs_admin'},{company_id:otherCompany}])assert.equal((await invoke(fixture({target}),{action:'set_access',user_id:userId,access:{}})).code,403);
 assert.equal((await invoke(fixture(),{action:'set_access',user_id:actorId,access:{}})).code,403);
});
