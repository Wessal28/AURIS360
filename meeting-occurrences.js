(function(root){
'use strict';
var occurrences=root.AurisMeetingTime.occurrences,wall=root.AurisMeetingTime.wall,localDate=root.AurisMeetingTime.localDate;
function agendaWeek(day){var d=new Date(Date.UTC(day.getFullYear(),day.getMonth(),day.getDate()));d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));var first=new Date(Date.UTC(d.getUTCFullYear(),0,1));return Math.ceil((((d-first)/86400000)+1)/7);}
function agendaPeriod(day,recurrence){var step=({monthly:1,bimonthly:2,quarterly:3,triannual:4,biannual:6,annual:12})[recurrence]||3;return day.slice(0,4)+'/'+Math.floor((Number(day.slice(5,7))-1)/step);}
function projectOccurrences(series,minutes,exceptions,year,today){
 if(!series||!series.id||!series.company_id||series.active===false)return [];
 var company=String(series.company_id),seriesId=String(series.id),records=[],allDates=new Set(occurrences(series,year)),claimed=new Set(),origins=new Map(),inferred=new Set(),ambiguous=new Set();
 (minutes||[]).forEach(function(m){if(!m||!m.id||String(m.company_id)!==company||String(m.series_id)!==seriesId)return;var actual;try{actual=wall(m.meeting_date,m.meeting_timezone).slice(0,10);}catch(_){return;}if(!/^\d{4}-\d{2}-\d{2}$/.test(actual))return;records.push({record:m,actual:actual});occurrences(series,Number(actual.slice(0,4))).forEach(function(d){allDates.add(d);});});
 records.forEach(function(entry){var original=String(entry.record.scheduled_date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(original))return;origins.set(String(entry.record.id),original);claimed.add(original);if(!allDates.has(original)){var choices=Array.from(allDates).filter(function(d){return agendaPeriod(d,series.recurrence)===agendaPeriod(original,series.recurrence);});if(choices.length===1)claimed.add(choices[0]);}});
 var legacy=records.filter(function(entry){return !origins.has(String(entry.record.id));});
 Array.from(allDates).forEach(function(planned){var matches=legacy.filter(function(entry){return entry.actual===planned;});if(!matches.length)return;var available=!claimed.has(planned);claimed.add(planned);if(matches.length===1&&available){origins.set(String(matches[0].record.id),planned);inferred.add(String(matches[0].record.id));}else matches.forEach(function(entry){ambiguous.add(String(entry.record.id));});});
 var buckets=new Set(legacy.filter(function(entry){return !origins.has(String(entry.record.id));}).map(function(entry){return agendaPeriod(entry.actual,series.recurrence);}));
 buckets.forEach(function(bucket){var candidates=legacy.filter(function(entry){return !origins.has(String(entry.record.id))&&agendaPeriod(entry.actual,series.recurrence)===bucket;});var planned=Array.from(allDates).filter(function(d){return !claimed.has(d)&&agendaPeriod(d,series.recurrence)===bucket;});if(candidates.length===1&&planned.length===1&&!ambiguous.has(String(candidates[0].record.id))){origins.set(String(candidates[0].record.id),planned[0]);inferred.add(String(candidates[0].record.id));claimed.add(planned[0]);}else candidates.forEach(function(entry){ambiguous.add(String(entry.record.id));});});
 var removed=new Map((exceptions||[]).filter(function(e){return e&&String(e.company_id)===company&&String(e.series_id)===seriesId&&e.status==='cancelled';}).map(function(e){return [String(e.scheduled_date),e];})),removedClaims=new Set();
 removed.forEach(function(skip,original){if(allDates.has(original))return;var choices=Array.from(allDates).filter(function(d){return agendaPeriod(d,series.recurrence)===agendaPeriod(original,series.recurrence);});if(choices.length===1)removedClaims.add(choices[0]);});
 var output=[],cutoff=String(today||localDate()).slice(0,10);
 function row(day,extra){var d=new Date(day+'T12:00:00');return Object.assign({seriesId:seriesId,date:d,dateKey:day,week:agendaWeek(d),past:day<cutoff,minutesId:null,status:'planned',removed:false,inferred:false,ambiguous:false},extra);}
 occurrences(series,year).forEach(function(planned){if(claimed.has(planned)||removedClaims.has(planned))return;var skip=removed.get(planned);output.push(row(planned,{key:'planned:'+seriesId+':'+planned,scheduledDate:planned,removed:!!skip,exception:skip||null}));});
 removed.forEach(function(skip,planned){if(Number(planned.slice(0,4))!==Number(year)||claimed.has(planned)||output.some(function(r){return r.scheduledDate===planned;}))return;output.push(row(planned,{key:'planned:'+seriesId+':'+planned,scheduledDate:planned,removed:true,exception:skip}));});
 records.forEach(function(entry){if(Number(entry.actual.slice(0,4))!==Number(year))return;var m=entry.record,status=String(m.status||'draft').toLowerCase(),id=String(m.id);output.push(row(entry.actual,{key:'minutes:'+id,scheduledDate:origins.get(id)||null,minutesId:id,status:status,removed:status==='cancelled',inferred:inferred.has(id),ambiguous:ambiguous.has(id)}));});
 return output.sort(function(a,b){return a.dateKey.localeCompare(b.dateKey)||a.key.localeCompare(b.key);});
}
root.AurisMeetingAgenda=Object.freeze({project:projectOccurrences});
root.mtgAgendaRows=function(series,year){return projectOccurrences(series,mtgMinutesData,typeof mtgOccurrenceExceptions==='undefined'?[]:mtgOccurrenceExceptions,year||mtgRoadmapYear);};
root.mtgOpenOccurrence=function(seriesId,key){
 var company=String(ccid()||''),series=(mtgSeriesData||[]).find(function(s){return String(s.id)===String(seriesId)&&String(s.company_id)===company&&s.active!==false;});
 var entry=series&&root.mtgAgendaRows(series,mtgRoadmapYear).find(function(row){return row.key===key;});
 if(!entry){toast('This occurrence changed or is unavailable. Refresh Meeting Agenda.',false);return;}
 if(entry.minutesId){if(entry.status==='completed'||!isMgr())mtgViewMomReadOnly(entry.minutesId);else mtgOpenMom(entry.minutesId);return;}
 if(entry.removed){toast('Restore this occurrence before creating minutes.',false);return;}
 if(!isMgr()){toast('Manager access is required to create minutes.',false);return;}
 mtgScheduleMeeting(series.id,entry.scheduledDate);
};
root.mtgOpenWeek=function(seriesId,week){
 var company=String(ccid()||''),user=String(prof?.id||''),series=(mtgSeriesData||[]).find(function(s){return String(s.id)===String(seriesId)&&String(s.company_id)===company;});
 var entries=series?root.mtgAgendaRows(series,mtgRoadmapYear).filter(function(row){return !row.removed&&row.week===Number(week);}):[];
 if(entries.length===1){root.mtgOpenOccurrence(seriesId,entries[0].key);return;}
 if(!entries.length)return;
 document.getElementById('meeting-week-choice')?.remove();var modal=document.createElement('div');modal.id='meeting-week-choice';modal.className='meeting-occurrence-dialog';
 var panel=document.createElement('div');panel.className='card';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Choose meeting occurrence');
 var heading=document.createElement('h3');heading.textContent='Choose the meeting date';panel.appendChild(heading);
 entries.forEach(function(entry){var button=document.createElement('button');button.type='button';button.className='btn';button.textContent=entry.date.toLocaleDateString('en-GB')+' · '+(entry.minutesId?'Open minutes':'Create minutes');button.addEventListener('click',function(){if(String(ccid()||'')!==company||String(prof?.id||'')!==user){modal.remove();toast('The account or company changed. Reopen the agenda.',false);return;}modal.remove();root.mtgOpenOccurrence(seriesId,entry.key);});panel.appendChild(button);});
 var close=document.createElement('button');close.type='button';close.className='btn';close.textContent='Close';close.addEventListener('click',function(){modal.remove();});panel.appendChild(close);modal.appendChild(panel);document.body.appendChild(modal);
};
root.mtgChangeOccurrence=async function(seriesId,key,command){
 if(root.mtgChangeOccurrence.pending||!['cancel','restore'].includes(command)||!isMgr())return false;
 var company=String(ccid()||''),user=String(prof?.id||''),role=activeRole();if(!company||!user)return false;
 var series=(mtgSeriesData||[]).find(function(s){return String(s.id)===String(seriesId)&&String(s.company_id)===company&&s.active!==false;});
 var entry=series&&root.mtgAgendaRows(series,mtgRoadmapYear).find(function(row){return row.key===key;});if(!entry)return false;
 function assertCurrent(){if(company!==String(ccid()||'')||user!==String(prof?.id||'')||role!==activeRole()||!isMgr())throw Error('The account, company or access changed. Reopen Meeting Agenda.');}
 if(entry.minutesId){if(command!=='cancel')return false;var cancelled=await mtgRemoveMinutes(entry.minutesId);if(cancelled)mtgRenderRoadmap();return cancelled;}
 if(!mtgCanChangeSeries(series,'PATCH')){toast('Schedule editing access is required to remove an occurrence.',false);return false;}
 root.mtgChangeOccurrence.pending=true;
 try{
  var scope='&company_id=eq.'+encodeURIComponent(company),rows=await api('/meeting_series?select=id,company_id,title,active&id=eq.'+encodeURIComponent(seriesId)+scope);assertCurrent();
  if(!Array.isArray(rows)||rows.length!==1||String(rows[0].id)!==String(seriesId)||String(rows[0].company_id)!==company||rows[0].active===false||!mtgCanChangeSeries(rows[0],'PATCH'))throw Error('The meeting schedule changed or is unavailable. Refresh the agenda.');
  var stored=await api('/meeting_occurrence_exceptions?select=*&series_id=eq.'+encodeURIComponent(seriesId)+'&scheduled_date=eq.'+encodeURIComponent(entry.scheduledDate)+scope+'&limit=2');assertCurrent();
  if(!Array.isArray(stored)||stored.length>1||stored.some(function(x){return String(x.company_id)!==company||String(x.series_id)!==String(seriesId)||x.scheduled_date!==entry.scheduledDate;}))throw Error('The occurrence state could not be verified. Refresh the agenda.');
  var current=stored[0]||null;if(command==='restore'&&current?.status!=='cancelled')throw Error('This occurrence is no longer removed. Refresh the agenda.');if(command==='cancel'&&current?.status==='cancelled')throw Error('This occurrence is already removed. Refresh the agenda.');
  var label=command==='restore'?'Restore occurrence':'Remove occurrence',confirmed=await appConfirmAction({title:label,message:label+' · '+entry.date.toLocaleDateString('en-GB')+' · '+rows[0].title+'?',confirmText:label,cancelText:'Back',detail:command==='restore'?'This date will return to Meeting Agenda.':'Only this occurrence is removed. The recurring schedule and saved minutes are kept. You can restore it using Show removed occurrences.'});
  if(!confirmed)return false;assertCurrent();if(!mtgCanChangeSeries(rows[0],'PATCH'))throw Error('Schedule editing access is required.');
  var response=await api('/rpc/set_meeting_occurrence',{m:'POST',b:{p_series_id:seriesId,p_scheduled_date:entry.scheduledDate,p_command:command,p_expected_updated_at:current?.updated_at||null}});assertCurrent();var saved=Array.isArray(response)?response[0]:response;
  if(!saved?.id||String(saved.company_id)!==company||String(saved.series_id)!==String(seriesId)||saved.scheduled_date!==entry.scheduledDate||saved.status!==(command==='cancel'?'cancelled':'active'))throw Error('The occurrence change could not be confirmed. Refresh the agenda before retrying.');
  mtgOccurrenceExceptions=(mtgOccurrenceExceptions||[]).filter(function(x){return !(String(x.company_id)===company&&String(x.series_id)===String(seriesId)&&x.scheduled_date===entry.scheduledDate);}).concat([saved]);
  mtgRenderRoadmap();toast(command==='restore'?'Meeting occurrence restored.':'Meeting occurrence removed.');return true;
 }catch(error){var message=String(error.message||error);if(/meeting_occurrence_exceptions|set_meeting_occurrence/.test(message)&&/schema cache|does not exist|could not find|PGRST/i.test(message))message='Occurrence changes need a database update. Your meeting schedule and minutes are unchanged.';toast(message,false);return false;}
 finally{root.mtgChangeOccurrence.pending=false;}
};
root.mtgRenderOccurrences=function(container){
 var section=document.createElement('section');section.className='meeting-occurrences';var heading=document.createElement('div');heading.className='meeting-occurrence-heading';var title=document.createElement('h3');title.textContent='Meeting occurrences — '+mtgRoadmapYear;heading.appendChild(title);
 var toggleLabel=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=typeof mtgShowRemovedOccurrences!=='undefined'&&mtgShowRemovedOccurrences;toggle.setAttribute('aria-label','Show removed occurrences');toggle.addEventListener('change',function(){mtgShowRemovedOccurrences=toggle.checked;mtgRenderRoadmap();});toggleLabel.appendChild(toggle);var toggleText=document.createElement('span');toggleText.textContent='Show removed occurrences';toggleLabel.appendChild(toggleText);heading.appendChild(toggleLabel);section.appendChild(heading);
 var rows=[];(mtgSeriesData||[]).filter(function(s){return s.active!==false&&String(s.company_id)===String(ccid()||'');}).forEach(function(series){root.mtgAgendaRows(series,mtgRoadmapYear).forEach(function(entry){if(!entry.removed||toggle.checked)rows.push({series:series,entry:entry});});});rows.sort(function(a,b){return a.entry.dateKey.localeCompare(b.entry.dateKey)||a.entry.key.localeCompare(b.entry.key);});
 rows.forEach(function(item){var series=item.series,entry=item.entry,line=document.createElement('div');line.className='meeting-occurrence-row'+(entry.removed?' is-removed':'');var name=document.createElement('span');name.textContent=entry.date.toLocaleDateString('en-GB')+' · '+series.title+(entry.removed?' · Removed':'');if(entry.ambiguous){var note=document.createElement('small');note.textContent=' · Existing minutes kept separately; original planned date is unconfirmed.';name.appendChild(note);}line.appendChild(name);var actions=document.createElement('div');actions.className='meeting-occurrence-actions';
 function button(label,callback){var b=document.createElement('button');b.type='button';b.className='btn btn-sm';b.textContent=label;b.setAttribute('aria-label',label+' · '+entry.dateKey+' · '+series.title);b.addEventListener('click',async function(){b.disabled=true;try{await callback();}finally{b.disabled=false;}});actions.appendChild(b);}
 if(entry.minutesId||(!entry.removed&&isMgr()))button(entry.minutesId?'Open minutes':'Create minutes',function(){root.mtgOpenOccurrence(series.id,entry.key);});
 if(isMgr()&&!entry.removed&&(entry.minutesId||mtgCanChangeSeries(series,'PATCH')))button(entry.minutesId?'Cancel meeting':'Remove occurrence',function(){return root.mtgChangeOccurrence(series.id,entry.key,'cancel');});
 if(isMgr()&&entry.removed&&!entry.minutesId&&mtgCanChangeSeries(series,'PATCH'))button('Restore occurrence',function(){return root.mtgChangeOccurrence(series.id,entry.key,'restore');});
 line.appendChild(actions);section.appendChild(line);});container.appendChild(section);
};
})(typeof window!=='undefined'?window:globalThis);
