/* Equipment presentation uses authenticated, company-scoped reads only. */
var toolsOpeningLinkedRecord=false,toolsRecordEditContext=null;
function toolsRecordHref(id,mode){
  var url=new URL(deepLinkRecordUrl({module:'tools',id:id,table:'tools_register',company_id:ccid()}));
  url.searchParams.set('equipmentMode',mode==='edit'?'edit':'view');return url.toString();
}
function toolsRecordWindow(id,mode){
  AurisToolsListWorkspace.session();
  if(mode==='edit'&&!isMgr())throw Error('Manager access is required to edit equipment.');
  var child=window.open(toolsRecordHref(id,mode),'_blank');
  if(child)child.opener=null;else toast('Allow popups to open the equipment in a separate window.',false);
}
function toolsEvidenceHref(value){
  try{var url=new URL(String(value||''));return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch(_){return '';}
}
function toolsRecordFields(row,fields){
  return '<dl class="equipment-fields">'+fields.map(function(pair){var value=row[pair[0]];return '<div><dt>'+escH(pair[1])+'</dt><dd>'+escH(value===true?'Yes':value===false?'No':value==null||value===''?'Not recorded':String(value).replace(/_/g,' '))+'</dd></div>';}).join('')+'</dl>';
}
var TOOLS_RECORD_HISTORY=[
  {table:'tool_inspections',key:'tool_id',title:'Inspections',order:'inspection_date',fields:[['inspection_date','Date'],['inspection_type','Type'],['inspected_by_name','Inspector'],['overall_result','Result'],['status','Record status']]},
  {table:'equipment_assurance_records',key:'equipment_id',title:'Certificates & assurance',order:'performed_date',fields:[['performed_date','Performed'],['record_type','Type'],['reference','Reference'],['provider','Provider'],['result','Result'],['expiry_date','Expiry'],['release_status','Release'],['evidence_reference','Evidence']]},
  {table:'equipment_movements',key:'equipment_id',title:'Issue & return history',order:'created_at',fields:[['movement_type','Movement'],['holder_name','Holder'],['issued_at','Issued'],['returned_at','Returned'],['expected_return_at','Return due'],['status','Status']]},
  {table:'equipment_maintenance_events',key:'equipment_id',title:'Maintenance & release',order:'created_at',fields:[['reference','Reference'],['maintenance_type','Type'],['completed_date','Completed'],['work_performed','Work performed'],['status','Status'],['release_status','Release'],['evidence_reference','Evidence']]},
  {table:'equipment_defects',key:'equipment_id',title:'Defects & quarantine',order:'created_at',fields:[['reference','Reference'],['description','Description'],['severity','Severity'],['status','Status']]}
];
async function toolsReadHistory(row,current){
  return Promise.all(TOOLS_RECORD_HISTORY.map(async function(info){
    try{
      var rows=await api('/'+info.table+'?select=*&'+info.key+'=eq.'+encodeURIComponent(row.id)+'&company_id=eq.'+encodeURIComponent(current.companyId)+'&order='+info.order+'.desc&limit=201');
      AurisToolsListWorkspace.assertSession(current);
      rows=(rows||[]).filter(function(item){return String(item.company_id)===current.companyId&&String(item[info.key])===String(row.id);});
      return {info:info,rows:rows.slice(0,200),limited:rows.length>200};
    }catch(error){AurisToolsListWorkspace.assertSession(current);return {info:info,error:true,rows:[]};}
  }));
}
function toolsHistoryHtml(result){
  var info=result.info;
  if(result.error)return '<section><h3>'+escH(info.title)+'</h3><p role="alert">This history could not be loaded. Reload this record to retry.</p></section>';
  return '<section><h3>'+escH(info.title)+'</h3>'+(result.limited?'<p>Showing the latest 200 records. Open the corresponding register for older history.</p>':'')+(result.rows.length?'<div class="equipment-table"><table><thead><tr>'+info.fields.map(function(pair){return '<th>'+escH(pair[1])+'</th>';}).join('')+'</tr></thead><tbody>'+result.rows.map(function(row){return '<tr>'+info.fields.map(function(pair){var value=row[pair[0]],href=pair[0]==='evidence_reference'?toolsEvidenceHref(value):'';return '<td>'+(href?'<a target="_blank" rel="noopener noreferrer" href="'+escH(href)+'">View evidence</a>':escH(value==null||value===''?'—':String(value).replace(/_/g,' ')))+(info.table==='tool_inspections'&&pair[0]==='overall_result'?'<br><button class="btn" data-equipment-inspection="'+escH(row.id)+'">View inspection</button>':'')+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>':'<p>No records recorded.</p>')+'</section>';
}
function toolsShowRecord(row,current,history){
  AurisToolsListWorkspace.assertSession(current);
  document.getElementById('equipment-record')?.remove();
  var host=document.createElement('div');host.id='equipment-record';host.className='equipment-overlay';
  host.innerHTML='<article class="equipment-window" role="dialog" aria-modal="true" aria-labelledby="equipment-record-title"><header><div><p>Tools & Equipment · Read only</p><h2 id="equipment-record-title">'+escH(row.name||'Equipment')+'</h2><p>'+escH(row.ref_number||'')+' · '+escH(String(row.status||'Not recorded').replace(/_/g,' '))+'</p></div><button class="btn" data-equipment-close>Close</button></header><nav aria-label="Equipment record actions"><button class="btn" data-equipment-print>Print equipment report</button>'+(isMgr()?'<a class="btn btn-primary" target="_blank" rel="noopener" href="'+escH(toolsRecordHref(row.id,'edit'))+'">Edit equipment</a>':'')+'</nav><div class="equipment-content"><section><h3>Identity & custody</h3>'+toolsRecordFields(row,[['category','Category'],['brand','Brand'],['model','Model'],['serial_number','Serial number'],['location','Location'],['assigned_to_name','Assigned to'],['purchase_date','Purchased'],['inspection_frequency','Inspection frequency']])+'</section><section><h3>Statutory assurance</h3>'+toolsRecordFields(row,[['requires_statutory','Statutory required'],['statutory_type','Type'],['statutory_body','Authority'],['last_statutory_date','Last verification'],['next_statutory_date','Next verification'],['notes','Notes']])+'</section>'+history.map(toolsHistoryHtml).join('')+'</div></article>';
  document.body.appendChild(host);
  host.addEventListener('click',function(event){try{AurisToolsListWorkspace.assertSession(current);}catch(error){event.preventDefault();event.stopImmediatePropagation();host.remove();toast(error.message,false);}},true);
  host.querySelector('[data-equipment-close]').addEventListener('click',function(){host.remove();});
  host.querySelector('[data-equipment-print]').addEventListener('click',function(){printRegisterView('Equipment Record - '+(row.name||''),'#equipment-record .equipment-content');});
  host.querySelectorAll('[data-equipment-inspection]').forEach(function(button){button.addEventListener('click',function(){toolsViewInspection(button.dataset.equipmentInspection);});});
  host.querySelector('[data-equipment-close]').focus();
}
async function toolsOpenLinkedRecord(req){
  var current=AurisToolsListWorkspace.session();
  if(req.table&&req.table!=='tools_register')throw Error('Unsupported equipment record.');
  if(req.company&&String(req.company)!==current.companyId)throw Error('Select the company that owns this equipment.');
  var rows=await api('/tools_register?select=*&id=eq.'+encodeURIComponent(req.record)+'&company_id=eq.'+encodeURIComponent(current.companyId));
  AurisToolsListWorkspace.assertSession(current);
  var row=(rows||[]).find(function(item){return String(item.id)===String(req.record)&&String(item.company_id)===current.companyId;});
  if(!row)return false;
  if(new URLSearchParams(location.search).get('equipmentMode')==='edit'){
    if(!isMgr())throw Error('Manager access is required to edit equipment.');
    var staff=await api('/people?select=id,company_id,first_name,last_name,job_title&company_id=eq.'+encodeURIComponent(current.companyId)+'&status=eq.active&order=last_name');
    AurisToolsListWorkspace.assertSession(current);
    if(!isMgr())throw Error('Manager access is required to edit equipment.');
    people=(staff||[]).filter(function(person){return String(person.company_id)===current.companyId;});
    if(row.assigned_to&&!people.some(function(person){return String(person.id)===String(row.assigned_to);})){people.push({id:row.assigned_to,company_id:current.companyId,last_name:row.assigned_to_name||'Previously assigned employee',first_name:''});}
    toolsAllData=(toolsAllData||[]).filter(function(item){return String(item.company_id)===current.companyId&&String(item.id)!==String(row.id);});toolsAllData.push(row);
    document.querySelectorAll('#page-tools .teu-view').forEach(function(node){node.style.display='none';});
    toolsRecordEditContext=current;
    toolsOpeningLinkedRecord=true;try{toolsEdit(row.id);}finally{toolsOpeningLinkedRecord=false;}
  }else toolsShowRecord(row,current,await toolsReadHistory(row,current));
  return true;
}
