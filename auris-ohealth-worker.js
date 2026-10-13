/* Worker-centred Occupational Health overview; loaded when dashboard opens. */
(function(){
  var $=function(id){return document.getElementById(id);};
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
    if(!isMgr())return;
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
    var ownerSelect=$(kind==='exam'?'msf-followup-owner':'expf-followup-owner');
    var assignment={assigned_to_id:ownerId||null,assigned_to_name:ownerId?ownerSelect?.selectedOptions?.[0]?.textContent:null,responsible:null,target_date:dueDate||null,source_ref:'Occupational Health follow-up',description:'Review the linked restricted Occupational Health record.'};
    if(open){await api('/action_tracker?id=eq.'+open.id,{m:'PATCH',p:'return=minimal',b:assignment});return;}
    await api('/action_tracker',{m:'POST',p:'return=minimal',b:Object.assign({company_id:company,source_module:'ohealth',source_id:sourceId,priority:'medium',status:'open',created_by:prof?.id},assignment)});
  };
  window.ohAfterHealthSave=async function(kind,id,body){
    if(!id)return;
    var table=kind==='exam'?'medical_surveillance':'exposure_monitoring';
    var ownerId=$(kind==='exam'?'msf-followup-owner':'expf-followup-owner')?.value||null;
    var links=kind==='exam'?{follow_up_owner_id:ownerId}:{follow_up_owner_id:ownerId,risk_assessment_id:$('expf-risk-assessment')?.value||null,audiometry_record_id:$('expf-audiometry')?.value||null,spirometry_record_id:$('expf-spirometry')?.value||null};
    try{await api('/'+table+'?id=eq.'+encodeURIComponent(id),{m:'PATCH',p:'return=minimal',b:links});}
    catch(error){toast('Record saved, but owner or linked records could not be updated: '+error.message,false);return;}
    var needed=kind==='exam'?(body.follow_up_required||body.referral_required):
      (body.recommended_actions||body.reassessment_date||body.exceeded_oel);
    if(needed)try{await window.ohEnsureFollowup(id,kind,body.follow_up_date||body.reassessment_date,ownerId);}
    catch(error){console.warn('Occupational Health follow-up was not created',error);toast('Record saved, but follow-up action failed: '+error.message,false);}
  };
  function requireOwner(kind){
    var field=$(kind==='exam'?'msf-followup-owner':'expf-followup-owner');
    var needed=kind==='exam'?($('msf-followup')?.checked||$('msf-referral')?.checked):
      (!!$('expf-actions')?.value.trim()||!!$('expf-reassess')?.value||
       (Number($('expf-oel-twa')?.value)>0&&Number($('expf-twa')?.value)>=Number($('expf-oel-twa')?.value)));
    if(needed&&!field?.value){toast('Select an Occupational Health follow-up owner before saving.',false);field?.focus();return false;}
    return true;
  }
  var originalMsSave=window.msSave,originalExpSave=window.expSave;
  window.msSave=function(){if(requireOwner('exam'))return originalMsSave();};
  window.expSave=function(){if(requireOwner('exposure'))return originalExpSave();};
  async function fillLinks(kind,record){
    var company=ccid(),recordId=record?.id||null,owner=$(kind==='exam'?'msf-followup-owner':'expf-followup-owner');if(!owner)return;
    owner.replaceChildren(new Option('Loading owners...',''));
    try{
      var queries=[api('/profiles?select=id,full_name,role,status'+cf()+'&status=eq.active&order=full_name')];
      if(kind==='exposure')queries.push(api('/risk_assessments?select=id,ra_ref,title,status'+cf()+'&order=created_at.desc&limit=300'),api('/audiometry_records?select=id,employee_name,test_date'+cf()+'&order=test_date.desc&limit=300'),api('/spirometry_records?select=id,employee_name,test_date'+cf()+'&order=test_date.desc&limit=300'));
      var result=await Promise.all(queries);if(ccid()!==company||(kind==='exam'?ohMsEditId:ohExpEditId)!==recordId)return;
      owner.replaceChildren(new Option('Select owner...',''));
      (result[0]||[]).filter(function(p){return ['occupational_health','sephs_admin'].includes(p.role);}).forEach(function(p){owner.add(new Option(p.full_name||'Occupational Health user',p.id));});
      owner.value=record?.follow_up_owner_id||'';
      if(kind==='exposure'){
        [['expf-risk-assessment',result[1],'risk_assessment_id',function(r){return (r.ra_ref||'Assessment')+' · '+(r.title||'Untitled');}],['expf-audiometry',result[2],'audiometry_record_id',function(r){return (r.test_date||'Undated')+' · '+(r.employee_name||'Audiometry');}],['expf-spirometry',result[3],'spirometry_record_id',function(r){return (r.test_date||'Undated')+' · '+(r.employee_name||'Spirometry');}]].forEach(function(item){var select=$(item[0]),saved=record?.[item[2]]||'';select.replaceChildren(new Option('None selected',''));(item[1]||[]).forEach(function(r){select.add(new Option(item[3](r),r.id));});if(saved&&!Array.from(select.options).some(function(option){return option.value===saved;}))select.add(new Option('Previously linked record',saved));select.value=saved;});
      }
    }catch(error){owner.replaceChildren(new Option('Owners unavailable',''));toast('Occupational Health links unavailable: '+error.message,false);}
  }
  var originalMsShowForm=window.msShowForm,originalExpShowForm=window.expShowForm;
  window.msShowForm=function(){originalMsShowForm();fillLinks('exam',ohMsData.find(function(r){return r.id===ohMsEditId;}));};
  window.expShowForm=function(){originalExpShowForm();fillLinks('exposure',ohExpData.find(function(r){return r.id===ohExpEditId;}));};
})();
