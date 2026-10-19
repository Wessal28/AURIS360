const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const editor=fs.readFileSync('auris-action-editor.js','utf8');
function runtime(){const elements={};const scope={console,window:{},document:{getElementById:id=>elements[id]||null,querySelectorAll:()=>[]},ccid:()=> 'company-a',prof:{id:'actor',full_name:'Reviewer'},activeRole:()=> 'admin',canAccessPage:()=>true};vm.runInNewContext(editor,scope);return {scope,elements};}
function checks(){return Object.fromEntries([1,2,3,4,5,6].map(n=>[n,{confirmed:true,not_applicable:false,reason:''}]));}
test('closure requires completion, evidence and required verification rather than any three checks',()=>{
 const {scope:s}=runtime();let record={requires_verification:true,closure_checklist:{4:{confirmed:true},5:{confirmed:true},6:{confirmed:true}}};assert.equal(s.mapClosureIssues(record).length,3);record.closure_checklist=checks();assert.equal(s.mapClosureIssues(record).length,0);
 record.closure_checklist[1]={not_applicable:true,reason:'Not doing it'};assert.equal(s.mapClosureIssues(record)[0].index,1);
 record.closure_checklist=checks();record.closure_checklist[4]={not_applicable:true,reason:''};assert.equal(s.mapClosureIssues(record)[0].index,4);record.closure_checklist[4].reason='Improvement, not a corrective action';assert.equal(s.mapClosureIssues(record).length,0);
 record.closure_checklist[3]={not_applicable:true,reason:'Verification not required by the workflow'};assert.equal(s.mapClosureIssues(record).length,1);record.requires_verification=false;assert.equal(s.mapClosureIssues(record).length,0);
 record.closure_checklist[4].confirmed=true;assert.equal(s.mapClosureIssues(record)[0].index,4);
});
test('saved-state ignores asynchronous connected-record controls but tracks edits and closure N/A reasons',()=>{
 const {scope:s,elements:e}=runtime();e['mf-title']={value:'Saved title'};e['mcc-4']={type:'checkbox',checked:false};e['mcc-reason-4']={value:''};s.mapEditorInitial=s.mapEditorForm();assert.equal(s.mapEditorDirty(),false);
 e['async-relationship-filter']={value:'new value'};assert.equal(s.mapEditorDirty(),false);e['mf-title'].value='Changed title';assert.equal(s.mapEditorDirty(),true);e['mf-title'].value='Saved title';assert.equal(s.mapEditorDirty(),false);e['mcc-reason-4'].value='Not applicable';assert.equal(s.mapEditorDirty(),true);
 e['mcc-reason-4'].value='';e['map-evidence-caption']={value:'Unsaved attachment'};assert.equal(s.mapEditorDirty(),true);
});
test('closure confirmations hydrate on reopening, including a justified N/A without assuming old confirmations',()=>{
 const {scope:s,elements:e}=runtime();for(const id of s.mapClosureControlIds())e[id]={type:id.includes('reason')?'text':'checkbox',checked:true,value:'stale'};
 s.mapClosureHydrate({closure_checklist:{1:{confirmed:true},4:{not_applicable:true,reason:'Improvement'}}});assert.equal(e['mcc-1'].checked,true);assert.equal(e['mcc-2'].checked,false);assert.equal(e['mcc-na-4'].checked,true);assert.equal(e['mcc-reason-4'].value,'Improvement');
 s.mapClosureHydrate({});assert.equal(e['mcc-1'].checked,false);assert.equal(e['mcc-na-4'].checked,false);assert.equal(e['mcc-reason-4'].value,'');
});
test('uncertain close reports persisted state and retains every editable draft field',async()=>{
 for(const persistedStatus of ['pending_closure','closed']){const {scope:s,elements:e}=runtime();e['mf-title']={value:'Keep my draft'};e['map-editor-feedback']={textContent:'',classList:{toggle(){}},setAttribute(){}};let writes=0,reads=0;
 s.mapEditorSession={record:()=>({id:'action-a',status:'pending_closure'}),assertCurrent(){},save:async()=>{writes++;throw Error('canceling statement due to statement timeout');}};
 s.workflowCanMutate=()=>true;s.mapEditorRefresh=()=>{};s.mapEditorRead=()=>({closure_notes:'Draft closure review'});s.mapEditorWorkflow=(_,body)=>body;s.mapEditorLoadWorkflow=async()=>{};s.api=async url=>{assert.match(url,/company_id=eq.company-a/);assert.match(url,/id=eq.action-a/);reads++;return [{status:persistedStatus,progress_pct:100,verification_status:'passed'}];};
 assert.equal(await s.mapEditorCommit('close'),false);assert.equal(writes,1);assert.equal(reads,1);assert.equal(e['mf-title'].value,'Keep my draft');assert.match(e['map-editor-feedback'].textContent,new RegExp(s.mapStatusLabel(persistedStatus)));assert.match(e['map-editor-feedback'].textContent,/entered changes remain/);assert.equal(s.mapEditorBusy,false);}
});
test('source aliases filter Meeting and Noise Survey consistently with the shared source configuration',()=>{
 const scope={};vm.runInNewContext(fs.readFileSync('auris-action-list-workspace.js','utf8'),scope);const rows=[{id:'meeting',company_id:'co',source_module:'meetings'},{id:'noise',company_id:'co',source_module:'noise'}];
 for(const source of ['meeting','noise_survey']){const result=scope.AurisActionListWorkspace.project(rows,{companyId:'co'},{filters:{source}});assert.equal(result.length,1);assert.equal(result[0].id,source==='meeting'?'meeting':'noise');}
});

