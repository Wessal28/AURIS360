const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const COMPANY='11111111-1111-4111-8111-111111111111',USER='22222222-2222-4222-8222-222222222222',DOC='33333333-3333-4333-8333-333333333333',REV='44444444-4444-4444-8444-444444444444';
const copy=value=>structuredClone(value);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function fixture(options={}){
 const d={id:DOC,company_id:COMPANY,title:'Fictional equipment procedure',doc_ref:'DOC-2026-001',reference_no:'DOC-2026-001',document_type:'procedure',doc_type:'procedure',category:'Operations',department:'Maintenance',owner:'Fictional controller',description:'Maintenance arrangements',scope:'Company workshop',tags:['maintenance'],legal_refs:['Internal standard'],issue_date:'2026-11-01',review_date:'2027-11-01',language_code:'en',scope_type:'company',scope_id:null,confidentiality:'internal',current_revision_id:REV,status:'draft',approval_status:'draft',lifecycle_state:'draft',file_url:'https://fixture.invalid/unchanged.pdf',file_name:'unchanged.pdf',version:'1.0',updated_at:'2026-11-26T09:00:00Z',...options.document};
 const r={id:REV,company_id:COMPANY,document_id:DOC,status:'draft',revision_code:'1.0',title:d.title,content_hash:'a'.repeat(64),content_json:{uploads:[{id:'existing-file',sha256:'f'.repeat(64)}]},metadata_json:{owner:d.owner,document_type:d.document_type},language_code:'en',scope_type:'company',scope_id:null,updated_at:'2026-11-26T09:00:01Z',...options.revision};
 const nodes={},requests=[],notices=[],drawers=[],effects=[],context={company:COMPANY,user:USER,role:'document_controller'},D={data:{documents:[copy(d)],revisions:[copy(r)],files:[{id:'existing-file',document_id:DOC,revision_id:REV}],records:[{id:'existing-decision',record_type:'approval_decision'}],audit:[]},drawerDirty:false};
 const h={D,esc:escape,company:()=>context.company,uid:()=>context.user,role:()=>context.role,canManage:()=>h.allowed,allowed:true,byId:(rows,id)=>(rows||[]).find(row=>String(row.id)===String(id)),visibleDocument:()=>true,currentRevision:()=>D.data.revisions.find(row=>row.id===D.data.documents[0]?.current_revision_id),authorisedRevision:()=>options.released||null,generatedRendition:()=>options.generated||null,documentTypeOptions:()=>[['procedure','Procedure'],['policy','Policy']],notify:(...args)=>notices.push(args),label:v=>String(v||''),ref:d=>d.doc_ref,title:d=>d.title,type:d=>d.document_type||d.doc_type,version:r=>r.revision_code||r.version,head:(title,subtitle,actions)=>'<h2>'+escape(title)+'</h2><p>'+escape(subtitle)+'</p>'+(actions||''),load:async()=>{effects.push('load');},render:()=>effects.push('render'),openDrawer:(...args)=>{drawers.push(args);if(String(args[1]).includes('id="dcx-edit-progress"'))nodes['dcx-edit-progress']={id:'dcx-edit-progress',textContent:''};},
  field:(label,id,type,choices,value)=>{nodes[id]={id,type,value:value??'',addEventListener(){},setAttribute(){}};return '<label for="'+escape(id)+'">'+escape(label)+'</label><input id="'+escape(id)+'" value="'+escape(value)+'">';},
  btn:(label,command)=>'<button data-command="'+escape(command)+'">'+escape(label)+'</button>'};
 const c={Date,console,crypto:require('node:crypto').webcrypto,document:{getElementById:id=>nodes[id]||null,querySelectorAll:()=>Object.values(nodes)},dcxCloseDrawer:()=>effects.push('close'),dcxCreateRevision:()=>effects.push('revision'),api:async(path,request)=>{
  requests.push({path,request:request?copy(request):null});
  if(!request||!request.m||request.m==='GET'){
   const url=new URL('https://fixture.invalid'+path);assert.equal(url.searchParams.get('company_id'),'eq.'+context.company,'Fresh editor reads must be tenant scoped');let rows;
   if(url.pathname==='/documents'){assert.equal(url.searchParams.get('id'),'eq.'+DOC);rows=[copy(d)];}
   else if(url.pathname==='/document_control_revisions'){assert.equal(url.searchParams.get('document_id'),'eq.'+DOC);assert.equal(url.searchParams.get('id'),'eq.'+REV);rows=[copy(r)];}
   else assert.fail('Unexpected editor read: '+path);
   if(options.afterRead)await options.afterRead(path,rows,f);return rows;
  }
  assert.equal(path,'/rpc/save_document_metadata','Editing may only use the atomic metadata command');assert.equal(request.m,'POST');if(f.fail)throw Error('Synthetic metadata save failure');
  const body=request.b,meta=body.p_meta;const saved={document:{...copy(d),...copy(meta),updated_at:'2026-11-26T10:00:00Z'},revision:{...copy(r),title:meta.title,metadata_json:{...copy(r.metadata_json),...copy(meta)},content_hash:'b'.repeat(64),updated_at:'2026-11-26T10:00:00Z'}};
  if(options.afterWrite)await options.afterWrite(saved,f);return saved;
 }};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('document-record-editor.js','utf8'),c);
 const f={c,h,D,d,r,nodes,requests,notices,drawers,effects,context,fail:false,editor:c.AurisDocumentRecordEditor};
 f.open=()=>f.editor.open(DOC,h);f.save=()=>f.editor.save(h);f.writes=()=>requests.filter(row=>row.request?.m==='POST');f.values=()=>Object.fromEntries(Object.entries(nodes).map(([id,node])=>[id,node.value]));return f;
}

