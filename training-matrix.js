(function(root){
'use strict';

function el(tag,text){var e=document.createElement(tag);if(text!=null)e.textContent=String(text);return e;}
function button(text,callback){var b=el('button',text);b.type='button';b.className='btn';b.addEventListener('click',callback);return b;}

function formField(form,label,control){
  const wrap=el('label',label);
  wrap.className='training-workflow-field';
  wrap.appendChild(control);
  form.appendChild(wrap);
  return control;
}

var cmLayout=null, cmLoadSequence=0;

function cmCompanySelected(){
  return !isSA()||!!sephsCompanyContext;
}

function cmCanWrite(method){
  return cmCompanySelected()&&isMgr()&&!window.AurisUserAccess?.requestIssue(prof,'/competency_matrix',method);
}

function cmCanCreateColumn(){
  return cmCompanySelected()&&isMgr()&&!window.AurisUserAccess?.requestIssue(prof,'/competencies','POST');
}

function cmCurrentLayout(){
  if(!cmLayout||!cmCompanySelected())throw Error('Choose a company and reload the matrix.');
  TrainingWorkflow.assertContext(cmLayout.scope);
  return cmLayout;
}

async function cmSaveMembers(layout,axis,ids,add){
  TrainingWorkflow.assertContext(layout.scope);
  if(!cmCanWrite('PATCH'))throw Error('You do not have access to change the matrix layout.');
  const saved=await api('/rpc/set_training_matrix_members',{m:'POST',b:{
    p_company_id:layout.scope.company,p_axis:axis,p_ids:ids,p_add:add
  }});
  TrainingWorkflow.assertContext(layout.scope);
  if(saved?.company_id!==layout.scope.company)throw Error('The layout save could not be confirmed. Reload the matrix before trying again.');
}

function cmManageRows(trigger){
  const layout=cmCurrentLayout();
  if(!layout.settings.available||!cmCanWrite('PATCH'))return;
  pickMatrixMembers(layout.scope,'rows',layout.people,cmPeople.map(person=>person.id),trigger,async ids=>{
    await cmSaveMembers(layout,'rows',ids,false);
    toast('Matrix rows saved.');
    await cmLoad();
  });
}

function cmReset(trigger){
  const layout=cmCurrentLayout();
  if(!layout.settings.available||!cmCanWrite('PATCH')||!cmCanWrite('DELETE'))return;
  const companyName=sidebarViewedCompany()?.name||'the selected company';
  resetMatrix(layout.scope,companyName,trigger,async mode=>{
    if(!cmCanWrite('PATCH')||!cmCanWrite('DELETE'))throw Error('You do not have access to reset the matrix.');
    const result=await api('/rpc/reset_training_matrix',{m:'POST',b:{p_company_id:layout.scope.company,p_mode:mode}});
    TrainingWorkflow.assertContext(layout.scope);
    if(!Number.isInteger(result?.cleared_cells))throw Error('The reset could not be confirmed. Reload the matrix before trying again.');
    trainingAudit('update',mode==='full'?'Training matrix reset':'Training matrix cell data cleared','training_matrix_settings',
      {company_id:layout.scope.company},{mode,cleared_cells:result.cleared_cells});
    toast(mode==='full'?'Matrix cleared. Add rows and columns to rebuild it.':'Cell data cleared. Rows and columns were kept.');
    await cmLoad();
  });
}

async function cmLoad(){
  var loadContext=TrainingWorkflow.context();
  var el=document.getElementById('cm3table');
  if(!el)return;
  const request=++cmLoadSequence;
  cmLayout=null;
  cmPeople=[];
  cmCompetencies=[];
  cmAllData=[];
  const resetBtn=document.getElementById('cm3reset-btn'), rowsBtn=document.getElementById('cm3rows-btn'), addBtn=document.getElementById('cm3add-comp-btn');
  [resetBtn,rowsBtn,addBtn].forEach(button=>{if(button)button.hidden=true;});
  if(!loadContext.company||!cmCompanySelected()){
    el.innerHTML='<div class="loading-msg">Select a company to open its training matrix.</div>';
    return;
  }
  el.innerHTML='<div class="loading-msg">Loading...</div>';
  try{
    const companyFilter='&company_id=eq.'+encodeURIComponent(loadContext.company);
    var [comps, people_data, cm, settings] = await Promise.all([
      apiAllRows('/competencies?select=*'+companyFilter+'&order=sort_order,name,id'),
      apiAllRows('/people?select=id,company_id,first_name,last_name,job_title&status=eq.active'+companyFilter+'&order=last_name,first_name,id'),
      apiAllRows('/competency_matrix?select=*'+companyFilter+'&person_id=not.is.null&competency_id=not.is.null'),
      TrainingWorkflow.matrixSettings(loadContext.company)
    ]);
    if(request!==cmLoadSequence)return;
    TrainingWorkflow.assertContext(loadContext);
    cmLayout={scope:loadContext,settings,people:people_data,columns:comps};
    cmCompetencies=TrainingWorkflow.matrixMembers(comps,settings.competency_ids);
    cmPeople=TrainingWorkflow.matrixMembers(people_data,settings.person_ids);
    cmAllData=cm;
    if(resetBtn){
      resetBtn.hidden=!cmCanWrite('PATCH')||!cmCanWrite('DELETE');
      resetBtn.onclick=()=>settings.available?cmReset(resetBtn):toast('The Training Matrix reset upgrade needs to be installed before resetting the matrix.',false);
    }
    if(rowsBtn){rowsBtn.hidden=!settings.available||!cmCanWrite('PATCH');rowsBtn.onclick=()=>cmManageRows(rowsBtn);}
    if(addBtn)addBtn.hidden=!(cmCanCreateColumn()||(settings.available&&cmCanWrite('PATCH')));
    if(!cmCompetencies.length||!cmPeople.length){
      const missing=!cmCompetencies.length&&!cmPeople.length?'No rows or columns in this matrix.':!cmCompetencies.length?'No columns in this matrix.':'No people selected for this matrix.';
      el.innerHTML='<div class="loading-msg">'+missing+'</div>';
      return;
    }
    // Build matrix
    var cmMap={};
    cmAllData.forEach(function(r){cmMap[r.person_id+'_'+r.competency_id]=r;});

    var html='<table style="border-collapse:collapse;font-size:12px;min-width:100%">';
    // Header
    html+='<thead><tr><th style="padding:8px 12px;background:#1a3a5c;color:#fff;text-align:left;min-width:160px;position:sticky;left:0;z-index:3">Person / Role</th>';
    cmCompetencies.forEach(function(comp){
      html+='<th style="padding:6px 4px;background:#1a3a5c;color:#cce4ff;text-align:center;min-width:80px;font-size:10px;font-weight:600;max-width:90px;word-wrap:break-word">'+escH(comp.name)+'</th>';
    });
    if(isMgr())html+='<th style="padding:6px;background:#1a3a5c;width:60px"></th>';
    html+='</tr></thead><tbody>';
    // Rows
    cmPeople.forEach(function(p,pi){
      var bg=pi%2===0?'#fff':'#f9fafb';
      html+='<tr style="border-bottom:1px solid #f0f0f0">';
      html+='<td style="padding:8px 12px;background:'+bg+';position:sticky;left:0;z-index:2;border-right:2px solid #e5e7eb;font-weight:600">'
        +escH(p.last_name+', '+p.first_name)
        +'<br><span style="font-size:10px;color:var(--text2);font-weight:400">'+escH(p.job_title||'')+'</span>'
        +'</td>';
      cmCompetencies.forEach(function(comp){
        var entry=cmMap[p.id+'_'+comp.id];
        var cur=entry?entry.current_level:null;
        var req=entry?.required_level??null;
        var isGap=cur!==null&&req!==null&&cur<req;
        var bg2=cur!==null?LEVEL_COLORS[cur]:'#f9fafb';
        var col2=cur!==null?LEVEL_TEXT[cur]:'#ccc';
        html+='<td style="padding:4px;text-align:center;background:'+bg+'">'
          +'<button type="button" class="training-matrix-cell" style="background:'+bg2+';color:'+col2+';border-color:'+(isGap?'var(--red)':'transparent')+'" '
          +'title="'+escH(comp.name)+': '+escH(TrainingWorkflow.levelLabel(cur))+' (required: '+(req??'not recorded')+')" '
          +'aria-label="'+escH('View '+personFullName(p)+' · '+comp.name+' · '+TrainingWorkflow.levelLabel(cur))+'" '
          +'id="'+escH('training-matrix-'+p.id+'-'+comp.id)+'" data-pid="'+escH(p.id)+'" data-cid="'+escH(comp.id)+'" data-auris-generated-onclick="g0310">'
          +(cur!==null?cur:'-')
          +(isGap?'<span style="position:absolute;top:-4px;right:-4px;width:8px;height:8px;border-radius:50%;background:var(--red)"></span>':'')
          +'</button></td>';
      });
      if(isMgr()){
        html+='<td style="padding:4px;background:'+bg+'"></td>';
      }
      html+='</tr>';
    });
    html+='</tbody></table>';
    // Gap legend
    el.innerHTML=html+'<div style="padding:10px 16px;border-top:1px solid var(--border);background:#fafafa;font-size:11px;color:var(--text2);display:flex;gap:16px;flex-wrap:wrap">'
      +LEVEL_COLORS.map(function(c,i){return '<span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:14px;border-radius:3px;background:'+c+';border:1px solid #e5e7eb;display:inline-block"></span>'+TrainingWorkflow.levelLabel(i)+'</span>';}).join('')
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:14px;border-radius:3px;background:#fff;border:2px solid var(--red);display:inline-block"></span>Gap identified</span>'
      +'</div>';
  }catch(e){if(request===cmLoadSequence&&loadContext.company===TrainingWorkflow.context().company)el.innerHTML=registerErrorHtml('register',e.message);console.error(e);}
}


async function cmAddCompetency(){
  try{
    const layout=cmCurrentLayout();
    const create=cmCanCreateColumn()&&(!layout.settings.available||layout.settings.competency_ids===null||cmCanWrite('PATCH'));
    if(layout.settings.available&&layout.settings.competency_ids!==null&&cmCanWrite('PATCH')){
      const visible=new Set(cmCompetencies.map(comp=>comp.id));
      pickMatrixMembers(layout.scope,'columns',layout.columns.filter(comp=>!visible.has(comp.id)),[],
        document.getElementById('cm3add-comp-btn'),async ids=>{
          await cmSaveMembers(layout,'columns',ids,true);
          toast('Matrix columns added.');
          await cmLoad();
        },create?()=>cmCreateCompetency(layout):null);
    }else if(create)await cmCreateCompetency(layout);
  }catch(e){toastActionError('Add competency','Training & Competency',e);}
}

async function cmCreateCompetency(layout){
  try{
    var name=await appPrompt({title:'Add competency',message:'Competency name',placeholder:'e.g. Fire extinguisher use'});
    if(!name?.trim())return;
    var cat=await appPrompt({title:'Add competency',message:'Category',value:'General',placeholder:'e.g. Fire Safety, Technical, Personal'});
    if(cat==null)return;
    TrainingWorkflow.assertContext(layout.scope);
    if(!cmCanCreateColumn())return;
    var body={company_id:layout.scope.company,name:name.trim(),category:cat||'General',sort_order:layout.columns.length};
    var created=await api('/competencies',{m:'POST',p:'return=representation',b:body});
    TrainingWorkflow.assertContext(layout.scope);
    if(!created?.[0]?.id||created[0].company_id!==layout.scope.company)throw Error('The new competency could not be confirmed.');
    trainingAudit('create','Competency catalogue item added','competencies',created[0],{category:body.category});
    if(layout.settings.available&&cmCanWrite('PATCH')){
      try{await cmSaveMembers(layout,'columns',[created[0].id],true);}
      catch(error){toast('Competency created, but adding it to the matrix could not be confirmed. Reopen Add column to check.',false);await cmLoad();return;}
    }
    toast('Competency added.');
    await cmLoad();
  }catch(e){toastActionError('Add competency','Training & Competency',e);}
}


function matrixDialog(title,description,trigger,build){
  if(document.getElementById('training-matrix-dialog'))return;
  const dialog=el('dialog'), header=el('header'), heading=el('h2',title), form=el('form'), footer=el('footer');
  dialog.id='training-matrix-dialog';
  dialog.className='training-competency-dialog';
  heading.id='training-matrix-dialog-title';
  dialog.setAttribute('aria-labelledby',heading.id);
  header.append(heading,el('p',description));
  form.className='training-competency-editor';
  const cancel=button('Cancel',()=>dialog.close()), message=el('p');
  message.className='training-competency-message';
  message.setAttribute('role','status');
  footer.appendChild(cancel);
  dialog.append(header,form);
  const submit=el('button');
  submit.type='submit';
  function handle(label,action,danger=false){
    submit.textContent=label;
    submit.className='btn '+(danger?'btn-danger':'btn-primary');
    footer.appendChild(submit);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(cancel.disabled)return;
      const controls=Array.from(form.elements).filter(control=>!control.disabled);
      controls.forEach(control=>control.disabled=true);
      message.textContent=danger?'Resetting matrix…':'Saving layout…';
      try{await action();if(dialog.open)dialog.close();}
      catch(error){message.textContent=error.message;}
      finally{controls.forEach(control=>control.disabled=false);}
    });
  }
  build(form,footer,handle,dialog);
  form.append(message,footer);
  dialog.addEventListener('cancel',event=>{if(cancel.disabled)event.preventDefault();});
  dialog.addEventListener('close',()=>{dialog.remove();trigger?.focus();},{once:true});
  document.body.appendChild(dialog);
  dialog.showModal();
  cancel.focus();
}

