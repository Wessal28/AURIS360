const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(f,'utf8');
function fakeElement(){return {value:'',textContent:'',style:{},options:[],children:[],handlers:{},classList:{toggle(){},add(){},remove(){}},replaceChildren(){this.children=[]},appendChild(x){this.children.push(x)},prepend(x){this.children.unshift(x)},addEventListener(name,fn){this.handlers[name]=fn},setAttribute(){},removeAttribute(){},focus(){},add(option){this.options.push(option)},toggleAttribute(){},querySelectorAll(){return []},querySelector(){return null}};}
function runtime(){let company='co-a',edited=0,back=0,messages=[],requests=[];const elements={};const fields={'.lca-status':{value:'not_assessed'},'.lca-controls':{value:'Saved controls'},'.lca-reco':{value:''},'.lca-resp':{value:''},'.lca-target':{value:''}};const tr={dataset:{id:'req-a'},querySelector:k=>fields[k]};const scope={console,crypto:require('node:crypto'),URL,Option:function(label,value){this.label=label;this.value=value},MutationObserver:function(){this.observe=()=>{}},prof:{id:'user-a',full_name:'Reviewer'},ccid:()=>company,cf:()=> '&company_id=eq.'+company,activeRole:()=> 'admin',canAccessPage:()=>true,workflowCanMutate:()=>true,appPrompt:async()=> 'Reviewed fictional worksheet',toast:m=>messages.push(m),document:{getElementById:id=>elements[id]||(elements[id]=fakeElement()),createElement:fakeElement,querySelectorAll:selector=>selector==='#lca-matrix .lca-row'?[tr]:[]},lrAllData:[{id:'req-a',company_id:'co-a',updated_at:'2026-10-19T00:00Z',status:'not_assessed'}],lcaAllData:[],lcaEditId:null,lrEditId:null,lcAllData:[],lcEditId:null,gapAllData:[],lcaUpdateGapFields(){},lcaBack:()=>back++,legalLoadRegister:async()=>{},legalRefreshMetrics:async()=>{},legalAssessmentScopeLabel:()=> 'Fictional scope',loadLegal:async()=>{},legalNewRequirement(){},legalLoadReqIntoForm(){},lcaNew(){},lcaEdit(){edited++},legalAssessmentRows:()=>scope.lrAllData,legalRenderAssessmentMatrix(){},legalNewChange(){},legalEditChg(){},legxOpenRecordForm(){},legxCloseDrawer(){},gapEdit(){}};scope.window=scope;
 const a={id:'assessment-a',company_id:'co-a',title:'Draft assessment',status:'draft',revision:1,worksheet:[{requirement_id:'req-a',baseline_updated_at:'2026-10-19T00:00Z',status:'not_assessed',controls:'Saved controls'}]};
 scope.api=async(path,options)=>{requests.push({path,options});if(!options)return [structuredClone(a)];return {assessment:{...a,...options.b.p_body,revision:2,worksheet:options.b.p_rows},remediation:[]}};
 vm.runInNewContext(read('auris-legal-assurance.js'),scope);elements['lcaf-title']=Object.assign(fakeElement(),{value:'Draft assessment'});elements['lcaf-status']=Object.assign(fakeElement(),{value:'draft'});
 return {scope,elements,fields,requests,messages,edited:()=>edited,back:()=>back,setCompany:c=>company=c};
}
test('draft save sends one atomic worksheet request, never publishes individual requirements or actions',async()=>{const r=runtime();await r.scope.lcaEdit('assessment-a');r.fields['.lca-status'].value='partial';r.fields['.lca-reco'].value='Provisional finding';await r.scope.lcaSave();const writes=r.requests.filter(x=>x.options);assert.equal(writes.length,1);assert.equal(writes[0].path,'/rpc/save_legal_assessment');assert.equal(writes[0].options.b.p_command,'save');assert.equal(writes[0].options.b.p_rows[0].status,'partial');assert.equal(writes[0].options.b.p_rows[0].baseline_updated_at,'2026-10-19T00:00Z');assert.equal(r.back(),0);assert.match(r.elements['legal-assessment-feedback'].textContent,/live register is unchanged/);});
test('failed draft save retains findings, selected result and editor',async()=>{const r=runtime();await r.scope.lcaEdit('assessment-a');r.fields['.lca-status'].value='partial';r.fields['.lca-reco'].value='Do not lose this finding';r.scope.api=async()=>{throw Error('Network unavailable')};await r.scope.lcaSave();assert.equal(r.fields['.lca-reco'].value,'Do not lose this finding');assert.equal(r.fields['.lca-status'].value,'partial');assert.equal(r.back(),0);assert.match(r.elements['legal-assessment-feedback'].textContent,/entries remain/);assert.equal(r.elements['page-legal'].inert,false);});
test('saved worksheets retain the reviewed wording and reference for later viewing and printing',async()=>{
 const r=runtime();Object.assign(r.scope.lrAllData[0],{req_ref:'LEG-001',title:'Recorded duty',legislation:'Fictional regulation',section:'Section 4',requirement:'Original wording',official_source_url:'https://example.test/source'});
 await r.scope.lcaEdit('assessment-a');await r.scope.lcaSave();
 const first=r.requests.filter(x=>x.options).at(-1).options.b.p_rows[0].requirement_snapshot;
 assert.equal(first.reference,'LEG-001');assert.equal(first.requirement,'Original wording');assert.equal(first.source_reference,'https://example.test/source');assert.equal(first.version_at,'2026-10-19T00:00Z');
 r.scope.lrAllData[0].requirement='Later register wording';r.scope.lrAllData[0].updated_at='2026-10-20T00:00Z';await r.scope.lcaSave();
 assert.equal(r.requests.filter(x=>x.options).at(-1).options.b.p_rows[0].requirement_snapshot.requirement,'Original wording');
});
test('older worksheets cannot silently acquire present-day wording as a historical snapshot',async()=>{
 const r=runtime();Object.assign(r.scope.lrAllData[0],{updated_at:'2026-10-20T00:00Z',requirement:'Current text that was not assessed in the saved version'});
 await r.scope.lcaEdit('assessment-a');await r.scope.lcaSave();
 assert.equal(r.requests.filter(x=>x.options).at(-1).options.b.p_rows[0].requirement_snapshot,undefined);
 const refresh=r.elements['legal-assessment-controls'].children.find(x=>x.textContent==='Refresh and review current requirements');
 r.scope.api=async()=>r.scope.lrAllData;await refresh.handlers.click();
 const row=r.scope.AurisLegalAssurance.worksheet()[0];assert.equal(row.baseline_updated_at,'2026-10-20T00:00Z');assert.equal(row.requirement_snapshot.requirement,'Current text that was not assessed in the saved version');
});
test('a late assessment response cannot open another company record',async()=>{const r=runtime();r.scope.api=async()=>{r.setCompany('co-b');return [{id:'assessment-a',worksheet:[]}];};await r.scope.lcaEdit('assessment-a');assert.equal(r.edited(),0);assert.match(r.messages[0],/company or access changed/);});
test('worksheet preserves Not assessed and identifies internal policies accurately',()=>{const core=read('auris-core.js');const fn=core.slice(core.indexOf('function legalRenderAssessmentMatrix(){'),core.indexOf('function lcaUpdateGapFields('));const box={innerHTML:''};const scope={document:{getElementById:id=>id==='lca-matrix'?box:null,querySelectorAll:()=>[]},legalAssessmentRows:()=>[{id:'r',status:'not_assessed',legislation:'Fictional internal policy',legislation_type:'internal_policy'}],legalAssessmentScopeOptionsHtml:()=>'',legalRequirementTypeLabel:()=> 'Internal policy',displayRecordRef:()=> 'LEG-FIXTURE',escH:s=>String(s||''),lcaUpdateLiveScore(){},lcaUpdateGapFields(){}};vm.runInNewContext(fn+';legalRenderAssessmentMatrix();',scope);assert.match(box.innerHTML,/value="not_assessed" selected/);assert.doesNotMatch(box.innerHTML,/value="compliant" selected/);assert.match(box.innerHTML,/Internal policy/);assert.match(box.innerHTML,/Drafts and submitted worksheets are provisional/);});
test('unanswered assessment and empty approved dashboard cannot report an achieved score',()=>{const c=read('auris-core.js'),code=c.slice(c.indexOf('function lcaCalcScore(){'),c.indexOf('function lcaBack()'));const fields={};for(const id of ['lcaf-compliant','lcaf-partial','lcaf-noncompliant','lcaf-na'])fields[id]={value:'0'};fields['lca-score-number']={textContent:'',style:{}};fields['lca-score-preview']={style:{}};const scope={document:{getElementById:id=>fields[id],querySelectorAll:()=>[{value:'not_assessed'}]}};vm.runInNewContext(code+';lcaCalcScore();',scope);assert.equal(fields['lca-score-number'].textContent,'Awaiting assessment');assert.match(c,/No approved results/);});
test('new requirement source classification never labels an unreviewed source as verified',()=>{const upgrade=read('legal-compliance-upgrade.js');assert.doesNotMatch(upgrade,/>Verified official source</);assert.match(upgrade,/\['legx-source-class','unverified'\]/);assert.match(read('auris-legal-assurance.js'),/Save source and applicability changes before verifying/);assert.match(read('auris-module-registry.js'),/assets:\['legal-compliance-upgrade.js','auris-legal-assurance.js','module-report-preview.js','legal-assessment-viewer.js'\]/);});


