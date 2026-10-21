/* Fire Certificates follow-up controls, loaded when the module opens. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const company=()=>String(ccid()||'');
  const assertContext=expected=>{if(company()!==expected)throw Error('Company changed. Reopen the fire record.');};
  function dateText(value){if(!value)return 'Not recorded';const date=new Date(String(value).slice(0,10)+'T00:00:00');return Number.isNaN(date.getTime())?'Not recorded':date.toLocaleDateString('en-GB');}
  function closeRecord(){ $('fire-record-window')?.remove(); }
  function overlay(title,subtitle,body,back){
    closeRecord();const host=document.createElement('div');host.id='fire-record-window';host.className='equipment-overlay';
    host.innerHTML='<article class="equipment-window" role="dialog" aria-modal="true" aria-labelledby="fire-record-title"><header><div><p>Fire Certificates · Read only</p><h2 id="fire-record-title">'+escH(title)+'</h2><p>'+escH(subtitle||'')+'</p></div><button class="btn" data-fire-close>Close</button></header><nav aria-label="Record actions">'+(back?'<button class="btn" data-fire-back>Back to certificate</button>':'')+'</nav><div class="equipment-content">'+body+'</div></article>';
    document.body.append(host);host.querySelector('[data-fire-close]').onclick=closeRecord;
    host.querySelector('[data-fire-back]')?.addEventListener('click',back);host.querySelector('[data-fire-close]').focus();return host;
  }
  async function scopedRecord(table,id){
    const scope=company();if(!scope||!id)throw Error('Select a company and record.');
    const rows=await api('/'+table+'?select=*&id=eq.'+encodeURIComponent(id)+'&company_id=eq.'+encodeURIComponent(scope));assertContext(scope);
    const row=(rows||[]).find(item=>String(item.id)===String(id)&&String(item.company_id)===scope);
    if(!row)throw Error('The fire record is unavailable in the selected company.');return row;
  }
  window.fireStartRenewal=function(previous){
    if(!isMgr())return toast('Manager access is required to start a renewal.',false);
    originalCertForm(null);
    const values={'fc-predecessor':previous.id,'fc-number':'','fc-type':previous.cert_type||'fire_certificate',
      'fc-premises':previous.premises_name||'','fc-address':previous.address||'','fc-occupancy':previous.occupancy_type||'',
      'fc-area':previous.floor_area??'','fc-maxocc':previous.max_occupancy??'','fc-authority':previous.issuing_authority||'',
      'fc-conditions':previous.conditions||'','fc-site-id':previous.site_id||'','fc-issue-date':'','fc-expiry-date':'',
      'fc-doc-url':'','fc-renewal-date':'','fc-renewal-submitted':'false'};
    Object.entries(values).forEach(([id,value])=>{if($(id))$(id).value=value;});
    populateSites($('fc-site-id'),previous.site_id||'');
    $('fire-cert-modal-title').textContent='Record replacement certificate';
    $('fc-renewal-source').textContent='Replaces '+(previous.cert_number||previous.premises_name)+'. Enter the new authority-issued number, dates and document; the previous certificate remains in the register.';
  };
  window.fireMarkRenewalSubmitted=async function(row){
    if(!isMgr())return;
    const scope=company();const date=await appPrompt({title:'Record renewal submission',message:'Enter the actual submission date (YYYY-MM-DD). This does not renew or extend the certificate.',value:new Date().toISOString().slice(0,10)});
    if(date===null)return;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))){toast('Enter a valid submission date.',false);return;}
    try{assertContext(scope);await api('/fire_certificates?id=eq.'+encodeURIComponent(row.id)+'&company_id=eq.'+encodeURIComponent(scope),{m:'PATCH',p:'return=minimal',b:{renewal_submitted:true,renewal_date:date,updated_at:new Date().toISOString()}});assertContext(scope);toast('Renewal submission recorded. Certificate validity is unchanged.');closeRecord();await fireLoadAll();fireRenderCerts();fireRecordWindow(row.id,'view');}
    catch(error){toast('Could not record renewal submission: '+error.message,false);}
  };
  window.fireOpenRelated=async function(table,id,certificate){
    try{
      if(table==='fire_inspections')return await fireViewInspection(id,certificate);
      if(table==='fire_equipment')return await fireViewEquipment(id,certificate);
      if(table==='fire_certificates')return await fireRecordWindow(id,'view');
      throw Error('Unsupported related record.');
    }catch(error){toast(error.message,false);}
  };
  async function fireViewInspection(id,certificate){
    const row=await scopedRecord('fire_inspections',id),scope=company();
    const findings=await api('/fire_inspection_findings?select=id,company_id,finding,severity,action_required,responsible_person,due_date,status,action_id&company_id=eq.'+encodeURIComponent(scope)+'&inspection_id=eq.'+encodeURIComponent(id)+'&order=created_at.asc');assertContext(scope);
    const own=(findings||[]).filter(item=>String(item.company_id)===scope);
    const actionIds=own.map(item=>item.action_id).filter(Boolean);
    let actions=[];if(actionIds.length){actions=await api('/action_tracker?select=id,company_id,status,progress_pct,target_date&company_id=eq.'+encodeURIComponent(scope)+'&id=in.('+actionIds.map(encodeURIComponent).join(',')+')');assertContext(scope);}
    const progress=new Map((actions||[]).filter(item=>String(item.company_id)===scope).map(item=>[item.id,item]));
    const findingsHtml=own.length?own.map(item=>{const action=progress.get(item.action_id);return '<section><h3>'+escH(item.finding)+'</h3><p>Severity: '+escH(item.severity||'Not assessed')+' · Owner: '+escH(item.responsible_person||'Unassigned')+' · Due: '+escH(dateText(item.due_date))+'</p><p>Action: '+escH(item.action_required||'None recorded')+'</p><p>Progress: '+escH(action?action.status.replace(/_/g,' ')+(action.progress_pct!=null?' · '+action.progress_pct+'%':''):'No linked action')+'</p>'+(action?'<button class="btn btn-sm" data-fire-action="'+escH(action.id)+'">Open action</button>':'')+'</section>';}).join(''):'<p>No detailed findings recorded.</p>';
    const host=overlay('Fire inspection',dateText(row.inspection_date)+' · '+fireInspTypeLabel(row.inspection_type),'<section><h3>Inspection result</h3>'+fireRecordFields(row,[['inspector_name','Inspector'],['inspector_authority','Authority'],['overall_result','Result'],['status','Status'],['findings','Summary findings'],['recommendations','Recommendations'],['follow_up_date','Follow-up date']])+'</section><section><h3>Finding follow-up</h3>'+findingsHtml+'</section>',certificate?()=>fireRecordWindow(certificate.id,'view'):null);
    host.addEventListener('click',event=>{const action=event.target.closest('[data-fire-action]');if(action){closeRecord();showPage('actions');mapEdit(action.dataset.fireAction);}});
  }
  window.fireViewInspection=fireViewInspection;
  async function fireViewEquipment(id,certificate){
    const row=await scopedRecord('fire_equipment',id),scope=company();
    const history=await api('/fire_equipment_services?select=service_date,next_due_date,performed_by,result,notes,company_id&company_id=eq.'+encodeURIComponent(scope)+'&equipment_id=eq.'+encodeURIComponent(id)+'&order=service_date.desc&limit=50');assertContext(scope);
    const body='<section><h3>Equipment</h3>'+fireRecordFields(row,[['description','Description'],['location','Location'],['serial_number','Serial number'],['status','Status'],['last_service_date','Last service'],['next_service_date','Next service']])+'</section><section><h3>Service history</h3>'+((history||[]).length?(history||[]).filter(item=>String(item.company_id)===scope).map(item=>'<p>'+escH(dateText(item.service_date))+' · '+escH(item.result.replace(/_/g,' '))+' · '+escH(item.performed_by)+' · next due '+escH(dateText(item.next_due_date))+(item.notes?' · '+escH(item.notes):'')+'</p>').join(''):'<p>No service history recorded. Existing dates predate the service ledger.</p>')+'</section>';
    const host=overlay(fireEquipTypeLabel(row.equipment_type),row.description||row.serial_number||'',body,certificate?()=>fireRecordWindow(certificate.id,'view'):null);
    if(isMgr()){const button=document.createElement('button');button.className='btn btn-primary';button.textContent='Record service';button.onclick=()=>fireRecordService(row,certificate);host.querySelector('nav').append(button);}
    if(row.site_id){const button=document.createElement('button');button.className='btn';button.textContent='View linked site';button.onclick=()=>fireOpenSite(row.site_id,certificate?.id);host.querySelector('nav').append(button);}
  }
  window.fireViewEquipment=fireViewEquipment;
  window.fireOpenSite=async function(siteId,certificateId){
    try{if(!canAccessPage('sitemap'))throw Error('Site Map access is required.');await scopedRecord('sites',siteId);closeRecord();await Promise.resolve(showPage('sitemap',null));await loadSiteMap();siteMapState.showAllLocations=true;smSelectSite(siteId,true);smRenderSiteList();
      const host=$('page-sitemap');if(host&&certificateId){host.querySelector('#fire-return-from-site')?.remove();const button=document.createElement('button');button.id='fire-return-from-site';button.type='button';button.className='btn btn-sm';button.textContent='Back to fire certificate';button.onclick=()=>{button.remove();showPage('fire',null);fireRecordWindow(certificateId,'view');};host.prepend(button);}
    }catch(error){toast('Linked site unavailable: '+error.message,false);}
  };
  window.fireOpenLinkedRecord=async function(req){
    if(req.company&&String(req.company)!==company())throw Error('Select the company that owns this fire record.');
    if(!req.table||req.table==='fire_certificates')return fireOpenRecordRequest(req);
    if(req.table==='fire_inspections'){await fireViewInspection(req.record);return true;}
    if(req.table==='fire_equipment'){await fireViewEquipment(req.record);return true;}
    if(req.table==='fire_inspection_findings'){
      const finding=await scopedRecord('fire_inspection_findings',req.record);
      await fireViewInspection(finding.inspection_id);return true;
    }
    throw Error('Unsupported Fire Certificates record.');
  };
  async function fireRecordService(row,certificate){
    const scope=company(),date=await appPrompt({title:'Record fire equipment service',message:'Actual service date (YYYY-MM-DD)',value:new Date().toISOString().slice(0,10)});if(date===null)return;
    const next=await appPrompt({title:'Next service due',message:'Next due date (YYYY-MM-DD)',value:row.next_service_date||''});if(next===null)return;
    const technician=await appPrompt({title:'Service provider',message:'Person or company that performed the service'});if(technician===null)return;
    const result=await appPrompt({title:'Service result',message:'Enter passed, requires_attention or failed',value:'passed'});if(result===null)return;
    const notes=await appPrompt({title:'Service notes',message:'Optional evidence or service report reference'});if(notes===null)return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}-\d{2}-\d{2}$/.test(next)||next<=date||!technician.trim()||!['passed','requires_attention','failed'].includes(result)){toast('Enter valid service dates, provider and result.',false);return;}
    try{assertContext(scope);await api('/rpc/record_fire_equipment_service',{m:'POST',p:'return=representation',b:{p_company_id:scope,p_equipment_id:row.id,p_service_date:date,p_next_due_date:next,p_performed_by:technician.trim(),p_result:result,p_notes:notes.trim()||null}});assertContext(scope);toast('Service entry saved and next due date updated.');await fireLoadAll();fireViewEquipment(row.id,certificate);}
    catch(error){toast('Service entry failed: '+error.message,false);}
  }
  const originalCertForm=window.fireShowCertForm,originalEquipForm=window.fireShowEquipForm,originalInspForm=window.fireShowInspForm;
  async function populateSites(select,chosen){
    const scope=company();if(!select||!scope)return;
    try{const rows=await api('/sites?select=id,company_id,name,site_type&company_id=eq.'+encodeURIComponent(scope)+'&active=eq.true&order=name.asc&limit=500');assertContext(scope);
      select.innerHTML='<option value="">Select a linked site or area...</option>'+(rows||[]).filter(item=>String(item.company_id)===scope).map(item=>'<option value="'+escH(item.id)+'">'+escH(item.name+' · '+item.site_type)+'</option>').join('');select.value=chosen||'';
    }catch(error){select.innerHTML='<option value="">Site records unavailable; existing link retained</option>';if(chosen){const option=document.createElement('option');option.value=chosen;option.textContent='Current linked site';select.append(option);select.value=chosen;}}
  }
  window.fireShowCertForm=function(id){const result=originalCertForm.apply(this,arguments);const chosen=$('fc-site-id')?.value;populateSites($('fc-site-id'),chosen);$('fc-renewal-source').textContent=id?'':'Select Start renewal from an existing certificate to link a replacement.';return result;};
  window.fireShowEquipForm=function(id){const result=originalEquipForm.apply(this,arguments);populateSites($('fe-site-id'),$('fe-site-id')?.value);['fe-last-service','fe-next-service'].forEach(field=>{if($(field)){$(field).readOnly=!!id;$(field).title=id?'Use Record service to retain service history':'';}});return result;};
  window.fireShowInspForm=function(id){const result=originalInspForm.apply(this,arguments),target=$('fire-existing-findings');if(!target)return result;target.textContent=id?'Loading existing findings...':'';if(id){const scope=company();api('/fire_inspection_findings?select=id,company_id,finding,action_required,responsible_person,due_date&company_id=eq.'+encodeURIComponent(scope)+'&inspection_id=eq.'+encodeURIComponent(id)+'&order=created_at.asc').then(rows=>{assertContext(scope);target.innerHTML=(rows||[]).length?'<strong>Existing findings</strong><p>Previously saved findings remain linked to this inspection. Open View to inspect their action progress.</p>'+(rows||[]).filter(row=>String(row.company_id)===scope).map(row=>'<p>'+escH(row.finding)+' · '+escH(row.responsible_person||'Unassigned')+' · '+escH(dateText(row.due_date))+'</p>').join(''):'No existing findings.';}).catch(error=>{target.textContent='Existing findings unavailable: '+error.message;});}return result;};
  document.addEventListener('click',event=>{const inspection=event.target.closest('[data-fire-inspection-view]');if(inspection){event.preventDefault();fireViewInspection(inspection.dataset.fireInspectionView).catch(error=>toast(error.message,false));}const equipment=event.target.closest('[data-fire-equipment-view]');if(equipment){event.preventDefault();fireViewEquipment(equipment.dataset.fireEquipmentView).catch(error=>toast(error.message,false));}});
  const img=$('fire-layout-img'),markers=$('fire-layout-marker-layer'),empty=$('fire-layout-empty');
  if(img&&markers&&empty){img.addEventListener('error',()=>{if(!img.getAttribute('src'))return;img.style.display='none';markers.style.display='none';empty.style.display='flex';empty.innerHTML='<div role="alert"><strong>Plan image could not be loaded.</strong><p>Markers are hidden until the background is restored. Use Upload plan above to replace the image, then save the plan.</p></div>';});img.addEventListener('load',()=>{if(!img.naturalWidth)return;markers.style.display='';empty.style.display='none';});}
  window.AurisFireWorkflow=Object.freeze({version:'1.0.0',fireStartRenewal:window.fireStartRenewal,fireViewInspection,fireViewEquipment});
})();
