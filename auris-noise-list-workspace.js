(function(root){
'use strict';

var types={occupational:'Occupational',environmental:'Environmental'};
var hpeLabels={adequate:'Adequate',inadequate:'Not adequate',review:'Review',missing:'Missing data'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view noise surveys.');
  services.rbac.requireAccess('noise');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view noise surveys.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the noise survey register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),hpe:String(input.hpe||'').slice(0,80),attention:String(input.attention||'').slice(0,80),calibration:String(input.calibration||'').slice(0,20)};}
function safeJson(value,fallback){if(Array.isArray(value))return value;try{var parsed=JSON.parse(value||'');return Array.isArray(parsed)?parsed:fallback;}catch(_){return fallback;}}
function dateState(value,now){
  now=now||new Date();if(!value)return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not recorded'};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not recorded'};
  var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var days=Math.ceil((due-today)/86400000);
  return {date:date.toISOString().slice(0,10),missing:false,expired:days<0,soon:days>=0&&days<=30,days:days,label:date.toISOString().slice(0,10)};
}
function calibrationState(value,now){
  if(!value)return {date:'',missing:true,expired:false,soon:false,days:null};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,days:null};
  var due=new Date(date);due.setFullYear(due.getFullYear()+1);return dateState(due,now);
}
function lex8h(leq,duration){var level=Number(leq),hours=Number(duration||8);if(!Number.isFinite(level)||!Number.isFinite(hours)||hours<=0)return null;return level+10*Math.log10(hours/8);}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId&&!/\[Archived/i.test(String(row.notes||''));}).map(function(row){
    var type=String(row.survey_type||'occupational').toLowerCase(),survey=dateState(row.survey_date,now),calibration=calibrationState(row.calibration_date,now),points=safeJson(row.measurements,[]),assessments=safeJson(row.hpe_assessment,[]),maxLeq=0,maxLex=0;
    points.forEach(function(point){var leq=Number(point&&point.leq);if(Number.isFinite(leq)){maxLeq=Math.max(maxLeq,leq);var lex=lex8h(leq,point.duration);if(lex!=null)maxLex=Math.max(maxLex,lex);}});
    var inadequate=assessments.filter(function(item){return String(item&&item.result||'').toLowerCase()==='inadequate';}).length,review=assessments.filter(function(item){return String(item&&item.result||'').toLowerCase()==='review';}).length;
    var hpe=assessments.length?(inadequate?'inadequate':review?'review':assessments.some(function(item){return String(item&&item.result||'').toLowerCase()==='missing';})?'missing':'adequate'):'missing';
    if(f.type&&type!==f.type.toLowerCase())return null;if(f.hpe&&hpe!==f.hpe.toLowerCase())return null;if(f.calibration==='missing'&&!calibration.missing)return null;if(f.calibration==='overdue'&&!calibration.expired)return null;if(f.calibration==='due_soon'&&!calibration.soon)return null;
    var flags=[];if(maxLeq>=85||maxLex>=85)flags.push('exposure_high');if(inadequate)flags.push('hpe_inadequate');else if(review)flags.push('hpe_review');if(calibration.expired)flags.push('calibration_overdue');else if(calibration.soon)flags.push('calibration_due_soon');if(!points.length)flags.push('measurements_missing');if(!assessments.length)flags.push('hpe_missing');
    if(f.attention&&!flags.includes(f.attention.toLowerCase()))return null;
    var title=row.site||'Noise survey',hay=[row.survey_ref,row.site,row.survey_type,type,row.conducted_by,row.instrument_used,row.weather_conditions,row.notes,points.map(function(p){return p&&p.loc+' '+p.source;}).join(' '),hpe].join(' ').toLowerCase();if(search&&!hay.includes(search))return null;
    var attention=flags.includes('hpe_inadequate')?'HPE not adequate':flags.includes('exposure_high')?'High exposure':flags.includes('calibration_overdue')?'Calibration overdue':flags.includes('hpe_review')?'HPE review':flags.includes('calibration_due_soon')?'Calibration due soon':flags.includes('measurements_missing')?'Measurements missing':flags.includes('hpe_missing')?'HPE not assessed':'—';
    return {id:String(row.id),company_id:String(row.company_id),source_table:'noise_surveys',reference:row.survey_ref||String(row.id).slice(0,8).toUpperCase(),title:title,type:types[type]||type,site:title,survey_date:survey.date,conducted_by:row.conducted_by||'Not recorded',instrument:row.instrument_used||'Not recorded',calibration_date:row.calibration_date||'',calibration:calibration.missing?'Not recorded':calibration.expired?'Overdue':calibration.soon?'Due soon':'Current',measurements:points.length,max_leq:maxLeq||'',max_lex8h:maxLex||'',hpe:hpeLabels[hpe]||hpe,layout:row.layout_image||row.layout_url?'Plan saved':'No plan',attention:attention,attention_flags:flags,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'survey_date',titleField:'title',subtitleField:'reference',groupField:'type',dateField:'survey_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Survey reference',required:true,groupable:false,action:'open'},{key:'title',label:'Site / area',required:true,groupable:false,action:'open'},{key:'type',label:'Survey type'},{key:'survey_date',label:'Survey date',type:'date',groupable:false},{key:'conducted_by',label:'Conducted by'},{key:'instrument',label:'Instrument',hidden:true},{key:'calibration_date',label:'Calibration date',type:'date',groupable:false},{key:'calibration',label:'Calibration',type:'badge',groupable:false,tones:{Current:'success','Due soon':'warning',Overdue:'danger','Not recorded':'warning'}},{key:'measurements',label:'Points',type:'number',groupable:false},{key:'max_leq',label:'Max Leq',type:'number',groupable:false},{key:'max_lex8h',label:'Max LEX,8h',type:'number',groupable:false},{key:'hpe',label:'HPE adequacy',type:'badge',groupable:false,tones:{Adequate:'success','Not adequate':'danger',Review:'warning','Missing data':'warning'}},{key:'layout',label:'Layout'},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{'HPE not adequate':'danger','High exposure':'danger','Calibration overdue':'danger','HPE review':'warning','Calibration due soon':'warning','Measurements missing':'warning','HPE not assessed':'warning','—':'success'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared noise survey register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'noise-surveys',label:'Noise Survey Register',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open survey'},{key:'print',label:'Print survey'},{key:'edit',label:'Edit survey',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This noise survey is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the noise survey.');var callback=key==='open'?options.openRecord:key==='print'?options.printRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This noise survey action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisNoiseListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState,calibrationState:calibrationState,lex8h:lex8h});
})(typeof window!=='undefined'?window:globalThis);
