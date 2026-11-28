const test=require('node:test');
const assert=require('node:assert/strict');
const service=require('../auris-source-action-sync.js');
const company='f1280000-0000-4000-8000-000000000010',user='f1280000-0000-4000-8000-000000000001';
const sourceId='f1280000-0000-4000-8000-000000000100',firstId='f1280000-0000-4000-8000-000000000201',secondId='f1280000-0000-4000-8000-000000000202';
const source={module:'investigation',id:sourceId,companyId:company,ref:'INV-2026-001'};
const clone=value=>JSON.parse(JSON.stringify(value));
function action(extra={}){return {id:firstId,company_id:company,source_module:'investigation',source_type:'investigation',source_id:sourceId,source_ref:source.ref,action_no:'first-key',title:'Repair the guard',description:'Repair the guard',responsible:null,assigned_to_name:null,assigned_to_id:null,target_date:null,priority:'medium',status:'open',updated_at:'2026-11-28T10:00:00Z',evidence:'Existing evidence',closure_notes:'Existing closure record',...extra};}
function harness(initial=[],options={}){
  const state={companyId:company,userId:user,role:'manager',canView:true,canEdit:true},records=clone(initial),requests=[],opened=[];let counter=0;
  const create=service.create({getContext:()=>({...state}),makeKey:()=>`new-key-${++counter}`,openAction:async(id,context)=>{opened.push({id,context});if(options.open)await options.open(id);},request:async(path,request={})=>{
    requests.push({path,request:clone(request)});
    if(options.before)await options.before(path,request,state);
    if(!request.m||request.m==='GET'){const columns=new URL(path,'https://fixture.invalid').searchParams.get('select').split(',');return records.map(record=>Object.fromEntries(columns.map(key=>[key,record[key]??null])));}
    assert.notEqual(request.m,'DELETE','Never delete/recreate canonical actions');
    if(request.m==='PATCH'){
      const q=new URL(path,'https://fixture.invalid').searchParams,id=q.get('id')?.slice(3),record=records.find(row=>row.id===id);
      assert.equal(q.get('company_id'),'eq.'+company);assert.equal(q.get('source_id'),'eq.'+sourceId);assert.equal(q.get('source_module'),'eq.investigation');
      assert.equal(Object.hasOwn(request.b,'status'),false,'Source metadata cannot approve, reopen or otherwise transition an action');
      if(options.rejectWrite)return [];
      if(!record||q.get('updated_at')!==`eq.${record.updated_at}`)return [];
      Object.assign(record,clone(request.b),{updated_at:'2026-11-28T10:01:00Z'});return [clone(record)];
    }
    if(request.m==='POST'){
      if(options.insertConflict){records.push(action({...clone(request.b),id:secondId,status:options.winnerStatus||'open'}));throw Object.assign(Error('duplicate key value violates unique constraint "'+options.insertConflict+'"'),{code:'23505'});}
      assert.equal(request.b.status,'open','New source actions start in the governed workflow');
      const record=action({...clone(request.b),id:secondId,updated_at:'2026-11-28T10:01:00Z'});records.push(record);return options.rejectWrite?[]:[clone(record)];
    }
    throw Error('Unexpected write');
  }});
  return {service:create,state,records,requests,opened};
}
test('a source completion claim cannot close or replace the exact Master Action',async()=>{
  const h=harness([action()]),rows=[{action_id:firstId,action_key:'first-key',desc:'Repair the guard',status:'closed'}],before=clone(rows);
  const result=await h.service.synchronize(source,rows);
  assert.deepEqual(rows,before,'Caller entries remain available after the service returns');
  assert.equal(result.rows[0].action_id,firstId);assert.equal(result.rows[0].status,'open');assert.equal(result.rows[0].recorded_status,'closed');
  assert.equal(result.differences[0].canonicalStatus,'open');assert.match(result.differences[0].message,/evidence, verification and approval/);
  assert.equal(h.records[0].evidence,'Existing evidence');assert.equal(h.records[0].closure_notes,'Existing closure record');assert.equal(h.requests.length,1);
});
test('source metadata updates retain action identity, status and evidence with optimistic concurrency',async()=>{
  const h=harness([action({status:'pending_closure'})]);
  const result=await h.service.synchronize(source,[{action_id:firstId,action_key:'first-key',description:'Repair and test the guard',status:'closed',assigned_to:'Named owner',due_date:'2026-12-01'}]);
  assert.equal(h.records.length,1);assert.equal(h.records[0].id,firstId);assert.equal(h.records[0].status,'pending_closure');assert.equal(h.records[0].evidence,'Existing evidence');
  assert.equal(result.rows[0].status,'pending_closure');assert.equal(h.requests[1].request.m,'PATCH');assert.match(h.requests[1].path,/updated_at=eq\./);
});
test('approved Master Action closure refreshes the exact source row without changing its sibling',async()=>{
  const h=harness([action({status:'closed'}),action({id:secondId,action_no:'second-key',description:'Different action',title:'Different action'})]);
  const result=await h.service.load(source,[{action_id:secondId,action_key:'second-key',desc:'Different action',status:'open'},{action_id:firstId,action_key:'first-key',desc:'Repair the guard',status:'open'}]);
  assert.equal(result.rows[0].action_id,secondId);assert.equal(result.rows[0].status,'open');assert.equal(result.rows[1].action_id,firstId);assert.equal(result.rows[1].status,'closed');assert.equal(h.requests.length,1);
});
test('reordering source actions uses their saved exact IDs rather than row positions',async()=>{
  const h=harness([action(),action({id:secondId,action_no:'second-key',description:'Second repair',title:'Second repair',status:'in_progress'})]);
  const result=await h.service.load(source,[{action_id:secondId,action_key:'second-key',desc:'Second repair',status:'open'},{action_id:firstId,action_key:'first-key',desc:'Repair the guard',status:'open'}]);
  assert.deepEqual(result.rows.map(row=>[row.action_id,row.status]),[[secondId,'in_progress'],[firstId,'open']]);
});
test('a single exact legacy description can be linked once without deleting its history',async()=>{
  const h=harness([action({action_no:null})]),prepared=h.service.prepare([{desc:'Repair the guard',status:'open'}]);
  const result=await h.service.synchronize(source,prepared);
  assert.equal(result.rows[0].action_id,firstId);assert.equal(result.rows[0].action_key,prepared[0].action_key);assert.equal(h.records.length,1);assert.equal(h.records[0].evidence,'Existing evidence');
  const again=await h.service.synchronize(source,result.rows);assert.equal(again.rows[0].action_id,firstId);assert.equal(h.records.length,1);
});
test('ambiguous legacy matches abort before any action is written',async()=>{
  const h=harness([action({action_no:null}),action({id:secondId,action_no:null})]);
  await assert.rejects(h.service.synchronize(source,[{desc:'Repair the guard',status:'closed'}]),/ambiguous/);assert.equal(h.requests.length,1);assert.equal(h.records.length,2);
});
test('a saved link pointing outside the selected source never falls back to a description match',async()=>{
  const h=harness([action()]);
  await assert.rejects(h.service.synchronize(source,[{action_id:secondId,action_key:'first-key',desc:'Repair the guard',status:'closed'}]),/saved Master Action link/);assert.equal(h.requests.length,1);assert.equal(h.records[0].id,firstId);
});
test('foreign-company or wrong-source action responses are rejected without writes',async()=>{
  for(const extra of [{company_id:'f1280000-0000-4000-8000-000000000020'},{source_id:secondId},{source_module:'inspection'}]){
    const h=harness([action(extra)]);await assert.rejects(h.service.load(source,[{action_id:firstId,desc:'Repair the guard'}]),/could not be confirmed/);assert.equal(h.requests.length,1);
  }
});
test('new source actions start open even if the source claims they are completed',async()=>{
  const h=harness(),prepared=h.service.prepare([{description:'New repair',status:'completed'}]);
  const result=await h.service.synchronize(source,prepared);
  assert.equal(h.records.length,1);assert.equal(h.records[0].status,'open');assert.equal(h.records[0].requires_verification,true);assert.equal(result.rows[0].action_id,secondId);assert.equal(result.rows[0].recorded_status,'closed');
  await h.service.synchronize(source,result.rows);assert.equal(h.records.length,1,'A confirmed source link is reused on retry');
});
test('removing a source row does not delete or cancel its existing Master Action',async()=>{
  const h=harness([action()]);await h.service.synchronize(source,[]);assert.equal(h.records.length,1);assert.equal(h.records[0].status,'open');assert.equal(h.requests.length,1);
});
test('closed canonical actions retain their approved metadata and closure history',async()=>{
  const h=harness([action({status:'closed'})]);await h.service.synchronize(source,[{action_id:firstId,action_key:'first-key',desc:'Changed source wording',status:'open'}]);
  assert.equal(h.records[0].description,'Repair the guard');assert.equal(h.records[0].status,'closed');assert.equal(h.requests.length,1);
});
test('explicit edits to closed or cancelled metadata abort the whole action batch before any write',async()=>{
  for(const terminal of ['closed','cancelled']){
    const h=harness([action(),action({id:secondId,action_no:'second-key',description:'Terminal repair',status:terminal})]);
    const rows=[{action_id:firstId,action_key:'first-key',description:'Open repair amendment',metadata_changed_fields:['description']},{action_id:secondId,action_key:'second-key',description:'Terminal repair amendment',metadata_changed_fields:['description']}],before=clone(rows),stored=clone(h.records);
    await assert.rejects(h.service.synchronize(source,rows),/approved metadata cannot be changed here.*edits are retained.*Manage linked action/);
    assert.equal(h.requests.length,1);assert.deepEqual(rows,before);assert.deepEqual(h.records,stored);
  }
});
test('a source revision claim serializes two tabs with different generated keys before either can create duplicate MAP actions',async()=>{
  const h=harness();let claimed=false;
  const claim=async rows=>{assert.ok(rows[0].action_key);if(claimed)throw Error('Source revision changed');claimed=true;};
  const result=await Promise.allSettled([
    h.service.synchronize(source,[{action_key:'ca-'+firstId,description:'Shared unsaved source repair'}],{beforeWrite:claim}),
    h.service.synchronize(source,[{action_key:'ca-'+secondId,description:'Shared unsaved source repair'}],{beforeWrite:claim})
  ]);
  assert.equal(result.filter(item=>item.status==='fulfilled').length,1);assert.equal(result.filter(item=>item.status==='rejected').length,1);assert.equal(h.records.length,1);assert.equal(h.requests.filter(item=>item.request.m==='POST').length,1);
});
test('an exact generated-key uniqueness race reuses its single scoped winning action without another insert',async()=>{
  const h=harness([],{insertConflict:'investigation_generated_action_identity'}),key='ca-'+firstId;
  const result=await h.service.synchronize(source,[{action_key:key,description:'Repair the guard',metadata_changed_fields:[]}]);
  assert.equal(result.rows[0].action_id,secondId);assert.equal(h.records.length,1);assert.equal(h.requests.filter(item=>item.request.m==='POST').length,1);assert.equal(h.records[0].action_no,key);
});
test('unrelated unique constraints fail without linking or retrying another action',async()=>{
  const h=harness([],{insertConflict:'other_unique_constraint'});
  await assert.rejects(h.service.synchronize(source,[{action_key:'ca-'+firstId,description:'Repair the guard'}]),/other_unique_constraint/);assert.equal(h.requests.length,2);
});
test('a rejected or stale metadata save preserves caller entries and does not create another action',async()=>{
  const h=harness([action()],{rejectWrite:true}),rows=[{action_id:firstId,action_key:'first-key',desc:'Updated guard repair',status:'closed'}],before=clone(rows);
  await assert.rejects(h.service.synchronize(source,rows),/save was not confirmed/);assert.deepEqual(rows,before);assert.equal(h.records.length,1);assert.equal(h.records[0].status,'open');
});
test('context and permission changes block linked-action writes',async()=>{
  const h=harness([action()],{before:async(path,request,state)=>{if(!request.m)state.companyId='different-company';}});
  await assert.rejects(h.service.synchronize(source,[{action_id:firstId,desc:'Updated repair'}]),/changed/);assert.equal(h.requests.length,1);
  const denied=harness([action()]);denied.state.canEdit=false;await assert.rejects(denied.service.synchronize(source,[{desc:'Repair'}]),/access/);assert.equal(denied.requests.length,0);
});
test('Manage linked action opens only the saved canonical ID in its current source company',async()=>{
  const h=harness([action()]);await h.service.manage(source,{action_id:firstId});assert.deepEqual(h.opened,[{id:firstId,context:{companyId:company,userId:user,role:'manager'}}]);
  await assert.rejects(h.service.manage(source,{action_id:secondId}),/unavailable/);assert.equal(h.opened.length,1);
});
