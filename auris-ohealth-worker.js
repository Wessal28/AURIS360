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
