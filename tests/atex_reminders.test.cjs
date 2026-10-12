const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/process-atex-reminders.js');
function response(){return {code:0,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}

test('ATEX reminder worker rejects requests without the cron secret',async()=>{
  const previous=process.env.CRON_SECRET,oldFetch=global.fetch;
  try{
    process.env.CRON_SECRET='test-secret';global.fetch=()=>assert.fail('unauthorised request reached Supabase');
    const res=response();await handler({method:'GET',headers:{}},res);assert.equal(res.code,401);
    const invalid=response();await handler({method:'DELETE',headers:{authorization:'Bearer test-secret'}},invalid);assert.equal(invalid.code,405);
  }finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;global.fetch=oldFetch;}
});

test('ATEX reminder worker calls the service-role processor once',async()=>{
  const names=['CRON_SECRET','SUPABASE_URL','SUPABASE_SERVICE_KEY'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]])),oldFetch=global.fetch;
  try{
    process.env.CRON_SECRET='test-secret';process.env.SUPABASE_URL='https://staging.example.supabase.co/';process.env.SUPABASE_SERVICE_KEY='test-key';
    let calls=0;global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://staging.example.supabase.co/rest/v1/rpc/process_atex_inspection_reminders');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer test-key');return {ok:true,json:async()=>({notifications_queued:2})};};
    const res=response();await handler({method:'GET',headers:{authorization:'Bearer test-secret'}},res);
    assert.equal(calls,1);assert.equal(res.code,200);assert.deepEqual(res.body,{ok:true,result:{notifications_queued:2}});
  }finally{for(const [name,value] of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}global.fetch=oldFetch;}
});