test('opening a draft record loads its exact same-company document and revision before showing editable metadata',async()=>{
 const f=fixture();f.D.data.documents[0].title='Older cached title';f.D.data.revisions[0].content_hash='outdated';await f.open();
 assert.equal(f.requests.length,2);assert.equal(f.nodes['dcx-edit-title'].value,f.d.title);assert.equal(f.nodes['dcx-edit-owner'].value,f.d.owner);
 assert.ok(f.drawers.length);assert.equal(f.writes().length,0);
});

test('language and scope controls preserve the saved revision values when document defaults differ',async()=>{
 const f=fixture({revision:{language_code:'fr',scope_type:'site',scope_id:'Workshop B',metadata_json:{language_code:'en',scope_type:'company',scope_id:'outdated'}}});await f.open();
 assert.equal(f.nodes['dcx-edit-language'].value,'fr');assert.equal(f.nodes['dcx-edit-scope-type'].value,'site');assert.equal(f.nodes['dcx-edit-scope-id'].value,'Workshop B');
});

test('saving metadata keeps stable IDs and binds the atomic command to the fresh revision snapshot',async()=>{
 const f=fixture();await f.open();f.nodes['dcx-edit-title'].value='Updated equipment procedure';f.nodes['dcx-edit-reason'].value='Clarified register title';f.nodes['dcx-edit-tags'].value='maintenance, isolation';
 await f.save();const writes=f.writes();assert.equal(writes.length,1);const body=writes[0].request.b;
 assert.equal(body.p_document,DOC);assert.equal(body.p_revision,REV);assert.deepEqual(body.p_expected,{document_updated_at:f.d.updated_at,revision_updated_at:f.r.updated_at,content_hash:f.r.content_hash});
 assert.equal(body.p_meta.title,'Updated equipment procedure');assert.equal(body.p_reason,'Clarified register title');assert.deepEqual(body.p_meta.tags,['maintenance','isolation']);
 for(const key of ['id','company_id','current_revision_id','status','approval_status','lifecycle_state','file_url','file_name','version','content_json'])assert.ok(!(key in body.p_meta),'Metadata edit must not overwrite '+key);
 assert.equal(f.D.data.documents[0].id,DOC);assert.equal(f.D.data.documents[0].title,'Updated equipment procedure');assert.equal(f.D.data.revisions[0].id,REV);
 assert.equal(f.D.data.documents[0].file_url,f.d.file_url);assert.deepEqual(f.D.data.files,[{id:'existing-file',document_id:DOC,revision_id:REV}]);assert.deepEqual(f.D.data.records,[{id:'existing-decision',record_type:'approval_decision'}]);
 assert.ok(f.effects.includes('close'));
});

test('metadata validation blocks missing titles and reasons before submitting a command',async()=>{
 const f=fixture();await f.open();f.nodes['dcx-edit-title'].value='';f.nodes['dcx-edit-reason'].value='Correction';await f.save();assert.equal(f.writes().length,0);
 f.nodes['dcx-edit-title'].value='Valid title';f.nodes['dcx-edit-reason'].value='';await f.save();assert.equal(f.writes().length,0);assert.ok(!f.effects.includes('close'));
});

