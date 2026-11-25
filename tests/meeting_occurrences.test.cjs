const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const helper=fs.readFileSync('meeting-reliability.js','utf8')+'\n'+fs.readFileSync('meeting-occurrences.js','utf8');
const COMPANY='company-a';
function runtime(overrides={}){const c={Intl,Date,Map,Set,crypto:require('node:crypto').webcrypto,document:{addEventListener(){},querySelectorAll(){return [];},getElementById(){return null;}},ccid:()=>COMPANY,...overrides};c.window=c;vm.createContext(c);vm.runInContext(helper,c);return c;}
function schedule(extra={}){return {id:'series-a',company_id:COMPANY,title:'Quarterly management review',recurrence:'quarterly',agenda_anchor_date:'2026-01-17',next_date:'2026-10-17',active:true,...extra};}
function minutes(extra={}){return {id:'minutes-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-01-17',meeting_date:'2026-01-24T05:00:00Z',meeting_timezone:'Asia/Dubai',status:'draft',...extra};}
function day(row){const value=row.date;return typeof value==='string'?value.slice(0,10):[value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');}
function project({series=schedule(),saved=[],exceptions=[],year=2026,today='2026-11-25'}={}){const c=runtime();assert.equal(typeof c.AurisMeetingAgenda?.project,'function','The grid and occurrence list share an exported projection');return c.AurisMeetingAgenda.project(series,saved,exceptions,year,today);}
function active(rows){return rows.filter(row=>!row.removed);}
function saved(rows){return rows.filter(row=>row.minutesId);}

test('moving an explicitly linked occurrence replaces its planned date without creating a second agenda item',()=>{
 const rows=active(project({saved:[minutes()]}));
 assert.equal(rows.length,4);assert.ok(!rows.some(row=>day(row)==='2026-01-17'));
 const moved=rows.find(row=>row.minutesId==='minutes-a');assert.ok(moved);assert.equal(day(moved),'2026-01-24');assert.equal(moved.scheduledDate,'2026-01-17');assert.equal(moved.seriesId,'series-a');
 assert.deepEqual(Array.from(rows.filter(row=>!row.minutesId),day),['2026-04-17','2026-07-17','2026-10-17']);
});

test('successive date changes retain the same occurrence and minutes identities',()=>{
 const first=active(project({saved:[minutes()]})),second=active(project({saved:[minutes({meeting_date:'2026-02-20T05:00:00Z'})]}));
 assert.equal(first.length,4);assert.equal(second.length,4);assert.equal(saved(second).length,1);
 assert.equal(saved(second)[0].minutesId,'minutes-a');assert.equal(saved(second)[0].scheduledDate,'2026-01-17');assert.equal(day(saved(second)[0]),'2026-02-20');
 assert.ok(!second.some(row=>day(row)==='2026-01-17'||day(row)==='2026-01-24'));
});

test('automatic next-date advancement does not shift the stable recurrence anchor',()=>{
 const rows=active(project({series:schedule({next_date:'2027-04-02'})}));
 assert.deepEqual(Array.from(rows,day),['2026-01-17','2026-04-17','2026-07-17','2026-10-17']);
});

test('cancelling saved minutes retains its occurrence claim so the original slot does not reappear',()=>{
 const rows=project({saved:[minutes({status:'cancelled'})]});
 assert.equal(active(rows).length,3);assert.ok(!active(rows).some(row=>day(row)==='2026-01-17'||day(row)==='2026-01-24'));
 const removed=rows.find(row=>row.minutesId==='minutes-a');assert.ok(removed?.removed);assert.equal(removed.scheduledDate,'2026-01-17');
});

test('deleting cancelled bound minutes with an off-pattern origin retains the same planned-slot cancellation',()=>{
 const record=minutes({scheduled_date:'2026-01-24',meeting_date:'2026-02-05T05:00:00Z',status:'cancelled'});
 const before=project({saved:[record]}),exception={id:'exception-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-01-24',status:'cancelled'},after=project({exceptions:[exception]});
 assert.equal(active(before).length,3);assert.equal(active(after).length,3);assert.ok(!active(after).some(row=>day(row)==='2026-01-17'));
 const removed=after.find(row=>row.removed);assert.ok(removed);assert.equal(removed.scheduledDate,'2026-01-24');assert.equal(removed.key,'planned:series-a:2026-01-24');assert.equal(removed.exception.id,'exception-a');
 const restored=active(project({exceptions:[{...exception,status:'active'}]}));assert.equal(restored.length,4);assert.ok(restored.some(row=>day(row)==='2026-01-17'));
});

test('one cancelled planned occurrence leaves the schedule and other dates intact and can be restored',()=>{
 const exception={id:'exception-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-04-17',status:'cancelled'};
 const cancelled=project({exceptions:[exception]});assert.equal(active(cancelled).length,3);assert.ok(!active(cancelled).some(row=>day(row)==='2026-04-17'));
 assert.ok(cancelled.some(row=>row.scheduledDate==='2026-04-17'&&row.removed));
 const restored=active(project({exceptions:[{...exception,status:'active'}]}));assert.equal(restored.length,4);assert.ok(restored.some(row=>day(row)==='2026-04-17'));
});

test('an exact legacy date claims its planned slot without changing or deleting minutes',()=>{
 const record=minutes({scheduled_date:null,meeting_date:'2026-01-17T05:00:00Z'}),before=JSON.stringify(record);
 const rows=active(project({saved:[record]}));assert.equal(rows.length,4);assert.equal(saved(rows).length,1);assert.equal(saved(rows)[0].scheduledDate,'2026-01-17');assert.equal(JSON.stringify(record),before);
});

test('a uniquely matched legacy date in one recurrence period replaces the old planned slot',()=>{
 const record=minutes({scheduled_date:null}),before=JSON.stringify(record);const rows=active(project({saved:[record]}));
 assert.equal(rows.length,4);assert.equal(day(saved(rows)[0]),'2026-01-24');assert.equal(saved(rows)[0].scheduledDate,'2026-01-17');assert.equal(saved(rows)[0].inferred,true);assert.equal(JSON.stringify(record),before);
});

test('ambiguous legacy minutes remain distinct and do not silently consume the planned occurrence',()=>{
 const records=[minutes({id:'legacy-a',scheduled_date:null}),minutes({id:'legacy-b',scheduled_date:null,meeting_date:'2026-02-07T05:00:00Z'})];
 const rows=active(project({saved:records}));assert.equal(rows.length,6);assert.deepEqual(Array.from(saved(rows),row=>row.minutesId).sort(),['legacy-a','legacy-b']);assert.ok(rows.some(row=>!row.minutesId&&day(row)==='2026-01-17'));
 assert.ok(saved(rows).every(row=>!row.scheduledDate));
});

test('two actual saved records on the same day are never merged or discarded by date',()=>{
 const records=[minutes(),minutes({id:'minutes-b',scheduled_date:'2026-04-17'})];const rows=active(project({saved:records}));
 assert.equal(rows.length,4);assert.deepEqual(Array.from(saved(rows),row=>row.minutesId).sort(),['minutes-a','minutes-b']);assert.ok(saved(rows).every(row=>day(row)==='2026-01-24'));
});

test('two distinct occurrences in one ISO week remain individually addressable',()=>{
 const rows=active(project({saved:[minutes(),minutes({id:'minutes-b',scheduled_date:'2026-04-17',meeting_date:'2026-01-25T05:00:00Z'})]}));
 const actual=saved(rows);assert.equal(actual.length,2);assert.equal(actual[0].week,actual[1].week);assert.notEqual(actual[0].minutesId,actual[1].minutesId);assert.notEqual(actual[0].scheduledDate,actual[1].scheduledDate);
});

test('an explicitly linked meeting moved across years disappears from its old year and retains the next year’s planned slot',()=>{
 const record=minutes({scheduled_date:'2026-10-17',meeting_date:'2027-01-05T05:00:00Z'});
 const old=active(project({saved:[record]}));assert.equal(old.length,3);assert.ok(!old.some(row=>row.scheduledDate==='2026-10-17'));
 const next=active(project({saved:[record],year:2027}));assert.equal(next.length,5);assert.equal(day(saved(next)[0]),'2027-01-05');assert.ok(next.some(row=>!row.minutesId&&day(row)==='2027-01-17'));
});

test('actual meeting dates use their saved timezone near a year boundary',()=>{
 const record=minutes({scheduled_date:'2026-10-17',meeting_date:'2026-12-31T23:30:00Z',meeting_timezone:'Asia/Dubai'});
 assert.equal(saved(active(project({saved:[record]}))).length,0);
 const next=saved(active(project({saved:[record],year:2027})));assert.equal(next.length,1);assert.equal(day(next[0]),'2027-01-01');
});

test('month-end planned dates retain the original day through February and leap years',()=>{
 const ordinary=active(project({series:schedule({recurrence:'monthly',agenda_anchor_date:'2027-01-31',next_date:'2027-03-28'}),year:2027}));
 assert.equal(ordinary.length,12);assert.ok(ordinary.some(row=>day(row)==='2027-02-28'));assert.ok(ordinary.some(row=>day(row)==='2027-03-31'));
 const leap=active(project({series:schedule({recurrence:'monthly',agenda_anchor_date:'2028-01-31',next_date:'2028-03-29'}),year:2028}));
 assert.ok(leap.some(row=>day(row)==='2028-02-29'));assert.ok(leap.some(row=>day(row)==='2028-03-31'));
});

test('other companies and inactive schedules cannot contribute minutes, exceptions or agenda dates',()=>{
 const rows=active(project({series:schedule(),saved:[minutes({id:'foreign-minutes',company_id:'company-b'}),minutes({id:'inactive-minutes',series_id:'inactive'})],exceptions:[{id:'foreign-exception',company_id:'company-b',series_id:'series-a',scheduled_date:'2026-01-17',status:'cancelled'},{id:'other-series-exception',company_id:COMPANY,series_id:'another-series',scheduled_date:'2026-04-17',status:'cancelled'}]}));
 assert.equal(rows.length,4);assert.ok(rows.every(row=>row.seriesId==='series-a'&&!row.minutesId));assert.ok(rows.some(row=>day(row)==='2026-01-17'));
});

test('inactive recurring schedules do not contribute agenda occurrences',()=>{assert.deepEqual(Array.from(project({series:schedule({active:false}),saved:[minutes()]})),[]);});

class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.events={};this.attributes={};this.textContent='';this.isConnected=true;}
 appendChild(child){child.parentNode=this;this.children.push(child);return child;}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,handler){this.events[name]=handler;}
 remove(){this.isConnected=false;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
}
function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
function ui(options={}){
 let company=COMPANY,role='manager',manager=true,permission=true;
 const calls=[],requests=[],confirmations=[],toasts=[],body=new Element('body');
 const document={body,addEventListener(){},querySelectorAll(){return [];},createElement:tag=>new Element(tag),getElementById:id=>descendants(body).find(node=>node.id===id)||null};
 const localExceptions=options.exceptions||[],stored=options.stored===undefined?localExceptions:options.stored;
 const c=runtime({document,prof:{id:'user-a'},ccid:()=>company,activeRole:()=>role,isMgr:()=>manager,mtgCanChangeSeries:()=>permission,
  mtgSeriesData:options.series||[schedule()],mtgMinutesData:options.saved||[],mtgOccurrenceExceptions:localExceptions,mtgRoadmapYear:2026,mtgShowRemovedOccurrences:false,
  toast:(...args)=>toasts.push(args),mtgRenderRoadmap:()=>calls.push(['render']),mtgViewMomReadOnly:id=>calls.push(['view',id]),mtgOpenMom:id=>calls.push(['edit',id]),mtgScheduleMeeting:(...args)=>calls.push(['create',...args]),mtgRemoveMinutes:async id=>{calls.push(['cancel-minutes',id]);return true;},
  appConfirmAction:async config=>{confirmations.push(config);return options.confirm?options.confirm(config):true;},
  api:async(url,request)=>{requests.push({url,request});if(options.request)return options.request(url,request);
   if(url.startsWith('/meeting_series?'))return [schedule()];
   if(url.startsWith('/meeting_occurrence_exceptions?'))return stored;
   if(url==='/rpc/set_meeting_occurrence')return {id:'exception-new',company_id:COMPANY,series_id:'series-a',scheduled_date:request.b.p_scheduled_date,status:request.b.p_command==='cancel'?'cancelled':'active',updated_at:'2026-11-25T10:00:00Z'};
   throw Error('Unexpected request '+url);
  }});
 return {c,calls,requests,confirmations,toasts,document,changeCompany:value=>{company=value;},changeUser:value=>{c.prof.id=value;},changeRole:value=>{role=value;},changeManager:value=>{manager=value;},changePermission:value=>{permission=value;},render(){const container=new Element('main');c.mtgRenderOccurrences(container);return container;}};
}
function rpcRequests(h){return h.requests.filter(item=>item.url==='/rpc/set_meeting_occurrence');}
const PLAN='planned:series-a:2026-01-17';

