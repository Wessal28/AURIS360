// Scheduled daily overdue-action digest builder. It queues email; send-emails delivers it.
module.exports=async function handler(req,res){
  if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)return res.status(401).json({error:'Unauthorized'});
  if(!['GET','POST'].includes(String(req.method||'GET').toUpperCase()))return res.status(405).json({error:'GET or POST only'});
  try{validateEnvironment();const base=String(process.env.SUPABASE_URL).replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_KEY;
    const response=await fetch(base+'/rest/v1/rpc/process_action_overdue_digests',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_limit:1000})});
    if(!response.ok)throw new Error('Digest processor failed: '+response.status+' '+(await response.text()).slice(0,500));
    return res.status(200).json({ok:true,result:await response.json()});
  }catch(e){return res.status(500).json({error:safeError(e)});}
};
function validateEnvironment(){const missing=['SUPABASE_URL','SUPABASE_SERVICE_KEY'].filter(n=>!process.env[n]);if(missing.length)throw new Error('Missing required environment variables: '+missing.join(', '));}
function safeError(e){return String(e&&e.message?e.message:e||'Unknown error').slice(0,500);}
module.exports._test={safeError};
