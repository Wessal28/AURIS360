(function(root){
'use strict';

var categories={general:'General',electrical:'Electrical',mechanical:'Mechanical',civil:'Civil',construction:'Construction',cleaning:'Cleaning',security:'Security',it:'IT',catering:'Catering',other:'Other'};
var statuses={approved:'Approved',pending:'Pending',pre_assessed:'Pre-assessed',conditional:'Conditional',rejected:'Rejected',suspended:'Suspended',inactive:'Inactive',archived:'Archived'};
var terminal=['rejected','suspended','inactive','archived'];
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view contractors.');
  services.rbac.requireAccess('contractor');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view contractors.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the contractor register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),category:String(input.category||'').slice(0,80),status:String(input.status||'').slice(0,80),compliance:String(input.compliance||'').slice(0,80)};}
function dateState(value,now){
  now=now||new Date();if(!value)return {date:null,missing:true,expired:false,soon:false,label:'Not recorded'};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:null,missing:true,expired:false,soon:false,label:'Not recorded'};
  var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var soonDate=new Date(today);soonDate.setDate(soonDate.getDate()+60);
  return {date:date,missing:false,expired:due<today,soon:due>=today&&due<=soonDate,label:date.toISOString().slice(0,10)};
}
function categoryCode(row){return String(row&&row.category||'general').toLowerCase();}
function categoryLabel(row){var code=categoryCode(row);return categories[code]||String(row&&row.category||'General').replace(/_/g,' ');}
function statusCode(row){return String(row&&row.status||'pending').toLowerCase();}
function statusLabel(value){var code=String(value||'').toLowerCase();return statuses[code]||String(value||'Not recorded').replace(/_/g,' ');}
function attentionFor(row,now){
  var expiry=dateState(row&&row.expiry_date,now),insurance=dateState(row&&row.insurance_expiry,now),review=dateState(row&&row.next_review_date,now),status=statusCode(row);
  if(expiry.expired||insurance.expired)return 'Expired';
  if(review.expired)return 'Review overdue';
  if(expiry.soon||insurance.soon||review.soon)return 'Due soon';
  if(insurance.missing)return 'Missing insurance';
  if(terminal.indexOf(status)!==-1)return statusLabel(status);
  return '—';
}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var category=categoryCode(row),status=statusCode(row),categoryText=categoryLabel(row),statusText=statusLabel(status),expiry=dateState(row.expiry_date,now),insurance=dateState(row.insurance_expiry,now),review=dateState(row.next_review_date,now),attention=attentionFor(row,now);
    if(f.category&&category!==f.category.toLowerCase())return null;
    if(f.status&&status!==f.status.toLowerCase())return null;
    if(f.compliance&&!(f.compliance==='expired'&&(expiry.expired||insurance.expired)||f.compliance==='expiring'&&(expiry.soon||insurance.soon||review.soon)||f.compliance==='missing_insurance'&&insurance.missing||f.compliance==='review_due'&&(review.expired||review.soon)))return null;
    var hay=[row.contractor_name,row.trading_name,row.registration_number,row.contact_person,row.contact_email,row.contact_phone,row.specialisation,row.address,row.website,categoryText,statusText,attention].join(' ').toLowerCase();
    if(search&&!hay.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'contractors',reference:row.registration_number||('CON-'+String(row.id).slice(0,8).toUpperCase()),title:row.contractor_name||row.trading_name||'Unnamed contractor',trading_name:row.trading_name||'',category:categoryText,specialisation:row.specialisation||'',contact:row.contact_person||'',email:row.contact_email||'',phone:row.contact_phone||'',insurance_expiry:row.insurance_expiry||'',approval_expiry:row.expiry_date||'',review_date:row.next_review_date||'',attention:attention,status:statusText,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'review_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'review_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Reference',required:true,groupable:false,action:'open'},{key:'title',label:'Contractor',required:true,groupable:false,action:'open'},
  {key:'trading_name',label:'Trading name'},{key:'category',label:'Category'},{key:'specialisation',label:'Specialisation'},{key:'contact',label:'Contact person'},{key:'email',label:'Email',hidden:true},{key:'phone',label:'Phone',hidden:true},
  {key:'insurance_expiry',label:'Insurance expiry',type:'date',groupable:false},{key:'approval_expiry',label:'Approval expiry',type:'date',groupable:false},{key:'review_date',label:'Next review',type:'date',groupable:false},
  {key:'attention',label:'Attention',type:'badge',groupable:false,tones:{Expired:'danger','Review overdue':'danger','Due soon':'warning','Missing insurance':'warning',Rejected:'danger',Suspended:'danger',Inactive:'neutral',Archived:'neutral','—':'success'}},
  {key:'status',label:'Status',type:'badge',tones:{Approved:'success',Conditional:'warning',Pending:'warning','Pre-assessed':'info',Rejected:'danger',Suspended:'danger',Inactive:'neutral',Archived:'neutral','Not recorded':'neutral'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared contractor register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'contractor-management',label:'Contractor Management',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open contractor'},{key:'edit',label:'Edit contractor',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This contractor is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the contractor record.');var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This contractor action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisContractorListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState,attentionFor:attentionFor});
})(typeof window!=='undefined'?window:globalThis);
