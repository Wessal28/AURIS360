const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const handler=require('../api/process-permit-followups.js');
const worker=handler._test;
const now=new Date('2026-10-13T07:25:00Z');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const profile={id:id(10),company_id:id(1),status:'active',role:'hse_manager',full_name:'Site manager',email:'manager@example.com'};
const permit={id:id(2),company_id:id(1),permit_number:'PTW-001',status:'active',planned_end:'2026-10-13T08:00:00Z',created_by:profile.id,risk_assessment_id:id(3),approval_l1_at:'2026-10-12T09:00:00Z'};
const references={risks:new Map([[id(3),{id:id(3),company_id:id(1),status:'approved',revision:2,updated_at:'2026-10-12T10:00:00Z'}]]),documents:new Map()};

test('pending approval follows the first unfinished configured level',()=>{
  const row={approval_level_required:3,approval_l1_status:'approved',approval_l2_status:'pending'};
  assert.equal(worker.approvalStage(row),2);
  const company={profiles:[profile],steps:[{step_no:2,approver_email:'manager@example.com',approver_name:'Site manager'}],fallback:{}};
  assert.deepEqual(worker.approvalRecipients(row,company),[{profile_id:profile.id,email:'manager@example.com',name:'Site manager'}]);
  row.approval_l2_status='approved';row.approval_l3_status='approved';
  assert.equal(worker.approvalStage(row),null);
});

test('only active company users with real addresses receive follow-ups',()=>{
  const recipients=worker.followupRecipients(permit,[profile,{...profile,id:id(11),email:'fake.local'},{...profile,id:id(12),company_id:id(9)}].filter(p=>p.company_id===permit.company_id));
  assert.equal(recipients.length,1);
  assert.equal(recipients[0].profile_id,profile.id);
  assert.equal(worker.bestEmail({email:'login@demo.local'}),null);
});

test('expiry, close-out and document changes are distinct and stop after closure',()=>{
  assert.equal(worker.documentIssue(permit,references),'Linked Risk Assessment changed after permit approval');
  assert.deepEqual(worker.planEvents(permit,references,now).map(e=>e.kind),['permit_expiry_warning','permit_document_review']);
  const overdue={...permit,planned_end:'2026-10-12T08:00:00Z'};
  assert.equal(worker.planEvents(overdue,references,now)[0].kind,'permit_closure_followup');
  assert.equal(worker.planEvents({...overdue,status:'approved'},references,now)[0].kind,'permit_expired_unstarted');
  assert.equal(worker.planEvents({...overdue,status:'completed'},references,now).length,0);
});

test('changed or withdrawn linked records flag the permit without assuming approval',()=>{
  assert.equal(worker.documentIssue({...permit,risk_assessment_id:id(9)},references),'Linked Risk Assessment is unavailable');
  references.risks.get(id(3)).status='draft';
  assert.equal(worker.documentIssue(permit,references),'Linked Risk Assessment is no longer approved/current');
  references.risks.get(id(3)).status='approved';
  const doc={...permit,risk_assessment_id:null,method_statement_id:id(4)};
  const linked={risks:new Map(),documents:new Map([[id(4),{id:id(4),company_id:id(1),status:'current',is_latest:false}]])};
  assert.equal(worker.documentIssue(doc,linked),'Linked method statement is no longer current');
  const currentRa={...permit,linked_reference_snapshot:{risk_assessment_id:id(3),risk_assessment_revision:1,approved_at:'2026-10-12T12:00:00Z'}};
  assert.equal(worker.documentIssue(currentRa,references),'Linked Risk Assessment revision changed after permit approval');
  const currentDoc={...doc,linked_reference_snapshot:{method_statement_id:id(4),method_statement_version_major:1,method_statement_version_minor:0}};
  linked.documents.get(id(4)).is_latest=true;
  linked.documents.get(id(4)).version_major=2;
  linked.documents.get(id(4)).version_minor=0;
  assert.equal(worker.documentIssue(currentDoc,linked),'Linked method statement revision changed after permit approval');
});

test('notification identity is per permit, event, recipient and day',()=>{
  const person={profile_id:profile.id,email:profile.email,name:profile.full_name};
  const one=worker.notificationFor(permit,{kind:'permit_closure_followup',title:'Closure due'},person,'2026-10-13',now);
  const repeat=worker.notificationFor(permit,{kind:'permit_closure_followup',title:'Closure due'},person,'2026-10-13',now);
  const next=worker.notificationFor(permit,{kind:'permit_closure_followup',title:'Closure due'},person,'2026-10-14',now);
  assert.equal(one.idempotency_key,repeat.idempotency_key);
  assert.notEqual(one.idempotency_key,next.idempotency_key);
  assert.equal(one.related_id,permit.id);
  assert.equal(one.channel,'in_app');
});

