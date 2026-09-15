(function(root){
'use strict';

var types={injury:'Injury',near_miss:'Near miss',dangerous_occurrence:'Dangerous occurrence',property_damage:'Property damage',environmental:'Environmental',vehicle:'Vehicle incident',unsafe_act:'Unsafe act',unsafe_condition:'Unsafe condition',occupational_disease:'Occupational disease',security:'Security',fire:'Fire / explosion'};
var severities={low:'Low',medium:'Medium',high:'High',critical:'Critical'};
var terminal=['closed','cancelled','archived'];
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view incidents.');
  services.rbac.requireAccess('events');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view incidents.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the incident register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),severity:String(input.severity||'').slice(0,80),status:String(input.status||'').slice(0,80),site:String(input.site||'').slice(0,120),department:String(input.department||'').slice(0,120),range:['all','year','month','30'].indexOf(input.range)!==-1?input.range:'year'};}
function typeCode(row){return String(row&& (row.event_type||row.type||'incident')).toLowerCase();}
function typeLabel(row){var code=typeCode(row);return types[code]||String(row&&(row.event_type||row.type)||'Incident').replace(/_/g,' ');}
function severityLabel(value){var code=String(value||'').toLowerCase();return severities[code]||String(value||'Not assessed').replace(/_/g,' ');}
function statusLabel(value){var code=String(value||'open').toLowerCase();return {open:'Open',submitted:'Submitted',awaiting_triage:'Awaiting triage',triage:'Triage',under_investigation:'Under investigation',action_required:'Action required',verification:'Verification',management_review:'Management review',closed:'Closed',cancelled:'Cancelled',archived:'Archived'}[code]||String(value||'Not recorded').replace(/_/g,' ');}
function dateValue(row){return row&& (row.event_date||row.date||row.created_at)||'';}
function dateRangeMatch(value,range,now){if(!range||range==='all')return true;var date=new Date(value);if(!value||Number.isNaN(date.getTime()))return false;if(range==='year')return date.getFullYear()===now.getFullYear();if(range==='month')return date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth();var start=new Date(now);start.setDate(start.getDate()-30);return date>=start&&date<=now;}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var code=typeCode(row),status=String(row.status||'open').toLowerCase(),site=row.site_name||row.site||row.location||'',department=row.department||row.business_unit||row.dept||'',date=dateValue(row),actual=severityLabel(row.severity),potential=severityLabel(row.potential_severity),investigation=row.investigation_ref||row.investigation_number||(row.investigation_required?'Required':'Not required'),reported=row.reported_by_name||row.reported_by||'Not recorded',summary=row.title||row.description||typeLabel(row),attention=status==='submitted'||status==='awaiting_triage'||status==='triage'?'Awaiting triage':row.investigation_required&&!row.investigation_ref&&!row.investigation_number?'Investigation required':['critical','high'].indexOf(String(row.potential_severity||row.severity||'').toLowerCase())!==-1?'High potential':'—';
    var hay=[row.event_ref,row.incident_number,summary,code,typeLabel(row),site,department,row.location,reported,row.assigned_to_name,actual,potential,status,statusLabel(status),investigation].join(' ').toLowerCase();
    if(f.type&&code!==f.type)return null;if(f.severity&&String(row.severity||'').toLowerCase()!==f.severity.toLowerCase())return null;if(f.status&&status!==f.status.toLowerCase())return null;if(f.site&&site!==f.site)return null;if(f.department&&department!==f.department)return null;if(!dateRangeMatch(date,f.range,now))return null;if(search&&!hay.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'events',reference:row.event_ref||row.incident_number||'INC-DRAFT',title:summary,type:typeLabel(row),location:site,department:department,date:date,actual_severity:actual,potential_severity:potential,status:statusLabel(status),investigation:investigation,reported_by:reported,attention:attention,evidence_count:row.evidence_count||row.attachments_count||'',updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board'],defaultView:'list',defaultSort:'date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'date',activityField:'updated_at',fields:[
  {key:'reference',label:'Incident reference',required:true,groupable:false,action:'open'},{key:'title',label:'Incident summary',required:true,groupable:false,action:'open'},
  {key:'date',label:'Event date',type:'date',groupable:false},{key:'type',label:'Type'},{key:'location',label:'Site / location'},{key:'department',label:'Business unit'},
  {key:'actual_severity',label:'Actual severity',type:'badge',tones:{Critical:'danger',High:'warning',Medium:'info',Low:'success','Not assessed':'neutral'}},
  {key:'potential_severity',label:'Potential severity',type:'badge',tones:{Critical:'danger',High:'warning',Medium:'info',Low:'success','Not assessed':'neutral'}},
  {key:'status',label:'Status',type:'badge',tones:{Open:'warning',Submitted:'warning','Awaiting triage':'warning',Triage:'info','Under investigation':'info','Action required':'warning',Verification:'info','Management review':'info',Closed:'success',Cancelled:'neutral',Archived:'neutral','Not recorded':'neutral'}},
  {key:'investigation',label:'Investigation'},{key:'reported_by',label:'Reported by'},{key:'attention',label:'Attention',groupable:false},{key:'evidence_count',label:'Evidence count',hidden:true},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared incident register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'incident-management',label:'Incident Management',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open incident'}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(key!=='open'||!selected||typeof options.openRecord!=='function')throw new Error('This incident is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the incident record.');await options.openRecord(selected.id,current);}});
}
root.AurisIncidentListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters});
})(typeof window!=='undefined'?window:globalThis);
