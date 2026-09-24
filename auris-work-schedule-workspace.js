/* Keep authenticated record navigation behind one loading screen. */
var wsWindowLoadingTimer;
function wsFinishWindowLoading(){
  document.documentElement.classList.remove('ws-window-loading');
  clearTimeout(wsWindowLoadingTimer);
}
if(typeof location!=='undefined'&&typeof document!=='undefined'&&new URLSearchParams(location.search).has('wsMode')){
  document.documentElement.classList.add('ws-window-loading');
  // Fail open to the normal sign-in/error UI if startup cannot finish.
  wsWindowLoadingTimer=setTimeout(wsFinishWindowLoading,30000);
}
/* Work Schedule register and read-only record windows. */
(function(root){
'use strict';
var statuses={planned:'Planned',approved:'Approved',in_progress:'In progress',on_hold:'On hold',completed:'Completed',cancelled:'Cancelled'};
function label(value){return String(value||'Not recorded').replace(/_/g,' ').replace(/^./,function(c){return c.toUpperCase();});}
function session(){
  var s=root.AurisPlatformServices;
  if(!s||!s.ready(['auth','rbac'])||!s.auth.isAuthenticated())throw Error('Sign in and select a company to open work orders.');
  s.rbac.requireAccess('workschedule');
  var user=s.auth.current(),profile=user.profile||{},company=user.company&&user.company.id||profile.company_id;
  if(!company||!profile.id)throw Error('Select a company to open work orders.');
  return {companyId:String(company),userId:String(profile.id),role:String(user.role||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw Error('Account, company or access changed. Reopen the work order.');return current;}
function filters(value){value=value||{};return {search:String(value.search||'').slice(0,300),status:String(value.status||'').slice(0,80),priority:String(value.priority||'').slice(0,80)};}
function dateKey(value){var match=String(value||'').match(/^\d{4}-\d{2}-\d{2}/);return match?match[0]:'';}
function localDay(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
function overdue(row,now){return ['planned','approved','in_progress'].includes(row.status)&&!!dateKey(row.planned_end)&&dateKey(row.planned_end)<localDay(now||new Date());}
function onDay(row,day){var start=dateKey(row.planned_start),end=dateKey(row.planned_end)||start;return !!start&&day>=start&&day<=end;}
function project(rows,current,options,now){
  var f=filters(options&&options.filters),search=f.search.toLowerCase();
  return (rows||[]).filter(function(row){return row&&row.id&&String(row.company_id||'')===current.companyId;}).filter(function(row){
    return (!f.status||row.status===f.status)&&(!f.priority||row.priority===f.priority)&&(!search||[row.ref_number,row.title,row.location,row.supervisor_name,row.team_members,row.department,row.work_type].join(' ').toLowerCase().includes(search));
  }).map(function(row){return {id:String(row.id),company_id:String(row.company_id),reference:row.ref_number||'Draft',title:row.title||'Untitled work order',location:row.location||'Not recorded',supervisor:row.supervisor_name||'Not assigned',department:row.department||'Not recorded',type:label(row.work_type),planned_start:dateKey(row.planned_start),planned_end:dateKey(row.planned_end),priority:label(row.priority),risk:label(row.risk_level),status:statuses[row.status]||label(row.status),timing:overdue(row,now)?'Overdue':'—',updated_at:row.updated_at||row.created_at||''};});
}
function definition(){return {rowKey:'id',views:['list','card','board'],defaultView:'list',defaultSort:'planned_start',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'planned_start',activityField:'updated_at',fields:[
  {key:'reference',label:'Reference',required:true,groupable:false,action:'view'},{key:'title',label:'Work order',required:true,groupable:false,action:'view'},
  {key:'location',label:'Location'},{key:'supervisor',label:'Supervisor'},{key:'planned_start',label:'Planned start',type:'date',groupable:false},{key:'planned_end',label:'Planned end',type:'date',groupable:false},
  {key:'priority',label:'Priority',type:'badge',tones:{Critical:'danger',High:'warning',Medium:'info',Low:'neutral'}},{key:'risk',label:'Risk'},
  {key:'status',label:'Status',type:'badge',tones:{Planned:'info',Approved:'info','In progress':'warning',Completed:'success','On hold':'warning',Cancelled:'neutral'}},
  {key:'timing',label:'Timing',type:'badge',tones:{Overdue:'danger'}},{key:'department',label:'Department',hidden:true},{key:'type',label:'Work type',hidden:true},{key:'updated_at',label:'Updated',type:'datetime',hidden:true,groupable:false}
]};}
function href(id,mode,company,linked){
  var url=new URL(deepLinkRecordUrl({module:'workschedule',id:id,table:'work_schedule',company_id:company||ccid()}));
  url.searchParams.set('wsMode',['edit','manage'].includes(mode)?mode:'view');
  if(linked){url.searchParams.set('wsLinkedKind',linked.kind);url.searchParams.set('wsLinkedValue',linked.value);}
  return url.toString();
}
function mount(host,rows,options){
  options=options||{};var current=session(),data=project(rows,current,options);
  return root.AurisViewEngine.mount(host,data,{moduleKey:'work-schedule',label:'Work Schedule',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),
    actions:['view','edit','manage'].map(function(key){return {key:key,label:{view:'View',edit:'Edit',manage:'Manage work'}[key],when:function(){return key==='view'||options.canEdit===true;}};}),
    onAction:async function(key,row){assertSession(current);await wsRecordWindow(row.id,key);},
    onApplyFilters:function(value){assertSession(current);options.onApplyFilters(filters(value));}
  });
}
root.AurisWorkScheduleWorkspace=Object.freeze({mount:mount,project:project,definition:definition,filters:filters,session:session,assertSession:assertSession,href:href,overdue:overdue,onDay:onDay,localDay:localDay});
})(typeof window!=='undefined'?window:globalThis);

var wsOpeningLinkedRecord=false,wsEditContext=null;
function wsMaySave(){
  try{if(!isMgr()||!wsEditContext)throw Error('Reopen the work order with manager access before saving.');AurisWorkScheduleWorkspace.assertSession(wsEditContext);return true;}
  catch(e){toast(e.message,false);return false;}
}
async function wsRecordWindow(id,mode){
  try{
    var current=AurisWorkScheduleWorkspace.session();
    return await wsOpenRecordRequest({record:id,table:'work_schedule',company:current.companyId,mode:mode||'view'});
  }catch(e){toast(e.message,false);return false;}
}
var WS_RECORD_LINKS={tbt:{label:'Toolbox talk',module:'meetings',table:'toolbox_talks',ref:'tbt_ref'},prestart:{label:'Pre-start check',module:'inspection',table:'inspections',ref:'reference_no'},site:{label:'Site inspection',module:'inspection',table:'inspections',ref:'reference_no'},ra:{label:'Risk assessment',module:'risk',table:'risk_assessments',ref:'ra_ref'},ptw:{label:'Permit to work',module:'permit',table:'permits',ref:'permit_number'},event:{label:'Incident / hazard',module:'events',table:'events',ref:'event_ref'},equipment:{label:'Equipment',module:'tools',table:'tools_register',ref:'ref_number'}};
function wsRecordLinks(row,extra){
  var links=[];
  function add(kind,value,ref){if(!WS_RECORD_LINKS[kind]||!value)return;if(!links.some(function(link){return link.kind===kind&&(link.value===String(value)||ref&&link.ref===ref);}))links.push({kind:kind,value:String(value),ref:ref||(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value))?'Reference unavailable':String(value))});}
  (extra||[]).forEach(function(link){add(link.link_type,link.record_id||link.record_ref,link.record_ref);});
  add('tbt',row.toolbox_talk_id);add('prestart',row.prestart_id);add('site',row.site_inspection_id);add('ra',row.risk_assessment_id||row.ra_ref,row.ra_ref);add('ptw',row.permit_id||row.permit_ref,row.permit_ref);add('event',row.linked_event_ref);
  return links;
}
async function wsReadRecordLinks(row,current){
  var warning='',extra=[];
  try{extra=await api('/work_schedule_links?select=*&company_id=eq.'+encodeURIComponent(current.companyId)+'&work_order_id=eq.'+encodeURIComponent(row.id));}
  catch(e){warning='Additional linked records could not be loaded. Direct work-order links are shown. Reload to retry.';}
  AurisWorkScheduleWorkspace.assertSession(current);
  extra=(extra||[]).filter(function(link){return String(link.company_id)===current.companyId&&String(link.work_order_id)===String(row.id);});
  var reverse=await Promise.allSettled(['ra','ptw','tbt'].map(function(kind){var info=WS_RECORD_LINKS[kind],field=kind==='tbt'?'work_schedule_id':'work_order_id';return api('/'+info.table+'?select=id,company_id,'+field+','+info.ref+'&company_id=eq.'+encodeURIComponent(current.companyId)+'&'+field+'=eq.'+encodeURIComponent(row.id));}));
  AurisWorkScheduleWorkspace.assertSession(current);
  reverse.forEach(function(result,index){var kind=['ra','ptw','tbt'][index],info=WS_RECORD_LINKS[kind],field=kind==='tbt'?'work_schedule_id':'work_order_id';if(result.status==='rejected'){warning='Some linked records could not be loaded. Reload to retry.';return;}(result.value||[]).forEach(function(record){if(String(record.company_id)===current.companyId&&String(record[field])===String(row.id))extra.push({link_type:kind,record_id:record.id,record_ref:record[info.ref]});});});
  // Standalone talks store their work-order link in notes rather than work_schedule_id.
  try{
    var markerRows=await api('/toolbox_talks?select=id,company_id,tbt_ref,notes&company_id=eq.'+encodeURIComponent(current.companyId)+'&notes=ilike.*'+encodeURIComponent(String(row.id))+'*');
    AurisWorkScheduleWorkspace.assertSession(current);
    (markerRows||[]).forEach(function(talk){
      if(String(talk.company_id)!==current.companyId)return;
      var marker=String(talk.notes||'').match(/\[AURIS360_LINKED_WORK:({[^\]]+})\]/);
      if(!marker)return;
      try{if(String(JSON.parse(marker[1]).id)===String(row.id))extra.push({link_type:'tbt',record_id:talk.id,record_ref:talk.tbt_ref});}catch(_){}
    });
  }catch(error){warning=warning||'Some linked talks could not be loaded. Reload to retry.';}
  var links=wsRecordLinks(row,extra);
  await Promise.all(links.map(async function(link){
    var info=WS_RECORD_LINKS[link.kind];
    if(link.ref!=='Reference unavailable'||!canAccessPage(info.module))return;
    try{
      var records=await api('/'+info.table+'?select=*&company_id=eq.'+encodeURIComponent(current.companyId)+'&id=eq.'+encodeURIComponent(link.value)+'&limit=1');
      AurisWorkScheduleWorkspace.assertSession(current);
      var record=(records||[]).find(function(item){return String(item.id)===link.value&&String(item.company_id)===current.companyId;});
      if(record&&canAccessPage(info.module))link.ref=record[info.ref]||record.ref_number||record.reference_no||'Reference unavailable';
    }catch(e){/* Keep the exact link usable even when reference lookup fails. */}
  }));
  AurisWorkScheduleWorkspace.assertSession(current);
  return {links:links,warning:warning};
}
function wsRecordFields(row,fields){
  return '<dl class="ws-record-fields">'+fields.map(function(field){var value=row[field[0]];if(typeof value==='boolean')value=value?'Yes':'No';if(Array.isArray(value))value=value.map(function(item){return typeof item==='object'?JSON.stringify(item):item;}).join(', ');if(value&&typeof value==='object')value=JSON.stringify(value);return '<div><dt>'+escH(field[1])+'</dt><dd>'+escH(value==null||value===''?'Not recorded':String(value))+'</dd></div>';}).join('')+'</dl>';
}
function wsReadOnlyHtml(row){
  return '<section><h3>Work details</h3>'+wsRecordFields(row,[['description','Description'],['location','Location'],['department','Department'],['work_type','Work type'],['notes','Notes']])+'</section><section><h3>Schedule & people</h3>'+wsRecordFields(row,[['planned_start','Planned start'],['planned_end','Planned end'],['estimated_duration','Estimated duration'],['supervisor_name','Supervisor'],['team_members','Team members']])+'</section><section><h3>Readiness</h3>'+wsRecordFields(row,[['status','Status'],['priority','Priority'],['risk_level','Risk level'],['requires_ra','Risk assessment required'],['requires_permit','Permit required']])+'</section>';
}
function wsLinkedRecordHtml(linked){
  var row=linked.row,info=linked.info;
  if(info.table==='inspections')return auditInspectionReportHTML(row);
  if(info.table==='toolbox_talks'){
    var display=Object.assign({},row,{presenter:row.presenter||row.conducted_by_name||row.facilitator,duration:row.duration_mins||row.duration_min,topics:row.key_points||row.topic});
    var html='<section><h3>Toolbox talk</h3>'+wsRecordFields(display,[['tbt_ref','Reference'],['title','Title'],['talk_date','Date'],['location','Location'],['presenter','Presenter'],['duration','Duration (minutes)']])+'</section><section><h3>Briefing</h3>'+wsRecordFields(display,[['topics','Topics discussed'],['hazards_discussed','Hazards'],['controls_discussed','Control measures'],['ppe_required','PPE required'],['emergency_procedures','Emergency procedures']])+'</section><section><h3>Attendance</h3>';
    var attendees=Array.isArray(row.attendees)?row.attendees:[];
    html+=attendees.length?'<div class="ws-linked-table"><table><thead><tr><th>Name</th><th>Department</th><th>Confirmation</th></tr></thead><tbody>'+attendees.map(function(a){return '<tr><td>'+escH(a.name||a.full_name||a.person_name||'Name not recorded')+'</td><td>'+escH(a.department||a.dept||'—')+'</td><td>'+(a.signed===true?'Confirmed':a.signed===false?'Not confirmed':'Not recorded')+'</td></tr>';}).join('')+'</tbody></table></div>':'<p>No attendance recorded.</p>';
    return html+'</section>';
  }
  var fields=info.table==='tools_register'?[['ref_number','Reference'],['name','Equipment'],['category','Category'],['status','Status'],['serial_number','Serial number']]:info.table==='permits'?[['permit_number','Permit number'],['title','Title'],['permit_type','Permit type'],['location','Location'],['status','Status'],['description','Description']]:info.table==='risk_assessments'?[['ra_ref','Reference'],['title','Title'],['activity','Activity'],['location','Location'],['status','Status']]:[['event_ref','Reference'],['title','Title'],['event_date','Event date'],['location','Location'],['description','Description'],['status','Status']];
  return '<section><h3>'+escH(info.label)+'</h3>'+wsRecordFields(row,fields)+'</section>';
}
function wsRelatedRecordsHtml(data,linked){
  var links=data.links||[];
  return '<section class="ws-related-records"><h3>Related HSE records</h3><p>Double-click a record to open it. Keyboard: focus a row and press Enter.</p>'+(data.warning?'<p role="alert">'+escH(data.warning)+'</p>':'')+(links.length?'<div class="ws-linked-table"><table><thead><tr><th>Record type</th><th>Reference</th><th>Viewing</th></tr></thead><tbody>'+links.map(function(link,index){var active=linked&&linked.info===WS_RECORD_LINKS[link.kind]&&String(linked.row.id)===link.value;return '<tr tabindex="0" data-ws-related="'+index+'" aria-label="'+escH(WS_RECORD_LINKS[link.kind].label+' '+link.ref)+'"'+(active?' class="ws-related-active"':'')+'><td>'+escH(WS_RECORD_LINKS[link.kind].label)+'</td><td>'+escH(link.ref)+'</td><td>'+(active?'Current record':'')+'</td></tr>';}).join('')+'</tbody></table></div>':'<p>No HSE records linked.</p>')+'</section>';
}
function wsShowReadOnly(row,current,linkData,linked){
  document.getElementById('ws-record-view')?.remove();
  var host=document.createElement('div');host.id='ws-record-view';host.className='ws-record-overlay';
  var title=linked?linked.row.title||linked.row.activity||linked.row.permit_number||linked.info.label:row.title||'Work order';
  var content=linked?wsLinkedRecordHtml(linked):wsReadOnlyHtml(row);
  host.innerHTML='<section class="ws-record-window" role="dialog" aria-modal="true" aria-labelledby="ws-record-title"><header><div><p>Work Schedule · Read only</p><h2 id="ws-record-title">'+escH(title)+'</h2><p>'+escH(linked?(linked.row[linked.info.ref]||'Reference unavailable'):(row.ref_number||'Draft'))+'</p></div>'+(linked?'<button class="btn" data-ws-back>Back to work order</button>':'')+'<button class="btn" data-ws-close>Close</button></header><nav aria-label="Work order actions">'+(!linked&&isMgr()?'<a class="btn" target="_blank" rel="noopener" href="'+escH(AurisWorkScheduleWorkspace.href(row.id,'edit',current.companyId))+'">Edit work order</a><a class="btn btn-primary" target="_blank" rel="noopener" href="'+escH(AurisWorkScheduleWorkspace.href(row.id,'manage',current.companyId))+'">Manage work & HSE checks</a>':'')+'</nav>'+(!linked&&isMgr()?'<nav class="ws-create-actions" aria-label="Create related records">'+[['tbt','Toolbox talk','meetings'],['prestart','Pre-start check','inspection'],['site','Site inspection','inspection'],['tools','Tools and equipment','tools'],['ra','Risk assessment','risk'],['ptw','Permit to work','permit']].filter(function(action){return canAccessPage(action[2]);}).map(function(action){return '<button type="button" class="btn" data-ws-create="'+action[0]+'">'+action[1]+'</button>';}).join('')+'</nav>':'')+'<div class="ws-record-content">'+content+wsRelatedRecordsHtml(linkData,linked)+'</div></section>';
  document.getElementById('page-workschedule').appendChild(host);
  var openingRelated=false;
  async function openRelated(event){
    var item=event.target.closest('[data-ws-related]');if(!item||openingRelated)return;
    event.preventDefault();var selected=linkData.links[Number(item.getAttribute('data-ws-related'))];if(!selected)return;
    openingRelated=true;
    try{AurisWorkScheduleWorkspace.assertSession(current);await wsOpenRecordRequest({record:row.id,company:current.companyId,mode:'view',linked:selected});}catch(e){toast(e.message,false);}finally{openingRelated=false;}
  }
  host.addEventListener('click',async function(event){
    var button=event.target.closest('[data-ws-create]');if(!button)return;
    button.disabled=true;
    try{
      AurisWorkScheduleWorkspace.assertSession(current);
      var action=button.dataset.wsCreate;
      if(!isMgr()||!canAccessPage(({tbt:'meetings',prestart:'inspection',site:'inspection',tools:'tools',ra:'risk',ptw:'permit'})[action]))throw Error('Access to this form changed.');
      await wsOpenRecordRequest({record:row.id,company:current.companyId,mode:'manage'});
      if(action==='tbt')wsOpenToolboxTalk();else if(action==='prestart')wsOpenPreStart();else if(action==='site')wsOpenSiteInspection();
      else if(action==='tools')await wsOpenToolsCheck();else if(action==='ra')await wsOpenRA();else if(action==='ptw')await wsOpenPTW();
    }catch(error){toast(error.message,false);}finally{button.disabled=false;}
  });
  host.addEventListener('dblclick',openRelated);
  host.addEventListener('keydown',function(event){if(event.key==='Enter')openRelated(event);});
  var back=host.querySelector('[data-ws-back]');
  if(back)back.addEventListener('click',async function(){back.disabled=true;try{AurisWorkScheduleWorkspace.assertSession(current);await wsOpenRecordRequest({record:row.id,company:current.companyId,mode:'view'});}catch(e){toast(e.message,false);}finally{back.disabled=false;}});
  host.querySelector('[data-ws-close]').addEventListener('click',function(){host.remove();});
  host.addEventListener('keydown',function(event){if(event.key==='Escape')host.remove();if(event.key==='Tab'){var items=Array.from(host.querySelectorAll('button,a[href],[data-ws-related]')),first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  host.addEventListener('click',async function(event){var anchor=event.target.closest('a');if(!anchor)return;event.preventDefault();try{AurisWorkScheduleWorkspace.assertSession(current);var params=new URL(anchor.href).searchParams;await wsOpenRecordRequest({record:row.id,company:current.companyId,mode:params.get('wsMode')||'view',linked:params.has('wsLinkedKind')?{kind:params.get('wsLinkedKind'),value:params.get('wsLinkedValue')}:null});}catch(e){event.preventDefault();host.remove();toast(e.message,false);}},true);
  host.querySelector('button').focus();
}
async function wsOpenRecordRequest(req){
  var current=AurisWorkScheduleWorkspace.session();
  if(req.table&&req.table!=='work_schedule')throw Error('Unsupported work-order record.');
  if(req.company&&String(req.company)!==current.companyId)throw Error('Select the company that owns this work order.');
  var rows=await api('/work_schedule?select=*&id=eq.'+encodeURIComponent(req.record)+'&company_id=eq.'+encodeURIComponent(current.companyId));
  AurisWorkScheduleWorkspace.assertSession(current);
  var row=(rows||[]).find(function(item){return String(item.id)===String(req.record)&&String(item.company_id)===current.companyId;});
  if(!row)return false;
  var query=new URLSearchParams(location.search),mode=req.mode||query.get('wsMode')||'view';
  wsAllData=wsAllData.filter(function(item){return String(item.company_id)===current.companyId&&String(item.id)!==String(row.id);});wsAllData.push(row);wsCurrentId=row.id;
  if(mode==='edit'||mode==='manage'){
    if(!isMgr())throw Error('Manager access is required to change work orders.');
    document.getElementById('ws-record-view')?.remove();
    wsOpeningLinkedRecord=true;
    try{if(mode==='edit')await wsEdit(row.id);else await wsShowDetail(row.id);}finally{wsOpeningLinkedRecord=false;}
    return true;
  }
  var data=await wsReadRecordLinks(row,current),kind=req.mode?(req.linked&&req.linked.kind):query.get('wsLinkedKind'),linked=null;
  if(kind){
    var selected=data.links.find(function(link){return link.kind===kind&&link.value===(req.linked?req.linked.value:query.get('wsLinkedValue'));});
    if(!selected)throw Error('This record is no longer linked to the work order.');
    var info=WS_RECORD_LINKS[kind];if(!canAccessPage(info.module))throw Error('Access to the linked module is required.');
    var field=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected.value)?'id':info.ref;
    var records=await api('/'+info.table+'?select=*&company_id=eq.'+encodeURIComponent(current.companyId)+'&'+field+'=eq.'+wsRestEqValue(selected.value)+'&limit=1');
    AurisWorkScheduleWorkspace.assertSession(current);
    if(!canAccessPage(info.module))throw Error('Access to the linked module changed.');
    if(!records||!records[0]||String(records[0].company_id)!==current.companyId||String(records[0][field])!==selected.value)throw Error('Linked record not found or access denied.');
    linked={info:info,row:records[0]};
  }
  wsShowReadOnly(row,current,data,linked);return true;
}
