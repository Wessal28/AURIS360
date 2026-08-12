// AURIS360 Meta WhatsApp Cloud API template-message worker.
const crypto = require('crypto');
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;

module.exports = async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try { validateEnvironment(); return res.status(200).json(await processQueue()); }
  catch (error) { return res.status(500).json({ error: safeError(error) }); }
};

async function processQueue() {
  const context = supabaseContext();
  const jobs = await claimJobs(context, 'whatsapp-' + crypto.randomUUID());
  let accepted=0,retried=0,failed=0,skipped=0;
  for (const job of jobs) {
    try {
      const detail=await loadDetail(context,job);
      if(!detail.notification||!detail.settings||!detail.settings.enabled){
        await patchJob(context,job.id,finalPatch('skipped',{error_msg:'WhatsApp source or company configuration unavailable'}));skipped++;continue;
      }
      const policy=await evaluateDeliveryPolicy(context,detail.notification,'whatsapp');
      if(policy&&policy.allowed===false){await patchJob(context,job.id,finalPatch('skipped',{error_msg:'Recipient preference: '+policy.reason}));skipped++;continue;}
      if(policy&&policy.deliver_after&&new Date(policy.deliver_after).getTime()>Date.now()+15000){await patchJob(context,job.id,{status:'pending',next_attempt_at:policy.deliver_after,locked_at:null,locked_by:null,error_msg:'Delivery deferred by recipient policy: '+policy.reason,updated_at:new Date().toISOString()});retried++;continue;}
      if(policy&&policy.override)await logPolicyOverride(context,detail.notification,'whatsapp',policy.reason);
      const response=await sendTemplate(job,detail.notification,detail.settings);
      if(!response.ok){const body=await response.json().catch(()=>({}));const e=new Error(body.error&&body.error.message||'Meta WhatsApp error '+response.status);e.statusCode=response.status;e.errorCode=body.error&&body.error.code;throw e;}
      const body=await response.json();
      const messageId=body.messages&&body.messages[0]&&body.messages[0].id;
      await patchJob(context,job.id,finalPatch('accepted',{provider_message_id:messageId||null,provider_status:'accepted',accepted_at:new Date().toISOString(),error_msg:null,error_code:null}));accepted++;
    }catch(error){
      const attempts=Number(job.attempt_count||1);
      if(isTransient(error)&&attempts<MAX_ATTEMPTS){
        await patchJob(context,job.id,{status:'pending',next_attempt_at:new Date(Date.now()+retryDelayMs(attempts)).toISOString(),locked_at:null,locked_by:null,error_code:String(error.errorCode||error.statusCode||''),error_msg:safeError(error),updated_at:new Date().toISOString()});retried++;
      }else{await patchJob(context,job.id,finalPatch('failed',{failed_at:new Date().toISOString(),error_code:String(error.errorCode||error.statusCode||''),error_msg:safeError(error)}));failed++;}
    }
  }
  return {accepted,retried,failed,skipped,total:jobs.length};
}

