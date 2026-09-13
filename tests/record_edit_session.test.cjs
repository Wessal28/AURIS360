const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../auris-record-edit-session.js'),'utf8');
const initial={id:'record-a',company_id:'company-a',title:'Original',status:'open',updated_at:'2026-09-13T01:00:00.000Z',actual_cost:0};
function runtime(record=initial){
  const scope={};vm.runInNewContext(source,scope);
  const state={identity:{companyId:'company-a',userId:'user-a',role:'admin'},online:true,rows:record?[{...record}]:[],calls:[],hook:null};
  state.request=async(path,options)=>{
    state.calls.push({path,options});if(state.hook){const result=await state.hook(path,options);if(result!==undefined)return result;}
    if(!options)return structuredClone(state.rows);
    if(options.m==='POST'){assert.equal(state.rows.length,0);state.rows=[{...options.b}];}
    else state.rows=[{...state.rows[0],...options.b}];
    return structuredClone(state.rows);
  };
  state.editor=scope.AurisRecordEditSession.create({record,table:'action_tracker',context:()=>state.identity,request:state.request,online:()=>state.online,uuid:()=> 'new-fixed-id',now:()=> '2026-09-13T02:00:00.000Z'});
  return state;
}
test('scopes both read and conditional update; only changed fields are written and zero survives',async()=>{
  const r=runtime();const result=await r.editor.save({title:'Changed',actual_cost:0,status:'open',company_id:'attacker',id:'other'});
  assert.equal(result.record.title,'Changed');assert.equal(result.record.company_id,'company-a');
  assert.match(r.calls[0].path,/id=eq.record-a&company_id=eq.company-a/);
  assert.match(r.calls[1].path,/updated_at=eq.2026-09-13T01%3A00%3A00.000Z&status=eq.open/);
  assert.deepEqual(Object.keys(r.calls[1].options.b).sort(),['title','updated_at']);
});
test('rejects changed records before a write, including old writers that did not update the timestamp',async()=>{
  for(const changes of [{updated_at:'later'},{title:'Someone else'},{status:'closed'}]){
    const r=runtime();Object.assign(r.rows[0],changes);
    await assert.rejects(r.editor.save({title:'Mine',status:'open'}),/changed since/);assert.equal(r.calls.length,1);
  }
});
test('fails closed on filtered read, wrong company, wrong identity or duplicate rows',async()=>{
  for(const rows of [[],[{...initial,company_id:'other'}],[{...initial,id:'other'}],[initial,initial]]){
    const r=runtime();r.rows=rows;await assert.rejects(r.editor.save({title:'Mine'}),/did not confirm/);assert.equal(r.calls.length,1);
  }
});
test('empty conditional-write response is not reported as a save',async()=>{
  const r=runtime();r.hook=async(_,o)=>o?[]:undefined;
  await assert.rejects(r.editor.save({title:'Mine'}),/did not confirm/);assert.equal(r.editor.record().title,'Original');
});
test('company, role, user and connectivity are rechecked after asynchronous reads',async()=>{
  for(const field of ['companyId','role','userId','online']){
    const r=runtime();r.hook=async()=>{if(field==='online')r.online=false;else r.identity[field]='changed';};
    await assert.rejects(r.editor.save({title:'Mine'}),/changed|Reconnect/);assert.equal(r.calls.length,1);
  }
});
test('serializes saves and retains the first edit while it is pending',async()=>{
  const r=runtime();let release;r.hook=()=>new Promise(resolve=>{release=resolve;});
  const pending=r.editor.save({title:'First'});await assert.rejects(r.editor.save({title:'Second'}),/already in progress/);
  r.hook=null;release();await pending;assert.equal(r.rows[0].title,'First');
});
test('create contains a stable id and the session company and user',async()=>{
  const r=runtime(null);const result=await r.editor.save({title:'New',status:'open',actual_cost:0});
  assert.equal(result.created,true);assert.equal(r.rows[0].id,'new-fixed-id');assert.equal(r.rows[0].created_by,'user-a');assert.equal(r.rows[0].actual_cost,0);
});
test('uncertain create response recovers the saved record without creating a duplicate',async()=>{
  const r=runtime(null);r.hook=async(_,o)=>{if(o){r.rows=[{...o.b}];throw Error('Connection lost');}};
  await assert.rejects(r.editor.save({title:'New',status:'open'}),/Connection lost/);assert.deepEqual({...r.editor.record()},{});
  r.hook=null;const result=await r.editor.save({title:'New',status:'open'});assert.equal(result.recovered,true);assert.equal(r.calls.filter(c=>c.options?.m==='POST').length,1);
});
test('a failed create with no persisted row retries the same id',async()=>{
  const r=runtime(null);r.hook=async(_,o)=>{if(o)throw Error('Disconnected');};
  await assert.rejects(r.editor.save({title:'New',status:'open'}));r.hook=null;
  await r.editor.save({title:'New',status:'open'});assert.equal(r.calls.filter(c=>c.options).every(c=>c.options.b.id==='new-fixed-id'),true);
});
test('new edits after an uncertain successful save are retained and persisted on retry',async()=>{
  const r=runtime();r.hook=async(_,o)=>{if(o){Object.assign(r.rows[0],o.b);throw Error('Lost reply');}};
  await assert.rejects(r.editor.save({title:'First'}));r.hook=null;
  const result=await r.editor.save({title:'Second'});assert.equal(result.record.title,'Second');
});
test('never confirms dropped input fields or an uncertain create changed by someone else',async()=>{
  const r=runtime(null);r.hook=async(_,o)=>{if(o){r.rows=[{...o.b,title:'Different'}];return r.rows;}};
  await assert.rejects(r.editor.save({title:'New',status:'open'}),/different values/);r.hook=null;
  await assert.rejects(r.editor.save({title:'New',status:'open'}),/different values/);assert.equal(r.calls.filter(c=>c.options).length,1);
});
test('lost update replies recover when the server has advanced the revision timestamp',async()=>{
  const r=runtime();r.hook=async(_,o)=>{if(o){Object.assign(r.rows[0],o.b,{updated_at:'2026-09-13T02:00:00.000001Z'});throw Error('Lost reply');}};
  await assert.rejects(r.editor.save({title:'Changed'}));r.hook=null;
  const recovered=await r.editor.save({title:'Changed'});assert.equal(recovered.recovered,true);assert.equal(r.calls.filter(c=>c.options).length,1);
});
