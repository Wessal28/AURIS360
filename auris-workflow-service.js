(function(root){
'use strict';

var registry=root.AurisModuleRegistry;
if(!registry)throw new Error('AurisWorkflowService requires AurisModuleRegistry.');
var policies=Object.create(null),listeners=[],approvalProvider=null,persistence=null,companyReadiness=Object.create(null);

function copy(value){return JSON.parse(JSON.stringify(value));}
function key(companyId,moduleKey){return String(companyId||'*')+'::'+String(moduleKey||'');}
function authContext(){
  var services=root.AurisPlatformServices;
  if(!services||!services.auth||!services.auth.isReady())return {};
  var current=services.auth.current()||{};
  return {companyId:(current.company&&current.company.id)||(current.profile&&current.profile.company_id)||null,role:current.role||null};
}
function basePolicy(moduleKey){
  var workflow=registry.workflowOf(moduleKey);
  if(!workflow)return null;
  return {moduleKey:moduleKey,entity:workflow.entity,initial:workflow.initial,terminal:Array.from(workflow.terminal),states:Array.from(workflow.states),transitions:Array.from(workflow.transitions,function(pair){return Array.from(pair);}),approvalTransitions:Array.from(workflow.approvalTransitions||[],function(pair){return Array.from(pair);}),version:'registry',source:'registry'};
}
function validate(moduleKey,input){
  var base=basePolicy(moduleKey);
  if(!base)throw new Error('AURIS workflow is not declared for module: '+moduleKey);
  input=input||{};
  var states=base.states.slice(),known=Object.create(null);
  states.forEach(function(state){known[state]=true;});
  var transitions=(input.transitions||base.transitions).map(function(pair){
    pair=Array.isArray(pair)?pair:[pair.from,pair.to];
    if(!known[pair[0]]||!known[pair[1]])throw new Error('Tenant workflow cannot introduce undeclared state: '+pair.join(' -> '));
    return [pair[0],pair[1]];
  });
  var allowed=Object.create(null);transitions.forEach(function(pair){allowed[pair.join('>')]=true;});
  var approvals=(input.approvalTransitions||[]).map(function(pair){
    pair=Array.isArray(pair)?pair:[pair.from,pair.to];
    if(!allowed[pair.join('>')])throw new Error('Approval transition must also be an allowed workflow transition: '+pair.join(' -> '));
    return [pair[0],pair[1]];
  });
  return {moduleKey:moduleKey,entity:base.entity,initial:input.initial||base.initial,terminal:(input.terminal||base.terminal).slice(),states:states,transitions:transitions,approvalTransitions:approvals,version:String(input.version||'tenant-1'),source:input.source||'tenant'};
}
function configure(companyId,moduleKey,input){
  var policy=validate(moduleKey,input);policies[key(companyId,moduleKey)]=policy;emit('configured',policy,companyId);return copy(policy);
}
function clear(companyId,moduleKey){delete policies[key(companyId,moduleKey)];emit('cleared',basePolicy(moduleKey),companyId);}
function clearCompany(companyId){
  var prefix=String(companyId||'*')+'::';Object.keys(policies).forEach(function(item){if(item.indexOf(prefix)===0)delete policies[item];});
}
function configurePersistence(adapter){
  if(adapter!==null&&(!adapter||typeof adapter.load!=='function'||typeof adapter.saveDraft!=='function'||typeof adapter.publish!=='function'||typeof adapter.rollback!=='function'))throw new Error('AURIS workflow persistence must implement load(), saveDraft(), publish() and rollback().');
  persistence=adapter;companyReadiness=Object.create(null);return api;
}
function readiness(companyId){
  if(!persistence)return {status:'memory',companyId:companyId||null,error:null};
  var state=companyReadiness[String(companyId||'')];return copy(state||{status:'idle',companyId:companyId||null,error:null});
}
function setReadiness(companyId,status,error){
  companyReadiness[String(companyId||'')]={status:status,companyId:companyId||null,error:error?String(error.message||error):null,updatedAt:new Date().toISOString()};
  emit('persistence-'+status,companyReadiness[String(companyId||'')],companyId);
}
function persistenceError(companyId,state){
  var error=new Error(state&&state.status==='loading'?'Workflow configuration is still loading.':'Workflow configuration is unavailable for the selected company.');
  error.code='AURIS_WORKFLOW_UNAVAILABLE';error.details={companyId:companyId||null,state:state||readiness(companyId)};return error;
}
function requireReady(context){
  if(!persistence)return true;context=Object.assign({},authContext(),context||{});if(!context.companyId)throw persistenceError(null,readiness(null));
  var state=readiness(context.companyId);if(state.status!=='ready')throw persistenceError(context.companyId,state);return true;
}
async function hydrate(companyId){
  if(!persistence)return [];
  if(!companyId){setReadiness(null,'error',new Error('A company context is required.'));throw persistenceError(null,readiness(null));}
  setReadiness(companyId,'loading');
  try{
    var rows=await persistence.load(companyId);clearCompany(companyId);
    (rows||[]).forEach(function(row){var moduleKey=row.moduleKey||row.module_key;var input=Object.assign({},row.policy||row.configuration||row,{version:String(row.version||row.policy_version||'tenant'),source:'database'});configure(companyId,moduleKey,input);});
    setReadiness(companyId,'ready');emit('hydrated',{count:(rows||[]).length},companyId);return (rows||[]).map(copy);
  }catch(error){clearCompany(companyId);setReadiness(companyId,'error',error);throw error;}
}
async function saveDraft(companyId,moduleKey,input,options){
  if(!persistence)throw new Error('AURIS workflow persistence is not configured.');
  var policyValue=validate(moduleKey,input);return persistence.saveDraft(companyId,moduleKey,copy(policyValue),options||{});
}
async function publish(companyId,moduleKey,policyId,options){
  if(!persistence)throw new Error('AURIS workflow persistence is not configured.');
  var row=await persistence.publish(companyId,moduleKey,policyId,options||{});var input=Object.assign({},row.policy||row.configuration||row,{version:String(row.version||row.policy_version||'tenant'),source:'database'});var active=configure(companyId,moduleKey,input);setReadiness(companyId,'ready');emit('published',row,companyId);return {row:copy(row),policy:active};
}
async function rollback(companyId,moduleKey,policyId,options){
  if(!persistence)throw new Error('AURIS workflow persistence is not configured.');
  var row=await persistence.rollback(companyId,moduleKey,policyId,options||{});var input=Object.assign({},row.policy||row.configuration||row,{version:String(row.version||row.policy_version||'tenant'),source:'database'});var active=configure(companyId,moduleKey,input);setReadiness(companyId,'ready');emit('rolled-back',row,companyId);return {row:copy(row),policy:active};
}
function policy(moduleKey,context){
  context=Object.assign({},authContext(),context||{});
  var configured=policies[key(context.companyId,moduleKey)]||policies[key('*',moduleKey)];
  return copy(configured||basePolicy(moduleKey));
}
function transitionKey(from,to){return String(from||'').toLowerCase()+'>'+String(to||'').toLowerCase();}
function canTransition(moduleKey,from,to,context){
  from=String(from||'').toLowerCase();to=String(to||'').toLowerCase();
  if(!from||from===to)return true;
  var current=policy(moduleKey,context);if(!current)return true;
  return current.transitions.some(function(pair){return pair[0]===from&&pair[1]===to;});
}
function requiresApproval(moduleKey,from,to,context){
  var current=policy(moduleKey,context);if(!current)return false;
  var wanted=transitionKey(from,to);
  return current.approvalTransitions.some(function(pair){return transitionKey(pair[0],pair[1])===wanted;});
}
function explain(moduleKey,from,to,context){
  if(persistence){var merged=Object.assign({},authContext(),context||{}),state=readiness(merged.companyId);if(state.status!=='ready')return {allowed:false,reason:'persistence_unavailable',policy:null,readiness:state};}
  var current=policy(moduleKey,context);
  if(!current)return {allowed:true,reason:'unmanaged',policy:null};
  if(!canTransition(moduleKey,from,to,context))return {allowed:false,reason:'transition_not_allowed',policy:current};
  if(requiresApproval(moduleKey,from,to,context))return {allowed:false,reason:'approval_required',policy:current};
  return {allowed:true,reason:'allowed',policy:current};
}
function requireTransition(moduleKey,from,to,context){
  var result=explain(moduleKey,from,to,context);
  if(result.allowed)return result;
  if(result.reason==='persistence_unavailable')throw persistenceError((context||{}).companyId||authContext().companyId||null,result.readiness);
  var error=new Error(result.reason==='approval_required'?'Approval is required before this workflow transition.':'Workflow transition is not allowed by the active company policy.');
  error.code=result.reason==='approval_required'?'AURIS_APPROVAL_REQUIRED':'AURIS_WORKFLOW_BLOCKED';error.details={moduleKey:moduleKey,from:from,to:to,companyId:(context||{}).companyId||authContext().companyId||null};throw error;
}
function registerApprovalProvider(provider){
  if(provider!==null&&(!provider||typeof provider.request!=='function'))throw new Error('AURIS approval provider must implement request().');
  approvalProvider=provider;return api;
}
async function transition(moduleKey,record,to,options){
  options=options||{};record=record||{};
  var context=Object.assign({},authContext(),options.context||{}),from=String(record[options.statusField||'status']||options.from||'').toLowerCase();
  requireReady(context);
  var services=root.AurisPlatformServices;
  if(services&&services.rbac&&services.rbac.isReady())services.rbac.requireAccess(moduleKey);
  if(requiresApproval(moduleKey,from,to,context)&&!options.approval){
    if(!approvalProvider)requireTransition(moduleKey,from,to,context);
    var request=await approvalProvider.request({moduleKey:moduleKey,record:record,from:from,to:to,context:context,reason:options.reason||''});
    return {status:'approval_required',request:request,from:from,to:to};
  }
  if(!canTransition(moduleKey,from,to,context))requireTransition(moduleKey,from,to,context);
  var result=typeof options.persist==='function'?await options.persist(to,context):Object.assign({},record,(function(){var next={};next[options.statusField||'status']=to;return next;})());
  if(services&&services.audit&&services.audit.isReady())await services.audit.log('workflow_transition',moduleKey,'Workflow moved from '+from+' to '+to,{record_id:record.id||null,from:from,to:to,policy:policy(moduleKey,context).version,approval_id:options.approval&&options.approval.id||null},{companyId:context.companyId});
  emit('transitioned',{moduleKey:moduleKey,from:from,to:to,record:record,result:result},context.companyId);return {status:'transitioned',result:result,from:from,to:to};
}
function subscribe(listener){if(typeof listener!=='function')throw new Error('AURIS workflow subscriber must be a function.');listeners.push(listener);return function(){listeners=listeners.filter(function(item){return item!==listener;});};}
function emit(type,detail,companyId){
  var event={type:type,companyId:companyId||null,detail:copy(detail||{})};listeners.slice().forEach(function(listener){try{listener(event);}catch(_){}});
  if(root.document&&typeof root.CustomEvent==='function')root.document.dispatchEvent(new root.CustomEvent('auris:workflow-'+type,{detail:event}));
}

var api={version:'2.0.0',configure:configure,clear:clear,clearCompany:clearCompany,configurePersistence:configurePersistence,hydrate:hydrate,readiness:readiness,saveDraft:saveDraft,publish:publish,rollback:rollback,policy:policy,canTransition:canTransition,requiresApproval:requiresApproval,explain:explain,requireTransition:requireTransition,registerApprovalProvider:registerApprovalProvider,transition:transition,subscribe:subscribe};
root.AurisWorkflowService=Object.freeze(api);
})(typeof window!=='undefined'?window:globalThis);