test('a failed metadata command retains entered values, cached records and the open editor for retry',async()=>{
 const f=fixture();await f.open();f.nodes['dcx-edit-title'].value='Unsaved edited title';f.nodes['dcx-edit-reason'].value='Correction';f.fail=true;
 const entered=f.values(),before=JSON.stringify(f.D.data);await f.save();assert.equal(f.writes().length,1);assert.deepEqual(f.values(),entered);assert.equal(JSON.stringify(f.D.data),before);assert.ok(!f.effects.includes('close'));assert.equal(f.notices.at(-1)[1],false);
 f.fail=false;await f.save();assert.equal(f.writes().length,2);assert.equal(f.writes()[1].request.b.p_document,DOC);assert.equal(f.writes()[1].request.b.p_revision,REV);assert.ok(f.effects.includes('close'));
});

test('an account, company or role change before saving prevents stale edits from being submitted',async()=>{
 for(const key of ['company','user','role']){const f=fixture();await f.open();f.nodes['dcx-edit-reason'].value='Correction';f.context[key]='changed';await f.save();assert.equal(f.writes().length,0);assert.ok(!f.effects.includes('close'));assert.equal(f.D.data.documents[0].title,f.d.title);}
});

test('lost edit access and another-company source rows cannot open or save an editor',async()=>{
 const denied=fixture();denied.h.allowed=false;await denied.open();assert.equal(denied.requests.length,0);assert.equal(denied.drawers.length,0);
 const foreign=fixture({document:{company_id:'other-company'}});await foreign.open();assert.ok(!foreign.nodes['dcx-edit-title']);assert.equal(foreign.writes().length,0);
 const lost=fixture();await lost.open();lost.nodes['dcx-edit-reason'].value='Correction';lost.h.allowed=false;await lost.save();assert.equal(lost.writes().length,0);
});

test('a company switch while the command is pending cannot update the new context cache, close its form or claim success',async()=>{
 const f=fixture({afterWrite:(_saved,state)=>{state.context.company='new-company';state.D.data.documents=[{id:'new-context',company_id:'new-company',title:'Different company'}];}});await f.open();f.nodes['dcx-edit-reason'].value='Correction';const priorNotices=f.notices.length;await f.save();
 assert.equal(f.writes().length,1);assert.equal(f.D.data.documents[0].id,'new-context');assert.ok(!f.effects.includes('close'));assert.equal(f.notices.length,priorNotices);
});

test('approved and in-review revisions offer a governed route instead of editable metadata controls',async()=>{
 for(const status of ['approved','effective','published','superseded','pending_review','under_review','pending_approval']){
  const f=fixture({revision:{status},document:{status:status==='effective'?'current':'draft',approval_status:status==='approved'?'approved':'draft'}});await f.open();assert.ok(!f.nodes['dcx-edit-title'],status+' must not be edited in place');assert.equal(f.writes().length,0);
  assert.ok(f.drawers.length||f.notices.length,'The locked state needs an explanation');
 }
});

test('a working draft beside a released revision cannot change controlled document details through the initial-draft editor',async()=>{
 const released={id:'previous-released',company_id:COMPANY,document_id:DOC,status:'effective',revision_code:'1.0'},f=fixture({released});await f.open();
 assert.ok(!f.nodes['dcx-edit-title']);assert.equal(f.writes().length,0);assert.ok(f.drawers.length||f.notices.length);
});

test('a generated SWMS rendition keeps source-bound metadata read-only so its file and revision hashes cannot diverge',async()=>{
 const f=fixture({generated:{file:{id:'generated-file',file_role:'generated_rendition'}},document:{document_type:'swms',doc_type:'swms'}});await f.open();
 assert.ok(!f.nodes['dcx-edit-title']);assert.equal(f.writes().length,0);assert.ok(f.drawers.length||f.notices.length);
 assert.doesNotMatch(f.editor.metadata(f.d,f.r,f.h),/dcxEditDocument/);await f.save();assert.equal(f.writes().length,0);
});

test('empty, wrongly scoped or unchanged save confirmations retain the form and never report success',async()=>{
 for(const corrupt of [saved=>{delete saved.document;},saved=>{saved.revision.company_id='different-company';},saved=>{saved.document.current_revision_id='different-revision';},saved=>{saved.document.title='The requested edit was ignored';}]){
  const f=fixture({afterWrite:corrupt});await f.open();f.nodes['dcx-edit-title'].value='Pending edit';f.nodes['dcx-edit-reason'].value='Correction';const before=JSON.stringify(f.D.data);await f.save();
  assert.equal(f.writes().length,1);assert.equal(JSON.stringify(f.D.data),before);assert.equal(f.nodes['dcx-edit-title'].value,'Pending edit');assert.ok(!f.effects.includes('close'));assert.equal(f.notices.at(-1)[1],false);
 }
});

