const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('auris-core.js','utf8');
const start=source.indexOf('async function invSave(){');
const end=source.indexOf('async function invReleaseForEdit()',start);
assert.ok(start>=0&&end>start,'The investigation save handler must be available for behavior tests');
const saveSource=source.slice(start,end);
function harness(){
 const existing={id:'investigation-existing',company_id:'company-a',status:'in_progress',investigation_ref:'INV-2026-001',description:'Previously saved investigation'};
 const fields={
  'inv-status-sel':{value:'completed'},'ws1-description':{value:'Confirmed investigation findings'},
  'ws1-event-link':{value:'INC-2026-001'},'ws1-location':{value:'Workshop'},
  'inv-type-sel':{value:'incident'},'inv-method':{value:'5why'},
  'inv-form3ref':{textContent:existing.investigation_ref},
  'ims-inv-form':{style:{display:'block'}},'ims-inv-list':{style:{display:'none'}}
 };
 const requests=[],notices=[],errors=[],effects=[];
 const c={Date,console,prof:{id:'manager-a',company_id:'company-a',role:'sephs_admin'},sephsCompanyContext:'company-a',imsInvEditId:existing.id,imsInvAllData:[structuredClone(existing)],invTeam:[],
  document:{getElementById:id=>fields[id]||null,querySelectorAll:()=>[]},
  workflowCanMutate:()=>true,invCanEditRecord:()=>true,isSA:()=>true,isAdm:()=>true,
  toast:(...args)=>notices.push(args),toastActionError:(...args)=>errors.push(args),
  invSaveWitnesses:async(...args)=>effects.push(['witnesses',...args]),invRefreshSignButtons:()=>effects.push(['sign-buttons']),
  imsInvBack:()=>{effects.push(['back']);fields['ims-inv-form'].style.display='none';},
  queueNotification:()=>effects.push(['notification']),
  api:async(path,options)=>{requests.push({path,options:structuredClone(options)});if(c.reject)throw c.reject;return null;}
 };
 c.window=c;vm.createContext(c);vm.runInContext(saveSource,c);
 return {c,fields,requests,notices,errors,effects,existing,values:()=>Object.fromEntries(Object.entries(fields).filter(([,field])=>'value' in field).map(([id,field])=>[id,field.value]))};
}

test('a rejected Completed investigation update retains the existing identity, input and saved cache without a fallback status write',async()=>{
 const h=harness(),entered=h.values(),cached=JSON.stringify(h.c.imsInvAllData);
 h.c.reject=Object.assign(new Error('new row for relation "investigations" violates check constraint "investigations_status_check"'),{code:'23514'});
 await h.c.invSave();
 assert.equal(h.requests.length,1,'A constraint failure must not retry with Closed or another workflow status');
 assert.match(h.requests[0].path,/^\/investigations\?id=eq\.investigation-existing(?:&|$)/);
 assert.equal(h.requests[0].options.m,'PATCH');assert.equal(h.requests[0].options.b.status,'completed');
 assert.equal(h.requests[0].options.b.company_id,'company-a');assert.equal(h.c.imsInvEditId,h.existing.id);
 assert.deepEqual(h.values(),entered);assert.equal(JSON.stringify(h.c.imsInvAllData),cached);
 assert.equal(h.fields['ims-inv-form'].style.display,'block');assert.equal(h.fields['inv-form3ref'].textContent,h.existing.investigation_ref);
 assert.deepEqual(h.effects,[],'No witness, action, notification or navigation effects may follow the rejected update');
 assert.equal(h.notices.length,0);assert.equal(h.errors.length,1);assert.match(h.errors[0][2].message,/investigations_status_check/);
});

test('a supported Completed update saves the requested value and keeps the same investigation identity',async()=>{
 const h=harness();await h.c.invSave();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.m,'PATCH');
 assert.equal(h.requests[0].options.b.status,'completed');assert.equal(h.requests[0].options.b.linked_event_ref,'INC-2026-001');
 assert.equal(h.requests[0].options.b.description,'Confirmed investigation findings');assert.equal(h.c.imsInvEditId,h.existing.id);
 assert.equal(h.errors.length,0);assert.deepEqual(h.effects,[['witnesses',h.existing.id,'company-a'],['back']]);
 assert.ok(h.notices.some(([message])=>/Investigation updated/.test(message)));
});

test('the investigation status migration accepts exactly the six workflow choices offered by the form',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const select=html.match(/<select\b[^>]*\bid="inv-status-sel"[^>]*>([\s\S]*?)<\/select>/i);
 assert.ok(select,'The investigation status selector must remain available');
 const choices=Array.from(select[1].matchAll(/<option\b[^>]*\bvalue="([^"]+)"/gi),match=>match[1]);
 const sql=fs.readFileSync('supabase/migrations/20261126020000_investigation_workflow_status.sql','utf8');
 const constraint=sql.match(/add\s+constraint\s+investigations_status_check\s+check\s*\(([\s\S]*?)\)\s*(?:not\s+valid\s*)?;/i);
 assert.ok(constraint,'Parse the installed status CHECK, excluding preflight and error-message literals');
 const allowed=Array.from(constraint[1].matchAll(/'([^']+)'/g),match=>match[1]);
 assert.deepEqual([...new Set(choices)].sort(),['open','submitted','revision_requested','in_progress','completed','closed'].sort());
 assert.deepEqual([...new Set(allowed)].sort(),[...new Set(choices)].sort());
});