test('evidence file upload is scoped and saved before a short-lived signed preview',async()=>{
 const r=runtime(),calls=[],navigations=[];r.scope.SB='https://fixture.invalid';r.scope.KEY='fictional';r.scope.tok='fictional';r.scope.open=()=>({opener:{},location:{replace:url=>navigations.push(url)},close(){}});
 r.scope.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({signedURL:'/object/sign/evidence/fictional.pdf?token=test'})}};
 r.scope.api=async(path,options)=>{r.requests.push({path,options});return {id:options.b.p_id,...options.b.p_body,version_no:1,reference:'EVD-TEST'}};
 r.scope.legxOpenRecordForm('evidence','req-a');r.elements['legx-r-title'].value='Fictional supporting PDF';r.scope.document.getElementById('legal-evidence-file').files=[{name:'fictional.pdf',type:'application/pdf',size:100}];
 await r.scope.AurisLegalAssurance.saveEvidence('evidence','save');
 assert.equal(calls.length,1);assert.match(calls[0].url,/\/storage\/v1\/object\/evidence\/co-a\/legal\//);assert.equal(calls[0].options.headers['x-upsert'],'false');
 const write=r.requests.find(x=>x.options);assert.equal(write.path,'/rpc/save_legal_evidence');assert.equal(write.options.b.p_body.payload.attachments[0].name,'fictional.pdf');assert.match(r.elements['legal-evidence-feedback'].textContent,/saved as submitted/);
 const preview=r.elements['legal-evidence-documents'].children.find(b=>b.textContent==='Preview fictional.pdf');assert.ok(preview);await preview.handlers.click();
 assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].options.body).expiresIn,300);assert.match(navigations[0],/^https:\/\/fixture\.invalid\/storage\/v1\/object\/sign\/evidence\/fictional\.pdf/);
});
test('failed evidence upload preserves the selected file and never saves misleading attachment metadata',async()=>{
 const r=runtime();r.scope.SB='https://fixture.invalid';r.scope.KEY='fictional';r.scope.tok='fictional';r.scope.fetch=async()=>({ok:false});r.scope.legxOpenRecordForm('evidence','req-a');r.elements['legx-r-title'].value='Unsent PDF';const file={name:'retained.pdf',type:'application/pdf',size:100};r.scope.document.getElementById('legal-evidence-file').files=[file];
 await r.scope.AurisLegalAssurance.saveEvidence('evidence','save');assert.equal(r.elements['legal-evidence-file'].files[0],file);assert.equal(r.requests.length,0);assert.match(r.elements['legal-evidence-feedback'].textContent,/upload failed.*entries remain/);assert.equal(r.elements['page-legal'].inert,false);
});

