// Meta WhatsApp Cloud API verification and delivery-status webhook.
const crypto=require('crypto');

module.exports=async function handler(req,res){
  if(req.method==='GET'){
    if(process.env.WHATSAPP_VERIFY_TOKEN&&req.query&&req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===process.env.WHATSAPP_VERIFY_TOKEN)
      return res.status(200).send(req.query['hub.challenge']);
    return res.status(403).json({error:'Webhook verification failed'});
  }
  if(req.method!=='POST')return res.status(405).json({error:'GET or POST only'});
  try{
    const raw=await readRawBody(req);verifySignature(req.headers,raw,process.env.WHATSAPP_APP_SECRET);
    const payload=JSON.parse(raw.toString('utf8'));validateEnvironment();
    const statuses=extractStatuses(payload),context=supabaseContext();let updated=0;
    for(const status of statuses){if(!status.id)continue;const patch=statusPatch(status),eligible=eligiblePriorStatuses(status.status);const filter=eligible.length?'&status=in.('+eligible.join(',')+')':'';const r=await fetch(context.baseUrl+'/rest/v1/whatsapp_delivery_jobs?provider_message_id=eq.'+encodeURIComponent(status.id)+filter,{method:'PATCH',headers:{...context.headers,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(patch)});if(!r.ok)throw new Error('WhatsApp delivery update failed: '+r.status);const rows=await r.json();updated+=Array.isArray(rows)?rows.length:0;}
    return res.status(200).json({ok:true,events:statuses.length,updated});
  }catch(e){return res.status(e.statusCode||500).json({error:safeError(e)});}
};
module.exports.config={api:{bodyParser:false}};
function validateEnvironment(){if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_KEY)throw new Error('Notification data service is not configured');}
function supabaseContext(){const baseUrl=String(process.env.SUPABASE_URL).replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_KEY;return {baseUrl,headers:{apikey:key,Authorization:'Bearer '+key}};}
function extractStatuses(p){const out=[];for(const entry of p.entry||[])for(const change of entry.changes||[])for(const status of change.value&&change.value.statuses||[])out.push(status);return out;}
function statusPatch(s){const now=s.timestamp?new Date(Number(s.timestamp)*1000).toISOString():new Date().toISOString();const error=s.errors&&s.errors[0];const base={provider_status:String(s.status||'unknown'),updated_at:new Date().toISOString()};if(s.status==='sent')return {...base,status:'sent',sent_at:now};if(s.status==='delivered')return {...base,status:'delivered',delivered_at:now};if(s.status==='read')return {...base,status:'read',read_at:now};if(s.status==='failed')return {...base,status:'failed',failed_at:now,error_code:String(error&&error.code||''),error_msg:String(error&&error.title||error&&error.message||'WhatsApp delivery failed').slice(0,500)};return base;}
function eligiblePriorStatuses(status){if(status==='sent')return ['accepted'];if(status==='delivered')return ['accepted','sent'];if(status==='read')return ['accepted','sent','delivered'];if(status==='failed')return ['accepted','sent'];return [];}
function verifySignature(headers,raw,secret){if(!secret)throw httpError(503,'WhatsApp webhook signing secret is not configured');const header=String(headers['x-hub-signature-256']||'');const provided=header.replace(/^sha256=/,'');const expected=crypto.createHmac('sha256',secret).update(raw).digest('hex');if(!provided||provided.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))throw httpError(401,'Invalid WhatsApp webhook signature');}
function readRawBody(req){if(Buffer.isBuffer(req.body))return Promise.resolve(req.body);if(typeof req.body==='string')return Promise.resolve(Buffer.from(req.body));if(req.body&&typeof req.body==='object')return Promise.reject(httpError(400,'Raw webhook body unavailable'));return new Promise((resolve,reject)=>{const chunks=[];req.on('data',c=>chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c)));req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});}
function httpError(statusCode,message){const e=new Error(message);e.statusCode=statusCode;return e;}
function safeError(e){return String(e&&e.message?e.message:e||'Unknown error').slice(0,500);}
module.exports._test={eligiblePriorStatuses,extractStatuses,statusPatch,verifySignature};
