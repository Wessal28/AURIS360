(function(root){
'use strict';

var workflow=root.AurisWorkflowService;
if(!workflow)throw new Error('AurisApprovalCentre requires AurisWorkflowService.');
var adapters=Object.create(null),requests=Object.create(null),persistence=null,sequence=0;
var decisions=['approved','rejected','changes_requested','cancelled'];

function clone(value){return JSON.parse(JSON.stringify(value));}
function context(input){
  input=input||{};var services=root.AurisPlatformServices,current={};
  if(services&&services.auth&&services.auth.isReady())current=services.auth.current()||{};
  return {companyId:input.companyId||(current.company&&current.company.id)||(current.profile&&current.profile.company_id)||null,userId:input.userId||(current.profile&&current.profile.id)||null,role:input.role||current.role||null};
}
function registerAdapter(adapter){
  if(!adapter||!adapter.key||!adapter.table||!adapter.page)throw new Error('Approval adapter requires key, table and page.');
  adapters[adapter.key]=Object.freeze(Object.assign({},adapter));return adapters[adapter.key];
}
function registerAdapters(items){return (items||[]).map(registerAdapter);}
function adapter(key){return adapters[key]||null;}
function configurePersistence(value){
  if(value!==null&&(!value||typeof value.create!=='function'||typeof value.decide!=='function'))throw new Error('Approval persistence must implement create() and decide().');
  persistence=value;return api;
}
function exactSource(input){
  var selected=adapter(input.adapterKey||input.adapter_key||input.moduleKey||input.source);
  var record=input.record||input;
  return {adapterKey:selected&&selected.key||input.adapterKey||input.adapter_key||input.moduleKey||'',moduleKey:input.moduleKey||selected&&selected.page||input.page||'',page:input.page||selected&&selected.page||input.moduleKey||'',table:input.table||selected&&selected.table||'',recordId:input.recordId||input.record_id||record.id||record.record_id||'',ref:input.ref||record.ref||record.reference||'',companyId:input.companyId||record.company_id||null};
}
function assertTenant(source,inputContext){
  var current=context(inputContext);
  if(source.companyId&&current.companyId&&source.companyId!==current.companyId){var error=new Error('Approval source belongs to another company.');error.code='AURIS_APPROVAL_TENANT_MISMATCH';throw error;}
  return current;
}
function identifier(){sequence+=1;return 'approval-'+Date.now().toString(36)+'-'+sequence.toString(36);}
async function audit(action,request,details){
  var services=root.AurisPlatformServices;if(!services||!services.audit||!services.audit.isReady())return;
  return services.audit.log(action,'approvals',(request.ref||request.id)+' '+action,Object.assign({approval_id:request.id,source:request.source,company_id:request.companyId},details||{}),{companyId:request.companyId});
}
async function request(input){
  input=input||{};var source=exactSource(input),current=assertTenant(source,input.context);
  if(!source.recordId)throw new Error('Approval request requires an exact source record id.');
  var created={id:identifier(),status:'pending',moduleKey:input.moduleKey||source.moduleKey,from:input.from||'',to:input.to||'',reason:input.reason||'',source:source,companyId:source.companyId||current.companyId||null,requestedBy:current.userId||null,requestedAt:new Date().toISOString()};
  var stored=persistence?await persistence.create(clone(created)):created;requests[stored.id]=clone(stored);await audit('approval_requested',stored);emit('requested',stored);return clone(stored);
}
function ingest(rows){
  return (rows||[]).map(function(row){var source=exactSource(row);var item=Object.assign({},row,{sourceRecord:source});if(row.id||row.row_key)requests[row.id||row.row_key]=clone(item);return item;});
}
function assertSource(input,inputContext){var source=exactSource(input);assertTenant(source,inputContext);if(!source.recordId)throw new Error('Approval queue item has no exact source record.');return source;}
async function decide(id,decision,options){
  options=options||{};decision=String(decision||'').toLowerCase();if(decisions.indexOf(decision)===-1)throw new Error('Unsupported approval decision: '+decision);
  var current=requests[id]||options.request;if(!current)throw new Error('Approval request was not found: '+id);assertTenant(current.source||exactSource(current),options.context);
  var decided=Object.assign({},current,{status:decision,decisionReason:options.reason||'',decidedAt:new Date().toISOString(),decidedBy:context(options.context).userId||null});
  if(persistence)decided=await persistence.decide(clone(decided));requests[id]=clone(decided);await audit('approval_'+decision,decided,{reason:decided.decisionReason});
  if(decision==='approved'&&options.transition!==false&&decided.moduleKey&&decided.to){
    await workflow.transition(decided.moduleKey,options.record||{id:decided.source.recordId,status:decided.from},decided.to,{context:options.context,approval:{id:decided.id,status:'approved'},statusField:options.statusField,persist:options.persist});
  }
  emit('decided',decided);return clone(decided);
}
function openSource(input,opener,options){
  var source=assertSource(input,options&&options.context);if(typeof opener!=='function')return source;return opener(source,input);
}
function emit(type,detail){if(root.document&&typeof root.CustomEvent==='function')root.document.dispatchEvent(new root.CustomEvent('auris:approval-'+type,{detail:clone(detail)}));}
function list(filter){var values=Object.keys(requests).map(function(id){return clone(requests[id]);});if(!filter)return values;return values.filter(filter);}

var api={version:'1.0.0',registerAdapter:registerAdapter,registerAdapters:registerAdapters,adapter:adapter,configurePersistence:configurePersistence,request:request,ingest:ingest,assertSource:assertSource,decide:decide,openSource:openSource,list:list};
workflow.registerApprovalProvider(api);
root.AurisApprovalCentre=Object.freeze(api);
})(typeof window!=='undefined'?window:globalThis);
