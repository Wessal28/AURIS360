(function(root){
'use strict';
function day(value){var s=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;var t=Date.parse(s+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?t:null;}
function localToday(now){var d=now||new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function expiry(value,now){var d=day(value),t=day(localToday(now));if(d===null)return {state:value?'invalid':'no_expiry',days:null,label:value?'Expiry needs correction':'No expiry recorded'};var days=(d-t)/86400000;return {state:days<0?'expired':days<90?'expiring':'current',days:days,label:days<0?'Expired':days<90?'Expiring within 90 days':'Current'};}
function filter(rows,query,mode,now){query=String(query||'').toLowerCase();return (rows||[]).filter(function(r){return (!query||[r.person_name,r.training_topic,r.certificate].join(' ').toLowerCase().includes(query))&&(!mode||expiry(r.expiry_date,now).state===mode);});}
function outcome(value){return value==='true'?true:value==='false'?false:null;}
function context(){return {company:String(ccid()||''),user:String(prof?.id||'')};}
function assertContext(c){if(!c.company||c.company!==String(ccid()||'')||c.user!==String(prof?.id||''))throw Error('Your account or company changed. Reopen the record.');}
function el(tag,text){var e=document.createElement(tag);if(text!=null)e.textContent=String(text);return e;}
function button(text,callback){var b=el('button',text);b.type='button';b.className='btn';b.addEventListener('click',callback);return b;}
function field(parent,label,type,value){var wrap=el('label',label),input=el('input');wrap.className='training-workflow-field';input.type=type||'text';input.value=value||'';wrap.appendChild(input);parent.appendChild(wrap);return input;}
function panel(title,back){document.getElementById('training-workflow-panel')?.remove();var host=el('section'),header=el('header');host.id='training-workflow-panel';host.className='card training-workflow-panel';header.append(el('h2',title),button('Back',function(){host.remove();back();}));host.appendChild(header);document.getElementById('page-training').appendChild(host);host.scrollIntoView({block:'start'});return host;}
function feedback(host,error){var p=host.querySelector('.training-workflow-feedback');if(!p){p=el('p');p.className='training-workflow-feedback';p.setAttribute('role','status');host.appendChild(p);}p.textContent=error;return p;}
function recordLabel(r){return [r.training_topic,r.person_name,r.training_date].filter(Boolean).join(' · ');}
async function fetchOne(table,id,c){var rows=await api('/'+table+'?select=*&company_id=eq.'+encodeURIComponent(c.company)+'&id=eq.'+encodeURIComponent(id)+'&limit=1');assertContext(c);if(rows?.length!==1||String(rows[0].id)!==String(id)||String(rows[0].company_id)!==c.company)throw Error('This record is unavailable in the selected company.');return rows[0];}
async function plansForForm(selected,version){var c=context(),select=document.getElementById('tfr-plan');if(!select)return;select.replaceChildren(new Option('Standalone training record',''));try{var plans=await api('/training_plan?select=id,company_id,training_topic,planned_date,actual_date,trainer,duration_hours&company_id=eq.'+encodeURIComponent(c.company)+'&order=planned_date.desc');assertContext(c);if(document.getElementById('tf-form').dataset.trainingVersion!==version)return;(plans||[]).filter(function(p){return String(p.company_id)===c.company;}).forEach(function(p){select.add(new Option(p.training_topic+' · '+(p.planned_date||'Date not scheduled'),p.id));});if(selected&&!Array.from(select.options).some(function(o){return o.value===selected;}))select.add(new Option('Linked session (details unavailable)',selected));select.value=selected||'';select.onchange=function(){var p=(plans||[]).find(function(x){return x.id===select.value&&String(x.company_id)===c.company;});if(!p)return;assertContext(c);document.getElementById('tfr-course').value=p.training_topic||'';document.getElementById('tfr-date').value=p.actual_date||p.planned_date||'';fillPersonSelect('tfr-trainer',p.trainer);setSelectValueWithFallback('tfr-trainer',p.trainer);document.getElementById('tfr-duration').value=p.duration_hours??'';};}catch(e){if(String(ccid()||'')===c.company&&String(prof?.id||'')===c.user&&document.getElementById('tf-form').dataset.trainingVersion===version){if(selected)select.add(new Option('Linked session (details unavailable)',selected));select.value=selected||'';select.title=e.message;}}}
function initRecord(row){var form=document.getElementById('tf-form');form.dataset.trainingVersion=crypto.randomUUID();form.dataset.trainingCompany=String(ccid()||'');form.dataset.trainingUser=String(prof?.id||'');document.getElementById('tfr-attendance').value=row?.attendance_status||'pending';plansForForm(row?.plan_id,form.dataset.trainingVersion);}
function participants(row){var select=document.getElementById('tp-participants');if(!select)return;select.replaceChildren();var selected=row?.participant_ids||[];(people||[]).filter(function(p){return String(p.company_id)===String(ccid());}).forEach(function(p){select.add(new Option(personFullName(p),p.id,false,selected.includes(p.id)));});document.getElementById('tp-create-attendance')?.remove();if(row?.id&&isMgr()){var b=button('Create attendee records',function(){attendance(row.id);});b.id='tp-create-attendance';select.after(b);}}
async function attendance(id){var c=context();try{if(!isMgr())throw Error('Manager access is required.');var plan=await fetchOne('training_plan',id,c),ppl=await api('/people?select=id,company_id,first_name,last_name&status=eq.active&company_id=eq.'+encodeURIComponent(c.company)+'&order=last_name');assertContext(c);lcuSwitch('sessions');document.getElementById('train-view-plan').style.display='none';var host=panel('Create attendee records · '+plan.training_topic,function(){lcuSwitch('sessions');}),form=el('form');form.className='training-workflow-form';host.append(el('p','Review the session details and select attendees. Records start with attendance and results pending. Edit each learner’s exceptions after saving.'),form);var date=field(form,'Session date','date',plan.actual_date||plan.planned_date),trainer=field(form,'Trainer','text',plan.trainer);date.required=true;var box=el('fieldset');box.appendChild(el('legend','Participants'));(ppl||[]).filter(function(p){return String(p.company_id)===c.company;}).forEach(function(p){var label=el('label'),cb=el('input');cb.type='checkbox';cb.value=p.id;cb.checked=(plan.participant_ids||[]).includes(p.id);label.append(cb,document.createTextNode(' '+personFullName(p)));box.appendChild(label);});form.appendChild(box);var save=el('button','Save pending attendee records');save.type='submit';save.className='btn btn-primary';form.appendChild(save);var busy=false;form.addEventListener('submit',async function(e){e.preventDefault();if(busy)return;try{assertContext(c);var ids=Array.from(box.querySelectorAll('input:checked')).map(function(x){return x.value;});if(!ids.length)throw Error('Select at least one attendee.');if(day(date.value)===null)throw Error('Enter a valid session date.');busy=true;save.disabled=true;feedback(host,'Saving attendee records…');var result=await api('/rpc/create_training_attendance',{m:'POST',b:{p_plan_id:id,p_people:ids,p_date:date.value,p_trainer:trainer.value||null}});assertContext(c);if(!Array.isArray(result)||result.length!==ids.length||result.some(function(r){return String(r.company_id)!==c.company||String(r.plan_id)!==String(id);}))throw Error('Save confirmation was incomplete. Reopen the session records before retrying.');if(!host.isConnected)return;host.remove();tfAllData=(tfAllData||[]).filter(function(r){return String(r.company_id)===c.company&&!result.some(function(x){return x.id===r.id;});}).concat(result);document.getElementById('tf-search').value=plan.training_topic;document.getElementById('tf-filter-exp').value='';lcuSwitch('records');tfFilter();toast(result.length+' linked learner records available. Existing records were retained.');}catch(err){if(c.company===String(ccid()||'')&&host.isConnected)feedback(host,err.message+' Your selections are retained.');}finally{busy=false;save.disabled=false;}});}catch(e){toastActionError('Create attendee records','Training',e);}}
function planFields(p){return [['Reference',p.training_ref||p.reference||'Training session'],['Training',p.training_topic],['Delivery',tpTypeLabel(p.training_type)],['Status',friendly(p.status)],['Planned date',p.planned_date],['Actual date',p.actual_date],['Trainer',p.trainer],['Provider',tpProviderFromRecord(p)],['Location',p.location],['Objective',p.objective],['Updated',p.updated_at?new Date(p.updated_at).toLocaleString():null]];}
function friendly(value){return String(value||'Not recorded').replace(/_/g,' ').replace(/^./,function(s){return s.toUpperCase();});}
async function viewPlan(id){var c=context();try{var p=await fetchOne('training_plan',id,c);aurisReadOnlyRecordModal('Training session',p.training_topic,p,planFields(p));var modal=document.getElementById('auris-readonly-record-modal');modal.querySelector('.auris-readonly-close')?.setAttribute('aria-label','Close training session');if(isMgr()){var footer=modal.querySelector('[role="dialog"]').lastElementChild;footer.prepend(button('Create attendee records',function(){modal.remove();attendance(p.id);}),button('Edit planned session',function(){assertContext(c);modal.remove();lcuSwitch('sessions');tpAllData=tpAllData.filter(function(x){return x.id!==p.id;}).concat([p]);tpOpen(p.id);}));}}catch(e){toastActionError('Open training session','Training',e);}}
async function viewRecord(id,back){var c=context();try{var r=await fetchOne('training_followup',id,c);lcuSwitch('records');var host=panel('Training record · '+recordLabel(r),back||function(){lcuSwitch('records');});host.trainingReturn=back;document.getElementById('train-view-followup').style.display='none';var dl=el('dl');[['Learner',r.person_name],['Course',r.training_topic],['Date',r.training_date],['Attendance',friendly(r.attendance_status||'pending')],['Result',r.passed===true?'Pass':r.passed===false?'Fail':'Pending assessment'],['Expiry',r.expiry_date||'No expiry recorded'],['Evidence review',friendly(r.evidence_review_status||'pending')],['Review note',r.evidence_review_note],['Refresher due',r.refresher_due]].forEach(function(x){dl.append(el('dt',x[0]),el('dd',x[1]||'Not recorded'));});host.appendChild(dl);if(r.plan_id)host.appendChild(button('View planned session',function(){viewPlan(r.plan_id);}));var url=r.certificate_url||r.evidence_url;if(url)host.appendChild(button('Preview certificate evidence',function(){trainingPreviewAttachment(url,r.certificate||r.training_topic);}));if(isMgr()){host.appendChild(button('Edit learner record',function(){host.remove();tfAllData=tfAllData.filter(function(x){return x.id!==r.id;}).concat([r]);tfOpen(r.id);}));host.appendChild(button('Review supporting evidence',function(){reviewEvidence(r,host,c);}));host.appendChild(button('Plan refresher',function(){host.remove();lcuSwitch('sessions');tpNew();document.getElementById('tp-topic').value=r.training_topic;document.getElementById('tp-group').value=r.person_name||'';document.getElementById('tp-type').value='refresher';document.getElementById('tp-planned-date').value=r.refresher_due||r.expiry_date||'';document.getElementById('tp-form').dataset.sourceTrainingId=r.id;participants({participant_ids:r.person_id?[r.person_id]:[]});}));}}catch(e){toastActionError('View training record','Training',e);}}
async function reviewEvidence(r,host,c){var decision=await appPrompt({title:'Evidence review',message:'Review the actual supporting evidence before recording a decision. This review does not grant work authorisation or practical competence.',options:[{value:'reviewed',label:'Evidence reviewed'},{value:'rejected',label:'Evidence rejected'}]});if(!decision)return;var note=await appPrompt({title:'Evidence review',message:'Record the evidence checked and the review conclusion.'});if(!note?.trim())return;try{assertContext(c);var saved=await api('/rpc/review_training_evidence',{m:'POST',b:{p_id:r.id,p_decision:decision,p_note:note}});assertContext(c);if(!saved?.id&& !saved?.[0]?.id)throw Error('Review confirmation was incomplete.');host.remove();await viewRecord(r.id,host.trainingReturn);toast('Evidence review saved. Competency decisions remain separate.');}catch(e){if(host.isConnected)feedback(host,e.message);}}
const competencyLevels = ['No knowledge','Theoretical','First experience','Good level','Expert'];

function levelLabel(value){
  return value!=null&&competencyLevels[value]!=null ? value+' · '+competencyLevels[value] : 'Not assessed';
}

function competency(personId, competencyId){
  const scope=context();
  const person=cmPeople.find(p=>p.id===personId&&String(p.company_id)===scope.company);
  const skill=cmCompetencies.find(c=>c.id===competencyId&&String(c.company_id)===scope.company);
  if(!person||!skill){
    toast('This cell is unavailable in the selected company. Reload the competency matrix.',false);
    return;
  }
  let entry=cmAllData.find(r=>r.person_id===personId&&r.competency_id===competencyId&&String(r.company_id)===scope.company);
  if(document.getElementById('training-competency-dialog'))return;

  const triggerId='training-matrix-'+personId+'-'+competencyId;
  const dialog=el('dialog');
  const heading=el('h2','Competency status');
  const personLabel=el('p',personFullName(person)+' · '+skill.name);
  const header=el('header');
  const content=el('div');
  const footer=el('footer');
  let saving=false;
  dialog.id='training-competency-dialog';
  dialog.className='training-competency-dialog';
  dialog.setAttribute('aria-labelledby','training-competency-dialog-title');
  heading.id='training-competency-dialog-title';
  heading.tabIndex=-1;
  header.append(heading,personLabel);
  dialog.append(header,content,footer);
  dialog.addEventListener('cancel',event=>{
    event.preventDefault();
    if(!saving)closeDialog();
  });
  dialog.addEventListener('close',restoreFocus);

  function restoreFocus(){
    if(!dialog.isConnected)return;
    dialog.remove();
    document.getElementById(triggerId)?.focus({preventScroll:true});
  }

  function closeDialog(){
    dialog.close();
    restoreFocus();
  }

  function canUpdate(){
    return isMgr()&&!root.AurisUserAccess?.requestIssue(prof,'/competency_matrix',entry?'PATCH':'POST');
  }

  function summaryField(list,label,value){
    const block=el('div');
    block.append(el('dt',label),el('dd',value));
    list.appendChild(block);
  }

  function showStatus(){
    heading.textContent='Competency status';
    const levels=el('dl');
    levels.className='training-competency-levels';
    const status=entry?.current_level==null ? 'Not assessed'
      : entry.required_level==null ? 'Required level not recorded'
      : entry.current_level<entry.required_level ? 'Below required level' : 'Meets required level';
    summaryField(levels,'Current level',levelLabel(entry?.current_level));
    summaryField(levels,'Required level',entry?.required_level!=null ? levelLabel(entry.required_level)
      : entry ? 'Not recorded' : levelLabel(2)+' (default)');
    summaryField(levels,'Status',status);

    const evidenceId=entry?.supporting_training_id;
    const evidence=el('p',evidenceId?'Loading linked evidence…':'No training record linked.');
    evidence.setAttribute('role','status');
    const notes=el('p',entry?.notes||'No assessment notes recorded.');
    notes.className='training-competency-notes';
    content.replaceChildren(levels,el('h3','Assessment notes'),notes,el('h3','Supporting evidence'),evidence);
    footer.replaceChildren(button('Close',closeDialog));
    if(canUpdate()){
      const update=button('Update competency',showEditor);
      update.classList.add('btn-primary');
      footer.appendChild(update);
    }
    heading.focus();
    if(!evidenceId)return;
    fetchOne('training_followup',evidenceId,scope).then(record=>{
      if(!dialog.open||!evidence.isConnected)return;
      if(record.person_id!==personId)throw Error('The linked training record is unavailable for this person.');
      evidence.textContent=recordLabel(record)+' · '+friendly(record.evidence_review_status||'pending')+' · '+expiry(record.expiry_date).label;
      content.appendChild(button('View training record',()=>{
        assertContext(scope);
        closeDialog();
        viewRecord(record.id,()=>{
          lcuSwitch('competency');
          competency(personId,competencyId);
        });
      }));
    }).catch(()=>{
      if(evidence.isConnected)evidence.textContent='A training record is linked. Its details are unavailable.';
    });
  }

  function formField(form,label,control){
    const wrap=el('label',label);
    wrap.className='training-workflow-field';
    wrap.appendChild(control);
    form.appendChild(wrap);
    return control;
  }

  function levelField(form,label,value,required){
    const select=el('select');
    select.required=required;
    select.add(new Option(required?'Select a level':'Not assessed',''));
    competencyLevels.forEach((_,index)=>select.add(new Option(levelLabel(index),String(index))));
    select.value=value==null?'':String(value);
    return formField(form,label,select);
  }

  function showEditor(){
    assertContext(scope);
    if(!canUpdate())return;
    heading.textContent='Update competency';
    const form=el('form');
    form.id='training-competency-editor';
    form.className='training-competency-editor';
    const levels=el('div');
    levels.className='training-competency-edit-levels';
    const current=levelField(levels,'Current level',entry?.current_level,false);
    const required=levelField(levels,'Required level',entry?.required_level??2,true);
    form.appendChild(levels);

    const evidence=formField(form,'Supporting training evidence',el('select'));
    evidence.add(new Option('Manual assessment',''));
    evidence.disabled=true;
    const notes=formField(form,'Assessment notes',el('textarea'));
    notes.required=true;
    notes.rows=4;
    notes.value=entry?.notes||'';
    const guidance=el('p','Record the assessment basis and any limitations.');
    const message=el('p','Loading available training evidence…');
    message.className='training-competency-message';
    message.setAttribute('role','status');
    form.append(guidance,message);
    content.replaceChildren(form);
    const cancel=button('Cancel',showStatus);
    const save=el('button','Save competency');
    save.type='submit';
    save.className='btn btn-primary';
    save.setAttribute('form',form.id);
    save.disabled=true;
    footer.replaceChildren(cancel,save);
    current.focus();

    const savedLink=entry?.supporting_training_id;
    const unavailable=new Option('Linked evidence is unavailable or no longer eligible',savedLink||'');
    if(savedLink){
      evidence.add(unavailable);
      evidence.value=savedLink;
      unavailable.disabled=true;
    }
    const enableEditor=()=>{
      evidence.disabled=false;
      save.disabled=!!savedLink&&evidence.value===savedLink&&unavailable.parentNode===evidence;
    };
    evidence.addEventListener('change',enableEditor);
    api('/training_followup?select=id,company_id,person_id,training_topic,person_name,training_date,passed,evidence_review_status,expiry_date&company_id=eq.'+encodeURIComponent(scope.company)+'&person_id=eq.'+encodeURIComponent(personId)+'&order=training_date.desc').then(records=>{
      assertContext(scope);
      if(!form.isConnected)return;
      const eligible=(records||[]).filter(r=>String(r.company_id)===scope.company&&r.person_id===personId
        &&r.passed===true&&r.evidence_review_status==='reviewed'&&!['expired','invalid'].includes(expiry(r.expiry_date).state));
      if(eligible.some(record=>record.id===savedLink))unavailable.remove();
      eligible.forEach(record=>evidence.add(new Option(recordLabel(record),record.id)));
      evidence.value=savedLink||'';
      message.textContent=unavailable.parentNode===evidence?'Select other evidence or choose Manual assessment.':'';
      enableEditor();
    }).catch(()=>{
      if(!form.isConnected)return;
      message.textContent=savedLink?'Training evidence could not be loaded. Cancel and try again to preserve the existing link.'
        :'Training evidence could not be loaded. You can still save a manual assessment.';
      if(!savedLink)enableEditor();
    });

    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(saving||save.disabled)return;
      const assessmentNotes=notes.value.trim();
      if(!assessmentNotes){
        message.textContent='Enter the assessment basis in the notes.';
        notes.focus();
        return;
      }
      const changes={
        current_level:current.value===''?null:Number(current.value),required_level:Number(required.value),
        supporting_training_id:evidence.value||null,notes:assessmentNotes
      };
      if(required.value==='')return;
      saving=true;
      save.disabled=true;
      cancel.disabled=true;
      message.textContent='Saving competency…';
      try{
        entry=await cmUpdateCell(scope,person,skill,entry,changes);
        assertContext(scope);
        if(dialog.open){
          await cmLoad();
          assertContext(scope);
          if(dialog.open)showStatus();
        }
      }catch(error){
        message.textContent=actionErrorMessage('Save competency','Training & Competency',error.message);
        save.disabled=false;
        cancel.disabled=false;
      }finally{
        saving=false;
      }
    });
  }

  document.body.appendChild(dialog);
  showStatus();
  dialog.showModal();
  heading.focus();
}

function validateInduction(topics,status){if(status!=='completed')return;var keys=INDUCTION_CHECKLIST_SECTIONS.flatMap(function(s){return s.items.map(function(x){return x[0];});}),missing=keys.filter(function(k){return !topics.includes(k)&&!topics.includes('na:'+k);});if(missing.length)throw Error('Complete each induction checklist item or explicitly mark it N/A before selecting Completed.');if(!topics.includes('entrant_declaration_understood'))throw Error('Confirm the entrant’s understanding before marking the induction Completed.');}
function initInduction(){document.getElementById('indf-status').value='in_progress';document.querySelectorAll('[name="ind-st-r"]').forEach(function(r){r.checked=r.value==='in_progress';});['indf-cert-issued','indf-sig'].forEach(function(id){document.getElementById(id).checked=false;});}
root.TrainingWorkflow=Object.freeze({expiry:expiry,filter:filter,outcome:outcome,localToday:localToday,context:context,assertContext:assertContext,initRecord:initRecord,participants:participants,attendance:attendance,viewPlan:viewPlan,viewRecord:viewRecord,competency:competency,levelLabel:levelLabel,validateInduction:validateInduction,initInduction:initInduction,friendly:friendly});
})(typeof window!=='undefined'?window:globalThis);
