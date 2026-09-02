// AURIS360 governed scheduled CSV intake worker. It stages reviewed rows; it never approves or applies them.
const crypto=require('crypto');
const dns=require('dns').promises;
const engine=require('../auris-integration-engine.js');
const BATCH_SIZE=5,MAX_BODY_BYTES=1024*1024,REQUEST_TIMEOUT_MS=15000;
module.exports=async function handler(req,res){if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)return res.status(401).json({error:'Unauthorized'});if(!['GET','POST'].includes(String(req.method||'GET').toUpperCase()))return res.status(405).json({error:'GET or POST only'});try{validateEnvironment();return res.status(200).json(await processSchedules());}catch(error){return res.status(500).json({error:safeError(error)});}};
function validateEnvironment(){var missing=['SUPABASE_URL','SUPABASE_SERVICE_KEY','AURIS_INTEGRATION_SECRETS_JSON'].filter(function(name){return !process.env[name];});if(missing.length)throw new Error('Scheduled exchange worker configuration is incomplete.');integrationSecrets();}
function integrationSecrets(){var parsed;try{parsed=JSON.parse(process.env.AURIS_INTEGRATION_SECRETS_JSON||'{}');}catch(_){throw new Error('Integration credential map is invalid.');}if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('Integration credential map is invalid.');return parsed;}
function supabase(){var key=process.env.SUPABASE_SERVICE_KEY;return {base:String(process.env.SUPABASE_URL).replace(/\/$/,''),headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'}};}
async function rpc(client,name,body){var response=await fetch(client.base+'/rest/v1/rpc/'+name,{method:'POST',headers:client.headers,body:JSON.stringify(body||{})}),text=await response.text();if(!response.ok)throw new Error('Scheduled exchange '+name+' failed with upstream status '+response.status);return text?JSON.parse(text):null;}
function privateAddress(address){address=String(address||'').toLowerCase();if(address.includes(':'))return address==='::1'||address.startsWith('fc')||address.startsWith('fd')||address.startsWith('fe8')||address.startsWith('fe9')||address.startsWith('fea')||address.startsWith('feb');return /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(address)||/^172\.(1[6-9]|2\d|3[01])\./.test(address);}
async function safeEndpoint(job){var url;try{url=new URL(String(job.endpoint_url||''));}catch(_){throw controlled('invalid_endpoint');}var host=url.hostname.toLowerCase();if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||host!==String(job.approved_host||'').toLowerCase()||host==='localhost'||host.endsWith('.local'))throw controlled('endpoint_not_approved');var resolved=await dns.lookup(host,{all:true,verbatim:true});if(!resolved.length||resolved.some(function(item){return privateAddress(item.address);}))throw controlled('endpoint_not_public');return url;}
function controlled(code){var error=new Error(code);error.controlled=true;error.errorCode=code;return error;}
function transient(error){var status=Number(error&&error.statusCode||0);return error&&error.name==='AbortError'||status===408||status===425||status===429||status>=500||/fetch|network|timeout|temporar|connection/i.test(String(error&&error.message||''));}
function errorCode(error){if(error&&error.controlled)return String(error.errorCode||'controlled_failure').slice(0,80);if(error&&error.name==='AbortError')return 'request_timeout';var status=Number(error&&error.statusCode||0);if(status)return 'http_'+status;if(/rejected|reference|revision|mapping|CSV/i.test(String(error&&error.message||'')))return 'source_validation_failed';return 'source_fetch_failed';}
function safeError(error){return String(error&&error.message||error||'Scheduled exchange failed').replace(/(Bearer|apikey|token|secret|password)\s+[^\s,;]+/gi,'$1 [redacted]').replace(/https?:\/\/\S+/gi,'[endpoint]').slice(0,300);}
async function fetchCsv(job,secret){
  var url=await safeEndpoint(job),controller=new AbortController(),timer=setTimeout(function(){controller.abort();},REQUEST_TIMEOUT_MS),response;
  try{
    response=await fetch(url,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'text/csv','User-Agent':'AURIS360-Scheduled-Exchange/1.0',Authorization:'Bearer '+secret,'X-AURIS-Run':String(job.run_id)}});
    if(response.status>=300&&response.status<400)throw controlled('redirect_blocked');
    if(!response.ok){var failed=new Error('Scheduled source rejected the request.');failed.statusCode=response.status;throw failed;}
    var type=String(response.headers.get('content-type')||'').toLowerCase(),declared=Number(response.headers.get('content-length')||0);
    if(!type.includes('text/csv')&&!type.includes('application/csv')&&!type.includes('text/plain'))throw controlled('unsupported_content_type');
    if(declared>MAX_BODY_BYTES)throw controlled('source_too_large');
    var reader=response.body&&response.body.getReader(),chunks=[],total=0;
    if(!reader)throw controlled('source_body_unavailable');
    while(true){var part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>MAX_BODY_BYTES){controller.abort();throw controlled('source_too_large');}chunks.push(Buffer.from(part.value));}
    return Buffer.concat(chunks,total).toString('utf8');
  }finally{clearTimeout(timer);}
}
async function processSchedules(){
  var client=supabase(),jobs=await rpc(client,'claim_due_data_exchange_runs',{p_limit:BATCH_SIZE,p_worker_id:'scheduled-'+crypto.randomUUID()}),staged=0,retried=0,failed=0,blocked=0,secrets=integrationSecrets();
  for(var job of jobs||[]){
    try{
      var secret=String(secrets[job.credential_ref]||'');if(secret.length<24)throw controlled('credential_unavailable');
      var csv=await fetchCsv(job,secret),profile={id:job.mapping_profile_id,company_id:job.company_id,name:job.mapping_name,operation:job.operation,field_map:job.field_map,value_map:job.value_map,mapping_fingerprint:job.mapping_fingerprint,status:'active',revision:Number(job.mapping_revision)},connection={id:job.connection_id,endpointUrl:job.endpoint_url,approvedHost:job.approved_host,credentialRef:job.credential_ref,inboundCsvEnabled:true,events:['action.updated'],status:'active',revision:Number(job.connection_revision)},schedule={id:job.schedule_id,name:job.schedule_name,status:'active',revision:Number(job.schedule_revision),mappingProfileId:job.mapping_profile_id,connectionId:job.connection_id,cadence:job.cadence,timezone:job.timezone,localTime:job.local_time,weekday:Number(job.weekday),retryLimit:Number(job.retry_limit),mappingProfile:profile,connection:connection},prepared=engine.scheduledMappedImport(schedule,profile,csv,{context:function(){return {companyId:String(job.company_id),role:'sephs_admin'};}});
      await rpc(client,'stage_scheduled_exchange_run',{p_run_id:job.run_id,p_lease_token:job.lease_token,p_schedule_revision:prepared.scheduleRevision,p_mapping_revision:prepared.mappingRevision,p_rows:prepared.rows});staged++;
    }catch(error){var retry=transient(error)&&Number(job.attempt_count)<Number(job.retry_limit);try{await rpc(client,'fail_scheduled_exchange_run',{p_run_id:job.run_id,p_lease_token:job.lease_token,p_error_code:errorCode(error),p_transient:retry});}catch(_){}if(error&&error.controlled)blocked++;else if(retry)retried++;else failed++;}
  }
  return {ok:true,claimed:(jobs||[]).length,staged:staged,retried:retried,failed:failed,blocked:blocked};
}
module.exports._test={privateAddress:privateAddress,safeError:safeError,errorCode:errorCode,transient:transient,integrationSecrets:integrationSecrets};
