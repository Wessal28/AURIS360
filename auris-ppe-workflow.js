/* PPE safety workflow, loaded when the module opens. Database triggers enforce the same decisions. */
(function(){
  'use strict';
  if(window.PpeWorkflow)return;
  window.PpeWorkflow=true;
  const $=id=>document.getElementById(id);
  const today=()=>new Date().toISOString().slice(0,10);
  const company=()=>String(ccid()||'');
  const match=(a,b)=>String(a||'').trim()===String(b||'').trim();
  let issuanceRows=[];

  async function loadInspectionIssuances(selected){
    const select=$('piif-issuance-id');if(!select)return;
    const scope=company(),ppe=$('piif-ppe-id')?.value,employee=$('piif-emp-name')?.value;
    select.replaceChildren(new Option('Select exact issuance / serial...',''));
    if(!ppe||!employee)return;
    try{
      const rows=await api('/ppe_issuance?select=id,company_id,ppe_id,employee_name,issuance_ref,serial_number,batch_number,status,issued_date'+cf()+'&order=issued_date.desc&limit=1000');
      if(company()!==scope||ppe!==$('piif-ppe-id')?.value||employee!==$('piif-emp-name')?.value)return;
      issuanceRows=(rows||[]).filter(row=>row.company_id===scope&&row.ppe_id===ppe&&match(row.employee_name,employee));
      if(selected&&!issuanceRows.some(row=>row.id===selected)){
        const linked=await api('/ppe_issuance?select=id,company_id,ppe_id,employee_name,issuance_ref,serial_number,batch_number,status&id=eq.'+encodeURIComponent(selected)+cf()+'&limit=1');
        if(company()!==scope||ppe!==$('piif-ppe-id')?.value||employee!==$('piif-emp-name')?.value)return;
        if(linked?.[0]?.company_id===scope&&linked[0].ppe_id===ppe&&match(linked[0].employee_name,employee))issuanceRows.push(linked[0]);
      }
      issuanceRows.forEach(row=>select.add(new Option((row.issuance_ref||row.id.slice(0,8))+' · '+(row.serial_number||row.batch_number||'no serial')+' · '+row.status,row.id)));
      select.value=selected||'';
      if(selected)select.value=selected;
    }catch(error){select.replaceChildren(new Option('Issuances unavailable',''));toast('Issued PPE could not be loaded: '+error.message,false);}
  }

  const originalSelect=window.ppeInspSelectItem;
  window.ppeInspSelectItem=function(){
    originalSelect.apply(this,arguments);
    if(!ppeInspEditId)$('piif-checklist')?.querySelectorAll('input[type=radio]').forEach(input=>{input.checked=false;});
    loadInspectionIssuances();
  };
  document.addEventListener('change',event=>{
    if(event.target.id==='piif-emp-name')loadInspectionIssuances();
    if(event.target.closest('#piif-checklist')&&event.target.value==='fail'){
      $('piif-result').value='fail';
      document.querySelectorAll('[name="piif-result-radio"]').forEach(r=>{r.checked=r.value==='fail';});
      if(['cleared_for_use','repaired'].includes($('piif-action').value))$('piif-action').value='none';
    }
    if(event.target.id==='pif-returned'&&event.target.checked)$('pif-status').value='returned';
  });

  const originalNew=window.ppeInspNew;
  window.ppeInspNew=async function(){
    await originalNew.apply(this,arguments);
    $('piif-result').value='';$('piif-action').value='none';
    document.querySelectorAll('[name="piif-result-radio"]').forEach(r=>{r.checked=false;});
    $('piif-issuance-id')?.replaceChildren(new Option('Select exact issuance / serial...',''));
  };
  const originalEdit=window.ppeInspEdit;
  window.ppeInspEdit=async function(id){
    await originalEdit.apply(this,arguments);
    if(ppeInspEditId===id){const row=ppeInspData.find(item=>item.id===id);await loadInspectionIssuances(row?.issuance_id);}
  };
  const originalSave=window.ppeInspSave;
  window.ppeInspSave=function(){
    const chosen=$('piif-issuance-id')?.value;
    if(!chosen||!issuanceRows.some(row=>row.id===chosen)){toast('Select the exact issued item or serial before saving.',false);$('piif-issuance-id')?.focus();return;}
    const checks=[...$('piif-checklist').querySelectorAll('input[type=radio]')];
    const names=[...new Set(checks.map(input=>input.name))];
    if(!names.length||names.some(name=>!checks.some(input=>input.name===name&&input.checked))){toast('Record a result for every inspection check.',false);return;}
    const result=$('piif-result').value;
    if(!result){toast('Select an overall inspection result.',false);return;}
    const failed=checks.some(input=>input.checked&&input.value==='fail');
    if(failed&&!['fail','condemn'].includes(result)){toast('A failed check requires Fail or Condemn; it cannot be cleared.',false);return;}
    if((failed||['fail','condemn'].includes(result))&&['cleared_for_use','repaired'].includes($('piif-action').value)){
      toast('Failed PPE cannot be cleared for use. Record its removal or maintenance action.',false);return;
    }
    return originalSave.apply(this,arguments);
  };

  const originalIssEdit=window.ppeIssEdit;
  window.ppeIssEdit=async function(){
    await originalIssEdit.apply(this,arguments);
    if(ppeIssEditId){$('pif-ppe-id').disabled=true;$('pif-qty').readOnly=true;}
  };
  const originalIssNew=window.ppeIssNew;
  window.ppeIssNew=async function(){
    $('pif-ppe-id').disabled=false;$('pif-qty').readOnly=false;
    return originalIssNew.apply(this,arguments);
  };
  const originalIssSave=window.ppeIssSave;
  window.ppeIssSave=function(){
    const returned=$('pif-returned').checked,status=$('pif-status').value,condition=$('pif-return-condition').value;
    if(!ppeIssEditId&&returned){toast('Save the issuance first, then record its return.',false);return;}
    if(returned){
      if(!$('pif-return-date').value){toast('Record the return date.',false);$('pif-return-date').focus();return;}
      if(!condition){toast('Record the return condition.',false);return;}
      if(condition==='lost'){toast('Lost PPE cannot be marked returned. Set its status to Lost.',false);return;}
      if(status==='active')$('pif-status').value=condition==='condemned'?'condemned':'returned';
    }else if(status==='returned'){toast('Returned status requires the PPE returned confirmation.',false);return;}
    return originalIssSave.apply(this,arguments);
  };
  async function archiveIssuance(id){
    if(!isMgr())return;
    const scope=company(),rows=await api('/ppe_issuance?select=id,company_id,status,notes&id=eq.'+encodeURIComponent(id)+cf()+'&limit=1');
    const row=rows?.[0];if(!row||row.company_id!==scope)throw Error('Issuance is unavailable in this company.');
    if(ohIsArchivedText(row.notes)){toast('Archived issuance history is retained for stock and inspection traceability.',false);return;}
    if(!(await appConfirmAction({title:'Archive PPE issuance?',message:'The issuance will remain in the stock and inspection trail. This does not record a physical return.',confirmText:'Archive',variant:'danger'})))return;
    await api('/ppe_issuance?id=eq.'+encodeURIComponent(id)+'&company_id=eq.'+encodeURIComponent(scope),{m:'PATCH',p:'return=minimal',b:{status:row.status==='active'?'expired':row.status,notes:ohArchivedText(row.notes),updated_at:new Date().toISOString()}});
    if(company()!==scope)return;toast('Issuance archived; stock history retained.');ppeIssBack();
  }
  window.ppeIssDelete=function(){if(!ppeIssEditId)return;archiveIssuance(ppeIssEditId).catch(error=>toast(error.message,false));};
  window.ppeIssDeleteRow=function(id){archiveIssuance(id).catch(error=>toast(error.message,false));};

  function lockReplacementEditor(){
    document.querySelectorAll('[name="prf-status-radio"]').forEach(r=>{r.disabled=true;});
    ['prf-approved-by','prf-approved-date','prf-fulfilled-date','prf-new-iss-ref'].forEach(id=>{$(id).disabled=true;});
    const form=$('ppe-rep-form');if(form&&!$('prf-action-note')){
      const note=document.createElement('p');note.id='prf-action-note';note.textContent='Approval and fulfilment are recorded from the request’s View record actions. Fulfilment links an actual issuance.';
      form.querySelector('.card')?.after(note);
    }
  }
  const originalRepNew=window.ppeRepNew;
  window.ppeRepNew=async function(){
    await originalRepNew.apply(this,arguments);
    ['prf-inspection-id','prf-issuance-id','prf-new-issuance-id'].forEach(id=>{$(id).value='';});
    lockReplacementEditor();
  };
  const originalRepEdit=window.ppeRepEdit;
  window.ppeRepEdit=function(id){
    const result=originalRepEdit.apply(this,arguments);
    if(ppeRepEditId===id){const row=ppeRepData.find(item=>item.id===id)||{};
      $('prf-inspection-id').value=row.inspection_id||'';$('prf-issuance-id').value=row.issuance_id||'';$('prf-new-issuance-id').value=row.new_issuance_id||'';
      lockReplacementEditor();}
    return result;
  };

  async function currentReplacement(id){
    const rows=await api('/ppe_replacements?select=*&id=eq.'+encodeURIComponent(id)+cf()+'&limit=1');
    const row=rows?.[0];if(!row||row.company_id!==company())throw Error('Replacement request is no longer available in this company.');
    return row;
  }
  async function approveReplacement(id,button){
    const scope=company();button.disabled=true;
    try{const row=await currentReplacement(id);if(row.status!=='pending')throw Error('Only pending requests can be approved.');
      await api('/ppe_replacements?id=eq.'+encodeURIComponent(id)+'&company_id=eq.'+encodeURIComponent(scope),{m:'PATCH',p:'return=minimal',b:{status:'approved',approved_by:prof.full_name||personFullName(prof),approved_date:today(),updated_at:new Date().toISOString()}});
      if(company()!==scope)return;toast('Replacement approved. Link a new issuance to fulfil it.');$('ppe-record-view')?.remove();ppeLoadReplacements();
    }catch(error){toast('Approval failed: '+error.message,false);}finally{button.disabled=false;}
  }
  async function addFulfilmentPicker(host,row){
    const scope=company(),nav=host.querySelector('nav');if(!nav)return;
    const select=document.createElement('select');select.setAttribute('aria-label','Replacement issuance');select.add(new Option('Select new issuance...',''));nav.append(select);
    const button=document.createElement('button');button.className='btn btn-primary';button.type='button';button.textContent='Fulfil with selected issuance';nav.append(button);
    try{const rows=await api('/ppe_issuance?select=id,company_id,ppe_id,employee_name,issuance_ref,serial_number,issued_date,status'+cf()+'&order=issued_date.desc&limit=1000');
      if(company()!==scope||!host.isConnected)return;
      (rows||[]).filter(item=>item.company_id===scope&&item.id!==row.issuance_id&&item.ppe_id===row.ppe_id&&match(item.employee_name,row.employee_name)&&item.status==='active')
        .forEach(item=>select.add(new Option((item.issuance_ref||item.id.slice(0,8))+' · '+(item.serial_number||'no serial'),item.id)));
    }catch(error){toast('Issuances unavailable: '+error.message,false);}
    button.onclick=async function(){if(!select.value){toast('Select the exact new issuance.',false);return;}button.disabled=true;
      try{const current=await currentReplacement(row.id);if(current.status!=='approved')throw Error('Approve the request before fulfilment.');
        await api('/ppe_replacements?id=eq.'+encodeURIComponent(row.id)+'&company_id=eq.'+encodeURIComponent(scope),{m:'PATCH',p:'return=minimal',b:{status:'fulfilled',new_issuance_id:select.value,fulfilled_date:today(),updated_at:new Date().toISOString()}});
        if(company()!==scope)return;toast('Replacement fulfilled and linked to the new issuance.');host.remove();ppeLoadReplacements();
      }catch(error){toast('Fulfilment failed: '+error.message,false);}finally{button.disabled=false;}
    };
  }
  async function startReplacement(inspection){
    const scope=company(),existing=await api('/ppe_replacements?select=id&inspection_id=eq.'+encodeURIComponent(inspection.id)+cf()+'&limit=1');
    if(company()!==scope)return;
    if(existing?.length){ppeRecordWindow('replacements',existing[0].id,'view');return;}
    $('ppe-record-view')?.remove();ppeSwitchTab('replacements',$('ppe-tab-replacements'));await ppeRepNew();
    $('prf-inspection-id').value=inspection.id;$('prf-issuance-id').value=inspection.issuance_id||'';
    $('prf-ppe-id').value=inspection.ppe_id||'';fillPersonSelect('prf-emp-name',inspection.employee_name);$('prf-dept').value=inspection.department||'';
    $('prf-reason').value='inspection_fail';$('prf-urgency').value='urgent';$('prf-old-condition').value=inspection.defects_found||'Failed inspection';
    $('prf-notes').value='Inspection '+(inspection.inspection_ref||inspection.id.slice(0,8))+': '+(inspection.defects_found||'Failed PPE checks');
  }
  const originalShow=window.ppeShowRecord;
  window.ppeRecordDetails=function(kind,row){
    const hidden=new Set(['id','company_id','ppe_id','issuance_id','inspection_id','new_issuance_id','person_id','created_by','updated_by','created_at','updated_at','certificate_url','conformity_certificate_url']);
    const labels={ppe_code:'PPE code',issuance_ref:'Issuance reference',inspection_ref:'Inspection reference',replacement_ref:'Replacement reference',employee_id:'Employee number',employee_signature:'Receipt acknowledged',replacement_issued:'Replacement issued',overall_result:'Inspection result',return_condition:'Return condition',return_date:'Return date',next_inspection_date:'Next inspection',new_issuance_ref:'Replacement issuance'};
    const groups={};
    Object.keys(row).forEach(key=>{
      if(hidden.has(key)||/_id$/.test(key)&&key!=='employee_id'||row[key]===null||row[key]==='')return;
      let value=key==='notes'?ppeStripCertMeta(row[key]):row[key];
      if(typeof value==='boolean')value=value?'Yes':'No';
      else if(key==='checklist'&&Array.isArray(value))value=value.map(check=>String(check.item||'Check')+': '+String(check.result||'Unanswered').replace(/_/g,' ')).join('; ');
      else if(Array.isArray(value))value=value.join(', ');
      else if(typeof value==='object')return;
      if(/(?:_date|_at)$/.test(key)&&/^\d{4}-\d{2}-\d{2}/.test(String(value))){const date=new Date(String(value).slice(0,10)+'T00:00:00');if(!Number.isNaN(date.getTime()))value=date.toLocaleDateString('en-GB');}
      if(key==='category')value=(PPE_CAT_CFG[value]||{}).label||value;
      if(typeof value==='string'&&key!=='notes'&&key!=='defects_found')value=value.replace(/_/g,' ');
      const group=/employee|department|job_title|issued_by|requested_by/.test(key)?'People':/quantity|stock|reorder|cost|supplier|location/.test(key)?'Stock & supply':/date|expiry|service_life|inspection_interval/.test(key)?'Dates & assurance':/notes|reason|defect|checklist|action/.test(key)?'Notes & findings':'Record details';
      (groups[group]||(groups[group]=[])).push('<div class="ppe-record-field"><dt>'+escH(labels[key]||key.replace(/_/g,' '))+'</dt><dd>'+escH(String(value))+'</dd></div>');
    });
    return Object.keys(groups).map(group=>'<section class="ppe-record-section"><h3>'+escH(group)+'</h3><dl>'+groups[group].join('')+'</dl></section>').join('');
  };
  const originalCatNew=window.ppeCatNew,originalCatEdit=window.ppeCatEdit;
  function lockStockFields(locked){
    ['pcf-qty-total','pcf-qty-avail'].forEach(id=>{const field=$(id);if(field){field.readOnly=locked;field.title=locked?'Use Receive stock or Adjust stock from View record':'';}});
  }
  window.ppeCatNew=function(){lockStockFields(false);return originalCatNew.apply(this,arguments);};
  window.ppeCatEdit=function(){const result=originalCatEdit.apply(this,arguments);if(ppeCatEditId)lockStockFields(true);return result;};
  async function recordStock(item,type,suggestion){
    if(!isMgr())return;
    const scope=company();
    const raw=await appPrompt({title:type==='receipt'?'Receive PPE stock':'Adjust PPE stock',message:type==='receipt'?'Quantity received for '+item.name+' (minimum to rise above reorder threshold: '+suggestion+').':'Enter a signed quantity change for '+item.name+' (for example -1 or 2).',value:type==='receipt'?String(suggestion||1):'',placeholder:type==='receipt'?'Positive whole number':'Signed whole number'});
    if(raw===null)return;
    if(!/^[+-]?\d+$/.test(String(raw).trim())||Number(raw)===0||Math.abs(Number(raw))>100000||(type==='receipt'&&Number(raw)<0)){toast('Enter a valid whole-number quantity.',false);return;}
    const reason=await appPrompt({title:'Reason for stock movement',message:'Record why this PPE balance is changing.',placeholder:type==='receipt'?'Supplier delivery or purchase order':'Count discrepancy, damage or correction'});
    if(reason===null)return;
    if(reason.trim().length<4){toast('Enter a reason of at least four characters.',false);return;}
    const reference=await appPrompt({title:'Source reference',message:'Optional delivery note, purchase order or stock count reference.',placeholder:'Optional reference'});
    if(reference===null)return;
    if(company()!==scope){toast('Company changed. Reopen the PPE item.',false);return;}
    try{
      await api('/rpc/record_ppe_stock_movement',{m:'POST',p:'return=representation',b:{p_company_id:scope,p_ppe_id:item.id,p_movement_type:type,p_quantity_delta:Number(raw),p_reason:reason.trim(),p_source_reference:reference.trim()||null}});
      if(company()!==scope)return;
      toast('PPE stock movement saved.');$('ppe-record-view')?.remove();
      if($('ppe-view-inventory')?.style.display!=='none')ppeLoadInventory();
      else ppeLoadCatalogue();
    }catch(error){toast('Stock movement failed: '+error.message,false);}
  }
  async function showStockHistory(host,item){
    const scope=company(),content=host.querySelector('.ppe-record-content');if(!content)return;
    content.querySelector('.ppe-stock-history')?.remove();
    const section=document.createElement('section');section.className='ppe-record-section ppe-stock-history';
    const heading=document.createElement('h3');heading.textContent='Stock movement history';section.append(heading);
    const status=document.createElement('p');status.textContent='Loading stock movements...';section.append(status);content.append(section);
    try{
      const rows=await api('/ppe_stock_movements?select=movement_type,quantity_delta,reason,source_reference,available_before,available_after,total_before,total_after,created_at'+cf()+'&ppe_id=eq.'+encodeURIComponent(item.id)+'&order=created_at.desc&limit=50');
      if(company()!==scope||!host.isConnected)return;
      status.textContent=rows?.length?'History starts with the opening balance; earlier changes are not reconstructed.':'No stock movements recorded yet.';
      (rows||[]).forEach(row=>{
        const entry=document.createElement('p');const date=new Date(row.created_at);
        entry.textContent=(Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleString())+' · '+row.movement_type.replace(/_/g,' ')+' '+(row.quantity_delta>0?'+':'')+row.quantity_delta+' · available '+row.available_before+' → '+row.available_after+' · '+row.reason+(row.source_reference?' · '+row.source_reference:'');
        section.append(entry);
      });
    }catch(error){status.textContent='Stock history unavailable: '+error.message;}
  }
  window.ppeShowRecord=function(kind,row){
    originalShow.apply(this,arguments);
    const host=$('ppe-record-view'),nav=host?.querySelector('nav');if(!host||!nav)return;
    if(kind==='catalogue'){
      const suggestion=Math.max(0,Number(row.reorder_level||0)+1-Number(row.quantity_available||0));
      if(isMgr()){
        [['Receive stock','receipt'],['Adjust stock','adjustment']].forEach(([label,type])=>{
          const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=label;
          button.onclick=()=>recordStock(row,type,suggestion);nav.append(button);
        });
      }
      const history=document.createElement('button');history.type='button';history.className='btn';history.textContent='Stock history';
      history.onclick=()=>{history.disabled=true;showStockHistory(host,row).finally(()=>{history.disabled=false;});};nav.append(history);
    }
    if(kind==='inspections'&&['fail','condemn'].includes(row.overall_result)&&isMgr()){
      const button=document.createElement('button');button.type='button';button.className='btn btn-primary';button.textContent='Create replacement request';
      button.onclick=()=>startReplacement(row).catch(error=>toast(error.message,false));nav.append(button);
    }
    if(kind==='replacements'&&isMgr()){
      if(row.status==='pending'){const button=document.createElement('button');button.type='button';button.className='btn btn-primary';button.textContent='Approve request';button.onclick=()=>approveReplacement(row.id,button);nav.append(button);}
      if(row.status==='approved')addFulfilmentPicker(host,row);
      if(row.issuance_id){const link=document.createElement('button');link.type='button';link.className='btn';link.textContent='View original issuance';link.onclick=()=>ppeRecordWindow('issuance',row.issuance_id,'view');nav.append(link);}
      if(row.new_issuance_id){const link=document.createElement('button');link.type='button';link.className='btn';link.textContent='View replacement issuance';link.onclick=()=>ppeRecordWindow('issuance',row.new_issuance_id,'view');nav.append(link);}
    }
  };
  const originalInventory=window.ppeLoadInventory;
  window.ppeLoadInventory=async function(){
    const scope=company();await originalInventory.apply(this,arguments);
    try{
      const rows=await api('/ppe_issuance?select=id,company_id,ppe_id,quantity,status,return_condition'+cf()+'&limit=5000');
      if(company()!==scope)return;
      const byItem=new Map(),totals={inUse:0,damaged:0,maintenance:0};
      (rows||[]).filter(row=>row.company_id===scope).forEach(row=>{
        const count=Number(row.quantity)||1,balance=byItem.get(row.ppe_id)||{inUse:0,damaged:0,maintenance:0};
        if(row.status==='active')balance.inUse+=count;
        if(row.status==='quarantined')balance.maintenance+=count;
        if(row.status==='returned'&&['damaged','condemned'].includes(row.return_condition))balance.damaged+=count;
        byItem.set(row.ppe_id,balance);
      });
      byItem.forEach(balance=>{totals.inUse+=balance.inUse;totals.damaged+=balance.damaged;totals.maintenance+=balance.maintenance;});
      const issued=$('ppe-inventory-m3issued');if(issued)issued.textContent=totals.inUse;
      const cards=issued?.closest('.card')?.parentElement;
      if(cards){cards.querySelectorAll('.ppe-derived-balance').forEach(node=>node.remove());
        [['Returned damaged',totals.damaged],['Under maintenance',totals.maintenance]].forEach(([label,value])=>{
          const card=document.createElement('div');card.className='card ppe-derived-balance';
          const heading=document.createElement('div');heading.textContent=label;const number=document.createElement('div');number.textContent=value;
          card.append(heading,number);cards.append(card);
        });
      }
      const table=$('ppe-inventory-list')?.querySelector('table');if(!table)return;
      if(table.tHead?.rows[0]?.cells[4])table.tHead.rows[0].cells[4].textContent='In use';
      [...table.tBodies[0].rows].forEach((tr,index)=>{
        const item=ppeCatData[index],balance=byItem.get(item?.id)||{inUse:0,damaged:0,maintenance:0};
        if(tr.cells[4])tr.cells[4].textContent=balance.inUse;
        if(tr.cells[1]){const detail=document.createElement('div');detail.className='ppe-stock-detail';detail.textContent='Returned damaged: '+balance.damaged+' · Under maintenance: '+balance.maintenance;tr.cells[1].append(detail);
          const suggestion=Math.max(0,Number(item?.reorder_level||0)+1-Number(item?.quantity_available||0));
          if(item?.status==='active'&&suggestion>0){const note=document.createElement('div');note.className='ppe-stock-detail';note.textContent='Suggested minimum receipt: '+suggestion+' to rise above reorder level.';tr.cells[1].append(note);
            if(isMgr()){const button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent='Receive stock';button.onclick=event=>{event.stopPropagation();recordStock(item,'receipt',suggestion);};tr.cells[1].append(button);}}
        }
      });
    }catch(error){toast('Stock breakdown unavailable: '+error.message,false);}
  };
  const originalInspections=window.ppeLoadInspections;
  window.ppeLoadInspections=async function(){
    await originalInspections.apply(this,arguments);
    const table=$('ppe-insp-list')?.querySelector('table');if(!table)return;
    const start=new Date();start.setHours(0,0,0,0);const soon=new Date(start);soon.setDate(soon.getDate()+30);
    [...table.tBodies[0].rows].forEach((tr,index)=>{
      const date=ppeInspData[index]?.next_inspection_date,cell=tr.cells[7];if(!date||!cell)return;
      const due=new Date(date+'T00:00:00');
      cell.textContent=due.toLocaleDateString('en-GB')+(due<start?' · Overdue':due<=soon?' · Due soon':'');
    });
  };
})();
