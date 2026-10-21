// Readiness probe only: PostgreSQL must reject p_id while binding its UUID
// argument, before the minutes function can execute any statement or mutation.
const PROBE_ID='invalid-uuid-readiness-probe';
const MAX_TIMEOUT_MS=15000;
const KNOWN_PROJECTS=new Set(['iarfxjhahzbhncsaohbg','beoutmqttgfyyzndcdxu']);
const REPAIR='supabase/migrations/20261020020000_meetings_rpc_installation_repair.sql';
class VerificationError extends Error {}
function authenticatedToken(value){
 const token=String(value||'').trim();
 try{const parts=token.split('.'),payload=JSON.parse(Buffer.from(parts[1]||'','base64url').toString('utf8'));if(parts.length===3&&parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part))&&payload.role==='authenticated'&&typeof payload.sub==='string'&&payload.sub)return token;}catch(_){}
 throw Error('Minutes RPC verification requires an authenticated user access token.');
}
function publicKey(value){
 const key=String(value||'').trim();if(!key||/^sb_secret_/i.test(key))throw Error('Minutes RPC verification requires a public application key.');
 if(key.startsWith('sb_publishable_'))return {key,jwt:false};
 try{const payload=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString('utf8'));if(key.split('.').length===3&&payload.role==='anon')return {key,jwt:true};}catch(_){}
 throw Error('Minutes RPC verification requires a public application key.');
}
function endpoint(value,expectedProjectRef){
 if(!KNOWN_PROJECTS.has(expectedProjectRef))throw Error('Minutes RPC verification requires an approved expected project.');
 let url;try{url=new URL(String(value||''));}catch(_){throw Error('Minutes RPC verification requires the approved HTTPS Supabase URL.');}
 if(url.protocol!=='https:'||url.hostname!==expectedProjectRef+'.supabase.co'||url.username||url.password||url.port&&url.port!=='443'||!['','/'].includes(url.pathname)||url.search||url.hash)throw Error('Minutes RPC verification requires the approved HTTPS Supabase URL.');
 return new URL('/rest/v1/rpc/save_hse_minutes',url).href;
}
async function verifyMeetingsRpc(options={}){
 const url=endpoint(options.supabaseUrl,options.expectedProjectRef),credential=publicKey(options.publicKey),accessToken=authenticatedToken(options.accessToken),fetchImpl=options.fetchImpl||fetch,controller=new AbortController();
 const timeoutMs=Number.isFinite(options.timeoutMs)?Math.max(1,Math.min(MAX_TIMEOUT_MS,options.timeoutMs)):MAX_TIMEOUT_MS;
 const timer=setTimeout(()=>controller.abort(),timeoutMs),headers={apikey:credential.key,Authorization:'Bearer '+accessToken,'Content-Type':'application/json',Accept:'application/json'};
 try{
  const response=await fetchImpl(url,{method:'POST',headers,redirect:'error',signal:controller.signal,body:JSON.stringify({p_id:PROBE_ID,p_minutes:{},p_expected_updated_at:null})});
  let result;try{result=await response.json();}catch(_){throw new VerificationError('Minutes RPC verification received an unreadable response.');}
  if(!response.ok&&result?.code==='22P02'&&/invalid input syntax for type uuid/i.test(String(result.message||''))&&String(result.message||'').includes(PROBE_ID))return {installed:true,authenticated:true,no_write_probe:true,result:'invalid_uuid_rejected'};
  if(result?.code==='PGRST202')throw new VerificationError('Atomic meeting minutes saving is unavailable in the deployed database. Apply '+REPAIR+' to this project and reload the PostgREST schema cache before release.');
  if(result?.code==='42501')throw new VerificationError('Authenticated minutes RPC readiness was denied. Check application access, the API request guard and execution grants before release.');
  throw new VerificationError('Minutes RPC readiness could not be verified safely. Check the atomic save routine, execution grants and API schema configuration.');
 }catch(error){
  if(controller.signal.aborted||error?.name==='AbortError')throw Error('Minutes RPC verification timed out. Retry the database readiness check before release.');
  if(error instanceof VerificationError)throw error;
  throw Error('Minutes RPC verification could not reach the approved database API. Retry before release.');
 }finally{clearTimeout(timer);}
}
module.exports={verifyMeetingsRpc,PROBE_ID,MAX_TIMEOUT_MS};