test('cron is authenticated and registered for an hourly run',async()=>{
  const old=process.env.CRON_SECRET;process.env.CRON_SECRET='test-secret';
  try{
    let code,body;const res={status(value){code=value;return this;},json(value){body=value;return value;}};
    await handler({headers:{},method:'GET'},res);
    assert.equal(code,401);assert.deepEqual(body,{error:'Unauthorized'});
    const vercel=JSON.parse(fs.readFileSync(path.join(__dirname,'..','vercel.json'),'utf8'));
    assert.equal(vercel.crons.find(row=>row.path==='/api/process-permit-followups').schedule,'25 * * * *');
  }finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}
});

test('database captures same-company linked revisions at approval and backfills existing permits',()=>{
  const migration=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20261013100000_permit_reference_approval_snapshot.sql'),'utf8');
  assert.match(migration,/new\.status = 'approved'/);
  assert.match(migration,/company_id = new\.company_id/g);
  assert.match(migration,/risk_assessment_revision/);
  assert.match(migration,/method_statement_version_major/);
  assert.match(migration,/where p\.status in \('approved','active'\)/);
});

test('worker reads tenant-linked evidence and queues only scoped, duplicate-safe reminders',async()=>{
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_SERVICE_KEY='test-service-key';
  const writes=[],reads=[];
  const fetchImpl=async(url,init={})=>{
    const parsed=new URL(url);reads.push(parsed.pathname+parsed.search);
    if(init.method==='POST'){
      writes.push(JSON.parse(init.body));
      assert.equal(init.headers.Prefer,'return=minimal');
      return {ok:true,status:201};
    }
    let value=[];
    if(parsed.pathname.endsWith('/permits'))value=[permit];
    if(parsed.pathname.endsWith('/profiles'))value=[profile];
    if(parsed.pathname.endsWith('/risk_assessments'))value=[references.risks.get(id(3))];
    return {ok:true,status:200,json:async()=>value};
  };
  try{
    const result=await worker.processFollowups({now,fetchImpl});
    assert.equal(result.permits_scanned,1);
    assert.equal(result.notifications_queued,2);
    assert.deepEqual(writes.map(row=>row.type),['permit_expiry_warning','permit_document_review']);
    assert.ok(reads.some(url=>url.includes('company_id=eq.'+id(1))&&url.includes('risk_assessments')));
    assert.ok(writes.every(row=>row.company_id===id(1)&&row.recipient_profile_id===profile.id));
  }finally{
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_KEY;else process.env.SUPABASE_SERVICE_KEY=oldKey;
  }
});

test('a previously queued daily reminder is counted as a duplicate, not a new notification',async()=>{
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_SERVICE_KEY='test-service-key';
  const fetchImpl=async(url,init={})=>{
    const route=new URL(url).pathname;
    if(init.method==='POST')return {ok:false,status:409,json:async()=>({code:'23505',message:'duplicate key value violates unique constraint "notification_queue_idempotency"'})};
    let rows=[];
    if(route.endsWith('/permits'))rows=[permit];
    if(route.endsWith('/profiles'))rows=[profile];
    if(route.endsWith('/risk_assessments'))rows=[references.risks.get(id(3))];
    return {ok:true,json:async()=>rows};
  };
  try{assert.equal((await worker.processFollowups({now,fetchImpl})).notifications_queued,0);}
  finally{
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_KEY;else process.env.SUPABASE_SERVICE_KEY=oldKey;
  }
});

test('unconfigured approval route alerts managers without giving them approval authority',async()=>{
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_SERVICE_KEY='test-service-key';
  const pending={...permit,status:'pending_approval',approval_level_required:1,approval_l1_status:'pending'};
  const writes=[];
  const fetchImpl=async(url,init={})=>{
    const route=new URL(url).pathname;
    if(init.method==='POST'){writes.push(JSON.parse(init.body));return {ok:true,status:201};}
    let rows=[];
    if(route.endsWith('/permits'))rows=[pending];
    if(route.endsWith('/profiles'))rows=[profile];
    if(route.endsWith('/risk_assessments'))rows=[references.risks.get(id(3))];
    return {ok:true,json:async()=>rows};
  };
  try{
    await worker.processFollowups({now,fetchImpl});
    assert.equal(writes.length,1);
    assert.equal(writes[0].type,'permit_approval_route_missing');
    assert.equal(writes[0].recipient_profile_id,profile.id);
    assert.match(writes[0].subject,/no configured contact/);
  }finally{
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_KEY;else process.env.SUPABASE_SERVICE_KEY=oldKey;
  }
});
