(function(root){
'use strict';

function clone(value){return JSON.parse(JSON.stringify(value));}
function first(value){return Array.isArray(value)?value[0]||null:value||null;}
function api(){
  var services=root.AurisPlatformServices;
  if(!services||!services.api||!services.api.isReady())throw new Error('AURIS platform API is not ready for governance persistence.');
  return services.api;
}
function request(path,options){return api().request(path,options);}
function requiredCompany(companyId){if(!companyId){var error=new Error('A company context is required for governance persistence.');error.code='AURIS_GOVERNANCE_COMPANY_REQUIRED';throw error;}return String(companyId);}
function mapPolicy(row){
  row=row||{};return {id:row.id,companyId:row.company_id,moduleKey:row.module_key,version:row.version,status:row.status,revision:row.revision,policy:clone(row.policy||{}),supersedesId:row.supersedes_id||null,createdAt:row.created_at||null,publishedAt:row.published_at||null};
}
function mapApproval(row){
  row=row||{};var recordId=row.source_record_id||row.related_id||'';
  return {id:row.id,status:row.status||'pending',moduleKey:row.module_name||'',from:row.from_state||'',to:row.to_state||'',reason:row.request_reason||'',companyId:row.company_id||null,requestedBy:row.requested_by||row.submitted_by||null,requestedAt:row.requested_at||row.submitted_at||row.created_at||null,decidedBy:row.decided_by||null,decidedAt:row.decided_at||row.completed_at||null,decisionReason:row.decision_reason||row.release_reason||'',revision:row.revision||1,source:{adapterKey:row.source_adapter_key||row.module_name||'',moduleKey:row.module_name||'',page:row.source_page||row.module_name||'',table:row.related_table||'',recordId:String(recordId),ref:row.source_ref||'',companyId:row.company_id||null}};
}

var workflowAdapter={
  load:async function(companyId){
    companyId=requiredCompany(companyId);
    var rows=await request('/workflow_policy_versions?select=*&company_id=eq.'+encodeURIComponent(companyId)+'&status=eq.published&order=module_key.asc,version.desc');
    return (rows||[]).map(mapPolicy);
  },
  saveDraft:async function(companyId,moduleKey,policy,options){
    companyId=requiredCompany(companyId);options=options||{};
    var row=first(await request('/rpc/create_workflow_policy_draft',{m:'POST',p:'return=representation',b:{p_company_id:companyId,p_module_key:String(moduleKey||''),p_policy:clone(policy),p_expected_revision:options.expectedRevision==null?null:Number(options.expectedRevision)}}));
    if(!row)throw new Error('Workflow draft was not returned by persistence.');return mapPolicy(row);
  },
  publish:async function(companyId,moduleKey,policyId,options){
    companyId=requiredCompany(companyId);options=options||{};
    var row=first(await request('/rpc/publish_workflow_policy',{m:'POST',p:'return=representation',b:{p_company_id:companyId,p_module_key:String(moduleKey||''),p_policy_id:policyId,p_expected_revision:options.expectedRevision==null?null:Number(options.expectedRevision)}}));
    if(!row)throw new Error('Published workflow policy was not returned by persistence.');return mapPolicy(row);
  },
  rollback:async function(companyId,moduleKey,policyId,options){
    companyId=requiredCompany(companyId);options=options||{};
    var row=first(await request('/rpc/rollback_workflow_policy',{m:'POST',p:'return=representation',b:{p_company_id:companyId,p_module_key:String(moduleKey||''),p_restore_policy_id:policyId,p_expected_active_revision:options.expectedRevision==null?null:Number(options.expectedRevision)}}));
    if(!row)throw new Error('Rolled-back workflow policy was not returned by persistence.');return mapPolicy(row);
  }
};

var approvalAdapter={
  load:async function(companyId){
    companyId=requiredCompany(companyId);
    var rows=await request('/approval_requests?select=*&company_id=eq.'+encodeURIComponent(companyId)+'&status=eq.pending&order=created_at.desc&limit=500');
    return (rows||[]).map(mapApproval);
  },
  create:async function(item){
    item=item||{};var source=item.source||{},companyId=requiredCompany(item.companyId||source.companyId);
    var row=first(await request('/rpc/request_workflow_approval',{m:'POST',p:'return=representation',b:{p_company_id:companyId,p_module_name:String(item.moduleKey||source.moduleKey||''),p_related_table:String(source.table||''),p_source_record_id:String(source.recordId||''),p_source_page:String(source.page||''),p_source_ref:String(source.ref||''),p_source_adapter_key:String(source.adapterKey||''),p_from_state:String(item.from||''),p_to_state:String(item.to||''),p_reason:String(item.reason||''),p_idempotency_key:String(item.id||'')}}));
    if(!row)throw new Error('Approval request was not returned by persistence.');return mapApproval(row);
  },
  decide:async function(item){
    item=item||{};var row=first(await request('/rpc/decide_workflow_approval',{m:'POST',p:'return=representation',b:{p_request_id:item.id,p_decision:String(item.status||''),p_reason:String(item.decisionReason||''),p_expected_revision:item.revision==null?null:Number(item.revision)}}));
    if(!row)throw new Error('Approval decision was not returned by persistence.');return mapApproval(row);
  }
};

var service={version:'1.0.0',workflow:workflowAdapter,approvals:approvalAdapter,mapPolicy:mapPolicy,mapApproval:mapApproval};
root.AurisGovernancePersistence=Object.freeze(service);
})(typeof window!=='undefined'?window:globalThis);
