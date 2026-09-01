(function(root){
'use strict';
var platform=root.AurisPlatformServices;
if(!platform)throw new Error('Application lifecycle persistence requires platform services.');
function request(path,options){return platform.api.request(path,options);}
function one(result){return Array.isArray(result)?result[0]||null:result||null;}
function load(companyId){if(!companyId)return Promise.reject(new Error('Select a company to inspect application lifecycle evidence.'));var filter='company_id=eq.'+encodeURIComponent(companyId);return Promise.all([
  request('/company_application_releases?select=*&'+filter+'&order=module_key.asc'),
  request('/application_upgrade_runs?select=*&'+filter+'&order=started_at.desc&limit=100'),
  request('/application_migration_status?select=*&'+filter+'&order=module_key.asc,migration_key.asc'),
  request('/application_health_events?select=*&'+filter+'&resolved_at=is.null&order=created_at.desc&limit=200'),
  request('/approval_requests?select=source_module,status&'+filter+'&status=eq.pending&limit=500')
]).then(function(rows){var migrations=(rows[2]||[]).slice(),lifecycleKey='20260901040000_modular_foundation_13_application_lifecycle';if(!migrations.some(function(row){return row.migration_key===lifecycleKey;}))migrations.push({migration_key:lifecycleKey,status:'succeeded',evidence:'schema_query_succeeded'});return {states:rows[0]||[],upgrades:rows[1]||[],migrations:migrations,events:rows[3]||[],approvals:rows[4]||[],releaseSha:root.__AURIS_RUNTIME_CONFIG__&&root.__AURIS_RUNTIME_CONFIG__.releaseSha||''};});}
function beginUpgrade(input){return request('/rpc/begin_application_upgrade',{m:'POST',p:'return=representation',b:{p_company_id:input.companyId,p_module_key:input.moduleKey,p_from_version:input.fromVersion,p_to_version:input.toVersion,p_activation_status:input.activationStatus||'pilot',p_compatibility_snapshot:input.compatibility,p_migration_plan:input.migrations||[],p_idempotency_key:input.idempotencyKey}}).then(one);}
function finishUpgrade(input){return request('/rpc/finish_application_upgrade',{m:'POST',p:'return=representation',b:{p_run_id:input.runId,p_status:input.status,p_error_code:input.errorCode||null}}).then(one);}
function rollback(input){return request('/rpc/rollback_application_release',{m:'POST',p:'return=representation',b:{p_company_id:input.companyId,p_module_key:input.moduleKey,p_idempotency_key:input.idempotencyKey}}).then(one);}
function recordHealth(input){return request('/rpc/record_application_health_event',{m:'POST',p:'return=representation',b:{p_company_id:input.companyId,p_module_key:input.moduleKey,p_event_type:input.eventType,p_severity:input.severity||'warning',p_error_code:input.errorCode,p_safe_context:input.safeContext||{},p_release_sha:input.releaseSha||null}}).then(one);}
root.AurisApplicationLifecyclePersistence=Object.freeze({version:'1.0.0',load:load,beginUpgrade:beginUpgrade,finishUpgrade:finishUpgrade,rollback:rollback,recordHealth:recordHealth});
})(typeof window!=='undefined'?window:globalThis);
