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
  var state={year:new Date().getFullYear(),company:null,rows:[],busy:false,loading:false,editing:null,formOpen:false,error:'',draft:{month:new Date().getMonth()+1,theme:'',points:''},message:'',request:0};
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function rootEl(){return document.getElementById('safety-awareness-root');}
  function company(){return typeof ccid==='function'?ccid():null;}
  function canEdit(){return typeof isMgr==='function' && isMgr();}
  function points(value){return String(value||'').split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean);}
  function render(){
    var host=rootEl();if(!host)return;
    var source=state.rows.length?state.rows:(state.loading||state.error?[]:suggestions.map(function(s,i){return {planned_month:i+1,theme:s[0],discussion_points:points(s[1]),suggested:true};}));
    var draft=state.draft;var cards=months.map(function(month,i){
      var items=source.filter(function(row){return Number(row.planned_month)===i+1;});
      return '<section class="saw-month"><h3><span>'+String(i+1).padStart(2,'0')+'</span> '+month+'</h3>'+(items.length?items.map(function(row){
        return '<article class="saw-topic"><div class="saw-topic-head"><strong>'+esc(row.theme)+'</strong>'+(row.suggested?'<small>Suggested</small>':canEdit()?'<span><button type="button" class="saw-icon" data-action="edit" data-id="'+esc(row.id)+'" title="Edit topic" aria-label="Edit '+esc(row.theme)+'"><i class="ti ti-pencil"></i></button><button type="button" class="saw-icon" data-action="delete" data-id="'+esc(row.id)+'" title="Remove topic" aria-label="Remove '+esc(row.theme)+'"><i class="ti ti-trash"></i></button></span>':'')+'</div><ul>'+((Array.isArray(row.discussion_points)?row.discussion_points:points(row.discussion_points)).map(function(p){return '<li>'+esc(p)+'</li>';}).join(''))+'</ul></article>';
      }).join(''):'<p class="saw-empty">No topic planned</p>')+'</section>';
    }).join('');
    host.innerHTML='<div class="saw-header"><div><h2>Safety Awareness</h2><p>Plan HSE themes and talking points by month for the selected company.</p></div><div class="saw-actions"><label for="saw-year">Year</label><input id="saw-year" type="number" min="2020" max="2100" value="'+state.year+'">'+(canEdit()?'<button type="button" class="btn btn-primary" data-action="add"><i class="ti ti-plus"></i> Add topic</button>':'')+'</div></div>'+(state.loading?'<p class="loading-msg">Loading awareness plan...</p>':'')+(state.message?'<p role="status">'+esc(state.message)+'</p>':'')+(state.error?'<p class="saw-error" role="alert">'+esc(state.error)+'</p>':'')+(!state.rows.length&&!state.loading&&!state.error?'<div class="saw-suggestion">These are example topics, not saved company records.'+(canEdit()?'<button type="button" class="btn" data-action="use-plan">Use suggested 12-month plan</button>':'')+'</div>':'')+'<button type="button" class="btn" data-action="retry">Refresh plan</button><div class="saw-grid">'+cards+'</div>'+(state.formOpen?'<form id="saw-form" class="saw-form"><h3>'+(state.editing?'Edit topic':'Add topic')+'</h3><div class="saw-fields"><label>Month<select name="month" required>'+months.map(function(m,i){return '<option value="'+(i+1)+'"'+(Number(draft.month)===i+1?' selected':'')+'>'+m+'</option>';}).join('')+'</select></label><label>HSE theme / topic<input name="theme" maxlength="200" required value="'+esc(draft.theme||'')+'"></label></div><label>Points to discuss <span>(one per line)</span><textarea name="points" rows="5" required>'+esc(draft.points||'')+'</textarea></label><div class="saw-form-actions"><button type="button" class="btn" data-action="cancel">Cancel</button><button type="submit" class="btn btn-primary"'+(state.busy?' disabled':'')+'>Save topic</button></div></form>':'');
  }
  function actor(){return typeof prof==='undefined'?'':String(prof?.id||'');}
  function context(){return {company:company(),user:actor(),year:state.year};}
  function current(c){return company()===c.company&&actor()===c.user&&state.year===c.year;}
  function failure(e,action){var msg=String(e?.message||e||'');return /PGRST205|does not exist|schema cache|404/.test(msg)?'Safety Awareness setup is unavailable in this environment. Contact your administrator.':/403|permission|denied|access|row.level/i.test(msg)?'Your account cannot '+action+' Safety Awareness records. Contact your administrator.':'Safety Awareness could not '+action+' records. Check your connection and retry.';}
  async function load(){
    var c=context(),request=++state.request;if(state.company!==c.company||state.user!==c.user){state.formOpen=false;state.editing=null;state.draft={month:new Date().getMonth()+1,theme:'',points:''};}state.company=c.company;state.user=c.user;state.error='';state.rows=[];state.loading=true;render();if(!c.company){state.loading=false;state.error='Select a company to view its plan.';render();return;}
    try{var path='/safety_awareness_topics?select=id,company_id,plan_year,planned_month,theme,discussion_points&company_id=eq.'+encodeURIComponent(c.company)+'&plan_year=eq.'+c.year+'&order=planned_month.asc,created_at.asc,id.asc';var result=typeof apiAllRows==='function'?await apiAllRows(path):await api(path);if(!current(c)||request!==state.request)return;state.rows=(Array.isArray(result)?result:[]).filter(function(r){return String(r.company_id)===String(c.company);});}
    catch(e){if(!current(c)||request!==state.request)return;state.error=failure(e,'load');}
    if(current(c)&&request===state.request){state.loading=false;render();}
  }
  async function persist(body,id){
    var c=context();if(!c.company||c.company!==state.company||state.busy||!canEdit())return;state.draft={month:body.planned_month,theme:body.theme,points:body.discussion_points.join('\n')};state.busy=true;state.error='';state.message='Saving topic…';render();
    try{var result=id?await api('/safety_awareness_topics?id=eq.'+encodeURIComponent(id)+'&company_id=eq.'+encodeURIComponent(c.company),{m:'PATCH',b:body,p:'return=representation'}):await api('/safety_awareness_topics',{m:'POST',b:Object.assign({company_id:c.company,plan_year:c.year},body),p:'return=representation'});if(!current(c))return;if(!result?.[0]?.id)throw new Error('Save confirmation was incomplete.');state.formOpen=false;state.editing=null;state.error='';state.message='Topic saved for '+months[body.planned_month-1]+' '+c.year+'.';await load();}
    catch(e){if(current(c)){state.message='';state.error=failure(e,'save')+' Your month, topic and discussion points are retained.';}}
    finally{state.busy=false;if(current(c))render();}
  }
  async function handleClick(event){
    var button=event.target.closest('[data-action]');if(!button||!rootEl().contains(button))return;
    var action=button.dataset.action,id=button.dataset.id;if(state.busy)return;if(action==='retry'){load();return;}
    if(action==='add'){state.formOpen=true;state.editing=null;state.draft={month:new Date().getMonth()+1,theme:'',points:''};state.message='';render();rootEl().querySelector('#saw-form').scrollIntoView({behavior:'smooth',block:'start'});rootEl().querySelector('[name="theme"]').focus();}
    if(action==='cancel'){state.formOpen=false;state.editing=null;render();}
    if(action==='edit'){state.editing=state.rows.find(function(r){return r.id===id;})||null;state.formOpen=!!state.editing;if(state.editing)state.draft={month:state.editing.planned_month,theme:state.editing.theme,points:Array.isArray(state.editing.discussion_points)?state.editing.discussion_points.join('\n'):state.editing.discussion_points};render();if(state.formOpen)rootEl().querySelector('#saw-form').scrollIntoView({behavior:'smooth',block:'start'});}
    if(action==='delete'&&canEdit()&&root.confirm('Remove this safety awareness topic?')){var cid=company();try{await api('/safety_awareness_topics?id=eq.'+encodeURIComponent(id)+'&company_id=eq.'+encodeURIComponent(cid),{m:'DELETE'});await load();}catch(e){state.error='The topic could not be removed.';render();}}
    if(action==='use-plan'&&canEdit()&&!state.rows.length&&!state.busy){var c=context();state.busy=true;state.error='';state.message='Saving suggested plan…';render();try{var body=suggestions.map(function(s,i){return {company_id:c.company,plan_year:c.year,planned_month:i+1,theme:s[0],discussion_points:points(s[1])};});var saved=await api('/safety_awareness_topics',{m:'POST',b:body,p:'return=representation'});if(!current(c))return;if(!Array.isArray(saved)||saved.length!==12||saved.some(function(r){return !r.id||String(r.company_id)!==String(c.company);}))throw Error('Plan save could not be confirmed.');state.message='The 12-month plan was saved for '+c.year+'.';await load();}catch(e){if(current(c)){state.message='';state.error=failure(e,'save')+' Refresh the plan before retrying to check whether any topics were saved.';}}finally{state.busy=false;if(current(c))render();}}
  }
  function init(){var host=rootEl();if(!host)return;host.addEventListener('click',handleClick);host.addEventListener('input',function(e){var f=host.querySelector('#saw-form');if(f)state.draft={month:Number(f.elements.month.value),theme:f.elements.theme.value,points:f.elements.points.value};});host.addEventListener('change',function(e){if(state.busy){if(e.target.id==='saw-year')e.target.value=state.year;return;}if(e.target.id==='saw-year'){var year=Number(e.target.value);if(year>=2020&&year<=2100){state.year=year;state.formOpen=false;load();}}});host.addEventListener('submit',function(e){if(e.target.id!=='saw-form')return;e.preventDefault();if(!canEdit())return;var form=e.target;state.draft={month:Number(form.elements.month.value),theme:form.elements.theme.value,points:form.elements.points.value};var body={planned_month:Number(form.elements.month.value),theme:form.elements.theme.value.trim(),discussion_points:points(form.elements.points.value)};if(!body.theme||!body.discussion_points.length){state.error='Enter a topic and at least one discussion point.';render();return;}persist(body,state.editing&&state.editing.id);});}
  root.AurisSafetyAwareness={load:load,months:months,suggestions:suggestions};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
