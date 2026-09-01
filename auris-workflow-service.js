(function(root){
'use strict';

var registry=root.AurisModuleRegistry;
if(!registry)throw new Error('AurisWorkflowService requires AurisModuleRegistry.');
var policies=Object.create(null),listeners=[],approvalProvider=null,persistence=null,companyReadiness=Object.create(null);
var allowedRoles=['employee','supervisor','site_manager','hse_officer','hse_manager','admin','sephs_admin'];

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
  var transitions=Array.from(workflow.transitions,function(pair){return Array.from(pair);}),incoming=Object.create(null);transitions.forEach(function(pair){incoming[pair[1]]=true;});
  var entryStates=Array.from(workflow.states).filter(function(state){return state===workflow.initial||!incoming[state];});
  return {moduleKey:moduleKey,entity:workflow.entity,initial:workflow.initial,entryStates:entryStates,terminal:Array.from(workflow.terminal),states:Array.from(workflow.states),transitions:transitions,approvalTransitions:Array.from(workflow.approvalTransitions||[],function(pair){return Array.from(pair);}),rules:[],title:workflow.entity+' workflow',description:'',studioVersion:1,version:'registry',source:'registry'};
}
function unsafeConfiguration(value,path){
  path=path||'policy';
  if(value&&typeof value==='object'){
    for(var name in value){
      if(!Object.prototype.hasOwnProperty.call(value,name))continue;
      if(/^(script|javascript|expression|eval|code)$/i.test(name))return path+'.'+name;
      var nested=unsafeConfiguration(value[name],path+'.'+name);if(nested)return nested;
    }
  }else if(typeof value==='string'&&/javascript\s*:|<\s*script|\beval\s*\(/i.test(value))return path;
  return null;
}
function normaliseRule(rule,allowed){
  rule=rule||{};var pair=Array.isArray(rule)?rule:[rule.from,rule.to],from=String(pair[0]||'').toLowerCase(),to=String(pair[1]||'').toLowerCase(),keyValue=from+'>'+to;
  if(!allowed[keyValue])throw new Error('Workflow rule must reference an allowed transition: '+from+' -> '+to);
  var roles=(rule.roles||[]).map(String).filter(function(role,index,list){return allowedRoles.indexOf(role)>=0&&list.indexOf(role)===index;});
  if((rule.roles||[]).length!==roles.length)throw new Error('Workflow rule contains an unsupported role: '+from+' -> '+to);
  var requiredFields=(rule.requiredFields||[]).map(String).map(function(field){return field.trim();}).filter(Boolean);
  if(requiredFields.some(function(field){return !/^[a-z][a-z0-9_.]{0,63}$/i.test(field);}))throw new Error('Workflow required fields must use safe field names: '+from+' -> '+to);
  var stages=(rule.approvalStages||[]).map(function(stage,index){stage=stage||{};var role=String(stage.role||'');if(allowedRoles.indexOf(role)<0)throw new Error('Approval stage '+(index+1)+' requires a supported role.');return {order:index+1,role:role,label:String(stage.label||('Stage '+(index+1))).slice(0,80),required:stage.required!==false};});
  if(stages.length>5)throw new Error('A workflow transition may contain at most five approval stages.');
  var slaHours=rule.slaHours==null||rule.slaHours===''?null:Number(rule.slaHours);if(slaHours!==null&&(!Number.isFinite(slaHours)||slaHours<1||slaHours>8760))throw new Error('Workflow SLA must be between 1 and 8760 hours.');
  var escalationRoles=(rule.escalationRoles||[]).map(String).filter(function(role,index,list){return allowedRoles.indexOf(role)>=0&&list.indexOf(role)===index;});
  if((rule.escalationRoles||[]).length!==escalationRoles.length)throw new Error('Workflow escalation contains an unsupported role.');
  return {from:from,to:to,label:String(rule.label||'').slice(0,100),roles:roles,requiredFields:requiredFields,approvalStages:stages,slaHours:slaHours,escalationRoles:escalationRoles};
}
function validate(moduleKey,input){
  var base=basePolicy(moduleKey);
  if(!base)throw new Error('AURIS workflow is not declared for module: '+moduleKey);
  input=input||{};
  var unsafe=unsafeConfiguration(input);if(unsafe)throw new Error('Unsafe executable workflow configuration is not permitted: '+unsafe);
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
  var rules=(input.rules||input.transitionRules||[]).map(function(rule){return normaliseRule(rule,allowed);});
  rules.forEach(function(rule){if(rule.approvalStages.length&&!approvals.some(function(pair){return pair[0]===rule.from&&pair[1]===rule.to;}))approvals.push([rule.from,rule.to]);});
  var entryStates=(input.entryStates||base.entryStates).map(String);if(entryStates.some(function(state){return !known[state];}))throw new Error('Workflow entry states must be declared states.');
  return {moduleKey:moduleKey,entity:base.entity,initial:input.initial||base.initial,entryStates:entryStates,terminal:(input.terminal||base.terminal).slice(),states:states,transitions:transitions,approvalTransitions:approvals,rules:rules,title:String(input.title||base.title).slice(0,120),description:String(input.description||'').slice(0,500),studioVersion:Number(input.studioVersion||1),version:String(input.version||'tenant-1'),source:input.source||'tenant'};
}
function review(moduleKey,input){
  var errors=[],warnings=[],policyValue=null;
  try{policyValue=validate(moduleKey,input);}catch(error){errors.push(String(error.message||error));return {valid:false,errors:errors,warnings:warnings,policy:null};}
  var reachable=Object.create(null);(policyValue.entryStates||[policyValue.initial]).forEach(function(state){reachable[state]=true;});var changed=true;
  while(changed){changed=false;policyValue.transitions.forEach(function(pair){if(reachable[pair[0]]&&!reachable[pair[1]]){reachable[pair[1]]=true;changed=true;}});}
  var used=Object.create(null);policyValue.transitions.forEach(function(pair){used[pair[0]]=used[pair[1]]=true;});used[policyValue.initial]=true;policyValue.terminal.forEach(function(state){used[state]=true;});
  Object.keys(used).filter(function(state){return !reachable[state];}).forEach(function(state){errors.push('State "'+state+'" is unreachable from '+policyValue.initial+'.');});
  policyValue.terminal.forEach(function(state){if(policyValue.transitions.some(function(pair){return pair[0]===state&&policyValue.terminal.indexOf(pair[1])<0;}))errors.push('Terminal state "'+state+'" cannot return to an active state.');});
  policyValue.transitions.forEach(function(pair,index,list){if(list.findIndex(function(item){return item[0]===pair[0]&&item[1]===pair[1];})!==index)errors.push('Duplicate transition: '+pair[0]+' -> '+pair[1]+'.');if(pair[0]===pair[1])errors.push('Self transitions are not permitted: '+pair[0]+'.');});
  policyValue.rules.forEach(function(rule){if(rule.slaHours&&!rule.escalationRoles.length)warnings.push(rule.from+' -> '+rule.to+' has an SLA without escalation recipients.');});
  return {valid:errors.length===0,errors:errors,warnings:warnings,policy:copy(policyValue)};
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
async function versions(companyId,moduleKey){
  if(!persistence||typeof persistence.history!=='function')return [];
  return (await persistence.history(companyId,moduleKey)).map(copy);
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
  if(typeof persistence.history==='function'){var candidates=await persistence.history(companyId,moduleKey),candidate=(candidates||[]).find(function(item){return item.id===policyId;});if(!candidate)throw new Error('Workflow draft is unavailable for publication.');var checked=review(moduleKey,candidate.policy||candidate.configuration||candidate);if(!checked.valid){var invalid=new Error('Workflow policy cannot be published: '+checked.errors.join(' '));invalid.code='AURIS_WORKFLOW_INVALID_POLICY';throw invalid;}}
  var row=await persistence.publish(companyId,moduleKey,policyId,options||{});var input=Object.assign({},row.policy||row.configuration||row,{version:String(row.version||row.policy_version||'tenant'),source:'database'});var active=configure(companyId,moduleKey,input);setReadiness(companyId,'ready');emit('published',row,companyId);return {row:copy(row),policy:active};
}
async function rollback(companyId,moduleKey,policyId,options){
  if(!persistence)throw new Error('AURIS workflow persistence is not configured.');
  if(typeof persistence.history==='function'){var candidates=await persistence.history(companyId,moduleKey),candidate=(candidates||[]).find(function(item){return item.id===policyId;});if(!candidate)throw new Error('Workflow version is unavailable for rollback.');var checked=review(moduleKey,candidate.policy||candidate.configuration||candidate);if(!checked.valid){var invalid=new Error('Workflow policy cannot be restored: '+checked.errors.join(' '));invalid.code='AURIS_WORKFLOW_INVALID_POLICY';throw invalid;}}
  var row=await persistence.rollback(companyId,moduleKey,policyId,options||{});var input=Object.assign({},row.policy||row.configuration||row,{version:String(row.version||row.policy_version||'tenant'),source:'database'});var active=configure(companyId,moduleKey,input);setReadiness(companyId,'ready');emit('rolled-back',row,companyId);return {row:copy(row),policy:active};
}
function policy(moduleKey,context){
  context=Object.assign({},authContext(),context||{});
  var configured=policies[key(context.companyId,moduleKey)]||policies[key('*',moduleKey)];
  return copy(configured||basePolicy(moduleKey));
}
function transitionKey(from,to){return String(from||'').toLowerCase()+'>'+String(to||'').toLowerCase();}
function ruleFor(current,from,to){var wanted=transitionKey(from,to);return (current.rules||[]).find(function(rule){return transitionKey(rule.from,rule.to)===wanted;})||null;}
function fieldValue(record,path){return String(path||'').split('.').reduce(function(value,name){return value==null?undefined:value[name];},record||{});}
function evaluate(current,from,to,context){
  context=context||{};var wanted=transitionKey(from,to),allowed=current.transitions.some(function(pair){return transitionKey(pair[0],pair[1])===wanted;});
  if(!allowed)return {allowed:false,reason:'transition_not_allowed',policy:current};
  var rule=ruleFor(current,from,to),role=String(context.role||authContext().role||''),record=context.record||context.fields||{};
  if(rule&&rule.roles.length&&rule.roles.indexOf(role)<0)return {allowed:false,reason:'role_not_allowed',policy:current,rule:copy(rule),role:role};
  var missing=rule?rule.requiredFields.filter(function(field){var value=fieldValue(record,field);return value===undefined||value===null||value==='';}):[];
  if(missing.length)return {allowed:false,reason:'required_fields_missing',policy:current,rule:copy(rule),missingFields:missing};
  if((rule&&rule.approvalStages.length)||current.approvalTransitions.some(function(pair){return transitionKey(pair[0],pair[1])===wanted;}))return {allowed:false,reason:'approval_required',policy:current,rule:rule?copy(rule):null,approvalStages:rule?copy(rule.approvalStages):[]};
  return {allowed:true,reason:'allowed',policy:current,rule:rule?copy(rule):null};
}
function canTransition(moduleKey,from,to,context){
  from=String(from||'').toLowerCase();to=String(to||'').toLowerCase();
  if(!from||from===to)return true;
  var current=policy(moduleKey,context);if(!current)return true;
  var result=evaluate(current,from,to,context);return result.allowed||result.reason==='approval_required';
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
  return evaluate(current,from,to,context);
}
function simulate(moduleKey,input,scenario){var checked=review(moduleKey,input);if(!checked.valid)return {allowed:false,reason:'invalid_policy',review:checked};return evaluate(checked.policy,scenario&&scenario.from,scenario&&scenario.to,scenario||{});}
function impact(moduleKey,currentInput,nextInput,records){
  var current=validate(moduleKey,currentInput||{}),next=validate(moduleKey,nextInput||{}),nextKeys=Object.create(null);next.transitions.forEach(function(pair){nextKeys[transitionKey(pair[0],pair[1])]=true;});
  var removed=current.transitions.filter(function(pair){return !nextKeys[transitionKey(pair[0],pair[1])];}),counts=Object.create(null);(records||[]).forEach(function(record){var state=String(record.status||record.approval_status||'unknown').toLowerCase();counts[state]=(counts[state]||0)+1;});
  var affected=removed.reduce(function(total,pair){return total+(counts[pair[0]]||0);},0);return {removedTransitions:removed,stateCounts:counts,recordsReviewed:(records||[]).length,potentiallyAffected:affected};
}
function requireTransition(moduleKey,from,to,context){
  var result=explain(moduleKey,from,to,context);
  if(result.allowed)return result;
  if(result.reason==='persistence_unavailable')throw persistenceError((context||{}).companyId||authContext().companyId||null,result.readiness);
  var messages={approval_required:'Approval is required before this workflow transition.',role_not_allowed:'Your role is not permitted to perform this workflow transition.',required_fields_missing:'Required fields must be completed before this workflow transition.',transition_not_allowed:'Workflow transition is not allowed by the active company policy.'};
  var codes={approval_required:'AURIS_APPROVAL_REQUIRED',role_not_allowed:'AURIS_WORKFLOW_ROLE_DENIED',required_fields_missing:'AURIS_WORKFLOW_REQUIRED_FIELDS',transition_not_allowed:'AURIS_WORKFLOW_BLOCKED'};
  var error=new Error(messages[result.reason]||messages.transition_not_allowed);error.code=codes[result.reason]||codes.transition_not_allowed;error.details=Object.assign({moduleKey:moduleKey,from:from,to:to,companyId:(context||{}).companyId||authContext().companyId||null},result);throw error;
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
  var decision=explain(moduleKey,from,to,Object.assign({},context,{record:record}));
  if(decision.reason==='approval_required'&&!options.approval){
    if(!approvalProvider)requireTransition(moduleKey,from,to,context);
    var request=await approvalProvider.request({moduleKey:moduleKey,record:record,from:from,to:to,context:context,reason:options.reason||''});
    return {status:'approval_required',request:request,from:from,to:to};
  }
  if(!decision.allowed&&!(decision.reason==='approval_required'&&options.approval))requireTransition(moduleKey,from,to,Object.assign({},context,{record:record}));
  var result=typeof options.persist==='function'?await options.persist(to,context):Object.assign({},record,(function(){var next={};next[options.statusField||'status']=to;return next;})());
  if(services&&services.audit&&services.audit.isReady())await services.audit.log('workflow_transition',moduleKey,'Workflow moved from '+from+' to '+to,{record_id:record.id||null,from:from,to:to,policy:policy(moduleKey,context).version,approval_id:options.approval&&options.approval.id||null},{companyId:context.companyId});
  emit('transitioned',{moduleKey:moduleKey,from:from,to:to,record:record,result:result},context.companyId);return {status:'transitioned',result:result,from:from,to:to};
}
function subscribe(listener){if(typeof listener!=='function')throw new Error('AURIS workflow subscriber must be a function.');listeners.push(listener);return function(){listeners=listeners.filter(function(item){return item!==listener;});};}
function emit(type,detail,companyId){
  var event={type:type,companyId:companyId||null,detail:copy(detail||{})};listeners.slice().forEach(function(listener){try{listener(event);}catch(_){}});
  if(root.document&&typeof root.CustomEvent==='function')root.document.dispatchEvent(new root.CustomEvent('auris:workflow-'+type,{detail:event}));
}

var api={version:'3.0.0',configure:configure,clear:clear,clearCompany:clearCompany,configurePersistence:configurePersistence,hydrate:hydrate,readiness:readiness,versions:versions,saveDraft:saveDraft,publish:publish,rollback:rollback,policy:policy,review:review,simulate:simulate,impact:impact,canTransition:canTransition,requiresApproval:requiresApproval,explain:explain,requireTransition:requireTransition,registerApprovalProvider:registerApprovalProvider,transition:transition,subscribe:subscribe};
root.AurisWorkflowService=Object.freeze(api);
})(typeof window!=='undefined'?window:globalThis);
