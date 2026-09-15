(function(root){
'use strict';

var risks={low:'Low',medium:'Medium',high:'High',critical:'Critical'};
var statuses={active:'Active',restricted:'Restricted',discontinued:'Discontinued',archived:'Archived',draft:'Draft',deleted:'Deleted'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view chemicals.');
  services.rbac.requireAccess('chemical');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view chemicals.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the chemical register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),risk:String(input.risk||'').slice(0,80),status:String(input.status||'').slice(0,80),attention:String(input.attention||'').slice(0,80)};}
function dateState(value,now){
  now=now||new Date();if(!value)return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var days=Math.ceil((due-today)/86400000);
  return {date:date.toISOString().slice(0,10),missing:false,expired:days<0,soon:days>=0&&days<=30,days:days,label:date.toISOString().slice(0,10)};
}
function sdsState(value,now){
  var state=dateState(value,now);if(state.missing)return {state:'Missing',date:'',stale:true};
  var current=new Date(now||new Date());var cutoff=new Date(current);cutoff.setFullYear(cutoff.getFullYear()-5);
  return {state:new Date(value)<cutoff?'Stale':'Current',date:state.date,stale:new Date(value)<cutoff};
}
function label(map,value,fallback){var key=String(value||'').toLowerCase();return map[key]||String(value||fallback||'Not recorded').replace(/_/g,' ');}
function listValue(value){return Array.isArray(value)?value.filter(Boolean).join(', '):String(value||'');}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId&&String(row.status||'').toLowerCase()!=='deleted';}).map(function(row){
    var risk=String(row.risk_level||'').toLowerCase(),status=String(row.status||'active').toLowerCase(),review=dateState(row.review_date,now),sds=sdsState(row.sds_revision_date,now),controls=String(row.existing_controls||'').trim(),ppe=String(row.ppe_required||'').trim(),hazards=listValue(row.hazard_statements)||String(row.hazard_identification||'').trim(),persons=Number(row.persons_exposed||0)||0;
    var flags=[];if(risk==='critical')flags.push('critical_risk');if(review.expired)flags.push('review_overdue');else if(review.soon)flags.push('review_due_soon');if(sds.state==='Missing')flags.push('sds_missing');else if(sds.state==='Stale')flags.push('sds_stale');if(!controls&&!ppe)flags.push('controls_missing');
    var attention=flags.includes('critical_risk')?'Critical risk':flags.includes('review_overdue')?'Review overdue':flags.includes('review_due_soon')?'Review due soon':flags.includes('sds_missing')?'SDS missing':flags.includes('sds_stale')?'SDS stale':flags.includes('controls_missing')?'Controls missing':'—';
    var hay=[row.chemical_ref,row.product_name,row.supplier,row.manufacturer,row.location,row.department,row.process_use,row.signal_word,row.hazard_identification,hazards,row.risk_level,status,attention,review.date,sds.date].join(' ').toLowerCase();
    if(f.risk&&risk!==f.risk.toLowerCase())return null;if(f.status&&status!==f.status.toLowerCase())return null;if(f.attention&&!flags.includes(f.attention.toLowerCase()))return null;if(search&&!hay.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'chemical_register',reference:row.chemical_ref||('CHEM-'+String(row.id).slice(0,8).toUpperCase()),title:row.product_name||'Unnamed chemical',supplier:row.supplier||'Not recorded',manufacturer:row.manufacturer||'Not recorded',location:row.location||'Not recorded',department:row.department||'Not recorded',process_use:row.process_use||'Not recorded',signal_word:row.signal_word||'Not recorded',hazards:hazards||'Not recorded',exposure_routes:listValue(row.exposure_routes)||'Not recorded',persons_exposed:persons,exposure_frequency:row.exposure_frequency||'Not recorded',task_type:row.task_type||'Not recorded',risk_score:Number(row.risk_score||0)||0,risk_level:label(risks,risk,'Not recorded'),review_date:review.date,review:review.expired?'Overdue':review.soon?'Due soon':review.missing?'Not scheduled':'Current',sds_revision_date:sds.date,sds:sds.state,controls:controls||ppe?'Recorded':'Missing',status:label(statuses,status,'Not recorded'),attention:attention,attention_flags:flags,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'review_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'review_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Chemical reference',required:true,groupable:false,action:'open'},{key:'title',label:'Product',required:true,groupable:false,action:'open'},
  {key:'supplier',label:'Supplier'},{key:'manufacturer',label:'Manufacturer',hidden:true},{key:'location',label:'Location'},{key:'department',label:'Department'},{key:'process_use',label:'Process / use',hidden:true},
  {key:'signal_word',label:'Signal word'},{key:'hazards',label:'Hazards',hidden:true},{key:'exposure_routes',label:'Exposure routes',hidden:true},{key:'persons_exposed',label:'Persons exposed',type:'number',groupable:false},{key:'exposure_frequency',label:'Frequency'},{key:'task_type',label:'Task type',hidden:true},
  {key:'risk_score',label:'Risk score',type:'number',groupable:false},{key:'risk_level',label:'Risk level',type:'badge',tones:{Low:'success',Medium:'warning',High:'danger',Critical:'danger','Not recorded':'neutral'}},
  {key:'review_date',label:'Review date',type:'date',groupable:false,action:'edit'},{key:'review',label:'Review',type:'badge',groupable:false,tones:{Current:'success','Due soon':'warning',Overdue:'danger','Not scheduled':'warning'}},{key:'sds_revision_date',label:'SDS revision',type:'date',groupable:false},{key:'sds',label:'SDS',type:'badge',groupable:false,tones:{Current:'success',Stale:'danger',Missing:'warning'}},{key:'controls',label:'Controls',type:'badge',groupable:false,tones:{Recorded:'success',Missing:'warning'}},{key:'status',label:'Status',type:'badge',tones:{Active:'success',Restricted:'warning',Discontinued:'danger',Archived:'neutral',Draft:'neutral','Not recorded':'neutral'}},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{'Critical risk':'danger','Review overdue':'danger','Review due soon':'warning','SDS missing':'warning','SDS stale':'danger','Controls missing':'warning','—':'success'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared chemical register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'chemical-control',label:'Chemical Control',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open chemical'},{key:'edit',label:'Edit chemical',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This chemical is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the chemical record.');var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This chemical action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisChemicalListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState,sdsState:sdsState});
})(typeof window!=='undefined'?window:globalThis);