test('opening an agenda occurrence addresses its exact minutes ID or planned origin',()=>{
 const h=ui({saved:[minutes(),minutes({id:'minutes-b',scheduled_date:'2026-04-17',meeting_date:'2026-01-25T05:00:00Z'})]});
 h.c.mtgOpenOccurrence('series-a','minutes:minutes-b');h.c.mtgOpenOccurrence('series-a','minutes:minutes-a');
 h.c.mtgOpenOccurrence('series-a','planned:series-a:2026-07-17');
 assert.deepEqual(h.calls,[['edit','minutes-b'],['edit','minutes-a'],['create','series-a','2026-07-17']]);
});

test('completed minutes and non-manager access open read-only while removed or stale planned entries cannot create records',()=>{
 const h=ui({saved:[minutes({status:'completed'})],exceptions:[{company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-04-17',status:'cancelled'}]});
 h.c.mtgOpenOccurrence('series-a','minutes:minutes-a');h.c.mtgOpenOccurrence('series-a','planned:series-a:2026-04-17');h.c.mtgOpenOccurrence('series-a','minutes:missing');
 h.changeCompany('company-b');h.c.mtgOpenOccurrence('series-a','planned:series-a:2026-07-17');assert.deepEqual(h.calls,[['view','minutes-a']]);
 const reader=ui({saved:[minutes()]});reader.changeManager(false);reader.c.mtgOpenOccurrence('series-a','minutes:minutes-a');reader.c.mtgOpenOccurrence('series-a','planned:series-a:2026-07-17');assert.deepEqual(reader.calls,[['view','minutes-a']]);
});

test('a week containing two moved meetings asks which exact occurrence to open',()=>{
 const h=ui({saved:[minutes(),minutes({id:'minutes-b',scheduled_date:'2026-04-17',meeting_date:'2026-01-25T05:00:00Z'})]});
 const week=h.c.mtgAgendaRows(h.c.mtgSeriesData[0],2026).find(row=>row.minutesId==='minutes-a').week;
 h.c.mtgOpenWeek('series-a',week);assert.equal(h.calls.length,0);
 let modal=h.document.getElementById('meeting-week-choice'),buttons=descendants(modal).filter(node=>node.tagName==='BUTTON');assert.equal(buttons.length,3);
 buttons[1].events.click();assert.deepEqual(h.calls,[['edit','minutes-b']]);assert.equal(h.document.getElementById('meeting-week-choice'),null);
 h.c.mtgOpenWeek('series-a',week);modal=h.document.getElementById('meeting-week-choice');buttons=descendants(modal).filter(node=>node.tagName==='BUTTON');buttons[0].events.click();assert.deepEqual(h.calls.at(-1),['edit','minutes-a']);
});

test('a stale same-week chooser cannot open minutes after company or account changes',()=>{
 for(const change of [h=>h.changeCompany('company-b'),h=>h.changeUser('user-b')]){
  const h=ui({saved:[minutes(),minutes({id:'minutes-b',scheduled_date:'2026-04-17',meeting_date:'2026-01-25T05:00:00Z'})]}),week=h.c.mtgAgendaRows(h.c.mtgSeriesData[0],2026)[0].week;
  h.c.mtgOpenWeek('series-a',week);const modal=h.document.getElementById('meeting-week-choice'),button=descendants(modal).find(node=>node.tagName==='BUTTON');change(h);button.events.click();assert.equal(h.calls.length,0);assert.equal(modal.isConnected,false);
 }
});

test('the occurrence list renders the actual moved date once and hides removed dates until requested',async()=>{
 const exception={id:'exception-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-04-17',status:'cancelled',updated_at:'2026-11-25T09:00:00Z'},h=ui({saved:[minutes()],exceptions:[exception]});
 let container=h.render(),lines=descendants(container).filter(node=>(node.className||'').startsWith('meeting-occurrence-row'));
 assert.equal(lines.length,3);assert.ok(lines.some(node=>node.children[0].textContent.startsWith('24/01/2026')));assert.ok(!lines.some(node=>node.children[0].textContent.startsWith('17/01/2026')||node.children[0].textContent.startsWith('17/04/2026')));
 const toggle=descendants(container).find(node=>node.tagName==='INPUT');toggle.checked=true;toggle.events.change();assert.equal(h.c.mtgShowRemovedOccurrences,true);
 container=h.render();lines=descendants(container).filter(node=>(node.className||'').startsWith('meeting-occurrence-row'));assert.equal(lines.length,4);
 const removed=lines.find(node=>node.className.includes('is-removed'));assert.match(removed.children[0].textContent,/17\/04\/2026.*Removed/);const actions=descendants(removed).filter(node=>node.tagName==='BUTTON');assert.deepEqual(actions.map(node=>node.textContent),['Restore occurrence']);
 await actions[0].events.click();assert.equal(rpcRequests(h)[0].request.b.p_command,'restore');assert.equal(h.c.mtgOccurrenceExceptions[0].status,'active');
});

test('cancelling one planned occurrence uses company-scoped reads and a verified exception receipt without changing minutes or the schedule',async()=>{
 const h=ui({saved:[minutes({id:'other-quarter',scheduled_date:'2026-04-17',meeting_date:'2026-04-24T05:00:00Z'})]}),before=JSON.stringify([h.c.mtgSeriesData,h.c.mtgMinutesData]);
 assert.equal(await h.c.mtgChangeOccurrence('series-a',PLAN,'cancel'),true);assert.equal(h.confirmations.length,1);
 assert.ok(h.requests.slice(0,2).every(item=>item.url.includes('company_id=eq.company-a')));assert.match(h.requests[1].url,/scheduled_date=eq\.2026-01-17/);
 const rpc=rpcRequests(h);assert.equal(rpc.length,1);assert.equal(rpc[0].request.m,'POST');assert.deepEqual(JSON.parse(JSON.stringify(rpc[0].request.b)),{p_series_id:'series-a',p_scheduled_date:'2026-01-17',p_command:'cancel',p_expected_updated_at:null});
 assert.equal(h.c.mtgOccurrenceExceptions.length,1);assert.equal(h.c.mtgOccurrenceExceptions[0].status,'cancelled');assert.equal(JSON.stringify([h.c.mtgSeriesData,h.c.mtgMinutesData]),before);
});

test('restoring an occurrence uses the freshly read concurrency version',async()=>{
 const local={id:'exception-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-01-17',status:'cancelled',updated_at:'old-version'},h=ui({exceptions:[local],stored:[{...local,updated_at:'fresh-version'}]});
 assert.equal(await h.c.mtgChangeOccurrence('series-a',PLAN,'restore'),true);assert.equal(rpcRequests(h)[0].request.b.p_expected_updated_at,'fresh-version');assert.equal(h.c.mtgOccurrenceExceptions[0].status,'active');
});

test('restoring an off-pattern tombstone addresses its original identity rather than the inferred base slot',async()=>{
 const exception={id:'exception-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-01-24',status:'cancelled',updated_at:'fresh-version'},h=ui({exceptions:[exception]});
 assert.equal(await h.c.mtgChangeOccurrence('series-a','planned:series-a:2026-01-24','restore'),true);
 assert.equal(rpcRequests(h)[0].request.b.p_scheduled_date,'2026-01-24');assert.equal(rpcRequests(h)[0].request.b.p_expected_updated_at,'fresh-version');
 assert.equal(active(h.c.mtgAgendaRows(h.c.mtgSeriesData[0],2026)).length,4);
});

test('declining an occurrence change leaves the saved state untouched',async()=>{
 const h=ui({confirm:()=>false}),before=JSON.stringify(h.c.mtgOccurrenceExceptions);assert.equal(await h.c.mtgChangeOccurrence('series-a',PLAN,'cancel'),false);assert.equal(rpcRequests(h).length,0);assert.equal(JSON.stringify(h.c.mtgOccurrenceExceptions),before);assert.equal(h.c.mtgChangeOccurrence.pending,false);
});

test('company, account and role changes during a fresh read prevent stale confirmation or writes',async()=>{
 for(const change of [h=>h.changeCompany('company-b'),h=>h.changeUser('user-b'),h=>h.changeRole('employee'),h=>h.changeManager(false)]){
  let resolve;const response=new Promise(done=>{resolve=done;}),h=ui({request:()=>response}),pending=h.c.mtgChangeOccurrence('series-a',PLAN,'cancel');change(h);resolve([schedule()]);
  assert.equal(await pending,false);assert.equal(h.confirmations.length,0);assert.equal(rpcRequests(h).length,0);assert.equal(h.c.mtgOccurrenceExceptions.length,0);assert.equal(h.c.mtgChangeOccurrence.pending,false);
 }
});

test('company, account, role and permission changes during confirmation prevent the occurrence write',async()=>{
 for(const change of [h=>h.changeCompany('company-b'),h=>h.changeUser('user-b'),h=>h.changeRole('employee'),h=>h.changeManager(false),h=>h.changePermission(false)]){
  let resolve,started;const ready=new Promise(done=>{started=done;}),answer=new Promise(done=>{resolve=done;}),h=ui({confirm:()=>{started();return answer;}}),pending=h.c.mtgChangeOccurrence('series-a',PLAN,'cancel');
  await ready;change(h);resolve(true);assert.equal(await pending,false);assert.equal(rpcRequests(h).length,0);assert.equal(h.c.mtgOccurrenceExceptions.length,0);
 }
});

test('an unavailable or no-longer-active server schedule cannot be modified using stale local data',async()=>{
 for(const server of [[],[schedule({active:false})],[schedule({company_id:'company-b'})]]){
  const h=ui({request:()=>server});assert.equal(await h.c.mtgChangeOccurrence('series-a',PLAN,'cancel'),false);assert.equal(h.confirmations.length,0);assert.equal(rpcRequests(h).length,0);
 }
});

test('a failed or invalid occurrence receipt preserves local state and allows a safe retry',async()=>{
 for(const failure of [Error('Could not find public.set_meeting_occurrence in the schema cache'),{id:'bad-receipt',company_id:'company-b',series_id:'series-a',scheduled_date:'2026-01-17',status:'cancelled'}]){
  const h=ui({request:(url)=>{if(url.startsWith('/meeting_series?'))return [schedule()];if(url.startsWith('/meeting_occurrence_exceptions?'))return [];if(failure instanceof Error)throw failure;return failure;}});
  assert.equal(await h.c.mtgChangeOccurrence('series-a',PLAN,'cancel'),false);assert.equal(h.c.mtgOccurrenceExceptions.length,0);assert.equal(h.c.mtgChangeOccurrence.pending,false);assert.ok(h.toasts.some(item=>/database update|could not be confirmed/.test(item[0])));
 }
});

test('a second click while an occurrence change is pending does not send a duplicate command',async()=>{
 let resolve,started;const ready=new Promise(done=>{started=done;}),answer=new Promise(done=>{resolve=done;}),h=ui({confirm:()=>{started();return answer;}}),first=h.c.mtgChangeOccurrence('series-a',PLAN,'cancel');
 await ready;assert.equal(await h.c.mtgChangeOccurrence('series-a',PLAN,'cancel'),false);resolve(true);assert.equal(await first,true);assert.equal(h.confirmations.length,1);assert.equal(rpcRequests(h).length,1);
});

test('cancelling a saved occurrence delegates to minutes cancellation using its exact ID',async()=>{
 const h=ui({saved:[minutes(),minutes({id:'minutes-b',scheduled_date:'2026-04-17',meeting_date:'2026-01-25T05:00:00Z'})]});
 assert.equal(await h.c.mtgChangeOccurrence('series-a','minutes:minutes-b','cancel'),true);assert.deepEqual(h.calls,[['cancel-minutes','minutes-b'],['render']]);assert.equal(h.requests.length,0);assert.equal(h.c.mtgMinutesData.length,2);
});
