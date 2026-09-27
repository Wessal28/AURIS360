const test=require('node:test'),assert=require('node:assert/strict');
const access=require('../auris-user-access.js');
const handler=require('../api/user-administration.js');
const actorId='11111111-1111-4111-8111-111111111111',personId='22222222-2222-4222-8222-222222222222',userId='33333333-3333-4333-8333-333333333333';
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
 const actor={id:actorId,role:'admin',company_id:'company-a',status:'active',...overrides.actor};
 const person={id:personId,company_id:'company-a',first_name:'Ada',last_name:'Example',email:'ada@example.com',phone:'+230 5123 4567',job_title:'Technician',department:'Maintenance',site:'Depot',person_type:'employee',status:'active',...overrides.person};
 const calls=[];
 const request=async(url,options={})=>{const path=new URL(url).pathname,query=new URL(url).search;const body=options.body?JSON.parse(options.body):null;calls.push({path,query,body,method:options.method});
   let data;
   if(path==='/auth/v1/user')data={id:actorId};
   else if(path==='/rest/v1/people')data=[person];
   else if(path==='/rest/v1/profiles'&&options.method==='GET'){
     if(query.includes('id=eq.'+actorId))data=[actor];
     else if(query.includes('id=eq.'+userId))data=[{id:userId,company_id:'company-a',role:'employee',permissions:{legacy:true},...overrides.target}];
     else if(query.includes('person_id=eq.'))data=overrides.linked?[overrides.linked]:[];
     else data=overrides.contact?[overrides.contact]:[];
   }else if(path==='/auth/v1/invite'||path==='/auth/v1/admin/users')data={id:userId};
   else if(path==='/rest/v1/profiles'&&overrides.saveFailure)return {ok:false,status:500,json:async()=>({message:'Database rejected profile'})};
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
 const profile=f.calls.find(c=>c.path==='/rest/v1/profiles'&&c.method==='POST').body;
 assert.equal(profile.person_id,personId);assert.equal(profile.department,'Maintenance');assert.equal(profile.company_id,'company-a');assert.equal(profile.phone,'+230 5123 4567');
});
test('phone onboarding uses canonical phone, strong temporary password and forced password change without SMS',async()=>{
 const f=fixture({person:{email:''}});const r=await invoke(f,{action:'onboard_person',person_id:personId});assert.equal(r.code,200);assert.equal(r.body.login,'+23051234567');assert.ok(r.body.temporary_password.length>20);
 const created=f.calls.find(c=>c.path==='/auth/v1/admin/users');assert.equal(created.body.phone,'+23051234567');assert.equal(created.body.password,r.body.temporary_password);assert.equal(created.body.phone_confirm,true);
 assert.equal(f.calls.find(c=>c.method==='POST'&&c.path==='/rest/v1/profiles').body.must_change_password,true);
 assert.ok(!f.calls.some(c=>c.path.includes('/otp')));
});
test('invalid phone and inactive people do not provision an account',async()=>{
 for(const person of [{email:'',phone:'51234567'},{status:'inactive'}]){const f=fixture({person});const r=await invoke(f,{action:'onboard_person',person_id:personId});assert.ok(r.code>=400);assert.ok(!f.calls.some(c=>c.path==='/auth/v1/invite'||c.path==='/auth/v1/admin/users'));}
});
test('onboarding is idempotent for linked people and refuses cross-company contact matches',async()=>{
 const linked=fixture({linked:{id:userId,company_id:'company-a',email:'ada@example.com'}});const r=await invoke(linked,{action:'onboard_person',person_id:personId});assert.equal(r.body.existing,true);assert.ok(!linked.calls.some(c=>c.path==='/auth/v1/invite'));
 const cross=fixture({contact:{id:userId,company_id:'company-b'}});assert.equal((await invoke(cross,{action:'onboard_person',person_id:personId})).code,403);
});
test('unauthorised, inactive and restricted administrators cannot onboard or change access',async()=>{
 for(const actor of [{role:'employee'},{status:'inactive'},{permissions:{access_v1:{users:{create:false,edit:false}}}}]){const f=fixture({actor});assert.equal((await invoke(f,{action:'onboard_person',person_id:personId})).code,403);}
 const cross=fixture({person:{company_id:'company-b'}});assert.equal((await invoke(cross,{action:'onboard_person',person_id:personId})).code,403);
});
test('profile-save failure removes the newly provisioned auth account',async()=>{
 const f=fixture({saveFailure:true});const r=await invoke(f,{action:'onboard_person',person_id:personId});assert.equal(r.code,500);assert.ok(f.calls.some(c=>c.path==='/auth/v1/admin/users/'+userId&&c.method==='DELETE'));
});
test('saving access preserves other permissions and protects self, SEPHS and cross-company accounts',async()=>{
 const f=fixture();const r=await invoke(f,{action:'set_access',user_id:userId,access:{inspection:{edit:false}}});assert.equal(r.code,200);assert.equal(r.body.permissions.legacy,true);assert.equal(r.body.permissions.access_v1.inspection.edit,false);
 for(const target of [{role:'sephs_admin'},{company_id:'company-b'}])assert.equal((await invoke(fixture({target}),{action:'set_access',user_id:userId,access:{}})).code,403);
 assert.equal((await invoke(fixture(),{action:'set_access',user_id:actorId,access:{}})).code,403);
});