function resetMatrix(scope,companyName,trigger,onReset){
  matrixDialog('Reset training matrix',
    'This applies to the entire matrix for '+companyName+', including departments hidden by filters. People, competency definitions, training records and existing actions are retained.',
    trigger,(form,footer,handle)=>{
      const select=el('select');
      select.required=true;
      select.add(new Option('Choose a reset option',''));
      select.add(new Option('Clear cell data only','cells'));
      select.add(new Option('Clear cells, rows and columns','full'));
      const detail=el('p','Select what you want to reset.');
      select.addEventListener('change',()=>{
        detail.textContent=select.value==='full'
          ? 'Clears current and required levels, notes and evidence links, and removes every row and column from the grid. Use Manage rows and Add column to rebuild it.'
          : select.value==='cells' ? 'Clears current and required levels, notes and evidence links. Keeps the rows and columns in place.' : 'Select what you want to reset.';
      });
      const confirmation=el('input');
      confirmation.required=true;
      confirmation.autocomplete='off';
      formField(form,'Reset option',select);
      form.appendChild(detail);
      formField(form,'Type RESET to confirm. This cannot be undone.',confirmation);
      handle('Reset matrix',async()=>{
        if(confirmation.value.trim().toUpperCase()!=='RESET')throw Error('Type RESET to confirm.');
        TrainingWorkflow.assertContext(scope);
        await onReset(select.value);
      },true);
    });
}

