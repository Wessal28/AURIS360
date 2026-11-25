(function(root){
'use strict';
var pending=new Map(),PAGE=200,MAX_PAGES=50;
var RECORDS='incident_mgmt_records',BULLETINS='safety_bulletins';
function value(v){return v==null?'':String(v).trim();}
function failure(code,message){var error=new Error(message);error.code=code;return error;}
function object(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
function finalInvestigation(row){return ['completed','closed'].includes(value(row.status).toLowerCase());}
function references(row){return Array.from(new Set([row.event_ref,row.incident_number].map(value).filter(function(ref){return ref&&!/^(INC[- ]?DRAFT|DRAFT|-)$/i.test(ref);})));}
function ids(row){return [row.incident_id,row.event_id].map(value).filter(Boolean);}
function matchesIncident(investigation,incident){
 if(!investigation||!incident||!value(incident.id)||!value(incident.company_id)||value(investigation.company_id)!==value(incident.company_id))return false;
 var links=ids(investigation);if(links.length)return links.every(function(id){return id===value(incident.id);});
 var ref=value(investigation.linked_event_ref);return !!ref&&references(incident).includes(ref);
}
function investigationOptions(incident,rows,selected,company){
 var options=[['','Select source investigation']],seen=new Set();selected=value(selected);company=value(company);
 (rows||[]).forEach(function(row){var id=value(row&&row.id);if(!id||seen.has(id)||value(row.company_id)!==company||!matchesIncident(row,incident))return;seen.add(id);options.push([id,(row.investigation_ref||'Investigation')+' · '+(row.status||'Not recorded')]);});
 if(selected&&!seen.has(selected))options.push([selected,'Saved investigation · refresh to view']);return options;
}
function context(services){
 if(!services||typeof services.api!=='function'||typeof services.session!=='function'||typeof services.canManage!=='function')throw failure('service_unavailable','Safety Communication services are unavailable. Reopen Incident Management.');
 function snapshot(){var now=services.session()||{};return {companyId:value(now.companyId),userId:value(now.userId),role:value(now.role),name:value(now.name)};}
 var captured=snapshot(),expected=services.expectedSession;
 if(!captured.companyId||!captured.userId||!captured.role)throw failure('context_changed','Sign in and select the company before generating a Safety Communication.');
 function same(a,b){return value(a.companyId)===value(b.companyId)&&value(a.userId)===value(b.userId)&&value(a.role)===value(b.role);}
 if(expected&&!same(captured,expected))throw failure('context_changed','The company, account or access changed. Reopen this lesson.');
 if(!services.canManage())throw failure('access_denied','Manager access is required to generate a Safety Communication.');
 function assert(){if(!same(captured,snapshot()))throw failure('context_changed','The company, account or access changed. Reopen this lesson.');if(!services.canManage())throw failure('access_denied','Your management access changed. Reopen this lesson.');return captured;}
 async function request(path,options){assert();try{return await services.api(path,options);}finally{assert();}}
 return {services:services,session:captured,assert:assert,request:request,scope:'company_id=eq.'+encodeURIComponent(captured.companyId)};
}
async function one(ctx,table,id,optional){
 var rows=await ctx.request('/'+table+'?select=*&'+ctx.scope+'&id=eq.'+encodeURIComponent(id)+'&limit=2');
 if(!Array.isArray(rows))throw failure('source_unavailable','The '+table+' response could not be verified. Refresh before retrying.');
 if(!rows.length&&optional)return null;
 if(rows.length!==1||value(rows[0].id)!==value(id)||value(rows[0].company_id)!==ctx.session.companyId)throw failure('source_mismatch','The selected '+table+' record is unavailable for this company.');
 return rows[0];
}
async function list(ctx,table,filters){
 var result=[];
 for(var page=0;page<MAX_PAGES;page++){
  var rows=await ctx.request('/'+table+'?select=*&'+ctx.scope+(filters?'&'+filters:'')+'&order=id.asc&limit='+PAGE+'&offset='+(page*PAGE));
  if(!Array.isArray(rows))throw failure('source_unavailable','The '+table+' records could not be verified. Refresh before retrying.');
  if(rows.some(function(row){return !row||!value(row.id)||value(row.company_id)!==ctx.session.companyId;}))throw failure('source_mismatch','A source response was outside the selected company. No draft was generated.');
  result=result.concat(rows);if(rows.length<PAGE)return result;
 }
 throw failure('query_limit','Too many source records were returned. Select an explicit investigation before retrying.');
}
async function verifyLink(ctx,investigation,incident){
 if(!matchesIncident(investigation,incident))throw failure('source_mismatch','The selected investigation belongs to a different incident or company. Correct the lesson source before generating.');
 if(ids(investigation).length)return;
 var ref=value(investigation.linked_event_ref),found=new Map();
 for(var field of ['event_ref','incident_number']){
  var rows=await ctx.request('/events?select=*&'+ctx.scope+'&'+field+'=eq.'+encodeURIComponent(ref)+'&limit=2');
  if(!Array.isArray(rows))throw failure('source_unavailable','The investigation reference could not be verified.');
  rows.forEach(function(row){if(value(row.company_id)===ctx.session.companyId&&value(row[field])===ref&&value(row.id))found.set(value(row.id),row);});
 }
 if(found.size!==1||!found.has(value(incident.id)))throw failure('ambiguous_source','This investigation reference does not identify one incident in this company. Link the investigation by incident ID before generating.');
}
async function validateSource(investigationId,incidentId,services){
 var ctx=context(services);if(!value(incidentId))throw failure('source_mismatch','Select the source incident before saving this lesson.');
 var incident=await one(ctx,'events',incidentId);
 if(!value(investigationId))return {incident:incident,investigation:null};
 var investigation=await one(ctx,'investigations',investigationId);await verifyLink(ctx,investigation,incident);ctx.assert();return {incident:incident,investigation:investigation};
}
function chooseDefault(candidates){
 if(!root.document||!root.document.body)throw failure('ambiguous_source','Several completed investigations match. Select the source investigation on the lesson before generating.');
 return new Promise(function(resolve){
  var dialog=root.document.createElement('dialog'),heading=root.document.createElement('h3'),note=root.document.createElement('p');
  dialog.className='imx-source-investigation-choice';heading.textContent='Choose the completed investigation';note.textContent='Several investigations match this incident. Choose the source for this Safety Communication.';dialog.appendChild(heading);dialog.appendChild(note);
  function finish(id){dialog.close();dialog.remove();resolve(id);}
  candidates.forEach(function(row){var button=root.document.createElement('button');button.type='button';button.className='imx-btn';button.textContent=[row.investigation_ref||row.inv_ref||row.id,row.title||'',row.status].filter(Boolean).join(' · ');button.addEventListener('click',function(){finish(row.id);});dialog.appendChild(button);});
  var cancel=root.document.createElement('button');cancel.type='button';cancel.className='imx-btn';cancel.textContent='Cancel';cancel.addEventListener('click',function(){finish(null);});dialog.appendChild(cancel);dialog.addEventListener('cancel',function(event){event.preventDefault();finish(null);});root.document.body.appendChild(dialog);dialog.showModal();
 });
}
async function source(ctx,lesson,incident){
 if(value(lesson.investigation_id)){
  var explicit=await one(ctx,'investigations',lesson.investigation_id);await verifyLink(ctx,explicit,incident);
  if(!finalInvestigation(explicit))throw failure('investigation_incomplete','The lesson’s selected investigation is '+(explicit.status||'not completed')+'. Complete or close that investigation before generating.');return explicit;
 }
 var rows=await list(ctx,'investigations'),linked=rows.filter(function(row){return matchesIncident(row,incident);}),complete=linked.filter(finalInvestigation),verified=[];
 for(var candidate of complete){await verifyLink(ctx,candidate,incident);verified.push(candidate);}
 if(!verified.length)throw failure('investigation_incomplete',linked.length?'No matching investigation is completed or closed. Complete the intended investigation before generating.':'No linked completed investigation was found. Link an investigation to this incident before generating.');
 if(verified.length===1)return verified[0];
 var chooser=typeof ctx.services.chooseInvestigation==='function'?ctx.services.chooseInvestigation:chooseDefault;
 var selected=await chooser(verified,{lesson:lesson,incident:incident});ctx.assert();
 if(!value(selected))throw failure('cancelled','Safety Communication generation cancelled.');
 if(!verified.some(function(row){return value(row.id)===value(selected);}))throw failure('source_mismatch','The selected investigation was outside the completed source choices.');
 var fresh=await one(ctx,'investigations',selected);await verifyLink(ctx,fresh,incident);
 if(!finalInvestigation(fresh))throw failure('investigation_incomplete','The selected investigation is no longer completed or closed. Refresh before generating.');return fresh;
}
function approved(lesson){if(lesson.record_type!=='lesson'||!['approved','published'].includes(value(lesson.status).toLowerCase()))throw failure('lesson_not_approved','Validate or publish the lesson before generating a Safety Communication.');}
async function stableId(ctx,parts){
 var crypto=ctx.services.crypto||root.crypto;if(!crypto||!crypto.subtle)throw failure('service_unavailable','Secure draft identification is unavailable. Reload the application.');
 var encoded=encodeURIComponent(JSON.stringify(parts)),bytes=[];for(var i=0;i<encoded.length;i++){if(encoded[i]==='%'){bytes.push(parseInt(encoded.slice(i+1,i+3),16));i+=2;}else bytes.push(encoded.charCodeAt(i));}
 var hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));ctx.assert();hash[6]=(hash[6]&15)|80;hash[8]=(hash[8]&63)|128;
 var hex=Array.from(hash.slice(0,16),function(byte){return byte.toString(16).padStart(2,'0');}).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
function matchesDraft(row,ctx,lesson,incident,investigation){var p=object(row&&row.payload);return row&&value(row.company_id)===ctx.session.companyId&&row.record_type==='safety_communication'&&row.status==='draft'&&value(row.incident_id)===value(incident.id)&&value(row.investigation_id)===value(investigation.id)&&value(p.source_lesson_id)===value(lesson.id)&&value(p.source_investigation_id)===value(investigation.id);}
function matchesBulletin(row,ctx,id){return row&&value(row.id)===value(id)&&value(row.company_id)===ctx.session.companyId&&row.status==='draft'&&row.bulletin_type==='safety_bulletin'&&row.distribution_method==='AURIS360 Safety Communications';}
async function hasLegacyTitleCollision(ctx,title,bulletinId,lesson,incident,investigation){
 var matches=(await list(ctx,BULLETINS,'title=eq.'+encodeURIComponent(title)+'&status=eq.draft')).filter(function(row){return value(row.id)!==bulletinId;});
 if(!matches.length)return false;
 var communications=await list(ctx,RECORDS,'record_type=eq.safety_communication&incident_id=eq.'+encodeURIComponent(incident.id));
 for(var bulletin of matches){
  var verified=false;
  if(matchesBulletin(bulletin,ctx,bulletin.id))for(var linked of communications){
   if(linked.record_type!=='safety_communication'||value(linked.incident_id)!==value(incident.id))continue;
   var p=object(linked.payload),differentSource=value(p.source_lesson_id)!==value(lesson.id)||value(p.source_investigation_id)!==value(investigation.id);
   if(!differentSource||!value(p.source_lesson_id)||!value(linked.investigation_id)||value(linked.investigation_id)!==value(p.source_investigation_id)||value(p.source_bulletin_id)!==value(bulletin.id))continue;
   if(await stableId(ctx,['safety-bulletin',ctx.session.companyId,value(linked.id)])===value(bulletin.id)){verified=true;break;}
  }
  if(!verified)return true;
 }
 return false;
}
async function write(ctx,table,id,body,filters){
 var rows=await ctx.request('/'+table+(filters?'?'+filters:''),{m:filters?'PATCH':'POST',p:'return=representation',b:body});
 if(!Array.isArray(rows)||rows.length!==1||value(rows[0].id)!==value(id)||value(rows[0].company_id)!==ctx.session.companyId)throw failure('confirmation_failed','The saved Draft could not be confirmed. Check the register before retrying.');return rows[0];
}
async function run(ctx,lessonId){
 var lesson=await one(ctx,RECORDS,lessonId);approved(lesson);if(!value(lesson.incident_id))throw failure('source_mismatch','This lesson has no source incident. Select it before generating.');
 var incident=await one(ctx,'events',lesson.incident_id),investigation=await source(ctx,lesson,incident),originalSelection=value(lesson.investigation_id);
 var drafts=await list(ctx,RECORDS,'record_type=eq.safety_communication&incident_id=eq.'+encodeURIComponent(incident.id)+'&investigation_id=eq.'+encodeURIComponent(investigation.id));
 drafts=drafts.filter(function(row){return matchesDraft(row,ctx,lesson,incident,investigation);});
 if(drafts.length>1)throw failure('ambiguous_draft','Several Draft communications already exist for this lesson and investigation. Open the intended Draft instead of generating another.');
 var communication=drafts[0]||null,reusedCommunication=!!communication;
 var communicationId=communication?communication.id:await stableId(ctx,['safety-communication',ctx.session.companyId,value(lesson.id),value(investigation.id)]);
 if(!communication){var existing=await one(ctx,RECORDS,communicationId,true);if(existing){if(!matchesDraft(existing,ctx,lesson,incident,investigation))throw failure('source_mismatch','The communication identity already belongs to another record or a released communication. Open it before generating another.');communication=existing;reusedCommunication=true;}}
 var bulletinId=await stableId(ctx,['safety-bulletin',ctx.session.companyId,value(communicationId)]),savedBulletinId=value(object(communication&&communication.payload).source_bulletin_id);
 if(savedBulletinId&&savedBulletinId!==bulletinId)throw failure('source_mismatch','The communication’s saved bulletin link differs from its source identity. Review that linked Draft before generating.');
 var actions=await list(ctx,'action_tracker','source_id=in.('+encodeURIComponent(investigation.id)+','+encodeURIComponent(incident.id)+')');
 // Recheck the actual saved lesson and case immediately before the first write.
 var freshLesson=await one(ctx,RECORDS,lessonId);approved(freshLesson);
 if(value(freshLesson.incident_id)!==value(incident.id)||value(freshLesson.investigation_id)!==originalSelection)throw failure('source_changed','The lesson source changed while generating. Reopen the lesson.');
 lesson=freshLesson;incident=await one(ctx,'events',incident.id);investigation=await one(ctx,'investigations',investigation.id);await verifyLink(ctx,investigation,incident);
 if(!finalInvestigation(investigation))throw failure('investigation_incomplete','The source investigation is no longer completed or closed. No new Draft was generated.');
 var p=object(lesson.payload),ref=value(incident.event_ref)||value(incident.incident_number)||value(incident.id),now=new Date().toISOString();
 var bulletinTitle='Safety Bulletin · '+ref+' · '+lesson.title;
 var legacyCollision;
 try{legacyCollision=await hasLegacyTitleCollision(ctx,bulletinTitle,bulletinId,lesson,incident,investigation);}catch(error){
  if(!communication||error.code==='context_changed'||error.code==='access_denied')throw error;
  var lookup=failure('bulletin_failed','The existing Safety Communication Draft is retained, but its linked Safety Bulletin could not be verified. Retry generation after refreshing. '+(error.message||''));lookup.receipt={communication:communication,lesson:lesson,incident:incident,investigation:investigation};lookup.cause=error;throw lookup;
 }
 if(legacyCollision){
  var collision=failure('legacy_bulletin_ambiguous','An existing Draft Safety Bulletin has this title without a verified link to this communication. Review it in Safety Bulletins before generating another.');
  if(communication){var retained=failure('bulletin_failed','The existing Safety Communication Draft is retained. '+collision.message);retained.receipt={communication:communication,lesson:lesson,incident:incident,investigation:investigation};retained.cause=collision;throw retained;}
  throw collision;
 }
 if(!communication){
  var completedActions=actions.filter(function(row){return [value(incident.id),value(investigation.id)].includes(value(row.source_id))&&['closed','completed','effective_closed'].includes(value(row.status).toLowerCase());}).map(function(row){return value(row.title)||value(row.description);}).filter(Boolean);
  var payload={headline:lesson.title,incident_ref:ref,event_date:incident.event_date||null,location:incident.location||null,what_happened:incident.description||investigation.what_happened||incident.title||null,
   immediate_causes:investigation.immediate_causes||investigation.root_causes||investigation.contributing_factors||null,immediate_actions:incident.immediate_action||investigation.immediate_actions||null,
   actions_taken:completedActions.length?completedActions:null,shared_learning:p.key_learning||p.approved_facts||lesson.title,relevant_standards:p.required_behaviours||null,contact:lesson.owner_name||ctx.session.name||null,
   source_lesson_id:lesson.id,source_investigation_id:investigation.id,source_bulletin_id:bulletinId};
  communication=await write(ctx,RECORDS,communicationId,{id:communicationId,company_id:ctx.session.companyId,incident_id:incident.id,investigation_id:investigation.id,record_type:'safety_communication',title:'Safety Communication · '+ref,status:'draft',owner_name:ctx.session.name||null,payload:payload,created_by:ctx.session.userId,updated_at:now});
  if(!matchesDraft(communication,ctx,lesson,incident,investigation)||value(object(communication.payload).source_bulletin_id)!==bulletinId)throw failure('confirmation_failed','The communication Draft source links could not be confirmed. Check its saved record before retrying.');
 }
 try{
  communication=await one(ctx,RECORDS,communication.id);
  if(!matchesDraft(communication,ctx,lesson,incident,investigation))throw failure('source_changed','The communication Draft changed. Reopen it before generating the bulletin.');
  if(!value(object(communication.payload).source_bulletin_id)){
   var version=communication.updated_at==null?'is.null':'eq.'+encodeURIComponent(communication.updated_at);
   communication=await write(ctx,RECORDS,communication.id,{payload:Object.assign({},object(communication.payload),{source_bulletin_id:bulletinId}),updated_at:new Date().toISOString()},ctx.scope+'&id=eq.'+encodeURIComponent(communication.id)+'&status=eq.draft&updated_at='+version);
   if(!matchesDraft(communication,ctx,lesson,incident,investigation)||value(object(communication.payload).source_bulletin_id)!==bulletinId)throw failure('confirmation_failed','The Draft bulletin link could not be confirmed.');
  }
  var bulletin=await one(ctx,BULLETINS,bulletinId,true),reusedBulletin=!!bulletin;
  if(bulletin&&!matchesBulletin(bulletin,ctx,bulletinId))throw failure('source_mismatch','The linked bulletin is no longer an editable Safety Communication Draft. Open it before retrying.');
  if(!bulletin){var savedPayload=object(communication.payload);bulletin=await write(ctx,BULLETINS,bulletinId,{id:bulletinId,company_id:ctx.session.companyId,bulletin_ref:'BULL-'+new Date().getFullYear()+'-'+bulletinId.slice(0,8).toUpperCase(),title:bulletinTitle,bulletin_type:'safety_bulletin',publication_date:new Date().toISOString().slice(0,10),summary:savedPayload.what_happened||null,key_messages:savedPayload.shared_learning||null,content:[savedPayload.shared_learning,savedPayload.relevant_standards].filter(Boolean).join('\n\n'),topics:['Incident lesson',ref],author:savedPayload.contact||null,target_audience:'All employees',distribution_method:'AURIS360 Safety Communications',status:'draft',created_by:ctx.session.userId});if(!matchesBulletin(bulletin,ctx,bulletinId))throw failure('confirmation_failed','The linked bulletin Draft could not be confirmed.');}
  ctx.assert();var receipt={communication:communication,bulletin:bulletin,lesson:lesson,incident:incident,investigation:investigation,reusedCommunication:reusedCommunication,reusedBulletin:reusedBulletin};
 }catch(error){
  if(error.code==='context_changed'||error.code==='access_denied')throw error;
  var partial=failure('bulletin_failed','Safety Communication Draft '+communication.id+' is saved, but its linked Safety Bulletin is not confirmed. Retry generation to finish the linked Draft. '+(error.message||''));partial.receipt={communication:communication,lesson:lesson,incident:incident,investigation:investigation};partial.cause=error;throw partial;
 }
 ctx.assert();if(typeof ctx.services.onSaved==='function'){try{await ctx.services.onSaved(receipt);ctx.assert();}catch(error){ctx.assert();var display=failure('presentation_failed','Both Drafts are saved, but their view could not refresh. Reopen Safety Communications.');display.receipt=receipt;display.cause=error;throw display;}}return receipt;
}
async function generate(lessonId,services){
 var ctx=context(services),key=[ctx.session.companyId,ctx.session.userId,ctx.session.role,value(lessonId)].join('/');
 if(!value(lessonId))throw failure('source_mismatch','Select the approved lesson before generating.');
 if(pending.has(key))return pending.get(key);
 var task=run(ctx,lessonId);pending.set(key,task);try{return await task;}finally{if(pending.get(key)===task)pending.delete(key);}
}
root.AurisIncidentCommunication=Object.freeze({version:'1.0.0',generate:generate,matchesIncident:matchesIncident,validateSource:validateSource,investigationOptions:investigationOptions});
})(typeof window!=='undefined'?window:globalThis);
