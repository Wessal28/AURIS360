(function(root){
  'use strict';
  var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var suggestions=[
    ['HSE responsibilities and reporting','Who is responsible for reporting hazards?\nHow do we report near misses?\nWhen should work stop?'],
    ['Hazard identification and risk assessment','What hazards are present today?\nWhich controls must be checked before work?\nWhat changes require a new assessment?'],
    ['Personal protective equipment','Which PPE is required for each task?\nHow do we inspect and replace damaged PPE?\nWhat protection does PPE not provide?'],
    ['Working at height','When is fall protection required?\nHow are ladders and scaffolds checked?\nWhat is the rescue plan?'],
    ['Manual handling and ergonomics','Can the lift be avoided or assisted?\nHow do we plan team lifts?\nWhat early signs of strain should be reported?'],
    ['Fire prevention','What ignition sources are present?\nWhere are extinguishers and exits?\nHow do we raise the alarm?'],
    ['Electrical safety and isolation','Who may work on electrical equipment?\nHow is energy isolated and verified?\nWhat should happen when a cable is damaged?'],
    ['Heat stress and occupational health','How do we recognise heat illness?\nWhen are water, shade and rest needed?\nHow is a colleague helped in an emergency?'],
    ['Chemical safety','Where are safety data sheets kept?\nHow are chemicals labelled and stored?\nWhat is the spill response?'],
    ['Vehicle and pedestrian safety','How are people separated from moving vehicles?\nWhat checks are required before driving?\nHow are reversing and blind spots managed?'],
    ['Emergency preparedness','Who calls for help?\nWhere is the assembly point?\nWhat did we learn from the last drill?'],
    ['Lessons learned and next-year priorities','Which incidents and near misses taught us most?\nWhich controls need improvement?\nWhat topics should next year include?']
  ];
  var state={year:new Date().getFullYear(),company:null,rows:[],busy:false,loading:false,editing:null,formOpen:false,error:''};
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function rootEl(){return document.getElementById('safety-awareness-root');}
  function company(){return typeof ccid==='function'?ccid():null;}
  function canEdit(){return typeof isMgr==='function' && isMgr();}
  function points(value){return String(value||'').split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean);}
  function render(){
    var host=rootEl();if(!host)return;
    var source=state.rows.length?state.rows:(state.loading||state.error?[]:suggestions.map(function(s,i){return {planned_month:i+1,theme:s[0],discussion_points:points(s[1]),suggested:true};}));
    var cards=months.map(function(month,i){
      var items=source.filter(function(row){return Number(row.planned_month)===i+1;});
      return '<section class="saw-month"><h3><span>'+String(i+1).padStart(2,'0')+'</span> '+month+'</h3>'+(items.length?items.map(function(row){
        return '<article class="saw-topic"><div class="saw-topic-head"><strong>'+esc(row.theme)+'</strong>'+(row.suggested?'<small>Suggested</small>':canEdit()?'<span><button type="button" class="saw-icon" data-action="edit" data-id="'+esc(row.id)+'" title="Edit topic" aria-label="Edit '+esc(row.theme)+'"><i class="ti ti-pencil"></i></button><button type="button" class="saw-icon" data-action="delete" data-id="'+esc(row.id)+'" title="Remove topic" aria-label="Remove '+esc(row.theme)+'"><i class="ti ti-trash"></i></button></span>':'')+'</div><ul>'+((Array.isArray(row.discussion_points)?row.discussion_points:points(row.discussion_points)).map(function(p){return '<li>'+esc(p)+'</li>';}).join(''))+'</ul></article>';
      }).join(''):'<p class="saw-empty">No topic planned</p>')+'</section>';
    }).join('');
    host.innerHTML='<div class="saw-header"><div><h2>Safety Awareness</h2><p>Plan HSE themes and talking points by month for the selected company.</p></div><div class="saw-actions"><label for="saw-year">Year</label><input id="saw-year" type="number" min="2020" max="2100" value="'+state.year+'">'+(canEdit()?'<button type="button" class="btn btn-primary" data-action="add"><i class="ti ti-plus"></i> Add topic</button>':'')+'</div></div>'+(state.loading?'<p class="loading-msg">Loading awareness plan...</p>':'')+(state.error?'<p class="saw-error" role="alert">'+esc(state.error)+'</p>':'')+(!state.rows.length&&!state.loading&&!state.error?'<div class="saw-suggestion">These are example topics, not saved company records.'+(canEdit()?'<button type="button" class="btn" data-action="use-plan">Use suggested 12-month plan</button>':'')+'</div>':'')+'<div class="saw-grid">'+cards+'</div>'+(state.formOpen?'<form id="saw-form" class="saw-form"><h3>'+(state.editing?'Edit topic':'Add topic')+'</h3><div class="saw-fields"><label>Month<select name="month" required>'+months.map(function(m,i){return '<option value="'+(i+1)+'"'+(state.editing&&Number(state.editing.planned_month)===i+1?' selected':'')+'>'+m+'</option>';}).join('')+'</select></label><label>HSE theme / topic<input name="theme" maxlength="200" required value="'+esc(state.editing&&state.editing.theme||'')+'"></label></div><label>Points to discuss <span>(one per line)</span><textarea name="points" rows="5" required>'+esc(state.editing?(Array.isArray(state.editing.discussion_points)?state.editing.discussion_points.join('\n'):state.editing.discussion_points):'')+'</textarea></label><div class="saw-form-actions"><button type="button" class="btn" data-action="cancel">Cancel</button><button type="submit" class="btn btn-primary"'+(state.busy?' disabled':'')+'>Save topic</button></div></form>':'');
  }
  async function load(){
    var id=company();state.company=id;state.error='';state.rows=[];state.loading=true;render();if(!id){state.loading=false;state.error='Select a company to view its plan.';render();return;}
    var year=state.year;
    try{var result=await api('/safety_awareness_topics?select=id,company_id,plan_year,planned_month,theme,discussion_points&company_id=eq.'+encodeURIComponent(id)+'&plan_year=eq.'+year+'&order=planned_month.asc,created_at.asc');if(company()!==id||state.year!==year)return;state.rows=Array.isArray(result)?result:[];}
    catch(e){if(company()!==id)return;state.error='Safety Awareness records could not be loaded. The database setup may still be required.';}
    state.loading=false;render();
  }
  async function persist(body,id){
    var cid=company();if(!cid||cid!==state.company||state.busy)return;
    state.busy=true;render();
    try{if(id){await api('/safety_awareness_topics?id=eq.'+encodeURIComponent(id)+'&company_id=eq.'+encodeURIComponent(cid),{m:'PATCH',b:body,p:'return=representation'});}else{await api('/safety_awareness_topics',{m:'POST',b:Object.assign({company_id:cid,plan_year:state.year},body),p:'return=representation'});}state.formOpen=false;state.editing=null;state.error='';await load();}
    catch(e){state.error='The topic could not be saved. Please try again.';}
    finally{state.busy=false;render();}
  }
  async function handleClick(event){
    var button=event.target.closest('[data-action]');if(!button||!rootEl().contains(button))return;
    var action=button.dataset.action,id=button.dataset.id;
    if(action==='add'){state.formOpen=true;state.editing=null;render();rootEl().querySelector('#saw-form').scrollIntoView({behavior:'smooth',block:'start'});rootEl().querySelector('[name="theme"]').focus();}
    if(action==='cancel'){state.formOpen=false;state.editing=null;render();}
    if(action==='edit'){state.editing=state.rows.find(function(r){return r.id===id;})||null;state.formOpen=!!state.editing;render();if(state.formOpen)rootEl().querySelector('#saw-form').scrollIntoView({behavior:'smooth',block:'start'});}
    if(action==='delete'&&canEdit()&&root.confirm('Remove this safety awareness topic?')){var cid=company();try{await api('/safety_awareness_topics?id=eq.'+encodeURIComponent(id)+'&company_id=eq.'+encodeURIComponent(cid),{m:'DELETE'});await load();}catch(e){state.error='The topic could not be removed.';render();}}
    if(action==='use-plan'&&canEdit()&&!state.rows.length&&!state.busy){var cid=company();state.busy=true;button.disabled=true;try{var body=suggestions.map(function(s,i){return {company_id:cid,plan_year:state.year,planned_month:i+1,theme:s[0],discussion_points:points(s[1])};});await api('/safety_awareness_topics',{m:'POST',b:body,p:'return=representation'});await load();}catch(e){state.error='The suggested plan could not be saved. Please try again.';render();}finally{state.busy=false;}}
  }
  function init(){var host=rootEl();if(!host)return;host.addEventListener('click',handleClick);host.addEventListener('change',function(e){if(e.target.id==='saw-year'){var year=Number(e.target.value);if(year>=2020&&year<=2100){state.year=year;state.formOpen=false;load();}}});host.addEventListener('submit',function(e){if(e.target.id!=='saw-form')return;e.preventDefault();if(!canEdit())return;var form=e.target,body={planned_month:Number(form.elements.month.value),theme:form.elements.theme.value.trim(),discussion_points:points(form.elements.points.value)};if(!body.theme||!body.discussion_points.length){state.error='Enter a topic and at least one discussion point.';render();return;}persist(body,state.editing&&state.editing.id);});}
  root.AurisSafetyAwareness={load:load,months:months,suggestions:suggestions};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