test('editing a requirement reference saves the trimmed label on the original record and reloads it',async()=>{
 const r=runtime(),saved={id:'req-a',company_id:'co-a',req_ref:'LEG-OLD',updated_at:'2026-10-19T00:00Z',legislation:'Fictional policy'};
 r.scope.lrAllData=[saved];
 r.scope.legalLoadReqIntoForm(saved);
 assert.equal(r.elements['lr-req-ref'].value,'LEG-OLD');
 r.elements['lr-req-ref'].value='  HSE-POLICY-07  ';
 r.scope.api=async(path,options)=>{
  r.requests.push({path,options});
  assert.equal(path,'/rpc/save_legal_requirement');
  assert.equal(options.b.p_id,'req-a');
  assert.equal(options.b.p_expected,'2026-10-19T00:00Z');
  assert.equal(options.b.p_body.req_ref,'HSE-POLICY-07');
  assert.deepEqual(Object.keys(options.b.p_body),['company_id','req_ref']);
  assert.equal(options.b.p_profile,null);
  assert.equal(options.b.p_reference_only,true);
  Object.assign(saved,options.b.p_body,{updated_at:'2026-11-10T09:00:00Z'});
  return saved;
 };
 r.scope.legalOpenReq=id=>{assert.equal(id,saved.id);r.scope.legalLoadReqIntoForm(saved);};
 r.scope.legalEditReq=()=>{};
 await r.scope.legalSaveReq();
 assert.equal(r.scope.lrEditId,'req-a');
 assert.equal(r.elements['lr-req-ref'].value,'HSE-POLICY-07');
 assert.equal(r.requests.length,1);
 assert.equal(r.elements['page-legal'].inert,false);
});