function pickMatrixMembers(scope,axis,items,selected,trigger,onSave,onCreate){
  const rows=axis==='rows';
  matrixDialog(rows?'Manage matrix rows':'Add matrix columns',
    rows?'Choose active People to show as rows. Their People profiles stay available.'
      :'Choose existing competencies to add as columns, or create a new one.',trigger,(form,footer,handle,dialog)=>{
      const options=el('div');
      options.className='training-matrix-picker';
      const search=el('input');
      search.type='search';
      formField(form,rows?'Find people':'Find competencies',search);
      const active=new Set(selected);
      const choices=items.map(item=>{
        const label=el('label'), input=el('input');
        const name=rows?personFullName(item)+(item.job_title?' · '+item.job_title:''):item.name;
        input.type='checkbox';
        input.value=item.id;
        input.checked=active.has(item.id);
        label.append(input,el('span',name));
        options.appendChild(label);
        return {label,input,name};
      });
      const empty=el('p',rows?'No matching active people.':'No matching competencies to add.');
      empty.hidden=choices.length>0;
      search.addEventListener('input',()=>{
        const query=search.value.trim().toLowerCase();
        choices.forEach(choice=>choice.label.hidden=!choice.name.toLowerCase().includes(query));
        empty.hidden=choices.some(choice=>!choice.label.hidden);
      });
      if(rows&&choices.length){
        const toggle=el('div');
        toggle.className='training-matrix-picker-actions';
        toggle.append(button('Select all',()=>choices.forEach(choice=>choice.input.checked=true)),
          button('Clear selection',()=>choices.forEach(choice=>choice.input.checked=false)));
        form.appendChild(toggle);
      }
      form.append(options,empty);
      if(onCreate)footer.appendChild(button('Create competency',()=>{dialog.close();onCreate();}));
      if(rows||choices.length)handle(rows?'Save rows':'Add selected columns',async()=>{
        const ids=choices.filter(choice=>choice.input.checked).map(choice=>choice.input.value);
        if(!rows&&!ids.length)throw Error('Select at least one competency.');
        TrainingWorkflow.assertContext(scope);
        await onSave(ids);
      });
    });
}

root.AurisTrainingMatrix=Object.freeze({load:cmLoad,addCompetency:cmAddCompetency});
})(typeof window!=='undefined'?window:globalThis);
