/* Worker-centred Occupational Health overview; loaded when dashboard opens. */
(function(){
  var $=function(id){return document.getElementById(id);};
  var ownerField={exam:'msf-followup-owner',exposure:'expf-followup-owner',audiometry:'audf-followup-owner',spirometry:'spif-followup-owner'};
  var tableFor={exam:'medical_surveillance',exposure:'exposure_monitoring',audiometry:'audiometry_records',spirometry:'spirometry_records'};
  function clinicalAccess(){return ['occupational_health','sephs_admin','admin'].includes(prof?.role);}
  async function loadOperationalSummary(){
    var dashboard=$('oh-view-dash');if(!dashboard)return;
    document.querySelectorAll('[id^="oh-tab-"]').forEach(function(tab){tab.style.display=tab.id==='oh-tab-dash'?'':'none';});
    Array.from(dashboard.children).forEach(function(child){child.style.display=child.id==='oh-operational-summary'?'':'none';});
    var card=$('oh-operational-summary');if(!card){card=document.createElement('section');card.id='oh-operational-summary';card.className='card';dashboard.append(card);}
    card.replaceChildren();var heading=document.createElement('h3');heading.textContent='Fitness and work restrictions';card.append(heading);
    var note=document.createElement('p');note.textContent='Operational summary only. Clinical examination, test and disease records are restricted.';card.append(note);
    if(!['hse_manager','hse_officer','manager','site_manager','supervisor'].includes(prof?.role)){
      card.append(document.createTextNode('This summary is available to authorised operational roles.'));return;
    }
    var company=ccid(),status=document.createElement('p');status.textContent='Loading current fitness decisions...';card.append(status);
    try{
      var rows=await api('/rpc/occupational_fitness_summaries',{m:'POST',b:{p_company_id:company}});
      if(ccid()!==company)return;
      status.remove();if(!rows?.length){card.append(document.createTextNode('No fitness decisions are available for this company.'));return;}
      var wrap=document.createElement('div');wrap.className='table-wrap';var table=document.createElement('table');
      var header=document.createElement('tr');['Worker','Employee ID','Department','Examined','Next due','Fitness','Work restrictions'].forEach(function(value){var th=document.createElement('th');th.textContent=value;header.append(th);});
      var thead=document.createElement('thead');thead.append(header);table.append(thead);var body=document.createElement('tbody');
      var labels={fit:'Fit for work',fit_with_restrictions:'Fit with restrictions',temporarily_unfit:'Temporarily unfit',permanently_unfit:'Permanently unfit',pending:'Awaiting assessment'};
      rows.forEach(function(row){var tr=document.createElement('tr');[row.employee_name,row.employee_id,row.department,row.exam_date,row.next_exam_date,labels[row.fitness_status]||'Awaiting assessment',row.restrictions].forEach(function(value){var td=document.createElement('td');td.textContent=value||'—';tr.append(td);});body.append(tr);});
      table.append(body);wrap.append(table);card.append(wrap);
    }catch(error){if(ccid()===company)status.textContent='Fitness summary unavailable: '+error.message;}
  }
  function ensureWorkerPanel(){
    var dashboard=$('oh-view-dash');if(!dashboard||$('oh-worker-panel'))return;
    var card=document.createElement('section');card.id='oh-worker-panel';card.className='card oh-worker-panel';
    var title=document.createElement('h3');title.textContent='Worker health record overview';
    var label=document.createElement('label');label.htmlFor='oh-worker-select';label.textContent='Select worker';
    var select=document.createElement('select');select.id='oh-worker-select';select.append(new Option('Select worker...',''));
    var results=document.createElement('div');results.id='oh-worker-results';results.setAttribute('role','status');results.textContent='Choose a linked People record to see examination, test, vaccination and follow-up dates.';
    label.append(select);card.append(title,label,results);dashboard.prepend(card);
    select.addEventListener('change',function(){loadWorker(select.value);});
  }
  async function loadWorkers(){
    if(!clinicalAccess()){await loadOperationalSummary();return;}
    document.querySelectorAll('[id^="oh-tab-"]').forEach(function(tab){tab.style.display='';});
    var dashboard=$('oh-view-dash');if(dashboard)Array.from(dashboard.children).forEach(function(child){child.style.display=child.id==='oh-operational-summary'?'none':'';});
    ensureWorkerPanel();var select=$('oh-worker-select');if(!select)return;
    try{var company=ccid(),rows=await api('/people?select=id,first_name,last_name,status'+cf()+'&order=last_name&limit=1000');if(ccid()!==company)return;
      var chosen=select.value;select.replaceChildren(new Option('Select worker...',''));
      (rows||[]).forEach(function(row){select.add(new Option([row.first_name,row.last_name].filter(Boolean).join(' ')+(row.status==='active'?'':' ('+row.status+')'),row.id));});select.value=chosen;
    }catch(error){$('oh-worker-results').textContent='Worker list unavailable: '+error.message;}
  }
  async function loadWorker(personId){
    var output=$('oh-worker-results');if(!output)return;output.replaceChildren();if(!personId){output.textContent='Choose a worker.';return;}
    var company=ccid();output.textContent='Loading worker records...';
    var sources=[
      ['Examinations','medical_surveillance','surveillance','exam_date','fitness_status'],
      ['Audiometry','audiometry_records','audiometry','test_date','sts_right'],
      ['Spirometry','spirometry_records','spirometry','test_date','pattern'],
      ['Vaccinations','vaccination_records','vaccination','vaccination_date','status']
    ];
    try{var records=await Promise.all(sources.map(function(s){return api('/'+s[1]+'?select=id,person_id,employee_name,'+s[3]+','+s[4]+cf()+'&person_id=eq.'+encodeURIComponent(personId)+'&order='+s[3]+'.desc&limit=10');}));
      var actions=await api('/action_tracker?select=id,source_id,target_date,status&source_module=eq.ohealth'+cf()+'&status=neq.closed&limit=100');
      if(ccid()!==company||$('oh-worker-select')?.value!==personId)return;
      output.replaceChildren();var linkedIds=new Set();
      sources.forEach(function(s,index){var rows=records[index]||[],group=document.createElement('section'),heading=document.createElement('h4');heading.textContent=s[0]+' ('+rows.length+')';group.append(heading);
        rows.forEach(function(row){linkedIds.add(row.id);var button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent=(row[s[3]]||'Date not recorded')+' · '+(s[1]==='medical_surveillance'?({fit:'Fit for work',fit_with_restrictions:'Fit with restrictions',temporarily_unfit:'Temporarily unfit',permanently_unfit:'Permanently unfit',pending:'Awaiting assessment'}[row.fitness_status]||'Awaiting assessment'):s[1]==='vaccination_records'?(row.status||'Scheduled'):'Record available');
          button.addEventListener('click',async function(){ohSwitchTab(s[2],$('oh-tab-'+s[2]));var load={surveillance:ohMsLoad,audiometry:ohAudLoad,spirometry:ohSpiLoad,vaccination:vaxLoad}[s[2]];if(load)await load();if(ccid()!==company)return;var open={surveillance:msEdit,audiometry:audEdit,spirometry:spiEdit,vaccination:vaxEdit}[s[2]];if(open)open(row.id);});group.append(button);});output.append(group);
      });
      var follow=document.createElement('section'),heading=document.createElement('h4');heading.textContent='Open follow-ups';follow.append(heading);
      (actions||[]).filter(function(row){return linkedIds.has(row.source_id);}).forEach(function(row){var button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent=(row.target_date||'No due date')+' · '+(row.status||'Open')+' follow-up';button.addEventListener('click',function(){showPage('actions');setTimeout(function(){mapOpenDetail(row.id);},150);});follow.append(button);});
      if(follow.children.length===1)follow.append(document.createTextNode('No linked open actions in the loaded records.'));output.append(follow);
    }catch(error){if(ccid()===company)output.textContent='Worker records unavailable: '+error.message;}
  }
  var originalSwitch=window.ohSwitchTab;
  window.ohSwitchTab=function(tab,button){
    if(!clinicalAccess()&&tab!=='dash'){toast('Clinical Occupational Health records require clinical or administrator access.',false);return;}
    return originalSwitch.apply(this,arguments);
  };
  window.ohLoadWorkers=loadWorkers;
})();

