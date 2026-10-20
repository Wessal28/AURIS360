const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyMeetingsRpc,PROBE_ID,MAX_TIMEOUT_MS}=require('../scripts/verify-meetings-rpc.cjs');
const project='iarfxjhahzbhncsaohbg',publicKey='sb_publishable_synthetic_readiness_key';
const options={supabaseUrl:'https://'+project+'.supabase.co',expectedProjectRef:project,publicKey};
const reply=(code,message,status=400)=>async()=>new Response(JSON.stringify({code,message}),{status});

test('probe sends all exact named arguments and an uncastable UUID before routine execution',async()=>{
 let request;
 const result=await verifyMeetingsRpc({...options,fetchImpl:async(url,init)=>{
  request={url,init};return new Response(JSON.stringify({code:'22P02',message:'invalid input syntax for type uuid: "'+PROBE_ID+'"'}),{status:400});
 }});
 assert.deepEqual(result,{installed:true,no_write_probe:true,result:'invalid_uuid_rejected'});
 assert.equal(request.url,options.supabaseUrl+'/rest/v1/rpc/save_hse_minutes');
 assert.equal(request.init.method,'POST');assert.equal(request.init.redirect,'error');
 assert.deepEqual(JSON.parse(request.init.body),{p_id:'invalid-uuid-readiness-probe',p_minutes:{},p_expected_updated_at:null});
 assert.equal(request.init.headers.apikey,publicKey);assert.equal(request.init.headers.Authorization,undefined);
 assert.ok(request.init.signal instanceof AbortSignal);assert.equal(MAX_TIMEOUT_MS,15000);
});

test('permission rejection proves the exact routine exists without executing it',async()=>{
 for(const name of ['save_hse_minutes','public.save_hse_minutes']){
  const result=await verifyMeetingsRpc({...options,fetchImpl:reply('42501','permission denied for function '+name,403)});
  assert.equal(result.result,'execution_permission_rejected');
 }
});

test('public anon JWT is supported while service-role and secret keys are rejected before a request',async()=>{
 const token=role=>'synthetic.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';let called=0;
 await verifyMeetingsRpc({...options,publicKey:token('anon'),fetchImpl:async(_url,init)=>{called++;assert.equal(init.headers.Authorization,'Bearer '+token('anon'));return new Response(JSON.stringify({code:'42501',message:'permission denied for function save_hse_minutes'}),{status:403});}});
 assert.equal(called,1);
 for(const key of [token('service_role'),'sb_secret_synthetic','', 'unrecognised-key'])await assert.rejects(verifyMeetingsRpc({...options,publicKey:key,fetchImpl:()=>{throw Error('must not request');}}),/public application key/);
});

test('missing RPC blocks release with the exact repair migration and schema-cache guidance',async()=>{
 await assert.rejects(verifyMeetingsRpc({...options,fetchImpl:reply('PGRST202','unsafe server detail '+publicKey,404)}),error=>{
  assert.match(error.message,/20261020020000_meetings_rpc_installation_repair\.sql/);assert.match(error.message,/PostgREST schema cache/);assert.doesNotMatch(error.message,/unsafe server detail|synthetic_readiness_key/);return true;
 });
});

test('unexpected success, unrelated permission denial and unrelated UUID errors do not count as readiness',async()=>{
 for(const fetchImpl of [reply('22P02','invalid input syntax for type uuid: "someone-else"'),reply('42501','permission denied for table hse_meetings',403),reply('42501','permission denied for function another_function',403),reply('22P02','invalid input syntax for type uuid: "'+PROBE_ID+'"',200),reply('PGRST203','Ambiguous function',300),async()=>new Response('Gateway failure',{status:503})])await assert.rejects(verifyMeetingsRpc({...options,fetchImpl}),/verification received an unreadable response|readiness could not be verified safely/);
});

test('project validation confines credentials and the probe to the caller-approved HTTPS Supabase project',async()=>{
 for(const supabaseUrl of ['http://'+project+'.supabase.co','https://other.supabase.co','https://'+project+'.supabase.co.evil.test','https://user:password@'+project+'.supabase.co','https://'+project+'.supabase.co:444','https://'+project+'.supabase.co/rest/v1','https://'+project+'.supabase.co/?redirect=other'])await assert.rejects(verifyMeetingsRpc({...options,supabaseUrl,fetchImpl:()=>{throw Error('must not request');}}),/approved HTTPS Supabase URL/);
 await assert.rejects(verifyMeetingsRpc({...options,expectedProjectRef:'other',fetchImpl:()=>{throw Error('must not request');}}),/approved expected project/);
});

test('network diagnostics never expose credentials and timeouts abort promptly',async()=>{
 await assert.rejects(verifyMeetingsRpc({...options,fetchImpl:async()=>{throw Error('network failed with '+publicKey);}}),error=>{assert.doesNotMatch(error.message,/synthetic_readiness_key/);assert.match(error.message,/could not reach/);return true;});
  await assert.rejects(verifyMeetingsRpc({...options,fetchImpl:async()=>{throw Error('Minutes RPC failed with '+publicKey);}}),error=>{assert.doesNotMatch(error.message,/synthetic_readiness_key/);return true;});
 await assert.rejects(verifyMeetingsRpc({...options,timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{const error=new Error('aborted');error.name='AbortError';reject(error);},{once:true});})}),/timed out/);
});
