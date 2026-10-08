const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const core=fs.readFileSync(path.join(__dirname,'..','auris-core.js'),'utf8');
function extract(start,end){const from=core.indexOf(start),to=core.indexOf(end,from+start.length);assert.ok(from>=0&&to>from);return core.slice(from,to);}

test('safety alert detail shows business fields without raw audit timestamps',()=>{
  let shown;const context={ccid:()=> 'company-a',ALERT_TYPE_CFG:{other:{label:'Other'}},ALERT_SEV_CFG:{medium:{label:'Medium'}},aurisReadOnlyRecordModal:(kind,title,row,fields)=>{shown={kind,title,row,fields};}};
  vm.createContext(context);vm.runInContext(extract('function alertViewReadOnly(record){','\nasync function alertUploadAttachment'),context);
  context.alertViewReadOnly({id:'alert-a',company_id:'company-a',title:'Safety notice',alert_ref:'ALERT-001',alert_type:'other',severity:'medium',summary:'Check the equipment',departments:['Stores'],created_at:'2026-10-01',updated_at:'2026-10-02'});
  assert.equal(shown.kind,'Safety alert');
  assert.equal(shown.row.reference_no,'ALERT-001');
  assert.ok(shown.fields.some(([label,value])=>label==='Summary'&&value==='Check the equipment'));
  assert.ok(!shown.fields.some(([label])=>/created at|updated at/i.test(label)));
});

test('an uploaded alert image appears in the read-only window with a working preview action',()=>{
  let section,previewed,removed=false;const dialog={lastElementChild:{},insertBefore(node){section=node;}};
  const element=tag=>({tag,children:[],appendChild(child){this.children.push(child);},addEventListener(event,callback){this[event]=callback;}});
  const context={ccid:()=> 'company-a',ALERT_TYPE_CFG:{other:{label:'Other'}},ALERT_SEV_CFG:{medium:{label:'Medium'}},aurisReadOnlyRecordModal:()=>{},aurisSafeMediaUrl:url=>url,dcOpenViewer:doc=>{previewed=doc;},dcMimeFromName:()=> 'image/png',document:{querySelector:()=>dialog,createElement:element,getElementById:()=>({remove(){removed=true;}})}};
  vm.createContext(context);vm.runInContext(extract('function alertViewReadOnly(record){','\nasync function alertUploadAttachment'),context);
  context.alertViewReadOnly({id:'alert-a',company_id:'company-a',alert_type:'other',severity:'medium',file_url:'https://example.supabase.co/alert.png',file_name:'alert.png',file_mime:'image/png'});
  assert.equal(section.children.find(node=>node.tag==='img').src,'https://example.supabase.co/alert.png');
  section.children.find(node=>node.tag==='button').click();
  assert.equal(removed,true);
  assert.equal(previewed.file_name,'alert.png');
});

test('alert attachment uploads under the company path with bounded file types and size',async()=>{
  let request;const context={SB:'https://example.supabase.co',DC_BUCKET:'documents',tok:'test-token',KEY:'test-key',crypto:{randomUUID:()=> 'unique-id'},dcSanitiseName:name=>name.replace(/[^A-Za-z0-9._-]/g,'_'),dcMimeFromName:()=> 'application/pdf',fetch:async(url,options)=>{request={url,options};return {ok:true};}};
  vm.createContext(context);vm.runInContext(extract('async function alertUploadAttachment(file,companyId){','\nasync function alertLoad'),context);
  const result=await context.alertUploadAttachment({name:'Site alert.pdf',type:'application/pdf',size:128},'company-a');
  assert.match(request.url,/\/documents\/company-a\/safety-alerts\/.*Site_alert\.pdf$/);
  assert.equal(result.file_name,'Site alert.pdf');
  assert.equal(result.file_mime,'application/pdf');
  assert.match(result.file_url,/\/storage\/v1\/object\/public\/documents\/company-a\/safety-alerts\//);
  await assert.rejects(context.alertUploadAttachment({name:'bad.exe',type:'application/x-msdownload',size:50},'company-a'),/Choose a PDF/);
  await assert.rejects(context.alertUploadAttachment({name:'big.pdf',type:'application/pdf',size:16*1024*1024},'company-a'),/15 MB/);
});

test('saving an alert persists the uploaded file reference with its company record',async()=>{
  const calls=[],nodes={'alertf-title':{value:'Alert'},'alertf-summary':{value:'Important safety notice'},'alertf-file':{files:[{name:'notice.pdf',size:128,type:'application/pdf'}]},'alertf-req-ack':{checked:false}};
  const context={document:{getElementById:id=>nodes[id]||null},ccid:()=> 'company-a',prof:{id:'person-a'},alertEditId:null,alertUploadAttachment:async()=>({file_url:'https://example.supabase.co/storage/v1/object/public/documents/company-a/safety-alerts/notice.pdf',file_path:'company-a/safety-alerts/notice.pdf',file_name:'notice.pdf',file_mime:'application/pdf'}),api:async(url,options)=>{calls.push({url,options});return url==='/safety_alerts'?[{id:'alert-a'}]:[];},nextCompanyRef:async()=> 'ALERT-2026-001',toast:()=>{},toastActionError:()=>{throw Error('Unexpected save error');},alertBack:()=>{calls.push({url:'back'});},Date,fetch:async()=>({ok:true}),SB:'https://example.supabase.co',DC_BUCKET:'documents',tok:'token',KEY:'key'};
  vm.createContext(context);vm.runInContext(extract('async function alertSave(){','\nasync function alertDelete'),context);
  await context.alertSave();
  assert.equal(calls[0].url,'/safety_alerts');
  assert.equal(calls[0].options.b.company_id,'company-a');
  assert.equal(calls[0].options.b.file_name,'notice.pdf');
  assert.equal(calls[0].options.b.file_path,'company-a/safety-alerts/notice.pdf');
  assert.equal(calls.at(-1).url,'back');
});
