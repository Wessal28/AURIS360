const crypto=require('crypto');
module.exports=async function handler(req,res){
  if(String(req.method||'GET').toUpperCase()!=='GET')return res.status(405).json({error:'GET only'});
  const fallback=applicationBase();
  try{
    const id=String(req.query&&req.query.n||''),expires=Number(req.query&&req.query.e),destination=decodeDestination(req.query&&req.query.d),token=String(req.query&&req.query.t||'');
    validateLink(id,expires,destination,token);
    try{await recordOpen(id,destination);}catch(error){console.error('Notification link evidence unavailable:',String(error.message||error).slice(0,200));}
    return res.redirect(302,destination);
  }catch(error){return res.redirect(302,fallback+'?goto=dashboard&notice=notification-link-invalid');}
};
function applicationBase(){return String(process.env.APP_BASE_URL||'https://auris-360.vercel.app').replace(/\/$/,'');}
function decodeDestination(value){return Buffer.from(String(value||''),'base64url').toString('utf8');}
function isAllowedDestination(value){try{const url=new URL(value),base=new URL(applicationBase());return url.origin===base.origin&&url.protocol==='https:';}catch(_){return false;}}
function signature(id,expires,destination){return crypto.createHmac('sha256',process.env.NOTIFICATION_LINK_SECRET||'').update(id+'|'+expires+'|'+destination).digest('base64url');}
function validateLink(id,expires,destination,token){if(!process.env.NOTIFICATION_LINK_SECRET)throw new Error('Tracking is not configured');if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isFinite(expires)||expires<Date.now()||expires>Date.now()+32*86400000||!isAllowedDestination(destination))throw new Error('Invalid link');const expected=Buffer.from(signature(id,expires,destination)),provided=Buffer.from(token);if(expected.length!==provided.length||!crypto.timingSafeEqual(expected,provided))throw new Error('Invalid signature');}
async function recordOpen(id,destination){const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_KEY;if(!base||!key)throw new Error('Notification evidence service is not configured');const destinationHash=crypto.createHash('sha256').update(destination).digest('hex');const response=await fetch(base+'/rest/v1/rpc/record_notification_link_open',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_notification_id:id,p_destination_hash:destinationHash})});if(!response.ok)throw new Error('Open evidence could not be recorded');}
module.exports._test={applicationBase,decodeDestination,isAllowedDestination,signature,validateLink};
