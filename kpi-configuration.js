(function(){
'use strict';

var NAV=[['targets','Status & Periods','ti-target'],['calculations','Calculations','ti-calculator'],['sources','Data Sources','ti-database'],['workflow','Approvals','ti-route'],['objectives','Objectives Register','ti-list-tree'],['audit','Audit History','ti-history']];
var state={section:'targets',rows:[],published:null,draft:null,audit:[],loading:false,schemaReady:false,dirty:false,context:null,sequence:0,revision:0,busy:false,publishing:false,notice:null};

function defaults(){return {
  general:{calendar_basis:'calendar',start_month:1,default_frequency:'monthly',decimal_precision:2,code_pattern:'OBJ.KPI.IND',show_archived:false},
  objectives:{weighting_method:'equal',allow_local_categories:true,require_owner:true,require_description:true},
  templates:{name:'Standard HSE KPI',classification:'leading_or_lagging',default_unit:'count',ytd_method:'sum',evidence_required:false,owner_required:true},
  targets:{on_track_percent:95,at_risk_percent:85,zero_tolerance_override:true,critical_override:true,require_action_off_track:true,require_explanation_at_risk:true,data_missing_excluded:true},
  cycles:{entry_deadline_working_day:5,verification_deadline_working_day:7,approval_deadline_working_day:10,lock_after_approval:true,current_period_excluded:true,reopen_policy:'request'},
  calculations:{aggregation:'average',ytd_method:'sum',rounding:2,zero_denominator:'data_error',formula:'actual / target * 100',block_circular:true},
  sources:{default_source:'manual',refresh_frequency:'real_time',reconciliation:'source_wins',allow_manual_override:false,lock_imported_values:true},
  workflow:{name:'Standard KPI Approval',self_approval:false,stage1:'KPI Owner',stage2:'HSE Manager',stage3:'Company Admin',escalation_days:3,allow_delegation:true},
  notifications:{enabled:true,channels:'in_app,email',missing_reminder_days:2,at_risk_recipient:'KPI Owner',off_track_recipient:'HSE Manager',approval_reminders:true},
  permissions:{edit_roles:'sephs_admin,admin,hse_manager',entry_roles:'manager,inspector',publish_roles:'sephs_admin,admin,hse_manager',restrict_company:true},
  reports:{default_report:'management_summary',status_scheme:'icon_text_colour',trend_months:6,show_data_quality:true,default_columns:'target,actual,variance,trend,owner,status'},
  audit:{retention_years:7,published_immutable:true,approved_values_locked:true,reason_required:true,record_exports:true}
};}
function clone(x){return JSON.parse(JSON.stringify(x));}
function merge(base,extra){Object.keys(extra||{}).forEach(function(k){if(extra[k]&&typeof extra[k]==='object'&&!Array.isArray(extra[k]))base[k]=merge(base[k]||{},extra[k]);else base[k]=extra[k];});return base;}
function normaliseOperationalConfig(value){var c=value||defaults();if(['average','worst'].indexOf(c.calculations&&c.calculations.aggregation)<0)c.calculations.aggregation='average';return c;}
function esc(v){if(typeof escH==='function')return escH(v==null?'':String(v));return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function companyId(){return typeof ccid==='function'?ccid():(window.prof&&prof.company_id);}
function actor(){return {id:window.prof&&prof.id,name:(window.prof&&(prof.full_name||prof.name||prof.email))||'User'};}
function canManage(){var r=typeof activeRole==='function'?activeRole():(window.prof&&prof.role);return ['sephs_admin','admin','hse_manager'].indexOf(r)>=0;}
function notify(message,ok){state.notice={message:message,ok:ok!==false};render();if(typeof toast==='function')toast(message,ok!==false);}
function scopeKey(){return JSON.stringify([companyId()||'',actor().id||'',typeof activeRole==='function'?activeRole():(window.prof&&prof.role)||'']);}
function current(context){return !!context&&state.context===context&&context.key===scopeKey();}
function editable(){return current(state.context)&&state.schemaReady&&!state.loading&&!state.publishing&&!!state.draft&&canManage();}
function ready(){if(!editable()){notify('Configuration is not ready for this account and company. Reload it before making changes.',false);return false;}if(state.busy)return false;return true;}
function invalidate(){state.revision++;state.dirty=true;state.draft.status='draft';state.draft.validation={};state.draft.impact_summary={};state.notice=null;}
function feedback(){return state.notice?'<div class="'+(state.notice.ok?'kpi-cfg-ok':'kpi-cfg-error')+'" role="'+(state.notice.ok?'status':'alert')+'">'+esc(state.notice.message)+'</div>':'';}
function versionQuery(row,company){var query='/kpi_config_versions?id=eq.'+encodeURIComponent(row.id)+'&company_id=eq.'+encodeURIComponent(company)+'&status=in.(draft,validated)';if(row.updated_at)query+='&updated_at=eq.'+encodeURIComponent(row.updated_at);return query;}
function confirmedRow(rows,context,id,status){if(!Array.isArray(rows)||rows.length!==1||!rows[0]||!rows[0].id||rows[0].company_id!==context.company||(id&&rows[0].id!==id)||rows[0].status!==status)throw new Error('The configuration was not confirmed. It may have changed in another session; reload before trying again.');return rows[0];}
function cfg(){return state.draft?state.draft.configuration:(state.published?state.published.configuration:defaults());}
function val(path){var p=path.split('.'),o=cfg();for(var i=0;i<p.length;i++)o=o&&o[p[i]];return o;}
function set(path,value){var p=path.split('.'),o=state.draft.configuration;for(var i=0;i<p.length-1;i++)o=o[p[i]]||(o[p[i]]={});o[p[p.length-1]]=value;invalidate();refreshState();}
function statusBadge(s){var map={draft:'Draft',validated:'Validated',published:'Published',archived:'Archived'};return '<span class="kpi-cfg-version '+esc(s||'draft')+'"><i class="ti ti-circle-filled"></i>'+esc(map[s]||'Draft')+'</span>';}
function input(path,label,type,help,options,forceDisabled){var v=val(path),disabled=editable()&&!forceDisabled?'':' disabled',id='kpi-cfg-'+path.replace(/\./g,'-');if(type==='toggle')return '<label class="kpi-cfg-toggle"><span><strong>'+esc(label)+'</strong><small>'+esc(help||'')+'</small></span><input id="'+id+'" type="checkbox" data-cfg="'+path+'" '+(v?'checked':'')+disabled+' data-auris-module-onchange="b0001"><i></i></label>';
  var field='<div class="kpi-cfg-field"><label for="'+id+'">'+esc(label)+'</label>';
  if(type==='select')field+='<select id="'+id+'" data-cfg="'+path+'"'+disabled+' data-auris-module-onchange="b0001">'+options.map(function(x){var a=Array.isArray(x)?x:[x,x];return '<option value="'+esc(a[0])+'" '+(String(v)===String(a[0])?'selected':'')+'>'+esc(a[1])+'</option>';}).join('')+'</select>';
  else field+='<input id="'+id+'" data-cfg="'+path+'" type="'+(type||'text')+'" value="'+esc(v==null?'':v)+'"'+disabled+' data-auris-module-oninput="b0002">';
  return field+(help?'<small>'+esc(help)+'</small>':'')+'</div>';}
function panel(title,body,desc){return '<section class="kpi-cfg-card"><div class="kpi-cfg-card-title">'+esc(title)+'</div>'+(desc?'<p class="kpi-cfg-help">'+esc(desc)+'</p>':'')+body+'</section>';}
function grid(items){return '<div class="kpi-cfg-fields">'+items.join('')+'</div>';}
function workflowPeople(path){var current=String(val(path)||''),rows=[];try{rows=typeof tenantPeople==='function'?tenantPeople():[];}catch(e){rows=[];}var options=[['','Select person…']];rows.forEach(function(person){var name=[person.first_name,person.last_name].filter(Boolean).join(' ')||person.email||'',label=[person.last_name,person.first_name].filter(Boolean).join(', ')||name;if(!name)return;options.push([name,label+(person.job_title?' — '+person.job_title:'')]);});if(current&&!options.some(function(option){return String(option[0])===current;}))options.splice(1,0,[current,current+' (current setting)']);return options;}

function sectionObjectives(){var rows=(window.kpiObjectives||[]).map(function(o){return '<tr><td><strong>'+esc(o.code||'—')+'</strong></td><td>'+esc(o.name)+'</td><td>'+esc(o.owner||'Company')+'</td><td><span class="kpi-cfg-readonly">Existing</span></td></tr>';}).join('');return panel('Current Objective Register','<div class="kpi-cfg-table"><table><thead><tr><th>Code</th><th>Objective</th><th>Owner</th><th>Source</th></tr></thead><tbody>'+ (rows||'<tr><td colspan="4">No objectives for the selected year.</td></tr>')+'</tbody></table></div>','This is a read-only view of the selected year. Create and edit objectives in the KPI Scorecard, where validation is enforced.');}
function sectionTargets(){var t=cfg().targets;return panel('Targets & Status Rules',grid([
  input('targets.on_track_percent','On Track threshold (%)','number','Achievement at or above this threshold.'),input('targets.at_risk_percent','At Risk threshold (%)','number','Achievement from this threshold up to On Track.'),input('targets.zero_tolerance_override','Zero-tolerance override','toggle','Any value above zero for a zero-tolerance indicator is Off Track.'),input('targets.critical_override','Critical KPI overrides aggregation','toggle','A critical failure cannot be hidden by a good aggregate score.'),input('cycles.current_period_excluded','Exclude open current period','toggle','The current month remains In Progress and does not reduce dashboard achievement.')
]))+panel('Status Threshold Preview','<div class="kpi-cfg-threshold"><span class="on">On Track <b>≥ '+esc(t.on_track_percent)+'%</b></span><span class="risk">At Risk <b>'+esc(t.at_risk_percent)+'–'+esc(Number(t.on_track_percent)-0.1)+'%</b></span><span class="off">Off Track <b>&lt; '+esc(t.at_risk_percent)+'%</b></span><span class="missing">Data Missing <b>required value absent</b></span></div>','Status is always communicated by icon, text, and colour.');}
function sectionCalculations(){return panel('Calculation Defaults',grid([
  input('calculations.aggregation','Objective aggregation','select','',[['average','Average KPI achievement'],['worst','Worst KPI status']])
]),'Controls how KPI results roll up into the objective score. YTD calculation remains configured on each indicator.');}
function sectionSources(){return panel('Data Source & Reconciliation',grid([
  input('sources.default_source','Default source for new KPIs','select','',[['manual','Manual entry'],['module','AURIS360 module'],['integration','External integration']]),input('sources.refresh_frequency','Automatic refresh frequency','select','',[['real_time','Real time'],['hourly','Hourly'],['daily','Daily'],['monthly','Monthly']]),input('sources.allow_manual_override','Allow manual override','toggle','Authorised users may replace an automatically calculated result; the override reason is audited.')
]),'These defaults apply to new KPIs and governed automatic source refreshes. Existing KPI source assignments are preserved.');}
function sectionWorkflow(){var self=!!val('workflow.self_approval');return panel('Approval Workflow',grid([
  input('workflow.stage1','Stage 1 · KPI owner / data provider','select','',workflowPeople('workflow.stage1')),input('workflow.stage2','Stage 2 · Reviewer','select',self?'Copied from Stage 1 while self-approval is enabled.':'',workflowPeople('workflow.stage2'),self),input('workflow.stage3','Stage 3 · Approver','select',self?'Copied from Stage 1 while self-approval is enabled.':'',workflowPeople('workflow.stage3'),self),input('workflow.self_approval','Allow self-approval','toggle','When enabled, Stages 2 and 3 automatically use the person selected in Stage 1.')
]),'The published route supplies defaults for new KPIs. Existing KPI assignments are preserved for audit continuity.');}
function sectionAudit(){var history=state.audit.map(function(a){return '<tr><td>'+esc(new Date(a.created_at).toLocaleString())+'</td><td><strong>'+esc(a.event_type)+'</strong></td><td>'+esc(a.actor_name||'User')+'</td><td>'+esc(a.reason||'—')+'</td></tr>';}).join('');return panel('Audit & Data Controls',grid([
  input('audit.reason_required','Publication reason required','toggle','The publisher must explain every live configuration change.')
]))+panel('Configuration History','<div class="kpi-cfg-table"><table><thead><tr><th>Date</th><th>Event</th><th>Actor</th><th>Reason</th></tr></thead><tbody>'+(history||'<tr><td colspan="4">No configuration events recorded.</td></tr>')+'</tbody></table></div>');}
var renderers={objectives:sectionObjectives,targets:sectionTargets,calculations:sectionCalculations,sources:sectionSources,workflow:sectionWorkflow,audit:sectionAudit};

function refreshState(){var el=document.getElementById('kpi-cfg-state');if(el)el.textContent=state.busy?'Saving…':state.dirty?'Unsaved changes':'All changes saved';}
function render(){var focused=document.activeElement,focus=focused&&focused.id?{id:focused.id,start:focused.selectionStart,end:focused.selectionEnd}:null;var host=document.getElementById('kpi-x-config-view');if(!host)return;if(state.loading){host.innerHTML='<div class="kpi-x-empty">Loading configuration…</div>';return;}var current=state.draft||state.published||{version_no:1,status:'draft',configuration:defaults()},readOnly=!editable()||state.busy;host.innerHTML=feedback()+'<div class="kpi-cfg-toolbar"><div><h2>KPI Module Configuration</h2><p>Version '+esc(current.version_no||1)+' · '+statusBadge(current.status)+'</p></div><div class="kpi-cfg-actions"><span id="kpi-cfg-state">'+(state.dirty?'Unsaved changes':'All changes saved')+'</span><button class="kpi-x-btn" data-auris-module-onclick="b0003" '+(readOnly?'disabled':'')+'>Discard</button><button class="kpi-x-btn" data-auris-module-onclick="b0004" '+(readOnly?'disabled':'')+'><i class="ti ti-device-floppy"></i>Save Draft</button><button class="kpi-x-btn" data-auris-module-onclick="b0005" '+(readOnly?'disabled':'')+'><i class="ti ti-checkup-list"></i>Validate</button><button class="kpi-x-btn primary" data-auris-module-onclick="b0006" '+(readOnly?'disabled':'')+'><i class="ti ti-send"></i>Publish</button></div></div><div class="kpi-cfg-operational"><i class="ti ti-circle-check"></i><div><strong>Operational settings only</strong><span>Every editable control below is connected to current KPI behaviour. Access roles and notification delivery are managed in their dedicated administration areas.</span></div></div>'+(state.schemaReady?'':'<div class="kpi-cfg-schema"><i class="ti ti-database-exclamation"></i><div><strong>Database setup required</strong><span>Run kpi_configuration_schema.sql in Supabase. The published defaults remain active until setup is complete.</span></div></div>')+'<div class="kpi-cfg-layout"><aside class="kpi-cfg-nav">'+NAV.map(function(n){return '<button class="'+(state.section===n[0]?'active':'')+'" data-auris-module-onclick="b0007" data-auris-module-args="'+encodeURIComponent(JSON.stringify([n[0]]))+'"><i class="ti '+n[2]+'"></i><span>'+n[1]+'</span></button>';}).join('')+'</aside><main class="kpi-cfg-main">'+renderers[state.section]()+'</main><aside class="kpi-cfg-side">'+side(current)+'</aside></div>';if(focus){var restored=document.getElementById(focus.id);if(restored&&typeof restored.focus==='function'){restored.focus({preventScroll:true});if(focus.start!=null&&typeof restored.setSelectionRange==='function'){try{restored.setSelectionRange(focus.start,focus.end);}catch(e){}}}}}
function side(current){var v=current.validation||{},impact=current.impact_summary||{},pub=state.published;return '<section class="kpi-cfg-card"><div class="kpi-cfg-card-title">Lifecycle</div><div class="kpi-cfg-kv"><span>Draft version</span><strong>v'+esc(current.version_no||1)+'</strong></div><div class="kpi-cfg-kv"><span>Live version</span><strong>'+(pub?'v'+esc(pub.version_no):'Defaults')+'</strong></div><div class="kpi-cfg-kv"><span>Effective</span><strong>'+esc((pub&&pub.effective_from)||'Immediately')+'</strong></div></section><section class="kpi-cfg-card"><div class="kpi-cfg-card-title">Validation & Impact</div>'+(v.valid===true?'<div class="kpi-cfg-ok"><i class="ti ti-circle-check"></i>Validation passed</div>':v.errors&&v.errors.length?'<div class="kpi-cfg-error"><i class="ti ti-alert-triangle"></i>'+esc(v.errors.length)+' blocking issue(s)</div>':'<p class="kpi-cfg-help">Validate the draft before publication.</p>')+'<div class="kpi-cfg-kv"><span>KPIs evaluated</span><strong>'+esc(impact.kpis_evaluated||0)+'</strong></div><div class="kpi-cfg-kv"><span>Status changes</span><strong>'+esc(impact.status_changes||0)+'</strong></div><div class="kpi-cfg-kv"><span>Periods affected</span><strong>'+esc(impact.periods_affected||0)+'</strong></div></section><section class="kpi-cfg-card"><div class="kpi-cfg-card-title">Control Note</div><p class="kpi-cfg-help">Saving a draft never changes live KPI calculations. Only a validated, published version becomes active.</p></section>';}

async function load(){
  if(current(state.context)&&state.schemaReady&&!state.publishing&&(state.dirty||state.busy)){render();return true;}
  var context={key:scopeKey(),company:companyId(),sequence:++state.sequence};
  state.context=context;state.rows=[];state.published=null;state.draft=null;state.audit=[];
  state.schemaReady=false;state.dirty=false;state.revision=0;state.busy=false;state.publishing=false;state.notice=null;
  window.kpiConfigPublished=defaults();
  state.loading=true;render();
  if(typeof api!=='function'||!context.company||!actor().id){state.loading=false;notify('Select a company and sign in before loading configuration.',false);return false;}
  try{
    var rows=await api('/kpi_config_versions?select=*&company_id=eq.'+encodeURIComponent(context.company)+'&order=version_no.desc');
    if(!current(context))return false;
    if(!Array.isArray(rows)||rows.some(function(row){return !row||!row.id||row.company_id!==context.company||!row.configuration||typeof row.configuration!=='object'||Array.isArray(row.configuration);}))throw new Error('Invalid company configuration response.');
    state.rows=rows;state.published=rows.find(function(x){return x.status==='published';})||null;
    state.draft=rows.find(function(x){return x.status==='draft'||x.status==='validated';})||null;
    var live=normaliseOperationalConfig(merge(defaults(),clone((state.published&&state.published.configuration)||{})));
    window.kpiConfigPublished=live;
    if(!state.draft)state.draft={version_no:rows.length?Math.max.apply(null,rows.map(function(x){return x.version_no||0;}))+1:1,status:'draft',configuration:clone(live),validation:{},impact_summary:{}};
    else state.draft.configuration=normaliseOperationalConfig(merge(defaults(),clone(state.draft.configuration||{})));
    state.schemaReady=true;
    try{
      var history=await api('/kpi_config_audit?select=*&company_id=eq.'+encodeURIComponent(context.company)+'&order=created_at.desc&limit=100');
      if(!current(context))return false;
      if(!Array.isArray(history)||history.some(function(row){return !row||row.company_id!==context.company;}))throw new Error('Invalid history response.');
      state.audit=history;
    }catch(historyError){if(!current(context))return false;state.notice={ok:false,message:'Configuration loaded, but audit history is unavailable. Try reloading before reviewing history.'};}
  }catch(e){
    if(!current(context))return false;
    state.rows=[];state.published=null;state.draft=null;state.audit=[];state.schemaReady=false;
    state.notice={ok:false,message:'Could not load configuration. Check access, connectivity and database setup, then reload.'};
  }
  if(!current(context))return false;
  state.loading=false;render();return state.schemaReady;
}
function change(el){if(!editable())return;var path=el.dataset.cfg,raw=el.type==='checkbox'?el.checked:el.value;if(el.type==='number')raw=raw===''?null:Number(raw);set(path,raw);if(path==='workflow.self_approval'&&raw){cfg().workflow.stage2=cfg().workflow.stage1||'';cfg().workflow.stage3=cfg().workflow.stage1||'';}if(path==='workflow.stage1'&&cfg().workflow.self_approval){cfg().workflow.stage2=raw;cfg().workflow.stage3=raw;}render();}
function validate(){var c=cfg(),errors=[],warnings=[],risk=Number(c.targets.at_risk_percent),track=Number(c.targets.on_track_percent);if(!Number.isFinite(risk)||!Number.isFinite(track)||risk<0||track>100)errors.push('Status thresholds must be numbers between 0 and 100.');else if(risk>=track)errors.push('At Risk threshold must be lower than On Track.');if(['average','worst'].indexOf(c.calculations.aggregation)<0)errors.push('Select a supported objective aggregation method.');if(!c.workflow.self_approval&&String(c.workflow.stage1).toLowerCase()===String(c.workflow.stage2).toLowerCase())errors.push('The submitter and verifier stages cannot be identical.');return {valid:errors.length===0,errors:errors,warnings:warnings,validated_at:new Date().toISOString()};}
function impact(){var after=cfg(),changed=0,kpis=window.kpiKPIs||[];kpis.forEach(function(k){var current=k._computed_status,score=k._kpiX&&k._kpiX.score,next=current;if(score!=null&&['data_missing','in_progress','not_due','not_started'].indexOf(current)<0){next=score>=Number(after.targets.on_track_percent)?'on_track':score>=Number(after.targets.at_risk_percent)?'at_risk':'off_track';if(after.targets.critical_override!==false&&k._kpiX.indicators&&k._kpiX.indicators.some(function(x){return x.status==='off_track';}))next='off_track';}if(next!==current)changed++;});return {kpis_evaluated:kpis.length,status_changes:changed,periods_affected:changed?Math.max(1,new Date().getMonth()):0,generated_at:new Date().toISOString()};}
async function audit(event,reason,before,after,context,versionId){
  if(!current(context)||!state.schemaReady)return;
  var a=actor();
  try{await api('/kpi_config_audit',{m:'POST',p:'return=minimal',b:{company_id:context.company,config_version_id:versionId,event_type:event,section_key:state.section,before_json:before||null,after_json:after||null,reason:reason||null,actor_id:a.id,actor_name:a.name}});}
  catch(e){if(current(context))state.notice={ok:false,message:'Configuration saved, but its audit entry could not be recorded. Reload and check history before publishing.'};}
}
async function persistDraft(context){
  var a=actor(),before=clone(state.draft),revision=state.revision;
  var body={company_id:context.company,version_no:before.version_no,status:'draft',configuration:clone(before.configuration),validation:{},impact_summary:{},updated_by:a.id,updated_by_name:a.name,updated_at:new Date().toISOString()};
  if(!before.id){body.created_by=a.id;body.created_by_name=a.name;}
  var rows=await api(before.id?versionQuery(before,context.company):'/kpi_config_versions',{m:before.id?'PATCH':'POST',p:'return=representation',b:body});
  if(!current(context))return false;
  var saved=confirmedRow(rows,context,before.id,'draft'),changed=revision!==state.revision,later=state.draft.configuration;
  state.draft=Object.assign({},saved,{configuration:changed?later:clone(body.configuration)});
  state.dirty=changed;
  await audit('draft_saved','Draft saved',before,saved,context,saved.id);
  return current(context)&&revision===state.revision&&!state.dirty;
}
async function save(silent){
  if(!ready())return false;
  var context=state.context;state.busy=true;state.notice=null;render();
  try{
    var clean=await persistDraft(context);
    if(!current(context))return false;
    if(!silent&&!state.notice)notify(clean?'Configuration draft saved. Live KPI calculations are unchanged.':'Earlier changes saved; your newer edits are still unsaved.',clean);
    return clean;
  }catch(e){if(current(context))notify('Could not save configuration: '+e.message,false);return false;}
  finally{if(current(context)){state.busy=false;render();}}
}
async function validateAndSave(){
  if(!ready())return false;
  var context=state.context;state.busy=true;state.notice=null;render();
  try{
    if((state.dirty||!state.draft.id)&&!(await persistDraft(context)))return false;
    if(!current(context)||!canManage())return false;
    var result=validate(),imp=impact(),a=actor(),before=clone(state.draft),revision=state.revision;
    state.draft.status='draft';state.draft.validation={};state.draft.impact_summary={};
    if(!result.valid){
      state.draft.status='draft';state.draft.validation=result;state.draft.impact_summary=imp;
      await audit('validation_failed',result.errors.join(' '),null,result,context,before.id);
      if(current(context))notify('Validation failed: '+result.errors.join(' '),false);
      return false;
    }
    var rows=await api(versionQuery(before,context.company),{m:'PATCH',p:'return=representation',b:{status:'validated',validation:result,impact_summary:imp,validated_by:a.id,validated_by_name:a.name,validated_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
    if(!current(context))return false;
    var saved=confirmedRow(rows,context,before.id,'validated');
    if(!saved.validation||saved.validation.valid!==true)throw new Error('Validation was not confirmed by the database.');
    if(revision!==state.revision){state.draft.updated_at=saved.updated_at;notify('The saved version was validated, but newer edits still need saving and validation.',false);return false;}
    state.draft=Object.assign({},saved,{configuration:clone(before.configuration),validation:result,impact_summary:imp});
    await audit('validated','Validation passed',null,result,context,saved.id);
    if(current(context)&&revision===state.revision&&!state.notice)notify('Configuration validated. '+imp.status_changes+' current KPI status change(s) identified.');
    return current(context)&&revision===state.revision;
  }catch(e){if(current(context))notify('Validation could not be saved: '+e.message,false);return false;}
  finally{if(current(context)){state.busy=false;render();}}
}
async function publish(){
  if(!ready())return false;
  if(state.dirty||!state.draft.id||state.draft.status!=='validated'||!state.draft.validation||!state.draft.validation.valid){notify('Save and validate the current configuration successfully before publishing.',false);return false;}
  var context=state.context,revision=state.revision,version=state.draft.version_no,id=state.draft.id;
  var reason=window.prompt('Reason for publishing this configuration version:','Approved KPI governance update');
  if(reason===null)return false;
  if(cfg().audit.reason_required&&!String(reason).trim()){notify('A publication reason is required.',false);return false;}
  if(!current(context)||!canManage()||revision!==state.revision)return false;
  state.busy=true;state.publishing=true;state.notice=null;render();
  try{
    var response=await api('/rpc/kpi_publish_config',{m:'POST',p:'return=representation',b:{p_config_id:id,p_reason:reason,p_effective_from:new Date().toISOString().slice(0,10)}});
    if(!current(context))return false;
    confirmedRow(Array.isArray(response)?response:[response],context,id,'published');
    if(revision!==state.revision){notify('The saved version was published. Newer local edits remain unsaved; save them as a new draft before continuing.',false);state.schemaReady=false;return false;}
    if(!(await load()))return false;
    // load() installs a new context. Never refresh another company's KPI view.
    var refreshed=state.context;
    if(refreshed.key!==context.key||!current(refreshed))return false;
    notify('Configuration published. Live KPI calculations now use version '+version+'.');
    if(typeof kpiLoadAll==='function')await kpiLoadAll();
    return true;
  }catch(e){if(current(context))notify('Publication failed: '+e.message,false);return false;}
  finally{if(current(context)){state.busy=false;state.publishing=false;render();}}
}
function discard(){if(!editable()||state.busy)return;state.draft.configuration=normaliseOperationalConfig(merge(defaults(),clone((state.published&&state.published.configuration)||{})));invalidate();render();}

window.kpiConfigPublished=defaults();window.kpiConfigRender=render;window.kpiConfigLoad=load;window.kpiConfigSection=function(s){state.section=s;render();};window.kpiConfigChange=change;window.kpiConfigSave=save;window.kpiConfigValidate=validateAndSave;window.kpiConfigPublish=publish;window.kpiConfigDiscard=discard;
})();