test('concurrent save clicks share the in-flight command and cannot submit duplicate metadata updates',async()=>{
 let resolve,started;const ready=new Promise(done=>{started=done;}),gate=new Promise(done=>{resolve=done;}),f=fixture({afterWrite:async()=>{started();await gate;}});await f.open();f.nodes['dcx-edit-reason'].value='Correction';const first=f.save();await ready;await f.save();assert.equal(f.writes().length,1);resolve();await first;assert.equal(f.writes().length,1);assert.ok(f.effects.includes('close'));
});

test('a forced drawer replacement while saving cannot close the new form or apply a stale display update',async()=>{
 const f=fixture({afterWrite:(_saved,state)=>{state.nodes['dcx-edit-progress']={id:'replacement-progress'};}});await f.open();f.nodes['dcx-edit-reason'].value='Correction';const before=JSON.stringify(f.D.data),notices=f.notices.length;await f.save();
 assert.equal(f.writes().length,1);assert.equal(JSON.stringify(f.D.data),before);assert.ok(!f.effects.includes('close'));assert.equal(f.notices.length,notices);
});

test('the shared drawer refuses to discard a pending metadata save',()=>{
 const source=fs.readFileSync('document-control-workflows.js','utf8'),start=source.indexOf('root.dcxCloseDrawer=function(force){'),end=source.indexOf('function users()',start);assert.ok(start>=0&&end>start);
 const notices=[],effects=[],D={documentEditSaving:true,drawerBaseline:'unchanged'},c={D,busy:false,drawerState:()=> 'unchanged',notify:(...args)=>notices.push(args),stopPreview:()=>effects.push('preview'),document:{getElementById:()=>({classList:{remove:()=>effects.push('close')}})},confirm:()=>{assert.fail('Pending saves must not offer a discard confirmation');}};
 c.root=c;vm.createContext(c);vm.runInContext(source.slice(start,end),c);c.dcxCloseDrawer();assert.deepEqual(effects,[]);assert.equal(notices.at(-1)[1],false);
});

test('the library and document header expose same-record editing alongside preview only for authorised working drafts',()=>{
 const f=fixture(),source=fs.readFileSync('document-control-upgrade.js','utf8');f.D.filters={q:'',type:'',department:'',site:'',status:'all'};f.D.selectedId=DOC;f.D.docTab='metadata';
 function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
 const c={D:f.D,esc:escape,byId:f.h.byId,canManage:f.h.canManage,currentRevision:f.h.currentRevision,authorisedRevision:f.h.authorisedRevision,generatedRendition:f.h.generatedRendition,visibleDocument:f.h.visibleDocument,ref:f.h.ref,title:f.h.title,type:f.h.type,version:f.h.version,label:f.h.label,status:row=>row.status,badge:escape,filteredDocs:()=>f.D.data.documents,previewFile:()=>({id:'file'}),head:f.h.head,btn:f.h.btn,table:(_headers,rows)=>rows.flat().join(''),nav(){},favouriteIds:()=>[],documentTab:()=>'',render(){}};
 vm.createContext(c);vm.runInContext(section('function canEditDocument(','function filteredDocs(')+section('function renderDocument(','function documentTab('),c);
 const main={};assert.match(c.renderRegister(),/dcxEditDocument/);assert.match(c.renderRegister(),/Preview PDF/);c.renderDocument(main);assert.match(main.innerHTML,/dcxEditDocument/);
 f.h.allowed=false;assert.doesNotMatch(c.renderRegister(),/dcxEditDocument/);c.renderDocument(main);assert.doesNotMatch(main.innerHTML,/dcxEditDocument/);
 f.h.allowed=true;f.D.data.revisions[0].status='pending_review';assert.doesNotMatch(c.renderRegister(),/dcxEditDocument/);c.renderDocument(main);assert.doesNotMatch(main.innerHTML,/dcxEditDocument/);
 f.D.data.revisions[0].status='draft';c.generatedRendition=()=>({file:{file_role:'generated_rendition'}});assert.doesNotMatch(c.renderRegister(),/dcxEditDocument/);c.renderDocument(main);assert.doesNotMatch(main.innerHTML,/dcxEditDocument/);
});

test('metadata details escape record values and only expose Edit record for an editable working revision',()=>{
 const f=fixture({document:{title:'<img src=x onerror=alert(1)>',description:'<script>unsafe</script>'}});
 const html=f.editor.metadata(f.d,f.r,f.h);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.match(html,/Edit record/);
 for(const status of ['approved','effective','pending_review']){f.D.data.revisions[0].status=status;assert.doesNotMatch(f.editor.metadata(f.d,f.D.data.revisions[0],f.h),/dcxEditDocument/);}
 f.h.allowed=false;assert.doesNotMatch(f.editor.metadata(f.d,f.r,f.h),/dcxEditDocument/);
});
