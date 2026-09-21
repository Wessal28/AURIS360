var emEqOpeningRecord=false,emEqRecordContext=null,emEqListFilters={};
function emEqRecordHref(id,mode){var url=new URL(deepLinkRecordUrl({module:'emergency',table:'emergency_equipment',id:id,company_id:ccid()}));url.searchParams.set('equipmentMode',mode==='edit'?'edit':'view');return url.href;}
function emEqRecordWindow(id,mode){AurisEmergencyListWorkspace.session();if(mode==='edit'&&!isMgr())throw Error('Manager access is required to edit emergency equipment.');var child=window.open(emEqRecordHref(id,mode),'_blank');if(child)child.opener=null;else toast('Allow popups to open emergency equipment in a separate window.',false);}
function emEqAssertEditor(){if(!emEqRecordContext)throw Error('Reopen the equipment form before saving.');AurisEmergencyListWorkspace.assertSession(emEqRecordContext);if(!isMgr())throw Error('Manager access is required to change emergency equipment.');}
function emEqRecordFields(row,fields){return '<dl class="equipment-fields">'+fields.map(function(pair){var value=row[pair[0]];return '<div><dt>'+escH(pair[1])+'</dt><dd>'+escH(value==null||value===''?'Not recorded':String(value).replace(/_/g,' '))+'</dd></div>';}).join('')+'</dl>';}
function emEqShowRecord(row,current){
  AurisEmergencyListWorkspace.assertSession(current);document.getElementById('emergency-record-window')?.remove();
  var host=document.createElement('div');host.id='emergency-record-window';host.className='equipment-overlay';
  host.innerHTML='<article class="equipment-window" role="dialog" aria-modal="true" aria-labelledby="emergency-record-title"><header><div><p>Emergency equipment · Read only</p><h2 id="emergency-record-title">'+escH(row.identifier||'Emergency equipment')+'</h2><p>'+escH(String(row.equipment_type||'').replace(/_/g,' '))+'</p></div><button class="btn" data-em-close>Close</button></header><nav aria-label="Equipment actions"><button class="btn" data-em-print>Print equipment report</button>'+(isMgr()?'<a class="btn btn-primary" target="_blank" rel="noopener" href="'+escH(emEqRecordHref(row.id,'edit'))+'">Edit in new window</a>':'')+'</nav><div class="equipment-content"><section><h3>Equipment & location</h3>'+emEqRecordFields(row,[['identifier','ID / tag'],['equipment_type','Type'],['building','Building'],['floor','Floor'],['location','Location']])+'</section><section><h3>Readiness & maintenance</h3>'+emEqRecordFields(row,[['status','Status'],['condition','Condition'],['last_inspection','Last inspection'],['next_inspection','Next inspection'],['last_service','Last service'],['next_service','Next service'],['serviced_by','Service provider'],['notes','Notes']])+'</section></div></article>';
  document.body.appendChild(host);host.addEventListener('click',function(event){try{AurisEmergencyListWorkspace.assertSession(current);}catch(error){event.preventDefault();event.stopImmediatePropagation();host.remove();toast(error.message,false);}},true);
  host.querySelector('[data-em-close]').addEventListener('click',function(){host.remove();});host.querySelector('[data-em-print]').addEventListener('click',function(){printRegisterView('Emergency Equipment Record - '+(row.identifier||''),'#emergency-record-window .equipment-content');});host.querySelector('[data-em-close]').focus();
}
async function emEqOpenRecordRequest(req){
  var current=AurisEmergencyListWorkspace.session();if(req.table&&req.table!=='emergency_equipment')throw Error('Unsupported emergency equipment record.');if(req.company&&String(req.company)!==current.companyId)throw Error('Select the company that owns this equipment.');
  var rows=await api('/emergency_equipment?select=*&id=eq.'+encodeURIComponent(req.record)+'&company_id=eq.'+encodeURIComponent(current.companyId));AurisEmergencyListWorkspace.assertSession(current);
  var row=(rows||[]).find(function(item){return String(item.id)===String(req.record)&&String(item.company_id)===current.companyId;});if(!row)return false;
  if(new URLSearchParams(location.search).get('equipmentMode')==='edit'){
    if(!isMgr())throw Error('Manager access is required to edit emergency equipment.');
    emEqData=(emEqData||[]).filter(function(item){return String(item.company_id)===current.companyId&&String(item.id)!==String(row.id);});emEqData.push(row);
    var tab=document.getElementById('em3tab-equipment');if(tab)emSwitchTab('equipment',tab);
    emEqOpeningRecord=true;try{await emEqEdit(row.id);}finally{emEqOpeningRecord=false;}
  }else emEqShowRecord(row,current);return true;
}
function emEqMountRegister(el,rows,type){return AurisEmergencyListWorkspace.mount(el,rows,{filters:Object.assign({},emEqListFilters,{type:type}),canEdit:isMgr(),recordHref:emEqRecordHref,openRecord:function(id){return emEqRecordWindow(id,'view');},editRecord:function(id){return emEqRecordWindow(id,'edit');},onApplyFilters:function(value){emEqListFilters=value;var control=document.getElementById('em3eq-filter-type');if(control)control.value=value.type||'';emEqLoad();}});}

async function emEqRemoveRecord(id,expected){
  var current=expected||AurisEmergencyListWorkspace.session();AurisEmergencyListWorkspace.assertSession(current);if(!isMgr())throw Error('Manager access is required to change emergency equipment.');
  var url='/emergency_equipment?id=eq.'+encodeURIComponent(id)+'&company_id=eq.'+encodeURIComponent(current.companyId);
  var rows=await api(url+'&select=*');AurisEmergencyListWorkspace.assertSession(current);var row=(rows||[]).find(function(item){return String(item.id)===String(id)&&String(item.company_id)===current.companyId;});if(!row)throw Error('Equipment was not found in this company.');
  var retire=row.status!=='out_of_service';
  var approved=retire?await appConfirmAction({title:'Take equipment out of service',message:'Take this emergency equipment out of service instead of deleting it?',detail:'Equipment history is retained for inspection, maintenance and readiness evidence.',confirmText:'Out of service',cancelText:'Back'}):await appConfirmDelete('emergency equipment','This equipment is already out of service. Permanent deletion should be used only for duplicate/test records.');
  if(!approved)return false;AurisEmergencyListWorkspace.assertSession(current);if(!isMgr())throw Error('Manager access is required to change emergency equipment.');
  var body={status:'out_of_service',condition:row.condition==='condemned'?'condemned':'poor',updated_at:new Date().toISOString()};
  var result=await api(url,retire?{m:'PATCH',p:'return=representation',b:body}:{m:'DELETE',p:'return=representation'});AurisEmergencyListWorkspace.assertSession(current);if(!result||!result.length)throw Error('Equipment was not changed. Reload and check your access.');
  emAudit(retire?'out_of_service':'delete',retire?'Emergency equipment taken out of service':'Emergency equipment permanently deleted','emergency_equipment',retire?Object.assign({},row,body):row,retire?{previous_status:row.status||null}:{reason:'duplicate_or_test_record'});toast(retire?'Equipment marked out of service':'Deleted');return true;
}
