(function(root){
'use strict';

var fitness={fit:'Fit for work',fit_with_restrictions:'Fit with restrictions',temporarily_unfit:'Temporarily unfit',permanently_unfit:'Permanently unfit',pending:'Pending',archived:'Archived'};
var examTypes={pre_employment:'Pre-employment',periodic:'Periodic',return_to_work:'Return to work',exit:'Exit',fitness_for_duty:'Fitness for duty',special:'Special'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view medical surveillance.');
  services.rbac.requireAccess('ohealth');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view medical surveillance.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload medical surveillance.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),fitness:String(input.fitness||'').slice(0,80),attention:String(input.attention||'').slice(0,80)};}
function dateState(value,now){
  now=now||new Date();if(!value)return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var days=Math.ceil((due-today)/86400000);
  return {date:date.toISOString().slice(0,10),missing:false,expired:days<0,soon:days>=0&&days<=60,days:days,label:date.toISOString().slice(0,10)};
}
function label(map,value,fallback){var key=String(value||'').toLowerCase();return map[key]||String(value||fallback||'Not recorded').replace(/_/g,' ');}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var type=String(row.exam_type||'').toLowerCase(),status=String(row.status||'active').toLowerCase(),fit=String(row.fitness_status||'pending').toLowerCase(),next=dateState(row.next_exam_date,now),flags=[];
    if(next.expired&&status!=='archived')flags.push('exam_overdue');else if(next.soon&&status!=='archived')flags.push('exam_due_soon');
    if(!row.next_exam_date&&status!=='archived')flags.push('next_exam_missing');if(fit==='temporarily_unfit'||fit==='permanently_unfit')flags.push('unfit');if(fit==='fit_with_restrictions')flags.push('restricted');if(row.follow_up_required)flags.push('follow_up_required');if(status==='archived')flags.push('archived');
    var attention=flags.includes('exam_overdue')?'Exam overdue':flags.includes('exam_due_soon')?'Exam due soon':flags.includes('next_exam_missing')?'Next exam missing':flags.includes('unfit')?'Unfit':flags.includes('restricted')?'Restrictions':flags.includes('follow_up_required')?'Follow-up required':flags.includes('archived')?'Archived':'—';
    var hay=[row.employee_name,row.employee_id,row.department,row.job_title,type,fit,status,attention,row.exam_date,next.date].join(' ').toLowerCase();
    if(f.type&&type!==f.type.toLowerCase()&&f.type!=='due_60'&&f.type!=='overdue')return null;if(f.type==='due_60'&&(next.missing||next.days>60))return null;if(f.type==='overdue'&&!next.expired)return null;if(f.fitness&&fit!==f.fitness.toLowerCase())return null;if(f.attention&&!flags.includes(f.attention.toLowerCase()))return null;if(search&&!hay.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'medical_surveillance',reference:row.exam_ref||row.record_ref||('MED-'+String(row.id).slice(0,8).toUpperCase()),title:row.employee_name||'Unnamed employee',employee_id:row.employee_id||'Not recorded',department:row.department||'Not recorded',job_title:row.job_title||'Not recorded',exam_type:label(examTypes,type,'Not recorded'),exam_date:dateState(row.exam_date,now).date,next_exam_date:next.date,next_exam:next.expired?'Overdue':next.soon?'Due soon':next.missing?'Not scheduled':'Current',fitness:label(fitness,fit,'Not recorded'),follow_up_required:!!row.follow_up_required,report_reference:row.report_ref||'Not recorded',status:label({active:'Active',archived:'Archived',closed:'Closed'},status,'Not recorded'),attention:attention,attention_flags:flags,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'next_exam_date',titleField:'title',subtitleField:'reference',groupField:'fitness',dateField:'next_exam_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Examination reference',required:true,groupable:false,action:'open'},{key:'title',label:'Employee',required:true,groupable:false,action:'open'},{key:'employee_id',label:'Employee ID',hidden:true},{key:'department',label:'Department'},{key:'job_title',label:'Job title',hidden:true},{key:'exam_type',label:'Exam type'},{key:'exam_date',label:'Exam date',type:'date',groupable:false},{key:'next_exam_date',label:'Next due',type:'date',groupable:false,action:'edit'},{key:'next_exam',label:'Due state',type:'badge',groupable:false,tones:{Current:'success','Due soon':'warning',Overdue:'danger','Not scheduled':'warning'}},{key:'fitness',label:'Fitness',type:'badge',tones:{'Fit for work':'success','Fit with restrictions':'warning','Temporarily unfit':'danger','Permanently unfit':'danger',Pending:'neutral',Archived:'neutral','Not recorded':'neutral'}},{key:'follow_up_required',label:'Follow-up',type:'badge',groupable:false,tones:{true:'warning',false:'success'}},{key:'report_reference',label:'Report reference',hidden:true},{key:'status',label:'Status',type:'badge',tones:{Active:'success',Archived:'neutral',Closed:'neutral','Not recorded':'neutral'}},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{'Exam overdue':'danger','Exam due soon':'warning','Next exam missing':'warning',Unfit:'danger',Restrictions:'warning','Follow-up required':'warning',Archived:'neutral','—':'success'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared medical surveillance register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'occupational-health',label:'Medical Surveillance',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open medical record'},{key:'edit',label:'Edit medical record',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This medical record is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the medical record.');var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This medical record action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisOhealthListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState});
})(typeof window!=='undefined'?window:globalThis);
