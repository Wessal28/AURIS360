(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  window.ohOpenMedicalSummary=function(row){
    var labels={fit:'Fit for work',fit_with_restrictions:'Fit with restrictions',temporarily_unfit:'Temporarily unfit',permanently_unfit:'Permanently unfit',pending:'Awaiting assessment'};
    return aurisReadOnlyRecordModal('Fitness and restrictions',row.employee_name||'Medical examination',Object.assign({},row,{reference_no:row.examination_ref}),[
      ['Examination reference',row.examination_ref||row.id],['Employee',row.employee_name],['Employee ID',row.employee_id],
      ['Department',row.department],['Examination type',String(row.exam_type||'').replace(/_/g,' ')],
      ['Examination date',row.exam_date],['Next due',row.next_exam_date],
      ['Fitness decision',labels[row.fitness_status]||'Awaiting assessment'],['Work restrictions',row.restrictions],
      ['Follow-up',row.follow_up_required?'Follow-up required':'No follow-up'],['Follow-up date',row.follow_up_date],
      ['Status',String(row.status||'').replace(/_/g,' ')]]);
  };
  window.ohEnsureFollowup=async function(sourceId,kind,dueDate){
    if(!sourceId)return;
    var company=ccid();
    var rows=await api('/action_tracker?select=id,target_date,status&source_module=eq.ohealth&source_id=eq.'+encodeURIComponent(sourceId)+cf()+'&limit=10');
    if(ccid()!==company)return;
    if((rows||[]).some(function(row){return !['closed','cancelled','completed'].includes(row.status);}))return;
    await api('/action_tracker',{m:'POST',p:'return=minimal',b:{company_id:company,source_module:'ohealth',source_id:sourceId,source_ref:'Occupational Health '+kind,description:'Review the linked occupational health follow-up in the restricted record.',target_date:dueDate||null,priority:'medium',status:'open',created_by:prof?.id}});
  };
  window.ohAfterHealthSave=async function(kind,id,body){
    var needed=kind==='exam'?(body.follow_up_required||body.referral_required):
      (body.recommended_actions||body.reassessment_date);
    if(needed)try{await window.ohEnsureFollowup(id,kind,body.follow_up_date||body.reassessment_date);}
    catch(error){console.warn('Occupational Health follow-up was not created',error);toast('Record saved, but follow-up action failed: '+error.message,false);}
  };
  document.addEventListener('change',function(event){
    if(event.target.name==='ms-fitness')$('msf-fitness').value=event.target.value;
    if(['audf-name','audf-date','audf-baseline'].includes(event.target.id))loadBaselines();
  });
  document.addEventListener('input',function(event){
    if(['spi-fvc-pred','spi-fvc-meas','spi-fev1-pred','spi-fev1-meas','spi-ratio-meas'].includes(event.target.id))spiCalc();
  });
  async function loadBaselines(selected){
    var select=$('audf-comparison-baseline');if(!select)return;
    var person=typeof personFromValue==='function'?personFromValue($('audf-name')?.value):null;
    var company=ccid(),testDate=$('audf-date')?.value;
    select.replaceChildren(new Option('No comparison baseline selected',''));
    if(!person?.id||!testDate||$('audf-baseline')?.checked)return;
    try{var rows=await api('/audiometry_records?select=id,person_id,test_date,is_baseline&person_id=eq.'+encodeURIComponent(person.id)+'&is_baseline=eq.true'+cf()+'&order=test_date.desc');
      if(ccid()!==company||personFromValue($('audf-name')?.value)?.id!==person.id)return;
      (rows||[]).filter(function(row){return row.test_date<testDate;}).forEach(function(row){select.add(new Option('Baseline '+row.test_date+' · '+row.id.slice(0,8),row.id));});
      select.value=selected||'';
    }catch(error){select.replaceChildren(new Option('Baselines unavailable',''));toast('Audiometry baselines unavailable: '+error.message,false);}
  }
  window.ohLoadAudiometryBaselines=loadBaselines;

  var originalDash=window.ohLoadDash;
  window.ohLoadDash=async function(){
    await originalDash();
    try{
      if(!window.ohLoadWorkers)await new Promise(function(resolve,reject){
        var script=document.createElement('script');script.src='auris-ohealth-worker.js?v=20261013-1';
        script.onload=resolve;script.onerror=function(){reject(new Error('Worker overview could not load.'));};document.head.append(script);
      });
      await window.ohLoadWorkers();
    }catch(error){toast(error.message,false);}
  };
})();
