(function(root){
'use strict';

var types={internal:'Classroom / internal',external:'External course',online:'Online / e-learning',toolbox:'Toolbox talk',induction:'Induction',refresher:'Refresher'};
var statuses={planned:'Planned',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled',postponed:'Postponed',in_progress:'In progress'};
var priorities={low:'Low',medium:'Medium',high:'High',critical:'Critical'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view the training plan.');
  services.rbac.requireAccess('training');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view the training plan.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the training plan.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),status:String(input.status||'').slice(0,80),priority:String(input.priority||'').slice(0,40),attention:String(input.attention||'').slice(0,80)};}
function dateState(value,now){
  now=now||new Date();if(!value)return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var days=Math.ceil((due-today)/86400000);
  return {date:date.toISOString().slice(0,10),missing:false,expired:days<0,soon:days>=0&&days<=30,days:days,label:date.toISOString().slice(0,10)};
}
function label(map,value,fallback){var key=String(value||'').toLowerCase();return map[key]||String(value||fallback||'Not recorded').replace(/_/g,' ');}
function evidenceFor(row,records){
  var topic=String(row.training_topic||'').trim().toLowerCase(),actual=String(row.actual_date||'').slice(0,10);
  if(!topic)return {count:0,certificate:false};
  var matches=(Array.isArray(records)?records:[]).filter(function(record){
    if(!record)return false;
    var sameTopic=String(record.training_topic||'').trim().toLowerCase()===topic;
    var sameDate=!actual||String(record.training_date||'').slice(0,10)===actual;
    return sameTopic&&sameDate&&String(record.company_id||row.company_id||'')===String(row.company_id||'');
  });
  return {count:matches.length,certificate:matches.some(function(record){return !!(record.certificate||record.certificate_url||record.evidence_url);})};
}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase(),records=options.records;
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var type=String(row.training_type||'internal').toLowerCase(),status=String(row.status||'planned').toLowerCase(),priority=String(row.priority||'medium').toLowerCase(),planned=dateState(row.planned_date,now),actual=dateState(row.actual_date,now),evidence=evidenceFor(row,records),active=!['completed','cancelled'].includes(status),flags=[];
    if(active&&!row.planned_date)flags.push('planned_date_missing');
    if(active&&(status==='planned'||status==='confirmed')&&planned.expired)flags.push('planned_overdue');
    if(active&&planned.soon&&!planned.expired)flags.push('planned_due_soon');
    if(status==='completed'&&!row.actual_date)flags.push('actual_date_missing');
    if(status==='completed'&&!evidence.count)flags.push('evidence_missing');
    if(f.type&&type!==f.type.toLowerCase())return null;if(f.status&&status!==f.status.toLowerCase())return null;if(f.priority&&priority!==f.priority.toLowerCase())return null;
    if(f.attention&&!flags.includes(f.attention.toLowerCase()))return null;
    var title=row.training_topic||'Training plan item',hay=[row.training_topic,row.target_group,row.training_type,type,row.priority,priority,row.trainer,row.provider,row.location,row.objective,row.notes,row.status,status,row.planned_date,row.actual_date].join(' ').toLowerCase();if(search&&!hay.includes(search))return null;
    var attention=flags.includes('planned_overdue')?'Planned date overdue':flags.includes('evidence_missing')?'Evidence missing':flags.includes('actual_date_missing')?'Actual date missing':flags.includes('planned_date_missing')?'Planned date missing':flags.includes('planned_due_soon')?'Planned date due soon':'—';
    return {id:String(row.id),company_id:String(row.company_id),source_table:'training_plan',reference:row.training_ref||row.reference||'TRAIN-'+String(row.id).slice(0,8).toUpperCase(),title:title,month:row.month||'',target_group:row.target_group||'Not recorded',training_type:label(types,type,'Not recorded'),priority:label(priorities,priority,'Not recorded'),planned_date:planned.date,actual_date:actual.date,trainer:row.trainer||'Not recorded',provider:row.provider||row.training_provider||'Not recorded',location:row.location||'Not recorded',objective:row.objective||'',status:label(statuses,status,'Not recorded'),evidence:evidence.count?(evidence.count+' record'+(evidence.count===1?'':'s')):'Missing',evidence_records:evidence.count,certificate_evidence:evidence.certificate?'Certificate evidence':'',attention:attention,attention_flags:flags,days_to_planned:planned.days,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'planned_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'planned_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Training reference',required:true,groupable:false,action:'open'},{key:'title',label:'Training',required:true,groupable:false,action:'open'},{key:'month',label:'Month',groupable:false},{key:'target_group',label:'Target group'},{key:'training_type',label:'Type'},{key:'priority',label:'Priority',type:'badge',tones:{Low:'success',Medium:'info',High:'warning',Critical:'danger','Not recorded':'neutral'}},{key:'planned_date',label:'Planned date',type:'date',groupable:false,action:'edit'},{key:'actual_date',label:'Actual date',type:'date',groupable:false},{key:'trainer',label:'Trainer'},{key:'location',label:'Location'},{key:'evidence',label:'Evidence',type:'badge',groupable:false,tones:{Missing:'danger'}},{key:'status',label:'Status',type:'badge',tones:{Planned:'warning',Confirmed:'info',Completed:'success',Cancelled:'neutral',Postponed:'warning','In progress':'info','Not recorded':'neutral'}},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{'Planned date overdue':'danger','Evidence missing':'danger','Actual date missing':'warning','Planned date missing':'warning','Planned date due soon':'warning','—':'success'}},{key:'days_to_planned',label:'Days to planned',type:'number',groupable:false},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared training plan register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'training-plan',label:'Training Plan Register',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open training plan'},{key:'edit',label:'Edit training plan',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This training plan item is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the training plan.');var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This training plan action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisTrainingPlanListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState,evidenceFor:evidenceFor});
})(typeof window!=='undefined'?window:globalThis);
