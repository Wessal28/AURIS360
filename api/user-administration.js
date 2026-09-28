'use strict';
const crypto=require('node:crypto');
const policy=require('../auris-user-access.js');
require('../auris-module-registry.js');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(status,message){const e=new Error(message);e.status=status;throw e;}
module.exports=async function(req,res){
  const send=(status,body)=>res.status(status).json(body);
  if(req.method!=='POST')return send(405,{error:'Method not allowed'});
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!token||token===req.headers.authorization)return send(401,{error:'Sign in required'});
  const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_KEY,anon=process.env.SUPABASE_ANON_KEY;
  if(!base||!key||!anon)return send(503,{error:'User administration is not configured'});
  async function call(path,method,body,userToken){
    const response=await fetch(base+path,{method:method||'GET',headers:{apikey:userToken?anon:key,Authorization:'Bearer '+(userToken||key),'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});
    const data=await response.json().catch(()=>null);if(!response.ok)failure(response.status,(data&&(data.message||data.msg||data.error))||'User administration request failed');return data;
  }
  async function one(table,filter){const rows=await call('/rest/v1/'+table+'?'+filter+'&limit=1');return rows&&rows[0];}
  try{
    const input=req.body||{},session=await call('/auth/v1/user','GET',null,token);
    const actor=await one('profiles','id=eq.'+session.id);
    if(!actor||actor.status!=='active'||!['sephs_admin','admin'].includes(actor.role)||!policy.allowed(actor,'users',input.action==='onboard_person'?'create':'edit'))failure(403,'An active administrator with Users & Roles access is required');
    function scope(target){if(!target||!target.company_id)failure(404,'Record not found');if(actor.role!=='sephs_admin'&&target.company_id!==actor.company_id)failure(403,'Record is outside your company');}
    if(input.action==='set_access'){
      if(!uuid.test(input.user_id||''))failure(400,'Invalid user');
      const target=await one('profiles','id=eq.'+input.user_id);scope(target);
      if(target.id===actor.id||target.role==='sephs_admin')failure(403,'Your own access and SEPHS administrator access are protected');
      const keys=globalThis.AurisModuleRegistry.keys().concat(policy.sectionKeys()).concat(['company','workflows','notifications','modules','data','personal','support'].map(k=>'settings.'+k));
      let access;try{access=policy.validate(input.access,keys);}catch(e){failure(400,e.message);}
      const permissions=Object.assign({},target.permissions,{access_v1:access,access_changed_by:actor.id,access_changed_at:new Date().toISOString()});
      await call('/rest/v1/profiles?id=eq.'+target.id,'PATCH',{permissions,updated_at:new Date().toISOString()});
      return send(200,{ok:true,permissions});
    }
    if(input.action!=='onboard_person')failure(400,'Unknown action');
    if(!uuid.test(input.person_id||''))failure(400,'Invalid person');
    const person=await one('people','id=eq.'+input.person_id);scope(person);
    if(person.status!=='active'||!policy.allowed(actor,'people','view'))failure(403,'Only active, accessible people can be onboarded');
    const linked=await one('profiles','person_id=eq.'+person.id);
    if(linked){scope(linked);return send(200,{ok:true,existing:true,user_id:linked.id,login:linked.email||linked.phone});}
    const email=String(person.email||'').trim().toLowerCase(),phone=String(person.phone||'').replace(/[\s().-]/g,'');
    const channel=input.channel||(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&!email.endsWith('.local')?'email':'phone');
    if(channel!=='email'&&channel!=='phone')failure(400,'Choose email or phone');
    if(channel==='email'&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.endsWith('.local')))failure(400,'Record a valid email in the person’s profile first');
    if(channel==='phone'&&!/^\+[1-9]\d{7,14}$/.test(phone))failure(400,'Record the phone with its country code, for example +230…, in the person’s profile first');
    const contact=channel==='email'?email:phone;
    const existing=await one('profiles',channel+'=eq.'+encodeURIComponent(contact));
    if(existing){if(!policy.allowed(actor,'users','edit'))failure(403,'Users & Roles edit access is required to link an existing account');scope(existing);if(existing.person_id&&existing.person_id!==person.id)failure(409,'This contact belongs to another person’s user account');if(existing.role==='sephs_admin')failure(403,'SEPHS administrator accounts are protected');await call('/rest/v1/profiles?id=eq.'+existing.id,'PATCH',{person_id:person.id});return send(200,{ok:true,existing:true,user_id:existing.id,login:contact});}
    const full_name=[person.first_name,person.last_name].filter(Boolean).join(' '),role=person.person_type==='employee'?'employee':'contractor';
    const password=crypto.randomBytes(18).toString('base64url')+'aA1!';
    const metadata={full_name,company_id:person.company_id,role,person_id:person.id};
    const auth=channel==='email'?await call('/auth/v1/invite','POST',{email,data:metadata}):await call('/auth/v1/admin/users','POST',{phone,password,phone_confirm:true,user_metadata:metadata});
    const id=auth.id||(auth.user&&auth.user.id);if(!id)failure(502,'Account service returned no user ID');
    try{
      await call('/rest/v1/profiles?on_conflict=id','POST',{id,person_id:person.id,company_id:person.company_id,full_name,role,email:channel==='email'?email:null,phone:person.phone||null,job_title:person.job_title||null,department:person.department||null,site:person.site||null,status:'active',invited_by:actor.id,must_change_password:channel==='phone'});
    }catch(e){
      // Auth may create a profile through an existing trigger. Update that row instead.
      if(e.status===409){try{await call('/rest/v1/profiles?id=eq.'+id,'PATCH',{person_id:person.id,company_id:person.company_id,full_name,role,phone:person.phone||null,job_title:person.job_title||null,department:person.department||null,site:person.site||null,must_change_password:channel==='phone'});}catch(updateError){await call('/auth/v1/admin/users/'+id,'DELETE').catch(()=>{});throw updateError;}}
      else{await call('/auth/v1/admin/users/'+id,'DELETE').catch(()=>{});throw e;}
    }
    return send(200,{ok:true,user_id:id,channel,login:contact,temporary_password:channel==='phone'?password:undefined});
  }catch(e){return send(e.status||500,{error:e.message||'User administration failed'});}
};
