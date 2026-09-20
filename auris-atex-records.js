/* ATEX area presentation; classification and workflow rules remain in the existing editor. */
var atexOpeningRecord=false,atexRecordContext=null;
function atexRecordHref(id,mode){
  var url=new URL(deepLinkRecordUrl({module:'atex',id:id,table:'atex_areas',company_id:ccid()}));
  url.searchParams.set('atexMode',mode==='edit'?'edit':'view');return url.toString();
}
function atexRecordWindow(id,mode){
  AurisAtexListWorkspace.session();
  if(mode==='edit'&&!isMgr())throw Error('Manager access is required to edit ATEX areas.');
  var child=window.open(atexRecordHref(id,mode),'_blank');
  if(child)child.opener=null;else toast('Allow popups to open the ATEX area in a separate window.',false);
}
function atexAssertEditor(){
  if(!atexRecordContext)throw Error('Reopen the ATEX form before saving.');
  AurisAtexListWorkspace.assertSession(atexRecordContext);
  if(!isMgr())throw Error('Manager access is required to change ATEX areas.');
}
function atexRecordFields(row,fields){
  return '<dl class="atex-record-fields">'+fields.map(function(pair){var value=row[pair[0]];return '<div><dt>'+escH(pair[1])+'</dt><dd>'+escH(value==null||value===''?'Not recorded':String(value).replace(/_/g,' '))+'</dd></div>';}).join('')+'</dl>';
}
function atexRecordHtml(row){
  return '<section><h3>Area & classification</h3>'+atexRecordFields(row,[['area_ref','Reference'],['area_name','Area'],['location','Location'],['plant_area','Plant area'],['zone_type','Zone'],['material_type','Material'],['substance','Substance'],['status','Status']])+'</section><section><h3>Release sources & controls</h3>'+atexRecordFields(row,[['source_of_release','Source of release'],['ventilation_controls','Ventilation'],['ignition_controls','Ignition sources'],['detection_controls','Detection / monitoring'],['linked_equipment','Equipment']])+'</section><section><h3>Inspection & responsibility</h3>'+atexRecordFields(row,[['last_inspection_date','Last inspection'],['next_inspection_date','Next inspection'],['responsible_person','Responsible person']])+'</section><section><h3>Linked records & notes</h3>'+atexRecordFields(row,[['linked_ra_ref','Risk assessment reference'],['linked_permit_ref','Permit reference'],['linked_permit_type','Permit type'],['notes','Notes']])+'</section>';
}
function atexShowRecord(row,current){
  AurisAtexListWorkspace.assertSession(current);document.getElementById('atex-record-window')?.remove();
  var host=document.createElement('div');host.id='atex-record-window';host.className='atex-record-overlay';
  host.innerHTML='<article class="atex-record-dialog" role="dialog" aria-modal="true" aria-labelledby="atex-record-title"><header><div><p>ATEX area · Read only</p><h2 id="atex-record-title">'+escH(row.area_name||'ATEX area')+'</h2><p>'+escH(row.area_ref||'')+'</p></div><button class="btn" data-atex-close>Close</button></header><nav aria-label="ATEX record actions"><button class="btn" data-atex-print>Print area report</button>'+(isMgr()?'<a class="btn btn-primary" target="_blank" rel="noopener" href="'+escH(atexRecordHref(row.id,'edit'))+'">Edit in new window</a>':'')+'</nav><div class="atex-record-content">'+atexRecordHtml(row)+'</div></article>';
  document.body.appendChild(host);
  host.addEventListener('click',function(event){try{AurisAtexListWorkspace.assertSession(current);}catch(error){event.preventDefault();event.stopImmediatePropagation();host.remove();toast(error.message,false);}},true);
  host.querySelector('[data-atex-close]').addEventListener('click',function(){host.remove();});
  host.querySelector('[data-atex-print]').addEventListener('click',function(){printRegisterView('ATEX Area Record - '+(row.area_name||''),'#atex-record-window .atex-record-content');});
  host.querySelector('[data-atex-close]').focus();
}
async function atexOpenRecordRequest(req){
  var current=AurisAtexListWorkspace.session();
  if(req.table&&req.table!=='atex_areas')throw Error('Unsupported ATEX record.');
  if(req.company&&String(req.company)!==current.companyId)throw Error('Select the company that owns this ATEX area.');
  var rows=await api('/atex_areas?select=*&id=eq.'+encodeURIComponent(req.record)+'&company_id=eq.'+encodeURIComponent(current.companyId));
  AurisAtexListWorkspace.assertSession(current);
  var row=(rows||[]).find(function(item){return String(item.id)===String(req.record)&&String(item.company_id)===current.companyId;});
  if(!row)return false;
  if(new URLSearchParams(location.search).get('atexMode')==='edit'){
    if(!isMgr())throw Error('Manager access is required to edit ATEX areas.');
    atexAreas=(atexAreas||[]).filter(function(item){return String(item.company_id)===current.companyId&&String(item.id)!==String(row.id);});atexAreas.push(row);
    atexOpeningRecord=true;try{await atexEdit(row.id);}finally{atexOpeningRecord=false;}
  }else atexShowRecord(row,current);
  return true;
}
