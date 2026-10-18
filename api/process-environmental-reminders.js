// Daily in-app collection/disposal milestones. Database processor owns scope and deduplication.
module.exports = async function handler(req,res){
  if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)return res.status(401).json({error:'Unauthorized'});
  if(!['GET','POST'].includes(String(req.method||'GET').toUpperCase()))return res.status(405).json({error:'GET or POST only'});
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_KEY)return res.status(500).json({error:'Environmental reminders are not configured'});
  try{const key=process.env.SUPABASE_SERVICE_KEY,response=await fetch(String(process.env.SUPABASE_URL).replace(/\/$/,'')+'/rest/v1/rpc/process_environmental_due_reminders',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('Reminder processor returned status '+response.status);return res.status(200).json({ok:true,result:await response.json()});}catch(error){return res.status(500).json({error:String(error.message||error).slice(0,200)});}
};