/* Follow-up ownership and exposure links load with the OH dashboard. */
(function(){
  if(window.__ohExtendedLoaded)return;
  window.__ohExtendedLoaded=true;
  var $=function(id){return document.getElementById(id);};
  window.ohEnsureFollowup=async function(sourceId,kind,dueDate,ownerId){
    if(!sourceId)return;
    var company=ccid();
    var rows=await api('/action_tracker?select=id,target_date,status&source_module=eq.ohealth&source_id=eq.'+encodeURIComponent(sourceId)+cf()+'&limit=10');
    if(ccid()!==company)return;
    var open=(rows||[]).find(function(row){return !['closed','cancelled','completed'].includes(row.status);});
    var ownerSelect=$(ownerField[kind]);
    var assignment={assigned_to_id:ownerId||null,assigned_to_name:ownerId?ownerSelect?.selectedOptions?.[0]?.textContent:null,responsible:null,target_date:dueDate||null,source_ref:'Occupational Health follow-up',description:'Review the linked restricted Occupational Health record.'};
    if(open){await api('/action_tracker?id=eq.'+open.id,{m:'PATCH',p:'return=minimal',b:assignment});return;}
    await api('/action_tracker',{m:'POST',p:'return=minimal',b:Object.assign({company_id:company,source_module:'ohealth',source_id:sourceId,priority:'medium',status:'open',created_by:prof?.id},assignment)});
  };
  window.ohAfterHealthSave=async function(kind,id,body){
    if(!id)return;
    var table=tableFor[kind];if(!table)return;
    var ownerId=$(ownerField[kind])?.value||null;
    var links={follow_up_owner_id:ownerId};
    if(kind==='exposure')Object.assign(links,{risk_assessment_id:$('expf-risk-assessment')?.value||null,audiometry_record_id:$('expf-audiometry')?.value||null,spirometry_record_id:$('expf-spirometry')?.value||null});
    try{await api('/'+table+'?id=eq.'+encodeURIComponent(id),{m:'PATCH',p:'return=minimal',b:links});}
    catch(error){toast('Record saved, but owner or linked records could not be updated: '+error.message,false);return;}
    var needed=kind==='exam'?(body.follow_up_required||body.referral_required||['fit_with_restrictions','temporarily_unfit','permanently_unfit'].includes(body.fitness_status)):kind==='exposure'?
      (body.recommended_actions||body.reassessment_date||body.exceeded_oel):kind==='audiometry'?
      (body.referral_required||body.sts_right||body.sts_left||body.right_ear_result!=='normal'||body.left_ear_result!=='normal'):
      (body.referral_required||(body.pattern&&body.pattern!=='normal')||(body.fvc_pct_predicted!=null&&body.fvc_pct_predicted<80)||(body.fev1_pct_predicted!=null&&body.fev1_pct_predicted<80)||(body.fev1_fvc_measured!=null&&body.fev1_fvc_measured<70));
    if(needed)try{await window.ohEnsureFollowup(id,kind,body.follow_up_date||body.reassessment_date,ownerId);}
    catch(error){console.warn('Occupational Health follow-up was not created',error);toast('Record saved, but follow-up action failed: '+error.message,false);}
  };
  function requireOwner(kind){
    var field=$(ownerField[kind]);
    var audibleResult=['aud-r-result','aud-l-result'].some(function(id){var result=$(id)?.querySelector('span')?.textContent?.trim().toLowerCase();return result&&result!=='normal'&&result!=='-';});
    var needed=kind==='exam'?($('msf-followup')?.checked||$('msf-referral')?.checked||['fit_with_restrictions','temporarily_unfit','permanently_unfit'].includes($('msf-fitness')?.value)):kind==='exposure'?
      (!!$('expf-actions')?.value.trim()||!!$('expf-reassess')?.value||
       (Number($('expf-oel-twa')?.value)>0&&Number($('expf-twa')?.value)>=Number($('expf-oel-twa')?.value))):kind==='audiometry'?
      ($('audf-referral')?.checked||$('audf-sts-r')?.checked||$('audf-sts-l')?.checked||audibleResult):
      ($('spif-referral')?.checked||/obstructive|restrictive|mixed|borderline/i.test($('spi-interpretation')?.textContent||''));
    if(needed&&!field?.value){toast('Select an Occupational Health follow-up owner before saving.',false);field?.focus();return false;}
    return true;
  }
  var originalMsSave=window.msSave,originalExpSave=window.expSave,originalAudSave=window.audSave,originalSpiSave=window.spiSave;
  window.msSave=function(){if(requireOwner('exam'))return originalMsSave();};
  window.expSave=function(){if(requireOwner('exposure'))return originalExpSave();};
  window.audSave=function(){if(requireOwner('audiometry'))return originalAudSave();};
  window.spiSave=function(){if(requireOwner('spirometry'))return originalSpiSave();};
  async function fillLinks(kind,record){
    var company=ccid(),recordId=record?.id||null,owner=$(ownerField[kind]);if(!owner)return;
    owner.replaceChildren(new Option('Loading owners...',''));
    try{
      var queries=[api('/profiles?select=id,full_name,role,status'+cf()+'&status=eq.active&order=full_name')];
      if(kind==='exposure')queries.push(api('/risk_assessments?select=id,ra_ref,title,status'+cf()+'&order=created_at.desc&limit=300'),api('/audiometry_records?select=id,employee_name,test_date'+cf()+'&order=test_date.desc&limit=300'),api('/spirometry_records?select=id,employee_name,test_date'+cf()+'&order=test_date.desc&limit=300'));
      var result=await Promise.all(queries);var currentId={exam:ohMsEditId,exposure:ohExpEditId,audiometry:ohAudEditId,spirometry:ohSpiEditId}[kind];if(ccid()!==company||currentId!==recordId)return;
      owner.replaceChildren(new Option('Select owner...',''));
      (result[0]||[]).filter(function(p){return ['occupational_health','sephs_admin'].includes(p.role);}).forEach(function(p){owner.add(new Option(p.full_name||'Occupational Health user',p.id));});
      var savedOwner=record?.follow_up_owner_id||'';if(savedOwner&&!Array.from(owner.options).some(function(option){return option.value===savedOwner;}))owner.add(new Option('Previously assigned owner',savedOwner));owner.value=savedOwner;
      if(kind==='exposure'){
        [['expf-risk-assessment',result[1],'risk_assessment_id',function(r){return (r.ra_ref||'Assessment')+' · '+(r.title||'Untitled');}],['expf-audiometry',result[2],'audiometry_record_id',function(r){return (r.test_date||'Undated')+' · '+(r.employee_name||'Audiometry');}],['expf-spirometry',result[3],'spirometry_record_id',function(r){return (r.test_date||'Undated')+' · '+(r.employee_name||'Spirometry');}]].forEach(function(item){var select=$(item[0]),saved=record?.[item[2]]||'';select.replaceChildren(new Option('None selected',''));(item[1]||[]).forEach(function(r){select.add(new Option(item[3](r),r.id));});if(saved&&!Array.from(select.options).some(function(option){return option.value===saved;}))select.add(new Option('Previously linked record',saved));select.value=saved;});
      }
    }catch(error){owner.replaceChildren(new Option('Owners unavailable',''));toast('Occupational Health links unavailable: '+error.message,false);}
  }
  var originalMsShowForm=window.msShowForm,originalExpShowForm=window.expShowForm,originalAudShowForm=window.audShowForm,originalSpiShowForm=window.spiShowForm;
  window.msShowForm=function(){originalMsShowForm();fillLinks('exam',ohMsData.find(function(r){return r.id===ohMsEditId;}));};
  window.expShowForm=function(){originalExpShowForm();fillLinks('exposure',ohExpData.find(function(r){return r.id===ohExpEditId;}));};
  window.audShowForm=function(){originalAudShowForm();fillLinks('audiometry',ohAudData.find(function(r){return r.id===ohAudEditId;}));};
  window.spiShowForm=function(){originalSpiShowForm();fillLinks('spirometry',ohSpiData.find(function(r){return r.id===ohSpiEditId;}));};
  document.addEventListener('click',async function(event){
    var button=event.target.closest('.oh-linked-view');if(!button)return;
    var config={
      'risk-assessment':['expf-risk-assessment','risk_assessments','Risk assessment',function(row){return [['Reference',row.ra_ref],['Title',row.title],['Activity',row.activity],['Status',row.status],['Review date',row.review_date]];}],
      audiometry:['expf-audiometry','audiometry_records','Audiometry test',function(row){return [['Worker',row.employee_name],['Test date',row.test_date],['Next test',row.next_test_date],['Referral required',row.referral_required?'Yes':'No']];}],
      spirometry:['expf-spirometry','spirometry_records','Spirometry test',function(row){return [['Worker',row.employee_name],['Test date',row.test_date],['Next test',row.next_test_date],['Referral required',row.referral_required?'Yes':'No']];}]
    }[button.dataset.link];if(!config)return;
    var id=$(config[0])?.value;if(!id){toast('Select a linked record first.',false);return;}
    var company=ccid();button.disabled=true;
    try{var rows=await api('/'+config[1]+'?select=*&id=eq.'+encodeURIComponent(id)+cf()+'&limit=1');
      if(ccid()!==company)return;
      var row=rows?.[0];if(!row){toast('The linked record is unavailable for this company or your access.',false);return;}
      aurisReadOnlyRecordModal(config[2],row.title||row.employee_name||config[2],row,config[3](row));
    }catch(error){if(ccid()===company)toast('Linked record could not be opened: '+error.message,false);}
    finally{button.disabled=false;}
  });
})();