test('an older server ignoring a supplied reference retains the form and permits a safe retry after upgrade',async()=>{
 const r=runtime(),saved={id:'req-a',company_id:'co-a',req_ref:'LEG-OLD',updated_at:'2026-10-19T00:00Z'};
 let result,refreshes=0,reopens=0;
 r.scope.legalLoadReqIntoForm(saved);
 r.elements['lr-req-ref'].value='NEW-REFERENCE';
 r.scope.document.getElementById('lr-leg-title').value='Corrected title';
 r.scope.legalLoadRegister=async()=>{refreshes++;};
 r.scope.legalOpenReq=id=>{reopens++;assert.equal(id,saved.id);r.scope.legalLoadReqIntoForm(result);};
 r.scope.legalEditReq=()=>{};
 r.scope.api=async(path,options)=>{
  r.requests.push({path,options});
  const ignored=r.requests.length===1;
  if(ignored){
   assert.equal(options.b.p_body.title,'Corrected title');
   assert.ok(options.b.p_profile);
   assert.ok(Object.hasOwn(options.b.p_profile,'source_classification'));
   assert.equal(Object.hasOwn(options.b,'p_reference_only'),false);
  }else{
   assert.equal(options.b.p_profile,null);
   assert.deepEqual(Object.keys(options.b.p_body),['company_id','req_ref']);
   assert.equal(options.b.p_reference_only,true);
  }
  result={...(result||saved),...options.b.p_body,req_ref:ignored?'LEG-OLD':options.b.p_body.req_ref,updated_at:ignored?'2026-11-10T09:00:00Z':'2026-11-10T09:01:00Z'};
  return result;
 };
 await r.scope.legalSaveReq();
 assert.equal(reopens,0);
 assert.equal(refreshes,0);
 assert.equal(r.scope.lrEditId,'req-a');
 assert.equal(r.elements['lr-req-ref'].value,'NEW-REFERENCE');
 assert.equal(r.elements['lr-leg-title'].value,'Corrected title');
 assert.match(r.elements['legal-source-feedback'].textContent,/details were saved.*database update.*entered reference is retained/);
 assert.equal(r.elements['page-legal'].inert,false);
 await r.scope.legalSaveReq();
 assert.equal(r.requests.length,2);
 assert.equal(r.requests[1].options.b.p_id,'req-a');
 assert.equal(r.requests[1].options.b.p_expected,'2026-11-10T09:00:00Z');
 assert.equal(r.requests[1].options.b.p_body.req_ref,'NEW-REFERENCE');
 assert.equal(reopens,1);
 assert.equal(refreshes,1);
 assert.equal(r.elements['lr-req-ref'].value,'NEW-REFERENCE');
 assert.match(r.elements['legal-source-feedback'].textContent,/Requirement and source profile saved/);
});

test('reverting a title saved by an older server remains a full requirement edit',async()=>{
 const r=runtime(),saved={id:'req-a',company_id:'co-a',req_ref:'LEG-OLD',title:'Original title',updated_at:'2026-10-19T00:00Z'};
 let result=saved;
 r.scope.document.getElementById('lr-leg-title').value=saved.title;
 r.scope.legalLoadReqIntoForm(saved);
 r.elements['lr-req-ref'].value='NEW-REFERENCE';
 r.elements['lr-leg-title'].value='Corrected title';
 r.scope.legalOpenReq=id=>{assert.equal(id,saved.id);r.scope.legalLoadReqIntoForm(result);};
 r.scope.legalEditReq=()=>{};
 r.scope.api=async(path,options)=>{
  r.requests.push({path,options});
  const ignored=r.requests.length===1;
  assert.equal(Object.hasOwn(options.b,'p_reference_only'),false);
  assert.ok(options.b.p_profile);
  assert.equal(options.b.p_body.title,ignored?'Corrected title':'Original title');
  result={...result,...options.b.p_body,req_ref:ignored?'LEG-OLD':options.b.p_body.req_ref,updated_at:ignored?'2026-11-10T09:00:00Z':'2026-11-10T09:01:00Z'};
  return result;
 };
 await r.scope.legalSaveReq();
 assert.equal(result.title,'Corrected title');
 r.elements['lr-leg-title'].value='Original title';
 await r.scope.legalSaveReq();
 assert.equal(r.requests.length,2);
 assert.equal(r.requests[1].options.b.p_id,'req-a');
 assert.equal(r.requests[1].options.b.p_expected,'2026-11-10T09:00:00Z');
 assert.equal(result.title,'Original title');
 assert.equal(result.req_ref,'NEW-REFERENCE');
 assert.match(r.elements['legal-source-feedback'].textContent,/Requirement and source profile saved/);
});