test('evidence retries use the same exact-record idempotency key and keep unsaved input after failure',async()=>{
 const {scope:s,elements:e}=runtime();s.URL=URL;s.crypto=require('node:crypto');s.mapEvidenceRecord={id:'action-a',company_id:'company-a',status:'in_progress'};s.mapEditorSession={assertCurrent(){}};s.workflowCanMutate=()=>true;s.mapEditorRefresh=()=>{};s.mapEvidenceLoad=async()=>{};s.mapDisplayRef=()=> 'MAP-FIXTURE';
 e['map-evidence-file']={files:[],value:''};e['map-evidence-url']={value:'https://example.invalid/evidence.pdf'};e['map-evidence-caption']={value:'Reviewed evidence'};e['map-evidence-add']={disabled:false};e['map-evidence-feedback']={textContent:''};const requests=[];s.api=async(url,options)=>{requests.push({url,body:structuredClone(options.b)});if(requests.length===1)throw Error('Network unavailable');return {id:'evidence-a'};};
 await s.mapEvidenceSave();assert.equal(requests.length,1);assert.equal(e['map-evidence-url'].value,'https://example.invalid/evidence.pdf');assert.equal(s.mapEvidenceDraft(),true);
 await s.mapEvidenceSave();assert.equal(requests.length,2);assert.equal(requests[0].body.p_idempotency_key,requests[1].body.p_idempotency_key);assert.equal(requests[1].body.p_source_module,'actions');assert.equal(requests[1].body.p_source_table,'action_tracker');assert.equal(requests[1].body.p_source_record_id,'action-a');assert.equal(requests[1].body.p_company_id,'company-a');assert.equal(s.mapEvidencePending,null);assert.equal(s.mapEvidenceDraft(),false);assert.match(e['map-evidence-feedback'].textContent,/saved separately/);
});
test('evidence previews reject executable, credential-bearing and foreign storage URLs',async()=>{
 const {scope:s}=runtime();s.URL=URL;let closed=0,opened=0,message='';s.window.open=()=>({close(){closed++},location:{replace(){opened++}}});s.mapEditorMessage=value=>message=value;const session={assertCurrent(){}};s.mapEditorSession=session;const record={id:'action-a',company_id:'company-a'};
 for(const item of [{url:'javascript:alert(1)'},{url:'https://user:secret@example.invalid/private'},{bucket:'evidence',path:'company-b/actions/action-a/evidence.pdf'}])await s.mapEvidencePreview(item,record,session);
 assert.equal(closed,3);assert.equal(opened,0);assert.ok(message);
});

test('readiness shows the requirements of the current workflow stage',()=>{
 const {scope:s,elements:e}=runtime();e['map-readiness']={textContent:''};s.mapEditorForm=()=>({'mf-title':'A task','mf-target-date':'2026-10-25','mf-progress':'100','mf-evidence':'Controlled record','mf-verif-notes':'Reviewed','mf-closure-notes':'Complete'});s.mapClosureRead=checks;
 s.mapReadinessRender({status:'open'});assert.match(e['map-readiness'].textContent,/Start readiness.*Action described.*Target date/);assert.doesNotMatch(e['map-readiness'].textContent,/Verification passed|100%/);
 s.mapReadinessRender({status:'in_progress',requires_verification:true});assert.match(e['map-readiness'].textContent,/Submission readiness.*100%/);assert.doesNotMatch(e['map-readiness'].textContent,/Verification passed/);
 s.mapReadinessRender({status:'pending_verification',requires_verification:true});assert.match(e['map-readiness'].textContent,/Verification readiness.*Verification notes/);assert.doesNotMatch(e['map-readiness'].textContent,/Verification passed/);
 s.mapReadinessRender({status:'pending_closure',requires_verification:true,verification_status:'passed'});assert.match(e['map-readiness'].textContent,/Closure readiness.*Verification passed.*confirmations answered/);
});
