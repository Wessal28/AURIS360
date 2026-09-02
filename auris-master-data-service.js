(function(root){
'use strict';
var adapter=null;
var domains=Object.freeze({
  location:Object.freeze({label:'Sites & locations',icon:'ti-map-pin'}),
  department:Object.freeze({label:'Departments & business units',icon:'ti-sitemap'}),
  organisation:Object.freeze({label:'Contractors & suppliers',icon:'ti-building-store'}),
  person_role:Object.freeze({label:'Personnel & responsible roles',icon:'ti-users'}),
  asset:Object.freeze({label:'Equipment & assets',icon:'ti-tools'}),
  risk_classification:Object.freeze({label:'Risk categories & matrices',icon:'ti-shield-check'}),
  action_classification:Object.freeze({label:'Action priorities & classifications',icon:'ti-list-check'}),
  document_category:Object.freeze({label:'Document categories',icon:'ti-folders'})
});
function text(value,max){return String(value==null?'':value).trim().slice(0,max||200);}
function context(options){var value=options&&typeof options.context==='function'?options.context():adapter&&adapter.context?adapter.context():{};return {companyId:text(value.companyId,80),userId:text(value.userId,80),role:text(value.role,40)};}
function canManage(role){return ['admin','company_admin','hse_manager','sephs_admin'].indexOf(role)!==-1;}
function date(value){value=text(value,10);if(value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Effective dates must use YYYY-MM-DD.');return value||null;}
function record(input,options){input=input||{};var current=context(options||{}),domain=text(input.domain,40),status=['draft','pending_review','active','inactive','archived','merged'].indexOf(input.status)!==-1?input.status:'draft',from=date(input.effectiveFrom||input.effective_from),to=date(input.effectiveTo||input.effective_to);if(!current.companyId)throw new Error('Master data requires an active company.');if(!domains[domain])throw new Error('Unsupported master-data domain.');if(!canManage(current.role))throw new Error('Master data is restricted to company administrators and HSE managers.');var code=text(input.code,80).toUpperCase(),name=text(input.name,160);if(!/^[A-Z0-9][A-Z0-9_.\/-]{0,79}$/.test(code))throw new Error('Master-data code must contain safe letters, numbers, dots, dashes or slashes.');if(name.length<2)throw new Error('Master-data name must contain at least two characters.');if(from&&to&&to<from)throw new Error('Effective-to date cannot precede effective-from date.');return Object.freeze({id:text(input.id,80),companyId:current.companyId,domain:domain,code:code,name:name,description:text(input.description,1000),status:status,effectiveFrom:from,effectiveTo:to,revision:Math.max(0,Number(input.revision)||0),mergedIntoId:text(input.mergedIntoId||input.merged_into_id,80)});}
function duplicateCandidates(candidate,records,options){var value=record(candidate,options),code=value.code.toLowerCase(),name=value.name.toLowerCase();return Object.freeze((records||[]).filter(function(row){return row.id!==value.id&&String(row.company_id||row.companyId)===value.companyId&&row.domain===value.domain&&(String(row.code||'').toLowerCase()===code||String(row.name||'').trim().toLowerCase()===name);}).map(function(row){return Object.freeze({id:row.id,code:row.code,name:row.name,status:row.status,revision:Number(row.revision||0)});}));}
function importPlan(domain,csv,fieldMap,options){if(!domains[domain])throw new Error('Unsupported master-data domain.');var rows=root.AurisIntegrationEngine.genericMappedRows(csv,fieldMap,['code','name','description','effective_from','effective_to'],['code','name']),accepted=[],rejected=[];rows.forEach(function(row,index){try{accepted.push(record(Object.assign({domain:domain,status:'draft'},row),options));}catch(error){rejected.push(Object.freeze({row:index+1,code:'invalid_master_data',message:text(error.message,180)}));}});return Object.freeze({domain:domain,fieldMap:Object.freeze(Object.assign({},fieldMap)),accepted:Object.freeze(accepted),rejected:Object.freeze(rejected),executable:accepted.length>0&&!rejected.length,rowCount:rows.length});}
function deepLink(row){var id=text(row&&row.id,80);if(!id)throw new Error('Master-data deep link requires an exact record id.');return '?goto=master-data&record='+encodeURIComponent(id)+'&ref='+encodeURIComponent(text(row.code||row.name,160))+'&table=master_data_records&company='+encodeURIComponent(text(row.company_id||row.companyId,80));}
function configure(value){if(!value||typeof value.context!=='function')throw new Error('AURIS master-data adapter is incomplete.');adapter=value;return api;}
var api={version:'1.0.0',domains:domains,configure:configure,canManage:canManage,record:record,duplicateCandidates:duplicateCandidates,importPlan:importPlan,deepLink:deepLink};
root.AurisMasterData=Object.freeze(api);if(typeof module==='object'&&module.exports)module.exports=root.AurisMasterData;
})(typeof window!=='undefined'?window:globalThis);
