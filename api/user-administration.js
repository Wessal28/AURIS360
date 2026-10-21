'use strict';
const crypto=require('node:crypto');
const policy=require('../auris-user-access.js');
require('../auris-module-registry.js');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles=new Set(['admin','executive','hse_manager','hse_officer','site_manager','auditor','hr','supervisor','employee','contractor','manager','inspector']);
const phone=value=>String(value||'').replace(/[\s().-]/g,'');
const realEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&!value.endsWith('.local');
function failure(status,message,details){const e=new Error(message);e.status=status;Object.assign(e,details);throw e;}
module.exports=async function(req,res){
 const send=(status,body)=>res.status(status).json(body);
 if(req.method!=='POST')return send(405,{error:'Method not allowed'});
 const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(!token||token===req.headers.authorization)return send(401,{error:'Sign in required'});
 const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_KEY,anon=process.env.SUPABASE_ANON_KEY;
 if(!base||!key||!anon)return send(503,{error:'User administration is not configured'});
 async function call(path,method='GET',body,userToken){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetch(base+path,{method,redirect:'error',signal:controller.signal,headers:{apikey:userToken?anon:key,Authorization:'Bearer '+(userToken||key),'Content-Type':'application/json',Prefer:'return=representation'},body:body==null?undefined:JSON.stringify(body)});
   const data=await response.json().catch(()=>null);
   if(!response.ok){
    if(data?.code==='PGRST202')failure(503,'People and user linking needs its database update before retrying.',{code:'linking_setup_required'});
    failure(data?.code==='42501'?403:response.status,(data&&(data.message||data.msg||data.error))||'User administration request failed');
   }
   return data;
  }catch(e){if(e.status)throw e;failure(502,'The account service could not be reached. Check the saved account before retrying.',{uncertain:true});}
  finally{clearTimeout(timer);}
 }
 async function one(table,filter){const rows=await call('/rest/v1/'+table+'?'+filter+'&limit=2');if(!Array.isArray(rows)||rows.length>1)failure(409,'The account identity is ambiguous. Review the existing records first.');return rows[0];}
 try{
  const input=req.body||{},action=input.action,actions={set_access:'edit',onboard_person:'create',invite_user:'create',create_user:'create',preview_user_person:'edit',link_user_person:'edit',list_account_links:'view'};
  if(!Object.prototype.hasOwnProperty.call(actions,action))failure(400,'Unknown action');
  const session=await call('/auth/v1/user','GET',null,token),actor=session?.id&&await one('profiles','id=eq.'+encodeURIComponent(session.id));
  if(!actor||actor.status!=='active'||!['sephs_admin','admin'].includes(actor.role)||!policy.allowed(actor,'users',actions[action]))failure(403,'An active administrator with Users & Roles access is required');
  function scope(target){if(!target||!target.company_id)failure(404,'Record not found');if(actor.role!=='sephs_admin'&&target.company_id!==actor.company_id)failure(403,'Record is outside your company');}
  function company(value){const id=value||actor.company_id;if(!uuid.test(id||''))failure(400,'Select a company');scope({company_id:id});return id;}
  function choice(value){if(value&&!uuid.test(value))failure(400,'Invalid person');return value||null;}
  async function link(companyId,userId,profile,personId,preview,allowNew){
   const result=await call('/rest/v1/rpc/admin_link_user_person','POST',{p_actor_id:actor.id,p_company_id:companyId,p_user_id:userId||null,p_profile:profile,p_person_id:personId,p_preview:preview,p_allow_new_person:allowNew===true});
   if(!result||result.ok!==true){const details={code:result?.code||'identity_conflict'};if(Array.isArray(result?.candidates))details.candidates=result.candidates;failure(409,result?.error||'Review the existing People records before linking this account.',details);}
   if(result.user_id&&!uuid.test(result.user_id)||result.person_id&&!uuid.test(result.person_id))failure(502,'The account link response was invalid.');
   return result;
  }
  async function verify(userId,companyId,personId){
   const saved=await one('profiles','id=eq.'+userId+'&company_id=eq.'+companyId);
   if(!saved||saved.id!==userId||saved.company_id!==companyId||!uuid.test(saved.person_id||'')||personId&&saved.person_id!==personId)return null;
   const person=await one('people','id=eq.'+saved.person_id+'&company_id=eq.'+companyId);
   return person&&person.id===saved.person_id&&person.company_id===companyId?{user_id:saved.id,person_id:person.id,login:saved.email||phone(saved.phone)||''}:null;
  }
  async function commit(companyId,userId,profile,personId,allowNew){
   const result=await link(companyId,userId,profile,personId,false,allowNew);
   if(result.user_id!==userId||!result.person_id||!await verify(userId,companyId,result.person_id))failure(502,'The saved user-to-People link could not be verified. Reopen the existing account before retrying.');
   return result;
  }
  if(action==='set_access'){
   if(!uuid.test(input.user_id||''))failure(400,'Invalid user');
   const target=await one('profiles','id=eq.'+input.user_id);scope(target);
   if(target.id===actor.id||target.role==='sephs_admin')failure(403,'Your own access and SEPHS administrator access are protected');
   const keys=globalThis.AurisModuleRegistry.keys().concat(policy.sectionKeys()).concat(['company','workflows','notifications','modules','data','personal','support'].map(k=>'settings.'+k));
   let access;try{access=policy.validate(input.access,keys);}catch(e){failure(400,e.message);}
   const permissions=Object.assign({},target.permissions,{access_v1:access,access_changed_by:actor.id,access_changed_at:new Date().toISOString()});
   await call('/rest/v1/profiles?id=eq.'+target.id,'PATCH',{permissions,updated_at:new Date().toISOString()});return send(200,{ok:true,permissions});
  }
  if(!policy.allowed(actor,'people','view'))failure(403,'People view access is required to link accounts');
  if(action==='list_account_links'){
   const companyId=company(input.company_id),links=[];
   for(let offset=0;offset<10000;offset+=500){
    const rows=await call('/rest/v1/profiles?select=id,person_id,status,email,phone&company_id=eq.'+companyId+'&person_id=not.is.null&order=id&limit=500&offset='+offset);
    if(!Array.isArray(rows))failure(502,'Account links could not be loaded');
    links.push(...rows.map(row=>({person_id:row.person_id,user_id:row.id,status:row.status,login:row.email||row.phone||''})));
    if(rows.length<500)return send(200,{ok:true,links});
   }
   failure(413,'Too many linked accounts to load at once. Contact your administrator.');
  }
  if(action==='preview_user_person'||action==='link_user_person'){
   if(!uuid.test(input.user_id||''))failure(400,'Invalid user');
   const target=await one('profiles','id=eq.'+input.user_id);scope(target);
   const personId=choice(input.person_id),allowNew=input.allow_new_person===true;
   const preview=await link(target.company_id,target.id,target,personId,true,allowNew);
   return send(200,action==='preview_user_person'?preview:await commit(target.company_id,target.id,target,personId,allowNew));
  }
  let profile,companyId,personId,channel,password;
  const allowNew=input.allow_new_person===true;
  if(action==='onboard_person'){
   personId=choice(input.person_id);if(!personId)failure(400,'Invalid person');
   const person=await one('people','id=eq.'+personId);scope(person);
   if(person.status!=='active')failure(403,'Only active people can be onboarded');
   companyId=person.company_id;
   const email=String(person.email||'').trim().toLowerCase(),number=phone(person.phone);
   channel=input.channel||(realEmail(email)?'email':'phone');
   if(!['email','phone'].includes(channel))failure(400,'Choose email or phone');
   if(channel==='email'&&!realEmail(email))failure(400,'Record a valid email in the person’s profile first');
   if(channel==='phone'&&!/^\+[1-9]\d{7,14}$/.test(number))failure(400,'Record the phone with its country code in the person’s profile first');
   profile={full_name:[person.first_name,person.last_name].filter(Boolean).join(' '),email:channel==='email'?email:null,real_email:realEmail(email)?email:null,phone:person.phone||null,role:['contractor','subcontractor'].includes(person.person_type)?'contractor':'employee',job_title:person.job_title||null,department:person.department||null,site:person.site||null,contractor_company:person.company_name||null,status:'active',must_change_password:channel==='phone',invited_by:actor.id};
   if(channel==='phone')password=crypto.randomBytes(18).toString('base64url')+'aA1!';
  }else{
   companyId=company(input.company_id);personId=choice(input.person_id);
   const fullName=String(input.full_name||'').trim(),email=String(input.email||'').trim().toLowerCase();
   if(!fullName||fullName.length>200)failure(400,'Enter the user’s full name');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||action==='invite_user'&&!realEmail(email))failure(400,'Enter a valid login email');
   if(!roles.has(input.role||'employee'))failure(400,'Choose a supported user role');
   const number=phone(input.phone);if(number&&!/^\+[1-9]\d{7,14}$/.test(number))failure(400,'Enter the phone with its country code');
   channel=action==='invite_user'?'email':'direct';password=action==='create_user'?String(input.password||''):null;
   if(channel==='direct'&&(password.length<8||password.length>128))failure(400,'Password must be between 8 and 128 characters');
   profile={full_name:fullName,email,real_email:realEmail(email)?email:null,phone:number||null,role:input.role||'employee',synthetic_email:email.endsWith('.local'),status:'active',invited_by:actor.id,must_change_password:channel==='direct'};
  }
  const preview=await link(companyId,null,profile,personId,true,allowNew);
  if(preview.user_id){
   if(!policy.allowed(actor,'users','edit'))failure(403,'Users & Roles edit access is required to link an existing account');
   return send(200,{...await commit(companyId,preview.user_id,profile,personId||preview.person_id,allowNew),ok:true,existing:true});
  }
  const metadata={full_name:profile.full_name,company_id:companyId,role:profile.role,must_change_password:profile.must_change_password,person_id:personId||preview.person_id,provision_request:crypto.randomUUID()};
  let auth;
  try{auth=channel==='email'?await call('/auth/v1/invite','POST',{email:profile.email,data:metadata}):await call('/auth/v1/admin/users','POST',{...(channel==='phone'?{phone:phone(profile.phone),phone_confirm:true}:{email:profile.email,email_confirm:true}),password,user_metadata:metadata});}
  catch(e){
   if([400,409,422].includes(e.status)){
    const fresh=await link(companyId,null,profile,personId,true,allowNew);
    if(fresh.user_id)return send(200,{...await commit(companyId,fresh.user_id,profile,personId||fresh.person_id,allowNew),existing:true});
   }
   throw e;
  }
  const id=auth?.id||auth?.user?.id;
  if(!uuid.test(id||''))failure(502,'Account service returned no valid user ID. Check the account before retrying.');
  try{
   const result=await commit(companyId,id,{...profile,_new_account:true},personId||preview.person_id,allowNew);
   return send(200,{...result,ok:true,existing:false,channel,login:result.login||profile.email||phone(profile.phone),temporary_password:channel==='phone'?password:undefined});
  }catch(e){
   // An interrupted response can follow a committed transaction. Never delete an
   // account another administrator could have linked while this request ran.
   const saved=await verify(id,companyId,personId||preview.person_id).catch(()=>null);
   if(saved)return send(200,{...saved,ok:true,existing:false,channel,temporary_password:channel==='phone'?password:undefined});
   failure(409,'The account was created, but its People link could not be completed. Open this existing account and choose Link People profile; do not create it again.',{code:'link_incomplete',account_created:true,user_id:id,login:profile.email||phone(profile.phone)});
  }
 }catch(e){
  const body={error:e.message||'User administration failed'};
  for(const field of ['code','candidates','account_created','user_id','login'])if(e[field]!==undefined)body[field]=e[field];
  return send(e.status||500,body);
 }
};
