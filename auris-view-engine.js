(function(root){
'use strict';

var adapter=null,allowedViews=['list','card','board','calendar','activity'],memory=Object.create(null),renders=new WeakMap();
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];});}
function safeKey(value){value=String(value||'').trim();if(!/^[a-zA-Z0-9_.-]{1,80}$/.test(value))throw new Error('Invalid view field key: '+value);return value;}
function currentContext(options){
  var value=options&&typeof options.context==='function'?options.context():adapter&&typeof adapter.context==='function'?adapter.context():{};
  return {companyId:String(value&&value.companyId||''),userId:String(value&&value.userId||''),role:String(value&&value.role||'')};
}
function definition(input){
  input=input||{};
  var fields=(input.fields||[]).map(function(field){
    var tones=Object.create(null);
    Object.keys(field.tones||{}).forEach(function(key){if(['neutral','info','success','warning','danger'].indexOf(field.tones[key])!==-1)tones[key]=field.tones[key];});
    return Object.freeze({key:safeKey(field.key),label:String(field.label||field.key).slice(0,80),type:field.type||'text',
      required:field.required===true,hidden:field.hidden===true,groupable:field.groupable!==false,
      action:field.action?safeKey(field.action):'',tones:Object.freeze(tones)});
  });
  if(!fields.length)throw new Error('At least one view field is required.');
  var views=(input.views||allowedViews).filter(function(view,index,list){return allowedViews.indexOf(view)!==-1&&list.indexOf(view)===index;});
  if(!views.length)throw new Error('At least one supported view is required.');
  var keys=fields.map(function(field){return field.key;}),fallback=fields[0].key;
  if(new Set(keys).size!==keys.length)throw new Error('View field keys must be unique.');
  function declared(key,defaultKey){key=key||defaultKey;if(keys.indexOf(key)===-1)throw new Error('View field is not declared: '+key);return key;}
  var date=fields.find(function(field){return field.type==='date';});
  return Object.freeze({fields:Object.freeze(fields),views:Object.freeze(views),defaultView:views.indexOf(input.defaultView)!==-1?input.defaultView:views[0],
    titleField:declared(input.titleField,fallback),subtitleField:declared(input.subtitleField,fields[1]&&fields[1].key||fallback),
    groupField:declared(input.groupField,keys.indexOf('status')!==-1?'status':fallback),dateField:declared(input.dateField,date&&date.key||fallback),
    activityField:declared(input.activityField,keys.indexOf('updated_at')!==-1?'updated_at':fallback),rowKey:safeKey(input.rowKey||'id'),
    defaultSort:declared(input.defaultSort,input.titleField||fallback)});
}
function storageKey(moduleKey,context){return 'auris360_view_engine_v1:'+encodeURIComponent(context.companyId||'no-company')+':'+encodeURIComponent(context.userId||'anonymous')+':'+encodeURIComponent(moduleKey);}
function columns(def,keys){
  var selected=Array.isArray(keys)?keys:def.fields.filter(function(field){return !field.hidden;}).map(function(field){return field.key;});
  var result=def.fields.filter(function(field){return field.required||selected.indexOf(field.key)!==-1;}).map(function(field){return field.key;});
  return result.length?result:[def.titleField];
}
function normalize(value,def){
  value=value||{};
  var keys=def.fields.map(function(field){return field.key;});
  return {mode:def.views.indexOf(value.mode)!==-1?value.mode:def.defaultView,
    groupBy:def.fields.some(function(field){return field.groupable&&field.key===value.groupBy;})?value.groupBy:def.groupField,
    sortBy:keys.indexOf(value.sortBy)!==-1?value.sortBy:def.defaultSort,sortDirection:value.sortDirection==='desc'?'desc':'asc',
    columns:columns(def,value.columns)};
}
function blank(def){return Object.assign(normalize(null,def),{saved:[]});}
function read(moduleKey,def,context){
  var key=storageKey(moduleKey,context),value=memory[key];
  if(!value){try{value=JSON.parse(root.localStorage.getItem(key)||'null');}catch(_){}}
  var state=normalize(value,def);
  state.saved=Array.isArray(value&&value.saved)?value.saved.filter(function(item){return item&&typeof item.name==='string'&&item.name.trim();}).slice(0,20).map(function(item){
    return Object.assign(normalize(item,def),{name:item.name.trim().slice(0,60),filters:Object.assign({},item.filters||{})});
  }):[];
  return state;
}
function write(moduleKey,state,context){
  var key=storageKey(moduleKey,context);memory[key]=JSON.parse(JSON.stringify(state));
  try{root.localStorage.setItem(key,JSON.stringify(state));return true;}catch(_){return false;}
}
function tenantRows(rows,context){return (rows||[]).filter(function(row){return row&&context.companyId&&row.company_id&&String(row.company_id)===context.companyId;});}
function compare(left,right){
  if((left==null||left==='')&&(right==null||right===''))return 0;if(left==null||left==='')return 1;if(right==null||right==='')return -1;
  var ld=Date.parse(left),rd=Date.parse(right);
  if(!Number.isNaN(ld)&&!Number.isNaN(rd)&&/\d{4}-\d{2}/.test(String(left)+String(right)))return ld-rd;
  return String(left).localeCompare(String(right),undefined,{numeric:true,sensitivity:'base'});
}
function model(rows,input,state,context){
  var def=definition(input);state=Object.assign(blank(def),state||{},normalize(state,def));
  var filtered=tenantRows(rows,context||{}).slice().sort(function(left,right){var result=compare(left[state.sortBy],right[state.sortBy]);return state.sortDirection==='desc'?-result:result;}),groups=Object.create(null);
  filtered.forEach(function(row){var group=String(row[state.groupBy]||'Unassigned');(groups[group]||(groups[group]=[])).push(row);});
  return {definition:def,state:state,rows:filtered,groups:groups};
}
function value(row,field){
  var raw=row[field.key];if(raw==null||raw==='')return '—';
  if(field.type==='date'){var parsed=/^\d{4}-\d{2}-\d{2}$/.test(String(raw))?new Date(raw+'T12:00:00'):new Date(raw);return Number.isNaN(parsed.getTime())?String(raw):parsed.toLocaleDateString();}
  if(field.type==='percent')return Math.max(0,Math.min(100,Number(raw)||0))+'%';
  return String(raw);
}
function available(row,options){return (options.actions||[]).filter(function(action){return typeof action.when!=='function'||action.when(row);});}
function actionButton(row,action,label,options,extra){
  return '<button type="button" '+(extra||'')+' data-view-action="'+esc(action.key)+'" data-view-row="'+esc(row[options.definition.rowKey])+'">'+esc(label)+'</button>';
}
function actions(row,options){return available(row,options).map(function(action){return actionButton(row,action,typeof action.label==='function'?action.label(row):action.label,options);}).join('');}
function cell(row,field,options){
  var text=value(row,field),action=available(row,options).find(function(item){return item.key===field.action;});
  if(action)return actionButton(row,action,text,options,'class="ave-link"');
  if(field.type==='badge')return '<span class="ave-badge ave-'+esc(field.tones[row[field.key]]||'neutral')+'">'+esc(text)+'</span>';
  if(field.type==='percent'&&text!=='—')return '<span class="ave-progress"><progress max="100" value="'+Math.max(0,Math.min(100,Number(row[field.key])||0))+'" aria-label="'+esc(field.label)+'"></progress>'+esc(text)+'</span>';
  return esc(text);
}
function visible(view){return view.definition.fields.filter(function(field){return view.state.columns.indexOf(field.key)!==-1;});}
function listHtml(view,options){
  return '<div class="ave-table-wrap" tabindex="0" role="region" aria-label="'+esc(options.label||'Records')+' table; scroll horizontally for more columns"><table><thead><tr>'+visible(view).map(function(field){return '<th scope="col">'+esc(field.label)+'</th>';}).join('')+'<th scope="col">Actions</th></tr></thead><tbody>'+view.rows.map(function(row){return '<tr>'+visible(view).map(function(field){return '<td>'+cell(row,field,options)+'</td>';}).join('')+'<td><div class="ave-actions">'+actions(row,options)+'</div></td></tr>';}).join('')+'</tbody></table></div>';
}
function card(row,view,options){
  return '<article class="ave-card"><header><strong>'+esc(row[view.definition.titleField]||'Untitled record')+'</strong><span>'+esc(row[view.definition.subtitleField]||'')+'</span></header><dl>'+visible(view).filter(function(field){return field.key!==view.definition.titleField&&field.key!==view.definition.subtitleField;}).map(function(field){return '<div><dt>'+esc(field.label)+'</dt><dd>'+cell(row,field,options)+'</dd></div>';}).join('')+'</dl><footer class="ave-actions">'+actions(row,options)+'</footer></article>';
}
function cardsHtml(view,options){return '<div class="ave-card-grid">'+view.rows.map(function(row){return card(row,view,options);}).join('')+'</div>';}
function boardHtml(view,options){
  return '<div class="ave-board" tabindex="0" role="region" aria-label="Grouped records; scroll horizontally">'+Object.keys(view.groups).sort().map(function(group){return '<section><header><strong>'+esc(group)+'</strong><span>'+view.groups[group].length+'</span></header>'+view.groups[group].map(function(row){return card(row,view,options);}).join('')+'</section>';}).join('')+'</div>';
}
function calendarHtml(view,options){
  var dates=Object.create(null);view.rows.forEach(function(row){var raw=row[view.definition.dateField],day=raw&&String(raw).slice(0,10)||'No date';(dates[day]||(dates[day]=[])).push(row);});
  return '<div class="ave-calendar">'+Object.keys(dates).sort().map(function(day){return '<section><time>'+esc(day)+'</time><div>'+dates[day].map(function(row){return '<article><strong>'+esc(row[view.definition.titleField]||'Untitled record')+'</strong><span>'+esc(row[view.definition.subtitleField]||'')+'</span><div class="ave-actions">'+actions(row,options)+'</div></article>';}).join('')+'</div></section>';}).join('')+'</div>';
}
function activityHtml(view,options){
  var rows=view.rows.slice().sort(function(left,right){return compare(right[view.definition.activityField],left[view.definition.activityField]);});
  return '<div class="ave-activity">'+rows.map(function(row){return '<article><span></span><div><strong>'+esc(row[view.definition.titleField]||'Untitled record')+'</strong><p>'+esc(row[view.definition.subtitleField]||'')+'</p><time>'+esc(value(row,view.definition.fields.find(function(field){return field.key===view.definition.activityField;})))+'</time><div class="ave-actions">'+actions(row,options)+'</div></div></article>';}).join('')+'</div>';
}
function toolbar(def,state){
  function options(fields,selected){return fields.map(function(field){return '<option value="'+esc(field.key)+'" '+(selected===field.key?'selected':'')+'>'+esc(field.label)+'</option>';}).join('');}
  return '<div class="ave-toolbar"><label>View<select data-view-mode>'+options(def.views.map(function(mode){return {key:mode,label:mode.charAt(0).toUpperCase()+mode.slice(1)};}),state.mode)+'</select></label>'
    +'<label>Group board by<select data-view-group '+(state.mode!=='board'?'disabled':'')+'>'+options(def.fields.filter(function(field){return field.groupable;}),state.groupBy)+'</select></label>'
    +'<label>Sort<select data-view-sort>'+options(def.fields,state.sortBy)+'</select></label><button type="button" data-view-direction aria-label="Toggle sort direction">'+(state.sortDirection==='desc'?'Descending':'Ascending')+'</button>'
    +'<details class="ave-columns"><summary>Columns / fields</summary><div>'+def.fields.map(function(field){return '<label><input type="checkbox" data-view-column="'+esc(field.key)+'" '+(state.columns.indexOf(field.key)!==-1?'checked':'')+' '+(field.required?'disabled':'')+'>'+esc(field.label)+(field.required?' (required)':'')+'</label>';}).join('')+'<button type="button" data-view-reset-columns>Reset columns</button></div></details>'
    +'<label>View name<input data-view-name maxlength="60" placeholder="e.g. High-priority open actions"></label><button type="button" data-view-save>Save view</button>'
    +'<label>Saved personal views<select data-view-saved><option value="">Select…</option>'+state.saved.map(function(item,index){return '<option value="'+index+'">'+esc(item.name)+'</option>';}).join('')+'</select></label></div>';
}
function configure(value){if(!value||typeof value.context!=='function')throw new Error('AURIS View Engine adapter is incomplete.');adapter=value;return api;}
function mount(host,rows,options){
  if(typeof host==='string')host=root.document&&root.document.querySelector(host);if(!host)return null;
  options=Object.assign({},options||{});
  var moduleKey=safeKey(options.moduleKey||'records'),context=currentContext(options),def=definition(options.definition),state=read(moduleKey,def,context),view=model(rows,def,state,context),ticket={busy:false};
  options.definition=def;renders.set(host,ticket);host.classList.add('auris-view-engine');
  var content=!view.rows.length?'<div class="ave-empty">No records match this view.</div>':state.mode==='list'?listHtml(view,options):state.mode==='card'?cardsHtml(view,options):state.mode==='board'?boardHtml(view,options):state.mode==='calendar'?calendarHtml(view,options):activityHtml(view,options);
  host.innerHTML=toolbar(def,state)+'<div data-view-feedback role="status" aria-live="polite" hidden></div><p class="ave-count">'+view.rows.length+' records · Personal view settings do not change records.</p>'+content;
  bind(host,rows,options,moduleKey,context,state,ticket);return view;
}
function bind(host,rows,options,moduleKey,context,state,ticket){
  function feedback(message,error){var el=host.querySelector('[data-view-feedback]');if(el){el.hidden=false;el.className='ave-feedback'+(error?' ave-feedback-error':'');el.textContent=message;if(error&&el.scrollIntoView)el.scrollIntoView({block:'nearest'});}}
  function valid(){
    var current=currentContext(options);
    if(!current.companyId||!current.userId||current.companyId!==context.companyId||current.userId!==context.userId||current.role!==context.role)throw new Error('Your account, company or access changed. Reload this register.');
    if(renders.get(host)!==ticket)throw new Error('This view has changed. Use the current register.');
  }
  function rerender(selector){
    var persisted=write(moduleKey,state,context),wrap=host.querySelector('.ave-table-wrap'),left=wrap&&wrap.scrollLeft||0,top=wrap&&wrap.scrollTop||0,details=host.querySelector('.ave-columns'),opened=details&&details.open;
    mount(host,rows,options);
    wrap=host.querySelector('.ave-table-wrap');if(wrap){wrap.scrollLeft=left;wrap.scrollTop=top;}
    details=host.querySelector('.ave-columns');if(details)details.open=opened;
    var focus=selector&&host.querySelector(selector);if(focus&&focus.focus)focus.focus();
    if(!persisted)feedback('Browser storage is unavailable. These settings are kept only until the application reloads.',false);
  }
  function bindControl(selector,event,fn){var el=host.querySelector(selector);if(el)el.addEventListener(event,function(){try{valid();fn(el);}catch(error){feedback(error.message,true);}});}
  bindControl('[data-view-mode]','change',function(el){state.mode=el.value;rerender('[data-view-mode]');});
  bindControl('[data-view-group]','change',function(el){state.groupBy=el.value;rerender('[data-view-group]');});
  bindControl('[data-view-sort]','change',function(el){state.sortBy=el.value;rerender('[data-view-sort]');});
  bindControl('[data-view-direction]','click',function(){state.sortDirection=state.sortDirection==='desc'?'asc':'desc';rerender('[data-view-direction]');});
  bindControl('[data-view-reset-columns]','click',function(){state.columns=columns(options.definition);rerender('[data-view-reset-columns]');});
  host.querySelectorAll('[data-view-column]').forEach(function(el){el.addEventListener('change',function(){
    try{valid();var key=el.getAttribute('data-view-column');state.columns=columns(options.definition,el.checked?state.columns.concat(key):state.columns.filter(function(item){return item!==key;}));rerender('[data-view-column="'+key+'"]');}
    catch(error){feedback(error.message,true);}
  });});
  bindControl('[data-view-save]','click',function(){
    var input=host.querySelector('[data-view-name]'),name=String(input&&input.value||'').trim().slice(0,60);
    if(!name){feedback('Enter a name for this personal view.',true);if(input)input.focus();return;}
    state.saved=state.saved.filter(function(item){return item.name!==name;});
    state.saved.unshift(Object.assign(normalize(state,options.definition),{name:name,filters:Object.assign({},options.filters||{})}));state.saved=state.saved.slice(0,20);rerender('[data-view-saved]');
  });
  bindControl('[data-view-saved]','change',function(el){
    if(el.value==='')return;var saved=state.saved[Number(el.value)];if(!saved)return;
    Object.assign(state,normalize(saved,options.definition));
    // Persist before the owning module re-renders its filtered rows.
    var persisted=write(moduleKey,state,context);
    if(typeof options.onApplyFilters==='function')options.onApplyFilters(Object.assign({},saved.filters||{}));else rerender('[data-view-saved]');
    if(!persisted)feedback('Browser storage is unavailable. This view is kept only until the application reloads.',false);
  });
  host.querySelectorAll('[data-view-action]').forEach(function(button){button.addEventListener('click',async function(){
    if(ticket.busy)return;
    try{
      valid();var key=button.getAttribute('data-view-row'),actionKey=button.getAttribute('data-view-action');
      var row=tenantRows(rows,context).find(function(item){return String(item[options.definition.rowKey])===String(key);});
      if(!row||!available(row,options).some(function(action){return action.key===actionKey;}))throw new Error('This record action is unavailable. Reload the register.');
      var notice=host.querySelector('[data-view-feedback]');if(notice)notice.hidden=true;
      ticket.busy=true;host.querySelectorAll('[data-view-action]').forEach(function(el){el.disabled=true;});
      if(typeof options.onAction==='function')await options.onAction(actionKey,row);
    }catch(error){if(renders.get(host)===ticket)feedback(error.message||'The action could not be opened.',true);}
    finally{ticket.busy=false;if(renders.get(host)===ticket)host.querySelectorAll('[data-view-action]').forEach(function(el){el.disabled=false;});}
  });});
}
function diagnostics(rows,input,options){
  var context=currentContext(options||{}),def=definition(input),state=read((options&&options.moduleKey)||'records',def,context),view=model(rows,def,state,context);
  return {scope:context,records:view.rows.length,excluded:(rows||[]).length-view.rows.length,mode:state.mode,savedViews:state.saved.length,groups:Object.keys(view.groups).length,columns:state.columns.slice()};
}
var api={version:'1.1.0',configure:configure,definition:definition,model:model,mount:mount,diagnostics:diagnostics};
root.AurisViewEngine=Object.freeze(api);
})(typeof window!=='undefined'?window:globalThis);