function validateEnvironment(){const missing=['SUPABASE_URL','SUPABASE_SERVICE_KEY','WHATSAPP_ACCESS_TOKEN','CRON_SECRET'].filter(n=>!process.env[n]);if(missing.length)throw new Error('Missing required environment variables: '+missing.join(', '));}
function supabaseContext(){const baseUrl=String(process.env.SUPABASE_URL).replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_KEY;return {baseUrl,headers:{apikey:key,Authorization:'Bearer '+key}};}
async function claimJobs(c,worker){const r=await fetch(c.baseUrl+'/rest/v1/rpc/claim_whatsapp_delivery_jobs',{method:'POST',headers:{...c.headers,'Content-Type':'application/json'},body:JSON.stringify({p_limit:BATCH_SIZE,p_worker_id:worker})});if(!r.ok)throw new Error('Unable to claim WhatsApp jobs: '+r.status+' '+(await r.text()).slice(0,300));return r.json();}
async function loadDetail(c,job){const [n,s]=await Promise.all([
  fetch(c.baseUrl+'/rest/v1/user_notifications?id=eq.'+encodeURIComponent(job.user_notification_id)+'&limit=1',{headers:c.headers}),
  fetch(c.baseUrl+'/rest/v1/whatsapp_channel_settings?company_id=eq.'+encodeURIComponent(job.company_id)+'&limit=1',{headers:c.headers})
]);if(!n.ok||!s.ok)throw transientError('Unable to load WhatsApp job detail');const nr=await n.json(),sr=await s.json();return {notification:nr[0]||null,settings:sr[0]||null};}
async function evaluateDeliveryPolicy(c,n,channel){const r=await fetch(c.baseUrl+'/rest/v1/rpc/evaluate_notification_delivery_policy',{method:'POST',headers:{...c.headers,'Content-Type':'application/json'},body:JSON.stringify({p_company_id:n.company_id,p_profile_id:n.recipient_profile_id,p_channel:channel,p_severity:n.severity||'normal',p_ack_required:!!n.acknowledgement_required})});if(r.ok)return r.json();const d=await r.text();if(r.status===404||/PGRST202|schema cache|evaluate_notification_delivery_policy/i.test(d))return null;throw transientError('Unable to evaluate recipient delivery policy');}
async function logPolicyOverride(c,n,channel,reason){await fetch(c.baseUrl+'/rest/v1/notification_events',{method:'POST',headers:{...c.headers,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({company_id:n.company_id,notification_id:n.source_notification_id,event_type:'mandatory_alert_override',related_module:n.related_module||null,related_table:n.related_table||null,related_id:n.related_id||null,related_ref:n.related_ref||null,detail:{channel,reason,recipient_profile_id:n.recipient_profile_id}})});}
async function sendTemplate(job,n,s){
  const version=process.env.WHATSAPP_GRAPH_VERSION||'v23.0';
  const reference=String(n.related_ref||n.id).slice(0,120),url=safeRecordUrl(n.record_url);
  return fetch('https://graph.facebook.com/'+encodeURIComponent(version)+'/'+encodeURIComponent(s.phone_number_id)+'/messages',{method:'POST',headers:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:normalisePhone(job.phone_snapshot),type:'template',template:{name:job.template_name,language:{code:job.template_language},components:[{type:'body',parameters:[{type:'text',text:severityLabel(n.severity)},{type:'text',text:String(n.title||'AURIS360 alert').slice(0,200)},{type:'text',text:reference},{type:'text',text:url}]}]}})});
}
async function patchJob(c,id,body){const r=await fetch(c.baseUrl+'/rest/v1/whatsapp_delivery_jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{...c.headers,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(body)});if(!r.ok)throw new Error('Unable to update WhatsApp job: '+r.status);}
function safeRecordUrl(value){try{const u=new URL(String(value||'/'),'https://auris-360.vercel.app');return u.origin==='https://auris-360.vercel.app'?u.href:'https://auris-360.vercel.app/';}catch(_){return 'https://auris-360.vercel.app/';}}
function normalisePhone(v){return String(v||'').replace(/\D/g,'');}
function severityLabel(v){return ({urgent:'URGENT',high:'HIGH',normal:'NOTICE',low:'NOTICE'})[String(v||'').toLowerCase()]||'NOTICE';}
function finalPatch(status,extra){return {...extra,status,locked_at:null,locked_by:null,updated_at:new Date().toISOString()};}
function retryDelayMs(attempt){return Math.min(60,Math.pow(2,Math.max(0,Number(attempt)-1)))*60000;}
function transientError(message){const e=new Error(message);e.transient=true;return e;}
function isTransient(e){const s=Number(e&&e.statusCode||0);return e&&e.transient===true||s===408||s===429||s>=500||/timeout|network|temporar|connection/i.test(safeError(e));}
function safeError(e){return String(e&&e.message?e.message:e||'Unknown error').slice(0,500);}
module.exports._test={evaluateDeliveryPolicy,isTransient,normalisePhone,retryDelayMs,safeRecordUrl,severityLabel};
