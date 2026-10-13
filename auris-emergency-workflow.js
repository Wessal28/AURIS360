/* Emergency plan consultation and safe draft/review workflow. Classic script: the
 * existing module functions are global and remain the source of record writes. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  function value(id){return ($(id)?.value||'').trim();}
  function section(label,text){var wrap=document.createElement('section'),heading=document.createElement('h3'),body=document.createElement('p');heading.textContent=label;body.textContent=text||'Not recorded';wrap.append(heading,body);return wrap;}
  async function viewPlan(id){
    try{
      var company=ccid();
      var rows=await api('/emergency_plans?select=*&id=eq.'+encodeURIComponent(id)+cf());
      if(ccid()!==company)throw Error('Company changed while opening this plan. Reopen it from the current register.');
      var plan=rows?.[0];if(!plan)throw Error('This plan is unavailable in the selected company.');
      $('emergency-plan-view')?.remove();
      var shade=document.createElement('div');shade.id='emergency-plan-view';shade.className='equipment-overlay';
      var article=document.createElement('article');article.className='equipment-window';article.setAttribute('role','dialog');article.setAttribute('aria-modal','true');article.setAttribute('aria-labelledby','emergency-plan-title');
      var header=document.createElement('header'),titles=document.createElement('div'),eyebrow=document.createElement('p'),title=document.createElement('h2'),meta=document.createElement('p'),close=document.createElement('button');
      eyebrow.textContent='Emergency response plan · Read only';title.id='emergency-plan-title';title.textContent=plan.title||'Emergency response plan';meta.textContent=[plan.plan_ref,plan.version&&'Revision '+plan.version,plan.status].filter(Boolean).join(' · ');close.className='btn';close.textContent='Close';close.addEventListener('click',function(){shade.remove();});titles.append(eyebrow,title,meta);header.append(titles,close);article.append(header);
      var nav=document.createElement('nav');nav.setAttribute('aria-label','Plan actions');if(isMgr()){
        var edit=document.createElement('button');edit.className='btn btn-primary';edit.textContent='Edit plan';edit.addEventListener('click',function(){shade.remove();emPlansData=[...(emPlansData||[]).filter(function(item){return item.id!==plan.id;}),plan];emPlanEdit(plan.id);});nav.append(edit);
      }article.append(nav);
      var content=document.createElement('div');content.className='equipment-content';
      [['Emergency type',plan.emergency_type],['Site / location',plan.site_name||plan.location],['Scope',plan.scope||plan.objectives],['Activation criteria',plan.activation_criteria],['Immediate actions',plan.immediate_actions],['Escalation',plan.escalation_procedure],['Communication',plan.communication_plan],['Recovery',plan.recovery_actions],['Approved by',plan.approved_by],['Review date',plan.review_date]].forEach(function(pair){content.append(section(pair[0],pair[1]));});
      article.append(content);shade.append(article);document.body.append(shade);close.focus();
    }catch(error){toast('Open emergency plan: '+error.message,false);}
  }
  window.emPlanView=viewPlan;
  async function viewBcp(id){
    try{var company=ccid(),row=(await api('/bcp_records?select=*&id=eq.'+encodeURIComponent(id)+cf()))?.[0];if(ccid()!==company)throw Error('Company changed while opening this BCP.');if(!row)throw Error('This BCP is unavailable in the selected company.');
      $('emergency-plan-view')?.remove();var shade=document.createElement('div');shade.id='emergency-plan-view';shade.className='equipment-overlay';var article=document.createElement('article');article.className='equipment-window';article.setAttribute('role','dialog');article.setAttribute('aria-modal','true');article.setAttribute('aria-labelledby','emergency-plan-title');
      var header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.id='emergency-plan-title';title.textContent=row.title+' · revision '+(row.version||'—');close.className='btn';close.textContent='Close';close.addEventListener('click',function(){shade.remove();});header.append(title,close);article.append(header);
      var nav=document.createElement('nav');if(isMgr()){var edit=document.createElement('button');edit.className='btn btn-primary';edit.textContent='Edit BCP';edit.addEventListener('click',function(){shade.remove();emBcpData=[...(emBcpData||[]).filter(function(item){return item.id!==row.id;}),row];bcpEdit(row.id);});nav.append(edit);}article.append(nav);
      var content=document.createElement('div');content.className='equipment-content';[['Status',row.status],['Business process',row.business_process],['Department',row.department],['Recovery time objective',row.rto_hours==null?'':row.rto_hours+' hours'],['Recovery point objective',row.rpo_hours==null?'':row.rpo_hours+' hours'],['Recovery strategy',row.recovery_strategy],['Recovery steps',row.recovery_steps],['Minimum resources',row.minimum_resources],['Alternate location',row.alternate_location],['Approved by',row.approved_by],['Review date',row.review_date]].forEach(function(pair){content.append(section(pair[0],pair[1]));});article.append(content);shade.append(article);document.body.append(shade);close.focus();
    }catch(error){toast('Open BCP: '+error.message,false);}
  }
  var originalPlansLoad=window.emPlansLoad;
  window.emPlansLoad=async function(){await originalPlansLoad();var rows=$('em3plans-list')?.querySelectorAll('tbody tr')||[];rows.forEach(function(row,index){var plan=emPlansData[index],cell=row.lastElementChild;if(!plan||!cell)return;var button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent='View plan';button.setAttribute('aria-label','View '+(plan.title||'plan'));button.addEventListener('click',function(){viewPlan(plan.id);});cell.prepend(button);});};
  var originalBcpLoad=window.bcpLoad;
  window.bcpLoad=async function(){await originalBcpLoad();var rows=$('em3bcp-list')?.querySelectorAll('tbody tr')||[];rows.forEach(function(row,index){var bcp=emBcpData[index],cell=row.lastElementChild;if(!bcp||!cell)return;var button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent='View BCP';button.addEventListener('click',function(){viewBcp(bcp.id);});cell.prepend(button);});};
  document.addEventListener('click',function(event){var item=event.target.closest('#em3dash-plans [data-auris-generated-onclick="g0175"]');if(!item)return;var items=[...$('em3dash-plans').querySelectorAll('[data-auris-generated-onclick="g0175"]')],plan=emPlansData[items.indexOf(item)];if(!plan)return;event.preventDefault();event.stopImmediatePropagation();viewPlan(plan.id);},true);

  var originalPlanSave=window.emPlanSave;
  window.emPlanSave=async function(){if(value('epf-status')==='active'){
      if(!value('epf-approved-by')||!value('epf-approved-date')||!value('epf-review-date')||!value('epf-activation')||!value('epf-immediate')){toast('Review before activation: record an approver, approval and review dates, activation criteria, and immediate actions.',false);return;}
      var previous=(emPlansData||[]).find(function(item){return item.id===emPlanEditId;});if(previous?.status!=='active'&&!(await appConfirmAction({title:'Activate response plan',message:'Confirm this revision has been reviewed and approved for operational use.',detail:'Plan: '+value('epf-title')+' · revision '+value('epf-version'),confirmText:'Activate plan',cancelText:'Continue editing'})))return;
    }return originalPlanSave();};
  var originalBcpSave=window.bcpSave;
  window.bcpSave=async function(){if(value('bcpf-status')==='active'){
      if(!value('bcpf-approved-by')||!value('bcpf-approved-date')||!value('bcpf-review-date')||!value('bcpf-strategy')||!value('bcpf-steps')){toast('Review before activation: record an approver, approval and review dates, recovery strategy, and recovery steps.',false);return;}
      var previous=(emBcpData||[]).find(function(item){return item.id===emBcpEditId;});if(previous?.status!=='active'&&!(await appConfirmAction({title:'Activate business continuity plan',message:'Confirm this revision has been reviewed and approved for operational use.',detail:'Plan: '+value('bcpf-title')+' · revision '+value('bcpf-version'),confirmText:'Activate BCP',cancelText:'Continue editing'})))return;
    }return originalBcpSave();};

  function drillPhase(){var completed=value('drf-status')==='completed';['drf-participated','drf-evac-time','drf-actual-dur','drf-all-accounted','drf-unaccounted'].forEach(function(id){var element=$(id);if(!element)return;var group=element.closest('.form3group')||element.closest('.auris-emergency-s-aa7c01383d');if(group)group.style.display=completed?'':'none';});['drf-strengths','drf-rating','drf-reviewed-by'].forEach(function(id){var card=$(id)?.closest('.card');if(card)card.style.display=completed?'':'none';});}
  function syncRating(){var rating=value('drf-rating');document.querySelectorAll('[name="drf-rating-radio"]').forEach(function(input){input.checked=input.value===rating;});}
  function addActionRow(){var row=document.createElement('div');row.className='emergency-action-row';var description=document.createElement('input'),owner=document.createElement('select'),due=document.createElement('input'),remove=document.createElement('button');description.placeholder='Corrective action';description.setAttribute('aria-label','Corrective action');owner.setAttribute('aria-label','Action owner');[...$('drf-action-owner').options].forEach(function(option){owner.add(option.cloneNode(true));});due.type='date';due.setAttribute('aria-label','Action due date');remove.type='button';remove.className='btn btn-sm';remove.textContent='Remove';remove.addEventListener('click',function(){row.remove();});row.append(description,owner,due,remove);$('drf-additional-actions').append(row);}
  document.addEventListener('click',function(event){if(event.target.id==='drf-add-action')addActionRow();});
  async function loadPlanChoices(selectId,selected){
    var select=$(selectId);if(!select)return;
    try{var company=ccid(),plans=await api('/emergency_plans?select=id,title,version,status'+cf()+'&order=title');if(ccid()!==company)return;
      select.replaceChildren(new Option('No linked plan',''));
      (plans||[]).filter(function(p){return p.status==='active'||String(p.id)===String(selected);}).forEach(function(p){var option=new Option((p.title||'Response plan')+' · revision '+(p.version||'—'),p.id);option.dataset.version=p.version||'';select.add(option);});select.value=selected||'';
    }catch(error){select.replaceChildren(new Option('Plan list unavailable',''));toast('Could not load response plans: '+error.message,false);}
  }
  async function loadDrillActions(id){
    var host=$('drf-linked-actions');if(!host)return;host.replaceChildren();if(!id)return;
    try{var rows=await api('/action_tracker?select=id,description,responsible,target_date,status&source_module=eq.emergency&source_id=eq.'+encodeURIComponent(id)+cf());
      if(!rows?.length){host.textContent='No linked follow-up actions yet.';return;}
      var heading=document.createElement('strong');heading.textContent='Linked follow-up actions';host.append(heading);
      rows.forEach(function(row){var button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent=(row.status||'Open')+' · '+(row.description||'Action')+' · '+(row.responsible||'Unassigned')+(row.target_date?' · due '+row.target_date:'');button.addEventListener('click',function(){showPage('actions');setTimeout(function(){mapOpenDetail(row.id);},150);});host.append(button);});
      if(rows.length===1){fillPersonSelect('drf-action-owner',rows[0].responsible||'');$('drf-action-due').value=rows[0].target_date||'';}
    }catch(error){host.textContent='Linked actions could not be loaded: '+error.message;}
  }
  var originalDrillNew=window.drillNew,originalDrillEdit=window.drillEdit;
  window.drillNew=function(){originalDrillNew();$('drf-rating').value='';$('drf-time').value='';$('drf-action-due').value='';$('drf-linked-actions').replaceChildren();$('drf-additional-actions').replaceChildren();fillPersonSelect('drf-action-owner');syncRating();drillPhase();loadPlanChoices('drf-plan');};
  window.drillEdit=async function(id){await originalDrillEdit(id);var row=(emDrillsData||[]).find(function(item){return item.id===id;});$('drf-additional-actions').replaceChildren();fillPersonSelect('drf-action-owner');syncRating();drillPhase();await Promise.all([loadPlanChoices('drf-plan',row?.plan_id),loadDrillActions(id)]);};
  var originalActivationNew=window.activationNew,originalActivationEdit=window.activationEdit;
  window.activationNew=function(){originalActivationNew();loadPlanChoices('actf-plan');};
  window.activationEdit=async function(id){await originalActivationEdit(id);var row=(emActivationsData||[]).find(function(item){return item.id===id;});await loadPlanChoices('actf-plan',row?.plan_id);};
  document.addEventListener('change',function(event){if(event.target.id==='drf-status')drillPhase();});
  var originalDrillSave=window.drillSave;
  window.drillSave=function(){if(value('drf-status')!=='completed'){$('drf-rating').value='';syncRating();}return originalDrillSave();};

  window.emEnsureDrillAction=async function(id,ref,body){
    if(body.status!=='completed')return;
    try{
    var actions=[];
    if(body.corrective_actions)actions.push({description:body.corrective_actions,owner:value('drf-action-owner')||body.reviewed_by||body.conducted_by||null,due:value('drf-action-due')||null});
    $('drf-additional-actions')?.querySelectorAll('.emergency-action-row').forEach(function(row){var fields=row.querySelectorAll('input,select'),description=fields[0]?.value?.trim();if(description)actions.push({description,owner:fields[1]?.value||null,due:fields[2]?.value||null});});
    if(!actions.length&&(['needs_improvement','failed'].includes(body.overall_rating)||body.unaccounted_persons>0))actions.push({description:body.weaknesses||'Emergency drill requires follow-up',owner:body.reviewed_by||body.conducted_by||null,due:null});
    if(!actions.length)return;
    var query='/action_tracker?select=id,description&source_module=eq.emergency&source_id=eq.'+encodeURIComponent(id)+cf();
    var existing=await api(query),known=new Set((existing||[]).map(function(row){return String(row.description||'').trim().toLowerCase();}));
    for(var action of actions){var key=action.description.toLowerCase();if(known.has(key))continue;
      await api('/action_tracker',{m:'POST',p:'return=minimal',b:{company_id:ccid(),source_module:'emergency',source_id:id,source_ref:ref+' - Emergency drill',description:action.description,responsible:action.owner,target_date:action.due,priority:body.overall_rating==='failed'||body.unaccounted_persons>0?'high':'medium',status:'open',created_by:prof?.id}});known.add(key);
    }
    }catch(error){setTimeout(function(){toast('Drill saved, but its follow-up action was not created: '+error.message,false);},0);}
  };
  window.emEnsurePlanReviewAction=async function(id,ref,body){
    if(!body.plan_update_required)return;
    try{
    var existing=await api('/action_tracker?select=id,description&source_module=eq.emergency&source_id=eq.'+encodeURIComponent(id)+cf());
    if((existing||[]).some(function(item){return String(item.description||'').startsWith('Review emergency plan after activation');}))return;
    var plan=body.plan_id?(await api('/emergency_plans?select=approved_by,title&id=eq.'+encodeURIComponent(body.plan_id)+cf()))?.[0]:null;
    var due=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    await api('/action_tracker',{m:'POST',p:'return=minimal',b:{company_id:ccid(),source_module:'emergency',source_id:id,source_ref:ref,description:'Review emergency plan after activation'+(plan?.title?': '+plan.title:''),responsible:plan?.approved_by||null,target_date:due,priority:'high',status:'open',created_by:prof?.id}});
    }catch(error){setTimeout(function(){toast('Activation saved, but the plan-review task was not created: '+error.message,false);},0);}
  };

  async function openSimulation(){
    var plans=await api('/emergency_plans?select=id,title,version&status=eq.active'+cf()+'&order=title');
    $('emergency-simulation')?.remove();var shade=document.createElement('div');shade.id='emergency-simulation';shade.className='equipment-overlay';var article=document.createElement('article');article.className='equipment-window';article.setAttribute('role','dialog');article.setAttribute('aria-modal','true');
    var header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.textContent='Emergency response simulation';close.className='btn';close.textContent='Close simulation';close.addEventListener('click',function(){shade.remove();});header.append(title,close);article.append(header);
    var content=document.createElement('div');content.className='equipment-content';var warning=document.createElement('p');warning.className='emergency-simulation-warning';warning.textContent='Practice only. No alert is sent, no activation is logged, and no operational status changes.';content.append(warning);
    var label=document.createElement('label');label.textContent='Practice plan and revision';var select=document.createElement('select');select.append(new Option('Choose an active plan',''));(plans||[]).forEach(function(plan){select.add(new Option(plan.title+' · revision '+(plan.version||'—'),plan.id));});label.append(select);content.append(label);
    var preview=document.createElement('button');preview.className='btn btn-primary';preview.textContent='View selected instructions';preview.addEventListener('click',function(){if(select.value)viewPlan(select.value);else toast('Choose a plan to practise.',false);});content.append(preview);
    ['Locate the nearest safe exit','Confirm the ERT contact route','Identify the muster point','Check the required equipment and isolation steps'].forEach(function(step){var item=document.createElement('label');var box=document.createElement('input');box.type='checkbox';item.append(box,document.createTextNode(' '+step));content.append(item);});article.append(content);shade.append(article);document.body.append(shade);close.focus();
  }

  async function loadMusterSites(selected){
    var select=$('mpf-site');if(!select)return;
    try{var company=ccid(),sites=await api('/sites?select=id,name,site_code,active'+cf()+'&order=name');if(ccid()!==company)return;select.replaceChildren(new Option('Select site...',''));
      (sites||[]).filter(function(site){return site.active!==false||String(site.id)===String(selected);}).forEach(function(site){select.add(new Option(site.name+(site.site_code?' · '+site.site_code:'')+(site.active===false?' · inactive':''),site.id));});select.value=selected||'';
    }catch(error){select.replaceChildren(new Option('Sites unavailable',''));toast('Could not load Site Map locations: '+error.message,false);}
  }
  var originalMusterNew=window.musterNew,originalMusterEdit=window.musterEdit;
  window.musterNew=function(){originalMusterNew();$('mpf-types').querySelectorAll('[data-legacy-type]').forEach(function(option){option.remove();});[...$('mpf-types').options].forEach(function(option){option.selected=false;});loadMusterSites();};
  window.musterEdit=async function(id){originalMusterEdit(id);var row=(emMusterData||[]).find(function(item){return item.id===id;});var types=row?.emergency_types||[];var select=$('mpf-types');select.querySelectorAll('[data-legacy-type]').forEach(function(option){option.remove();});types.forEach(function(type){var option=[...select.options].find(function(item){return item.value===type;});if(!option){option=new Option(type+' (legacy)',type);option.dataset.legacyType='';select.add(option);}option.selected=true;});await loadMusterSites(row?.site_id);};

  var originalDash=window.emLoadDash;
  window.emLoadDash=async function(){await originalDash();try{
    var realButton=document.querySelector('#em3view-dash [data-auris-onclick="h0647"]');if(realButton&&!$('emergency-simulate-button')){var simulate=document.createElement('button');simulate.type='button';simulate.id='emergency-simulate-button';simulate.className='btn';simulate.textContent='Practice simulation (no alerts)';simulate.addEventListener('click',function(){openSimulation().catch(function(error){toast('Simulation unavailable: '+error.message,false);});});realButton.parentElement.append(simulate);}
    var plans=await api('/emergency_plans?select=id,title,review_date,status'+cf());
    var today=new Date().toISOString().slice(0,10),soon=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    var due=(plans||[]).filter(function(p){return p.status==='active'&&p.review_date&&p.review_date<=soon;});
    var host=$('em3dash-plans')?.parentElement;if(!host)return;host.querySelector('[data-em-review-reminders]')?.remove();
    var drills=(emDrillsData||[]).filter(function(row){return row.status==='planned'&&row.drill_date&&row.drill_date<=soon;});
    var equipment=(emEqData||[]).filter(function(row){return row.status==='operational'&&[row.next_inspection,row.next_service].some(function(date){return date&&date<=soon;});});
    var certificates=(emErtData||[]).filter(function(row){return [row.first_aid_expiry,row.fire_warden_expiry].some(function(date){return date&&date<=soon;});});
    if(due.length||drills.length||equipment.length||certificates.length){var box=document.createElement('div');box.dataset.emReviewReminders='';box.className='emergency-review-reminders';box.textContent=[due.length+' plan reviews',drills.length+' drills',equipment.length+' equipment inspections/services',certificates.length+' ERT certificates'].join(' · ')+' due or overdue within 30 days';
      due.forEach(function(p){var button=document.createElement('button');button.className='btn btn-sm';button.textContent=(p.review_date<today?'Overdue: ':'Due: ')+(p.title||'Plan')+' · '+p.review_date;button.addEventListener('click',function(){viewPlan(p.id);});box.append(button);});
      drills.forEach(function(row){var button=document.createElement('button');button.className='btn btn-sm';button.textContent='Drill '+(row.drill_ref||'')+' · '+row.drill_date;button.addEventListener('click',async function(){emSwitchTab('drills',$('em3tab-drills'));await drillsLoad();drillEdit(row.id);});box.append(button);});
      equipment.forEach(function(row){var button=document.createElement('button');button.className='btn btn-sm';button.textContent='Equipment '+(row.identifier||row.equipment_type||'')+' · '+(row.next_inspection||row.next_service);button.addEventListener('click',async function(){emSwitchTab('equipment',$('em3tab-equipment'));await emEqLoad();emEqRecordWindow(row.id,'view');});box.append(button);});
      certificates.forEach(function(row){var button=document.createElement('button');button.className='btn btn-sm';button.textContent='ERT certificate: '+(row.name||'Member');button.addEventListener('click',function(){emSwitchTab('ert',$('em3tab-ert'));});box.append(button);});host.append(box);}
  }catch(error){console.warn('Emergency review reminders unavailable',error);}};
})();
