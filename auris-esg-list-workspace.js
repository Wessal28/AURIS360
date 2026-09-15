(function(root){
'use strict';

var types={routine:'Routine',regulatory:'Regulatory',audit:'Audit',follow_up:'Follow-up'};
var ratings={excellent:'Excellent',good:'Good',satisfactory:'Satisfactory',poor:'Poor',unacceptable:'Unacceptable'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view environmental inspections.');
  services.rbac.requireAccess('esg');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view environmental inspections.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the environmental inspection register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),rating:String(input.rating||'').slice(0,80),attention:String(input.attention||'').slice(0,80),signed:String(input.signed||'').slice(0,20)};}
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
    var type=String(row.inspection_type||'routine').toLowerCase(),rating=String(row.overall_rating||'satisfactory').toLowerCase(),next=dateState(row.next_inspection_date,now),inspection=dateState(row.inspection_date,now),nc=Number(row.non_conformances||0),signed=row.signed_off===true;
    if(f.type&&type!==f.type.toLowerCase())return null;if(f.rating&&rating!==f.rating.toLowerCase())return null;if(f.signed==='true'&&!signed)return null;if(f.signed==='false'&&signed)return null;
    var flags=[];if(rating==='poor'||rating==='unacceptable')flags.push('rating_risk');if(nc>0)flags.push('open_non_conformance');if(next.expired)flags.push('next_overdue');else if(next.soon)flags.push('next_due_soon');else if(next.missing)flags.push('next_missing');if(!signed)flags.push('signoff_pending');
    if(f.attention&&!flags.includes(f.attention.toLowerCase()))return null;
    var title=row.area||'Environmental inspection',hay=[row.inspector,row.area,row.inspection_type,type,row.overall_rating,rating,row.findings,row.corrective_actions,row.notes,row.inspection_date,row.next_inspection_date,signed?'signed':'pending'].join(' ').toLowerCase();if(search&&!hay.includes(search))return null;
    var attention=flags.includes('rating_risk')?'Rating risk':flags.includes('open_non_conformance')?'Open non-conformance':flags.includes('next_overdue')?'Next inspection overdue':flags.includes('next_due_soon')?'Next inspection due soon':flags.includes('next_missing')?'Next inspection missing':flags.includes('signoff_pending')?'Sign-off pending':'—';
    return {id:String(row.id),company_id:String(row.company_id),source_table:'environmental_inspections',reference:'ENV-'+String(row.id).slice(0,8).toUpperCase(),title:title,inspection_date:inspection.date,inspector:row.inspector||'Not recorded',area:title,type:label(types,type,'Not recorded'),rating:label(ratings,rating,'Not recorded'),non_conformances:nc,findings:row.findings||'',corrective_actions:row.corrective_actions||'',next_inspection_date:next.date,next_inspection:next.expired?'Overdue':next.soon?'Due soon':next.missing?'Not scheduled':'Current',days_to_next:next.days,signed_off:signed?'Signed off':'Pending',attention:attention,attention_flags:flags,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'next_inspection_date',titleField:'title',subtitleField:'reference',groupField:'rating',dateField:'next_inspection_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Inspection reference',required:true,groupable:false,action:'open'},{key:'title',label:'Area',required:true,groupable:false,action:'open'},{key:'inspection_date',label:'Inspection date',type:'date',groupable:false},{key:'inspector',label:'Inspector'},{key:'type',label:'Inspection type'},{key:'rating',label:'Rating',type:'badge',tones:{Excellent:'success',Good:'success',Satisfactory:'neutral',Poor:'warning',Unacceptable:'danger','Not recorded':'neutral'}},{key:'non_conformances',label:'Non-conformances',type:'number',groupable:false},{key:'next_inspection_date',label:'Next inspection',type:'date',groupable:false,action:'edit'},{key:'next_inspection',label:'Next state',type:'badge',groupable:false,tones:{Current:'success','Due soon':'warning',Overdue:'danger','Not scheduled':'warning'}},{key:'days_to_next',label:'Days to next',type:'number',groupable:false},{key:'signed_off',label:'Sign-off',type:'badge',groupable:false,tones:{'Signed off':'success',Pending:'warning'}},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{'Rating risk':'danger','Open non-conformance':'danger','Next inspection overdue':'danger','Next inspection due soon':'warning','Next inspection missing':'warning','Sign-off pending':'warning','—':'success'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared environmental inspection register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'environmental-inspections',label:'Environmental Inspection Register',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open inspection'},{key:'edit',label:'Edit inspection',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This environmental inspection is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the environmental inspection.');var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This environmental inspection action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisEsgListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState});
})(typeof window!=='undefined'?window:globalThis);
