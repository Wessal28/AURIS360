(function(root){
'use strict';

var types={workplace:'Workplace inspection',behavioral:'Behavioural safety',equipment:'Equipment inspection',ppe:'PPE inspection',fire:'Fire safety',environmental:'Environmental inspection',iso_audit:'ISO audit',internal_audit:'Internal audit',supplier_audit:'Supplier audit',contractor_audit:'Contractor audit',regulatory:'Regulatory inspection',prestart:'Pre-start inspection'};
var statuses={open:'Open',in_progress:'In progress',completed:'Completed',closed:'Closed',archived:'Archived',draft:'Draft',pending_review:'Pending review',pending_approval:'Pending approval',rejected:'Rejected'};
var terminal=['completed','closed','archived'];
var auditTypes=['iso_audit','internal_audit','supplier_audit','contractor_audit','regulatory'];
var inspectionTypes=['workplace','behavioral','equipment','ppe','fire','environmental'];

function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view audits and inspections.');
  services.rbac.requireAccess('inspection');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view audits and inspections.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the audit register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),status:String(input.status||'').slice(0,80),attention:String(input.attention||'').slice(0,80),score:String(input.score||'').slice(0,80),range:['all','year','month','30'].indexOf(input.range)!==-1?input.range:'all'};}
function typeCode(row){return String(row&&(row.inspection_type||row.audit_type||row.type)||'workplace').toLowerCase();}
function typeLabel(row){var code=typeCode(row);return types[code]||String(row&&(row.inspection_type||row.audit_type||row.type)||'Inspection').replace(/_/g,' ');}
function statusLabel(value){var code=String(value||'open').toLowerCase();return statuses[code]||String(value||'Not recorded').replace(/_/g,' ');}
function dateValue(row){return row&&(row.inspection_date||row.if_date||row.date||row.created_at)||'';}
function parseNumber(value){var number=Number(value);return Number.isFinite(number)?number:null;}
function scoreSummary(row){
  var good=parseNumber(row&&row.score_good),insuf=parseNumber(row&&row.score_insuf),total=(good===null?0:good)+(insuf===null?0:insuf);
  if(total<=0)return {good:0,insufficient:0,total:0,percent:null,band:'unscored'};
  var percent=Math.round((good||0)/total*100);
  return {good:good||0,insufficient:insuf||0,total:total,percent:percent,band:percent>=80?'excellent':percent>=60?'acceptable':'attention'};
}
function findingCount(row){
  var direct=row&&(row.findings_count??row.audit_findings_count);
  if(direct!==null&&direct!==undefined&&String(direct).trim()!==''&&Number.isFinite(Number(direct)))return Math.max(0,Number(direct));
  return Array.isArray(row&&row.items)?row.items.filter(function(item){return item&&['insufficient','finding','fail','failed'].indexOf(String(item.result||item.status||'').toLowerCase())!==-1;}).length:0;
}
function actionCount(row){
  var direct=row&&(row.actions_count??row.action_count);
  if(direct!==null&&direct!==undefined&&String(direct).trim()!==''&&Number.isFinite(Number(direct)))return Math.max(0,Number(direct));
  return Array.isArray(row&&row.action_items)?row.action_items.filter(Boolean).length:0;
}
function dateRangeMatch(value,range,now){
  if(!range||range==='all')return true;
  var date=new Date(value);if(!value||Number.isNaN(date.getTime()))return false;
  if(range==='year')return date.getFullYear()===now.getFullYear();
  if(range==='month')return date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth();
  var start=new Date(now);start.setDate(start.getDate()-30);return date>=start&&date<=now;
}
function tabTypeMatch(code,tab){
  if(tab==='audit')return auditTypes.indexOf(code)!==-1;
  if(inspectionTypes.indexOf(tab)!==-1)return code===tab;
  return true;
}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase(),tab=String(options.tab||'all'),soon=new Date(now.getTime()+30*86400000);
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var code=typeCode(row),status=String(row.status||'open').toLowerCase(),date=dateValue(row),planned=row.planned_date||row.planned_inspection_date||row.next_review_date||'',plannedDate=planned?new Date(planned):null;
    var score=scoreSummary(row),findings=findingCount(row),actions=actionCount(row),overdue=!!(plannedDate&&!Number.isNaN(plannedDate.getTime())&&plannedDate<now&&terminal.indexOf(status)===-1),dueSoon=!overdue&&!!(plannedDate&&!Number.isNaN(plannedDate.getTime())&&plannedDate<=soon&&terminal.indexOf(status)===-1),unplanned=!planned||!plannedDate||Number.isNaN(plannedDate.getTime());
    var attention=overdue?'Overdue':dueSoon?'Due soon':findings>0?'Open findings':score.band==='attention'?'Low score':unplanned?'No plan':'—';
    var inspector=row.inspector||row.by||row.if_by||row.performed_by||row.inspector_name||'Not recorded',site=row.site||row.if_site||row.location||'Not recorded',reference=row.reference_no||row.audit_ref||'INSP-DRAFT',title=row.title||row.activity||row.audit_scope||site||typeLabel(row);
    var hay=[reference,title,typeLabel(row),site,row.department,row.audit_standard,row.audit_scope,inspector,status,statusLabel(status),attention,score.percent===null?'Not scored':score.percent+'%',row.notes].join(' ').toLowerCase();
    if(!tabTypeMatch(code,tab)||f.type&&code!==f.type||f.status&&status!==f.status||f.search&&!hay.includes(search)||!dateRangeMatch(date,f.range,now))return null;
    if(f.attention&&!(f.attention==='overdue'&&overdue||f.attention==='due_soon'&&dueSoon||f.attention==='unplanned'&&unplanned||f.attention==='open_findings'&&findings>0||f.attention==='low_score'&&score.band==='attention'))return null;
    if(f.score&&score.band!==f.score)return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'inspections',reference:reference,title:title,type:typeLabel(row),site:site,department:row.department||'',inspection_date:date,planned_date:planned||'',inspector:inspector,standard:row.audit_standard||'Not specified',score:score.percent,score_detail:score.total?score.good+' good / '+score.insufficient+' insufficient':'Not scored',status:statusLabel(status),findings:findings,actions:actions,attention:attention,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'inspection_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'inspection_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Reference',required:true,groupable:false,action:'open'},{key:'title',label:'Inspection / audit',required:true,groupable:false,action:'open'},
  {key:'type',label:'Type'},{key:'site',label:'Site / location'},{key:'department',label:'Department',hidden:true},{key:'inspection_date',label:'Inspection date',type:'date',groupable:false},{key:'planned_date',label:'Planned date',type:'date',groupable:false,hidden:true},{key:'inspector',label:'Inspector'},
  {key:'standard',label:'Standard',groupable:false},{key:'score',label:'Score',type:'percent',groupable:false},{key:'score_detail',label:'Score detail',groupable:false,hidden:true},{key:'status',label:'Status',type:'badge',tones:{Open:'warning','In progress':'info',Completed:'success',Closed:'success',Archived:'neutral',Draft:'neutral','Pending review':'warning','Pending approval':'warning',Rejected:'danger','Not recorded':'neutral'}},
  {key:'findings',label:'Findings',groupable:false},{key:'actions',label:'Actions',groupable:false},{key:'attention',label:'Attention',groupable:false},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared audit register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'audits-inspections',label:'Audits & Inspections',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open inspection report'},{key:'edit',label:'Edit inspection',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This inspection is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the inspection report.');
    var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This inspection action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisAuditListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,scoreSummary:scoreSummary});
})(typeof window!=='undefined'?window:globalThis);
