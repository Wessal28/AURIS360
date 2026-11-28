/* Source corrective actions refer to the existing Master Action, rather than
 * owning a second closure workflow. Metadata synchronisation never approves,
 * reopens, deletes or replaces an action and its evidence/history. */
(function(root){
'use strict';
var uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var states=['open','in_progress','overdue','pending_verification','pending_closure','closed','cancelled'];
function copy(value){return JSON.parse(JSON.stringify(value));}
function text(value){return value==null?'':String(value).trim();}
function state(value){var key=text(value).toLowerCase().replace(/\s+/g,'_');return ['completed','complete','done'].includes(key)?'closed':key||'open';}
function label(value){return text(value).replace(/_/g,' ').replace(/^./,function(c){return c.toUpperCase();});}
function description(row){return text(row.description||row.desc||row.title);}
function create(options){
  options=options||{};
  if(typeof options.request!=='function'||typeof options.getContext!=='function')throw Error('Linked action services are unavailable. Reload the source record.');
  function context(edit){
    var current=options.getContext()||{},value={companyId:text(current.companyId),userId:text(current.userId),role:text(current.role)};
    if(!value.companyId||!value.userId||!value.role||current.canView!==true||(edit&&current.canEdit!==true))throw Error('Master Action access is required to manage linked actions.');
    return value;
  }
  function guard(expected,edit){var current=context(edit);if(['companyId','userId','role'].some(function(key){return current[key]!==expected[key];}))throw Error('Company, account or access changed. Reopen the source record.');return current;}
  function source(input,current){
    if(!input||input.module!=='investigation'||!uuid.test(text(input.id))||(input.companyId&&text(input.companyId)!==current.companyId))throw Error('The linked action source does not match this investigation and company.');
    return {module:'investigation',id:text(input.id),companyId:current.companyId,ref:text(input.ref).slice(0,500)};
  }
  function makeKey(){var value=typeof options.makeKey==='function'?options.makeKey():root.crypto&&typeof root.crypto.randomUUID==='function'?'ca-'+root.crypto.randomUUID():'';if(!value)throw Error('A stable corrective-action identity could not be created. Reload and retry.');return value;}
  function identify(row){
    var item=copy(row||{}),id=text(item.action_id),key=text(item.action_key||item.key);
    if(id&&!uuid.test(id))throw Error('A linked Master Action identity is invalid. Reopen the source record.');
    if(!key)key=id?'action-'+id:makeKey();
    if(key.length>160)throw Error('A source corrective-action identity is invalid.');
    item.action_key=key;if(id)item.action_id=id;return item;
  }
  function prepare(input){
    if(typeof input==='string'){try{input=JSON.parse(input);}catch(_){throw Error('Corrective actions could not be read. Retain the source record and review its saved actions.');}}
    if(input==null)input=[];
    if(!Array.isArray(input)||input.length>1000)throw Error('Corrective actions must be a list of no more than 1,000 rows.');
    var seen=new Set();
    return input.filter(function(row){return row&&description(row);}).map(function(row){
      var item=identify(row),key=item.action_key;
      if(seen.has(key))throw Error('Two source rows share the same corrective-action identity. Review their links before saving.');
      seen.add(key);return item;
    });
  }
  function owns(action,exact){return action&&uuid.test(text(action.id))&&text(action.company_id)===exact.companyId&&action.source_module===exact.module&&text(action.source_id)===exact.id;}
  async function read(exact,current,edit){
    guard(current,edit);
    var rows=await options.request('/action_tracker?select=id,company_id,source_module,source_type,source_id,source_ref,action_no,title,description,responsible,assigned_to_id,assigned_to_name,target_date,priority,status,updated_at&company_id=eq.'+encodeURIComponent(exact.companyId)+'&source_module=eq.'+exact.module+'&source_id=eq.'+encodeURIComponent(exact.id)+'&order=created_at.asc,id.asc&limit=1001');
    guard(current,edit);
    if(!Array.isArray(rows)||rows.length>1000||rows.some(function(row){return !owns(row,exact)||!states.includes(row.status);}))throw Error('The linked Master Actions could not be confirmed for this company and source.');
    return rows;
  }
  function plan(rows,actions){
    var claimed=new Set();
    return rows.map(function(row){
      var id=text(row.action_id),key=text(row.action_key),matches;
      if(id){matches=actions.filter(function(action){return action.id===id;});if(matches.length!==1)throw Error('The saved Master Action link is unavailable in this company and investigation. Retain the source row and review its exact link.');}
      else{
        matches=actions.filter(function(action){return text(action.action_no)===key;});
        if(!matches.length){
          matches=actions.filter(function(action){return description(action)===description(row);});
          if(matches.length&&(matches.length!==1||rows.filter(function(item){return description(item)===description(row);}).length!==1||text(matches[0].action_no)))throw Error('A legacy corrective action has ambiguous or conflicting Master Action links. Review the exact action before saving; existing actions have been retained.');
        }
      }
      if(matches.length>1)throw Error('More than one Master Action has this source-action identity. Review the links before saving.');
      var action=matches[0]||null;
      if(action){if(claimed.has(action.id))throw Error('Two source rows refer to the same Master Action. Review their exact links before saving.');claimed.add(action.id);}
      return {row:row,action:action};
    });
  }
  function projection(row,action){
    var item=copy(row);
    if(!action)return {row:item,difference:{actionId:null,sourceKey:item.action_key,recordedStatus:state(item.status),canonicalStatus:null,message:'This source row has no confirmed Master Action link. Save its link before managing completion.'}};
    var recorded=state(item.status),remembered=text(item.recorded_status);
    if(recorded===action.status&&remembered)recorded=state(remembered);
    item.action_id=action.id;item.action_key=text(action.action_no)||item.action_key;item.status=action.status;
    item.description=description(action);if(Object.prototype.hasOwnProperty.call(item,'desc'))item.desc=item.description;
    item.assigned_to=text(action.assigned_to_name||action.responsible);if(Object.prototype.hasOwnProperty.call(item,'resp'))item.resp=item.assigned_to;
    if(Object.prototype.hasOwnProperty.call(item,'responsible'))item.responsible=item.assigned_to;if(Object.prototype.hasOwnProperty.call(item,'assigned_to_name'))item.assigned_to_name=item.assigned_to;if(Object.prototype.hasOwnProperty.call(item,'assigned_to_id'))item.assigned_to_id=action.assigned_to_id||null;
    item.due_date=action.target_date||null;if(Object.prototype.hasOwnProperty.call(item,'date'))item.date=item.due_date;
    item.priority=action.priority||'medium';if(Object.prototype.hasOwnProperty.call(item,'prio'))item.prio=item.priority;
    delete item.metadata_changed_fields;
    var different=recorded!==action.status,needsWorkflow=different&&!['closed','cancelled'].includes(action.status)&&(['closed','cancelled'].includes(recorded)||(recorded==='in_progress'&&action.status==='open'));
    item.recorded_status=needsWorkflow?recorded:null;
    return {row:item,difference:different?{actionId:action.id,sourceKey:item.action_key,recordedStatus:recorded,canonicalStatus:action.status,needsWorkflow:needsWorkflow,message:needsWorkflow?'Source recorded '+label(recorded)+'; Master Action is '+label(action.status)+'. Use Manage linked action to complete its evidence, verification and approval workflow.':'Master Action is '+label(action.status)+'. This source status has been refreshed from its exact linked action.'}:null};
  }
  function metadata(row,action,exact){
    var owner=text(row.responsible||row.resp||row.assigned_to||row.assigned_to_name)||null;
    var body={action_no:text(action&&action.action_no)||row.action_key,title:description(row).slice(0,500),description:description(row),responsible:owner,assigned_to_name:owner,target_date:text(row.target_date||row.due_date||row.date)||null,priority:text(row.priority||row.prio)||text(action&&action.priority)||'medium',source_ref:text(action&&action.source_ref)||exact.ref||null};
    if(!['low','medium','high','critical'].includes(body.priority))throw Error('A corrective action has an invalid priority.');
    if(body.target_date&&!/^\d{4}-\d{2}-\d{2}$/.test(body.target_date))throw Error('A corrective action has an invalid due date.');
    if(row.assigned_to_id){if(!uuid.test(text(row.assigned_to_id)))throw Error('The corrective action assignee identity is invalid.');body.assigned_to_id=text(row.assigned_to_id);}
    else if(action&&text(action.assigned_to_name||action.responsible)!==text(owner))body.assigned_to_id=null;
    if(action&&Array.isArray(row.metadata_changed_fields)){
      var changed=new Set(row.metadata_changed_fields),allowed=new Set(['description','responsible','target_date','priority']);
      if(row.metadata_changed_fields.some(function(key){return !allowed.has(key);}))throw Error('The source corrective-action changes could not be confirmed. Reopen its exact link.');
      var keep=new Set(['action_no','source_ref']);
      if(changed.has('description')){keep.add('description');keep.add('title');}
      if(changed.has('responsible'))['responsible','assigned_to_name','assigned_to_id'].forEach(function(key){keep.add(key);});
      if(changed.has('target_date'))keep.add('target_date');if(changed.has('priority'))keep.add('priority');
      Object.keys(body).forEach(function(key){if(!keep.has(key))delete body[key];});
    }
    return body;
  }
  function confirm(response,exact,id,body){
    if(!Array.isArray(response)||response.length!==1||!owns(response[0],exact)||(id&&response[0].id!==id)||!states.includes(response[0].status)||Object.keys(body).some(function(key){return (response[0][key]??null)!==(body[key]??null);}))throw Error('The linked action save was not confirmed. Your source entries must be retained; retry after reviewing the saved link.');
    return response[0];
  }
  async function load(input,inputRows){
    var current=context(false),exact=source(input,current),rows=prepare(inputRows),actions=await read(exact,current,false),resolved=plan(rows,actions).map(function(item){return projection(item.row,item.action);});
    return {rows:resolved.map(function(item){return item.row;}),actions:copy(actions),differences:resolved.map(function(item){return item.difference;}).filter(Boolean)};
  }
  async function synchronize(input,inputRows,lifecycle){
    var current=context(true),exact=source(input,current),rows=prepare(inputRows),actions=await read(exact,current,true),planned=plan(rows,actions),resolved=[];
    // Resolve every legacy link and validate metadata before making any change.
    planned.forEach(function(item){
      if(item.action&&['closed','cancelled'].includes(item.action.status)&&Array.isArray(item.row.metadata_changed_fields)&&item.row.metadata_changed_fields.length)throw Error('The linked Master Action is '+label(item.action.status)+'. Its approved metadata cannot be changed here. Your source edits are retained; restore those action fields before using Manage linked action to review its governed workflow.');
      item.body=metadata(item.row,item.action,exact);
    });
    if(lifecycle&&typeof lifecycle.beforeWrite==='function'){await lifecycle.beforeWrite(copy(planned.map(function(item){return Object.assign({},item.row,item.action?{action_id:item.action.id}:{});})));guard(current,true);}
    for(var item of planned){
      guard(current,true);var action=item.action,body=item.body;
      if(action&&!['closed','cancelled'].includes(action.status)){
        if(Object.keys(body).some(function(key){return (action[key]??null)!==(body[key]??null);})){
          var path='/action_tracker?id=eq.'+encodeURIComponent(action.id)+'&company_id=eq.'+encodeURIComponent(exact.companyId)+'&source_module=eq.'+exact.module+'&source_id=eq.'+encodeURIComponent(exact.id)+(action.updated_at?'&updated_at=eq.'+encodeURIComponent(action.updated_at):'&updated_at=is.null');
          var updated=await options.request(path,{m:'PATCH',p:'return=representation',b:body});guard(current,true);action=confirm(updated,exact,action.id,body);
        }
      }else if(!action){
        var created;
        try{created=await options.request('/action_tracker',{m:'POST',p:'return=representation',b:Object.assign({},body,{company_id:exact.companyId,source_module:exact.module,source_type:'investigation',source_id:exact.id,status:'open',requires_verification:true,created_by:current.userId})});}
        catch(insertError){
          guard(current,true);
          if(!/^(?:ca-|action-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.action_no)||!/investigation_generated_action_identity/.test(String(insertError.message||''))||!(String(insertError.code||'')==='23505'||/duplicate key/i.test(String(insertError.message||''))))throw insertError;
          var concurrent=await read(exact,current,true),winners=concurrent.filter(function(candidate){return text(candidate.action_no)===body.action_no;});if(winners.length!==1)throw insertError;
          // Reuse that exact winning identity. A normal metadata retry retains
          // CAS and terminal-action guards; unrelated uniqueness errors fail.
          var recovered=await synchronize(input,[Object.assign({},item.row,{action_id:winners[0].id})]);guard(current,true);
          action=recovered.actions.find(function(candidate){return candidate.id===winners[0].id;});if(!action)throw insertError;
          actions.push(action);resolved.push({row:recovered.rows[0],difference:recovered.differences[0]||null});continue;
        }
        guard(current,true);action=confirm(created,exact,null,body);actions.push(action);
      }
      resolved.push(projection(item.row,action));
    }
    guard(current,true);
    return {rows:resolved.map(function(item){return item.row;}),actions:copy(actions),differences:resolved.map(function(item){return item.difference;}).filter(Boolean)};
  }
  async function manage(input,row){
    var current=context(false),exact=source(input,current),id=text(row&&row.action_id);
    if(!uuid.test(id))throw Error('Save and confirm the exact Master Action link before managing its workflow.');
    var actions=await read(exact,current,false),action=actions.find(function(item){return item.id===id;});
    if(!action)throw Error('The linked Master Action is unavailable for this source and company.');
    guard(current,false);if(typeof options.openAction!=='function')throw Error('The Master Action editor is unavailable. Reopen the action from its register.');
    await options.openAction(id,copy(current));guard(current,false);return copy(action);
  }
  return Object.freeze({identify:identify,prepare:prepare,load:load,synchronize:synchronize,manage:manage});
}
root.AurisSourceActions=Object.freeze({version:'1.0.0',create:create});
if(typeof module!=='undefined'&&module.exports)module.exports=root.AurisSourceActions;
})(typeof window!=='undefined'?window:globalThis);
