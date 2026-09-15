(function(root){
'use strict';

var statuses={draft:'Draft',pending_review:'Pending review',pending_approval:'Pending approval',review:'Under review',submitted:'Submitted',approved:'Approved',active:'Active',closed:'Closed',rejected:'Rejected',archived:'Archived'};
var types={baseline:'Baseline / generic',task:'Task-based',dynamic:'Dynamic',hira:'HIRA',jsa:'JSA / JHA',manual_handling:'Manual handling',fire:'Fire',machinery:'Machinery',chemical:'Chemical / COSHH',atex:'ATEX',fleet:'Fleet / vehicle',environmental:'Environmental'};
var terminal=['closed','archived'];
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view risk assessments.');
  services.rbac.requireAccess('risk');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view risk assessments.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account or company changed. Reload the risk register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),status:String(input.status||'').slice(0,80),risk:String(input.risk||'').slice(0,80),scope:['all','mine','due','high'].indexOf(input.scope)!==-1?input.scope:'all'};}
function typeCode(row){return String(row&&((row.ra_type_v2||row.ra_type||row.ra_type_old)||'baseline')).toLowerCase();}
function typeLabel(row){var code=typeCode(row);return types[code]||String(row&&((row.ra_type_v2||row.ra_type||row.ra_type_old)||'Risk assessment')).replace(/_/g,' ');}
function statusLabel(value){var code=String(value||'').toLowerCase();return statuses[code]||String(value||'Not recorded').replace(/_/g,' ');}
function score(value){var n=parseInt(value,10);return Number.isFinite(n)?n:0;}
function riskSummary(row){
  var rows=Array.isArray(row&&row.rows)?row.rows:Array.isArray(row&&row.baseline_rows)?row.baseline_rows:[];
  var initial=score(row&& (row.overall_risk_score||row.risk_score)),initialLevel=String(row&& (row.overall_risk_level||row.risk_level)||'');
  var residual=0,residualLevel='';
  rows.forEach(function(item){var i=score(item&&item.rr),r=score(item&&item.res_rr);if(i>initial){initial=i;initialLevel=item.rl||'';}if(r>residual){residual=r;residualLevel=item.res_rl||'';}});
  if(!initialLevel&&initial)initialLevel=initial>=20?'Critical':initial>=12?'Very High':initial>=6?'High':initial>=3?'Medium':'Low';
  if(!residualLevel&&residual)residualLevel=residual>=20?'Critical':residual>=12?'Very High':residual>=6?'High':residual>=3?'Medium':'Low';
  return {initial:initial,initialLevel:initialLevel||'Not recorded',residual:residual,residualLevel:residualLevel||'Not recorded',rows:rows.length};
}
function isOverdue(row,now){return !!(row&&row.review_date&&new Date(row.review_date)<now&&terminal.indexOf(String(row.status||'').toLowerCase())===-1);}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase(),name=String(current.name||'').toLowerCase().trim();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var code=typeCode(row),label=typeLabel(row),status=String(row.status||'').toLowerCase(),summary=riskSummary(row),overdue=isOverdue(row,now),dueSoon=!overdue&&row.review_date&&new Date(row.review_date)<=new Date(now.getTime()+30*86400000)&&terminal.indexOf(status)===-1;
    var owner=String(row.assessed_by||row.ra_assessor||row.created_by_name||'Unassigned');
    if(f.scope==='mine'&&!(String(row.assessed_by_id||row.created_by||'')===current.userId||name&&owner.toLowerCase().includes(name)))return null;
    if(f.scope==='due'&&!overdue&&!dueSoon)return null;
    if(f.scope==='high'&&!['high','very high','critical'].some(function(level){return summary.initialLevel.toLowerCase()===level||summary.residualLevel.toLowerCase()===level;}))return null;
    var hay=[row.ra_ref,row.title,row.activity,row.scope,row.location,row.workshop,row.department,owner,label,status,statusLabel(status),summary.initialLevel,summary.residualLevel].join(' ').toLowerCase();
    if(search&&!hay.includes(search)||f.type&&(code!==f.type&&label.toLowerCase()!==f.type.toLowerCase())||f.status&&status!==f.status||f.risk&&summary.initialLevel.toLowerCase()!==f.risk.toLowerCase()&&summary.residualLevel.toLowerCase()!==f.risk.toLowerCase())return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'risk_assessments',reference:row.ra_ref||'RA-DRAFT',title:row.title||row.activity||row.workshop||'Untitled risk assessment',type:label,location:row.location||row.workshop||row.site_name||'',department:row.department||'',owner:owner,initial_risk:summary.initialLevel,residual_risk:summary.residualLevel,initial_score:summary.initial,residual_score:summary.residual,rows:summary.rows,status:statusLabel(status),review_date:row.review_date||row.ra_review_date||'',attention:overdue?'Overdue':dueSoon?'Due soon':'—',linked_records:[row.permit_ref?'PTW '+row.permit_ref:'',row.work_order_id?'Work order':'',row.rams_document_name||row.rams_document_url?'RAMS':''].filter(Boolean).join(' · ')};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board'],defaultView:'list',defaultSort:'review_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'review_date',fields:[
  {key:'reference',label:'Reference',required:true,groupable:false,action:'open'},{key:'title',label:'Assessment / scope',required:true,groupable:false,action:'open'},
  {key:'type',label:'Type'},{key:'location',label:'Site / location'},{key:'department',label:'Department',hidden:true},{key:'owner',label:'Assessed by'},
  {key:'initial_risk',label:'Initial risk',type:'badge',tones:{'Very Low':'success',Low:'success',Medium:'info',High:'warning','Very High':'danger',Critical:'danger','Not recorded':'neutral'}},
  {key:'residual_risk',label:'Residual risk',type:'badge',tones:{'Very Low':'success',Low:'success',Medium:'info',High:'warning','Very High':'danger',Critical:'danger','Not recorded':'neutral'}},
  {key:'status',label:'Status',type:'badge',tones:{Draft:'neutral','Pending review':'warning','Pending approval':'warning','Under review':'info',Submitted:'warning',Approved:'success',Active:'success',Closed:'success',Rejected:'danger',Archived:'neutral','Not recorded':'neutral'}},
  {key:'review_date',label:'Review date',type:'date',groupable:false},{key:'attention',label:'Attention',groupable:false},{key:'rows',label:'Hazard rows',groupable:false,hidden:true},{key:'linked_records',label:'Linked records',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session(),projected=project(rows,current,options);
  if(!root.AurisViewEngine)throw new Error('The shared risk register is unavailable. Reload the application.');
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'risk-assessment',label:'Risk Assessment',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open risk assessment'}],
    onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},
    onAction:async function(key,row){
      assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});
      if(key!=='open'||!selected||typeof options.openRecord!=='function')throw new Error('This risk assessment is outside the current register. Reload to retry.');
      if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the risk assessment.');
      await options.openRecord(selected.id,current);
    }
  });
}
root.AurisRiskListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,riskSummary:riskSummary});
})(typeof window!=='undefined'?window:globalThis);
