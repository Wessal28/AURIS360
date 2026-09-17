(function(root){
'use strict';

var statuses={active:'Active',returned:'Returned',expired:'Expired',lost:'Lost',condemned:'Condemned',archived:'Archived'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view PPE issuance.');
  services.rbac.requireAccess('ppe');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view PPE issuance.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the PPE register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),status:String(input.status||'').slice(0,80),attention:String(input.attention||'').slice(0,80)};}
function dateState(value,now){
  now=now||new Date();if(!value)return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var days=Math.ceil((due-today)/86400000);
  return {date:date.toISOString().slice(0,10),missing:false,expired:days<0,soon:days>=0&&days<=30,days:days,label:date.toISOString().slice(0,10)};
}
function label(map,value,fallback){var key=String(value||'').toLowerCase();return map[key]||String(value||fallback||'Not recorded').replace(/_/g,' ');}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var status=String(row.status||'active').toLowerCase(),expiry=dateState(row.expiry_date,now),replacement=dateState(row.expected_replacement_date,now),flags=[];
    if(expiry.expired&&status==='active')flags.push('expiry_overdue');else if(expiry.soon&&status==='active')flags.push('expiry_due_soon');
    if(replacement.expired&&status==='active')flags.push('replacement_overdue');else if(replacement.soon&&status==='active')flags.push('replacement_due_soon');
    if(!row.employee_signature&&status==='active')flags.push('acknowledgement_missing');
    if(status==='lost')flags.push('lost');if(status==='condemned')flags.push('condemned');if(status==='returned')flags.push('returned');
    var attention=flags.includes('expiry_overdue')?'Expiry overdue':flags.includes('replacement_overdue')?'Replacement overdue':flags.includes('expiry_due_soon')?'Expiry due soon':flags.includes('replacement_due_soon')?'Replacement due soon':flags.includes('acknowledgement_missing')?'Acknowledgement missing':flags.includes('lost')?'Lost':flags.includes('condemned')?'Condemned':flags.includes('returned')?'Returned':'—';
    var hay=[row.issuance_ref,row.ppe_name,row.ppe_category,row.employee_name,row.employee_id,row.department,row.job_title,row.serial_number,row.batch_number,row.hazard_ref,status,attention,expiry.date,replacement.date].join(' ').toLowerCase();
    if(f.status&&status!==f.status.toLowerCase())return null;if(f.attention&&!flags.includes(f.attention.toLowerCase()))return null;if(search&&!hay.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'ppe_issuance',reference:row.issuance_ref||('ISS-'+String(row.id).slice(0,8).toUpperCase()),title:row.ppe_name||'Unnamed PPE',employee:row.employee_name||'Not recorded',employee_id:row.employee_id||'Not recorded',department:row.department||'Not recorded',job_title:row.job_title||'Not recorded',category:row.ppe_category||'Not recorded',quantity:Number(row.quantity||0)||0,size:row.size||'Not recorded',serial_number:row.serial_number||'Not recorded',batch_number:row.batch_number||'Not recorded',issued_date:dateState(row.issued_date,now).date,expiry_date:expiry.date,replacement_date:replacement.date,expiry:expiry.expired?'Expired':expiry.soon?'Due soon':expiry.missing?'Not scheduled':'Current',replacement:replacement.expired?'Overdue':replacement.soon?'Due soon':replacement.missing?'Not scheduled':'Current',condition:label({},row.condition_on_issue,'Not recorded'),acknowledged:!!row.employee_signature,status:label(statuses,status,'Not recorded'),attention:attention,attention_flags:flags,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'issued_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'expiry_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Issuance reference',required:true,groupable:false,action:'open'},{key:'title',label:'PPE item',required:true,groupable:false,action:'open'},{key:'employee',label:'Employee'},{key:'employee_id',label:'Employee ID',hidden:true},{key:'department',label:'Department'},{key:'job_title',label:'Job title',hidden:true},{key:'category',label:'Category'},{key:'quantity',label:'Quantity',type:'number',groupable:false},{key:'size',label:'Size',hidden:true},{key:'serial_number',label:'Serial / tag',hidden:true},{key:'batch_number',label:'Batch',hidden:true},{key:'issued_date',label:'Issued',type:'date',groupable:false},{key:'expiry_date',label:'Expiry',type:'date',groupable:false,action:'edit'},{key:'expiry',label:'Expiry state',type:'badge',groupable:false,tones:{Current:'success','Due soon':'warning',Expired:'danger','Not scheduled':'neutral'}},{key:'replacement_date',label:'Replace by',type:'date',groupable:false},{key:'replacement',label:'Replacement state',type:'badge',groupable:false,tones:{Current:'success','Due soon':'warning',Overdue:'danger','Not scheduled':'neutral'}},{key:'condition',label:'Condition'},{key:'acknowledged',label:'Acknowledged',type:'badge',groupable:false,tones:{true:'success',false:'warning'}},{key:'status',label:'Status',type:'badge',tones:{Active:'success',Returned:'neutral',Expired:'danger',Lost:'danger',Condemned:'danger',Archived:'neutral','Not recorded':'neutral'}},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{'Expiry overdue':'danger','Replacement overdue':'danger','Expiry due soon':'warning','Replacement due soon':'warning','Acknowledgement missing':'warning',Lost:'danger',Condemned:'danger',Returned:'neutral','—':'success'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared PPE register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'ppe-management',label:'PPE Issuance',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open PPE issuance'},{key:'edit',label:'Edit PPE issuance',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This PPE issuance is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the PPE issuance.');var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This PPE action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisPpeListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState});
})(typeof window!=='undefined'?window:globalThis);