test('blank edited references and failed saves retain entries for correction',async()=>{
 const r=runtime(),saved={id:'req-a',company_id:'co-a',req_ref:'LEG-OLD',updated_at:'2026-10-19T00:00Z'};
 r.scope.legalLoadReqIntoForm(saved);
 r.elements['lr-req-ref'].value='   ';
 await r.scope.legalSaveReq();
 assert.equal(r.requests.length,0);
 assert.match(r.elements['legal-source-feedback'].textContent,/Enter a requirement reference/);
 r.elements['lr-req-ref'].value='EXISTING-REF';
 r.scope.api=async(path,options)=>{r.requests.push({path,options});throw Error('Network unavailable');};
 await r.scope.legalSaveReq();
 assert.equal(r.requests.length,1);
 assert.equal(r.requests[0].options.b.p_id,'req-a');
 assert.equal(r.elements['lr-req-ref'].value,'EXISTING-REF');
 assert.match(r.elements['legal-source-feedback'].textContent,/Network unavailable.*entries remain/);
 assert.equal(r.elements['page-legal'].inert,false);
});

test('a server missing the guarded reference operation cannot receive a general metadata save',async()=>{
 const r=runtime(),saved={id:'req-a',company_id:'co-a',req_ref:'LEG-OLD',updated_at:'2026-10-19T00:00Z'};
 r.scope.legalLoadReqIntoForm(saved);
 r.elements['lr-req-ref'].value='REVISED-REF';
 r.scope.api=async(path,options)=>{
  r.requests.push({path,options});
  throw Error('Could not find the function public.save_legal_requirement(p_body, p_expected, p_id, p_profile, p_reference_only) in the schema cache');
 };
 await r.scope.legalSaveReq();
 assert.equal(r.requests.length,1);
 const args=r.requests[0].options.b;
 assert.equal(args.p_reference_only,true);
 assert.equal(args.p_profile,null);
 assert.deepEqual(Object.keys(args.p_body),['company_id','req_ref']);
 assert.equal(args.p_id,'req-a');
 assert.equal(args.p_expected,saved.updated_at);
 assert.equal(r.elements['lr-req-ref'].value,'REVISED-REF');
 assert.match(r.elements['legal-source-feedback'].textContent,/database update.*attempt was not saved.*entries remain/);
 assert.equal(r.elements['page-legal'].inert,false);
 assert.equal(saved.req_ref,'LEG-OLD');
});

test('new requirements keep automatic references when blank and allow a deliberately supplied reference',async()=>{
 const r=runtime();
 r.scope.api=async(path,options)=>{r.requests.push({path,options});throw Error('Synthetic stop after capture');};
 r.scope.legalNewRequirement();
 assert.equal(r.elements['lr-req-ref'].value,'');
 await r.scope.legalSaveReq();
 const generated=r.requests[0].options.b;
 assert.ok(generated.p_id);
 assert.equal(generated.p_expected,null);
 assert.equal(Object.hasOwn(generated.p_body,'req_ref'),false);
 assert.ok(generated.p_profile);
 assert.equal(Object.hasOwn(generated,'p_reference_only'),false);
 r.elements['lr-req-ref'].value='  COMPANY-REQ-01  ';
 await r.scope.legalSaveReq();
 const supplied=r.requests[1].options.b;
 assert.equal(supplied.p_id,generated.p_id);
 assert.equal(supplied.p_body.req_ref,'COMPANY-REQ-01');
 r.scope.legalLoadReqIntoForm({id:'legacy',reference_no:'HISTORICAL-01'});
 assert.equal(r.elements['lr-req-ref'].value,'HISTORICAL-01');
 r.scope.legalLoadReqIntoForm({id:'legacy-without-ref',req_ref:null,updated_at:'2026-10-19T00:00Z'});
 await r.scope.legalSaveReq();
 const legacy=r.requests.at(-1).options.b;
 assert.equal(legacy.p_id,'legacy-without-ref');
 assert.equal(Object.hasOwn(legacy.p_body,'req_ref'),false);
});
