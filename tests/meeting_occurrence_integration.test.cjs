const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('auris-core.js','utf8'),helper=fs.readFileSync('meeting-reliability.js','utf8')+'\n'+fs.readFileSync('meeting-occurrences.js','utf8');
function section(start,end){const a=core.indexOf(start),b=core.indexOf(end,a);assert.ok(a>=0&&b>a,start);return core.slice(a,b);}
const COMPANY='company-a';
const series=(extra={})=>({id:'series-a',company_id:COMPANY,title:'Quarterly review',meeting_type:'management_review',recurrence:'quarterly',agenda_anchor_date:'2026-01-17',next_date:'2026-10-17',active:true,...extra});
const minutes=(extra={})=>({id:'minutes-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-01-17',title:'Quarterly review',meeting_date:'2026-01-24T05:00:00Z',meeting_timezone:'Asia/Dubai',status:'draft',agenda_items:[],recommendations:[],updated_at:'2026-11-25T08:00:00Z',...extra});
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.events={};this.attributes={};this.value='';this.textContent='';this._html='';this.classList={add(){},remove(){}};}
 set innerHTML(value){this._html=value;this.children=[];}get innerHTML(){return this._html;}
 appendChild(child){child.parentNode=this;this.children.push(child);return child;}
 prepend(child){child.parentNode=this;this.children.unshift(child);}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,callback){this.events[name]=callback;}
 querySelectorAll(){return [];}
 querySelector(selector){if(selector==='span'){if(!this.label)this.label=new Element('span');return this.label;}return null;}
 after(child){if(this.parentNode)this.parentNode.appendChild(child);}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
}
function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
function harness(options={}){
 let company=COMPANY;const requests=[],messages=[],navigation=[],elements={};
 for(const id of ['mtg-roadmap-container','mtg-agenda-year','mtg-new-series-btn2','mtg-manage-schedules','mtg-series-list','mtg-mom3form','mtg-view-schedule','mtg-view-minutes','mtg-series-form','mtg-mom3title','mtg-mom3ref','mtg-mom3del-btn','mtg-mom3send-btn','mom3title','mom3location','mom3chaired-by','mom3recorder','mom3attendees','mom3apologies','mom3notes','mom3sign-chair','mom3sign-approver','mom3attendees-extra','mom3apologies-extra','mom3attendees-tags','mom3apologies-tags','mom3date','mom3next-date','mom3sign-date','mom3sign-approver-date','mom3status','mom3header-title','mom3agenda-body','mom3rec-body','mom3rec-empty','mom3type']){elements[id]=new Element();elements[id].id=id;}
 const form=elements['mtg-mom3form'],buttons=[new Element('button'),new Element('button')];form.querySelectorAll=()=>buttons;form.style.display='none';
 const document={body:new Element('body'),addEventListener(){},getElementById:id=>elements[id]||descendants(form).find(node=>node.id===id)||null,querySelectorAll:()=>[],createElement:tag=>new Element(tag)};
 const c={Date,Intl,Map,Set,crypto:require('node:crypto').webcrypto,console:{error(){}},document,setTimeout(){},ccid:()=>company,cf:()=> '&company_id=eq.'+company,prof:{id:'user-a'},isMgr:()=>true,activeRole:()=> 'manager',
  mtgSeriesData:options.series||[series()],mtgMinutesData:options.saved||[],mtgRoadmapYear:options.year||2026,mtgSeriesListOpen:false,mtgEditingMomId:null,mtgSavingMom:false,mtgMinutesRemovalPending:false,mapAllData:[],
  MTG_TYPES:{management_review:'Management review'},MTG_RECURRENCE:{quarterly:'Quarterly'},escH:String,escH2:String,
  mtgSeriesRemovalButtons:()=>'',mtgBindSeriesRemoval(){},mtgCanChangeSeries:()=>true,mtgCanRemoveMinutes:()=>false,mtgMinutesRemovalMode:()=> 'cancel',
  toast:(...args)=>messages.push(args),toastActionError:(_a,_m,error)=>messages.push([error.message,false]),registerErrorHtml:(_label,error)=>String(error),fillPersonSelect(){},momPopulateDropdowns(){},momSetAttendees(){},momSetApologies(){},
  mtgSplitAgendaPayload:()=>({items:[],signoff:{}}),mtgSplitRecommendationPayload:()=>({recs:[],meta:{}}),mtgApplyMeta(){},
  mtgCollectRecs:()=>[],mtgCollectAgenda:()=>[],mtgCollectSignoff:()=>({}),mtgCollectMeta:()=>({}),momGetAttendees:()=>'',momGetApologies:()=>'',personFromValue:()=>null,personIdsFromText:()=>[],mtgBuildAgendaPayload:items=>items,mtgBuildRecommendationPayload:items=>items,
  api:async(path,request)=>{requests.push({path,request});if(options.request)return options.request(path,request);
   if(path==='/rpc/save_hse_minutes_occurrence')return {minutes:{...request.b.p_minutes,id:request.b.p_id,updated_at:'2026-11-25T09:00:00Z'},actions:[]};
   if(path.startsWith('/meeting_series?'))return options.series||[series()];if(path.startsWith('/hse_meetings?'))return options.saved||[];if(path.startsWith('/meeting_occurrence_exceptions?'))return options.exceptions||[];throw Error('Unexpected request '+path);
  }};
 c.window=c;vm.createContext(c);vm.runInContext(helper,c);
 vm.runInContext(section('var mtgSeriesLoadVersion=0;','function mtgMissingColumnName(')+section('function mtgScheduleMeeting(','function mtgAddAgendaItem(){')+section('function mtgGetWeeksForSeries(','function mtgWeekToDate(')+section('async function mtgSaveMom(){','async function mtgDeleteMom(){')+section('async function mtgOpenMom(id){','async function mtgDeleteMomFromList('),c);
 c.mtgOccurrenceExceptions=options.exceptions||[];c.mtgAgendaLoadError=options.error||'';c.mtgTimeLabel=()=>{};c.mtgMomBack=()=>navigation.push('back');
 return {c,form,elements,requests,messages,navigation,changeCompany:value=>{company=value;}};
}
function gridCells(h){return [...h.elements['mtg-roadmap-container'].innerHTML.matchAll(/title="([^"]*)"\s+data-series-id="([^"]*)" data-auris-runtime-onclick="r0034" data-auris-runtime-args="([^"]*)"/g)].map(match=>({title:match[1],seriesId:match[2],week:JSON.parse(decodeURIComponent(match[3]))[0]}));}
function listRows(h){return descendants(h.elements['mtg-roadmap-container']).filter(node=>(node.className||'').startsWith('meeting-occurrence-row'));}

test('the editor sets the planned origin, preserves it through repeated actual-date edits and saves the same minutes ID',async()=>{
 const h=harness();h.c.mtgScheduleMeeting('series-a','2026-01-17');assert.equal(h.form.dataset.scheduledDate,'2026-01-17');assert.equal(h.form.dataset.seriesId,'series-a');
 h.form.dataset.timezone='Asia/Dubai';h.elements.mom3date.value='2026-01-24T09:00';await h.c.mtgSaveMom();
 let saved=h.c.mtgMinutesData[0];assert.ok(saved.id);assert.equal(saved.scheduled_date,'2026-01-17');const id=saved.id;
 await h.c.mtgOpenMom(id);assert.equal(h.form.dataset.scheduledDate,'2026-01-17');assert.equal(h.elements.mom3date.value,'2026-01-24T09:00');
 h.elements.mom3date.value='2026-02-20T09:00';await h.c.mtgSaveMom();
 const writes=h.requests.filter(item=>item.path.startsWith('/rpc/'));assert.equal(writes.length,2);assert.ok(writes.every(item=>item.path==='/rpc/save_hse_minutes_occurrence'&&item.request.b.p_id===id&&item.request.b.p_minutes.scheduled_date==='2026-01-17'));
 assert.equal(writes[1].request.b.p_expected_updated_at,'2026-11-25T09:00:00Z');assert.equal(h.c.mtgMinutesData.length,1);assert.equal(h.c.mtgMinutesData[0].meeting_date,'2026-02-20T05:00:00.000Z');
});

test('starting unrelated minutes or clearing the editor removes the previous occurrence identity',()=>{
 const h=harness();h.c.mtgScheduleMeeting('series-a','2026-01-17');h.c.mtgScheduleMeeting();assert.equal(h.form.dataset.seriesId,undefined);assert.equal(h.form.dataset.scheduledDate,undefined);
 h.c.mtgScheduleMeeting('series-a','2026-04-17');h.c.mtgClearMom();assert.equal(h.form.dataset.seriesId,undefined);assert.equal(h.form.dataset.scheduledDate,undefined);assert.equal(h.form.dataset.pendingMinutesId,undefined);
});

test('opening a legacy record uses only a unique inferred origin and leaves ambiguous records unbound',async()=>{
 const unique=harness({saved:[minutes({scheduled_date:null})]});await unique.c.mtgOpenMom('minutes-a');assert.equal(unique.form.dataset.scheduledDate,'2026-01-17');
 const ambiguous=harness({saved:[minutes({scheduled_date:null}),minutes({id:'minutes-b',scheduled_date:null,meeting_date:'2026-02-07T05:00:00Z'})]});
 await ambiguous.c.mtgOpenMom('minutes-b');assert.equal(ambiguous.form.dataset.scheduledDate,'');assert.equal(ambiguous.c.mtgEditingMomId,'minutes-b');
 ambiguous.elements.mom3notes.value='Unrelated legitimate edit';await ambiguous.c.mtgSaveMom();assert.equal(ambiguous.requests[0].request.b.p_minutes.scheduled_date,null);assert.equal(ambiguous.requests[0].request.b.p_id,'minutes-b');assert.equal(ambiguous.c.mtgMinutesData.length,2);
});

test('the roadmap and occurrence list share actual dates and omit the same removed or replaced planned slots',()=>{
 const h=harness({saved:[minutes()],exceptions:[{id:'exception-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-07-17',status:'cancelled'}]});h.c.mtgRenderRoadmap();
 const rows=h.c.mtgAgendaRows(h.c.mtgSeriesData[0],2026).filter(row=>!row.removed),cells=gridCells(h),list=listRows(h);
 assert.equal(cells.length,new Set(rows.map(row=>row.week)).size);assert.equal(list.length,rows.length);
 const oldWeek=h.c.mtgGetWeekNumber(new Date(2026,0,17,12)),movedWeek=h.c.mtgGetWeekNumber(new Date(2026,0,24,12)),removedWeek=h.c.mtgGetWeekNumber(new Date(2026,6,17,12));
 assert.ok(!cells.some(cell=>cell.week===oldWeek||cell.week===removedWeek));assert.ok(cells.some(cell=>cell.week===movedWeek&&cell.title.includes('24 Jan')));
 assert.equal(list.filter(row=>row.children[0].textContent.startsWith('24/01/2026')).length,1);assert.ok(!list.some(row=>/^17\/(01|07)\/2026/.test(row.children[0].textContent)));
});

test('a same-week collision stays visible as two list rows and a counted grid cell',()=>{
 const h=harness({saved:[minutes(),minutes({id:'minutes-b',scheduled_date:'2026-04-17',meeting_date:'2026-01-25T05:00:00Z'})]});h.c.mtgRenderRoadmap();
 const week=h.c.mtgGetWeekNumber(new Date(2026,0,24,12)),cell=gridCells(h).find(row=>row.week===week);assert.ok(cell);assert.match(cell.title,/24 Jan, 25 Jan/);assert.match(h.elements['mtg-roadmap-container'].innerHTML,/>2<\/span>/);
 assert.equal(listRows(h).filter(row=>/^2[45]\/01\/2026/.test(row.children[0].textContent)).length,2);
});

test('an actual 1 January date with ISO week 53 is visible in both the calendar-year grid and list',()=>{
 const h=harness({year:2027,saved:[minutes({scheduled_date:'2026-10-17',meeting_date:'2026-12-31T23:30:00Z'})]});h.c.mtgRenderRoadmap();
 assert.match(h.elements['mtg-roadmap-container'].innerHTML,/colspan="53"/);assert.ok(gridCells(h).some(cell=>cell.week===53&&cell.title.includes('01 Jan')));assert.ok(listRows(h).some(row=>row.children[0].textContent.startsWith('01/01/2027')));
});

test('failed minutes or removed-state loading blocks phantom occurrence creation from the agenda and schedule buttons',async()=>{
 for(const failed of ['minutes','exceptions']){
  const exception={id:'exception-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-01-17',status:'cancelled'},h=harness({exceptions:[exception],request:async path=>{if(path.startsWith('/meeting_series?'))return [series()];if(path.startsWith('/hse_meetings?')){if(failed==='minutes')throw Error('Connection failed');return [];}throw Error('meeting_occurrence_exceptions missing from schema cache');}});
  await h.c.mtgLoadSeries();assert.ok(h.c.mtgAgendaLoadError);assert.match(h.elements['mtg-roadmap-container'].innerHTML,/role="alert"/);assert.equal(gridCells(h).length,0);assert.equal(listRows(h).length,0);assert.equal(h.c.mtgOccurrenceExceptions[0].id,'exception-a');
  h.c.mtgScheduleMeeting('series-a','2026-04-17');assert.equal(h.form.style.display,'none','All Meeting Schedules must not bypass the unavailable agenda state');
  h.c.mtgOpenOccurrence('series-a','planned:series-a:2026-04-17');assert.equal(h.form.style.display,'none');
 }
});

test('agenda entry blocks stale schedule creation synchronously before its delayed minutes preload runs',async()=>{
 const h=harness(),timers=[];h.c.setTimeout=(callback,delay)=>{timers.push({callback,delay});};
 vm.runInContext(section('function mtgKickAgendaRoadmap(){','var mtgSeriesLoadVersion='),h.c);
 let release;h.c.mtgLoadMinutes=()=>new Promise(resolve=>{release=resolve;});h.c.mtgKickAgendaRoadmap();
 assert.match(h.c.mtgAgendaLoadError,/Loading meeting agenda/);assert.equal(h.requests.length,0);h.c.mtgScheduleMeeting('series-a','2026-04-17');assert.equal(h.form.style.display,'none');
 const running=timers.find(timer=>timer.delay===50).callback();assert.equal(h.requests.length,0);h.c.mtgOpenOccurrence('series-a','planned:series-a:2026-04-17');assert.equal(h.form.style.display,'none');
 release();await running;assert.equal(h.c.mtgAgendaLoadError,'');h.c.mtgScheduleMeeting('series-a','2026-04-17');assert.equal(h.form.style.display,'block');assert.equal(h.form.dataset.scheduledDate,'2026-04-17');
});

test('a successful complete reload restores normal navigation with fresh cancellation state',async()=>{
 const exception={id:'exception-a',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-01-17',status:'cancelled'},h=harness({error:'Previous loading failure',exceptions:[exception]});
 await h.c.mtgLoadSeries();assert.equal(h.c.mtgAgendaLoadError,'');assert.equal(listRows(h).length,3);assert.ok(!listRows(h).some(row=>row.children[0].textContent.startsWith('17/01/2026')));
 h.c.mtgOpenOccurrence('series-a','planned:series-a:2026-04-17');assert.equal(h.form.style.display,'block');assert.equal(h.form.dataset.scheduledDate,'2026-04-17');
 assert.ok(h.requests.every(item=>item.path.includes('company_id=eq.company-a')));
});

test('a stale removed-state response cannot replace the agenda after switching company',async()=>{
 let resolve,started;const ready=new Promise(done=>{started=done;}),response=new Promise(done=>{resolve=done;}),h=harness({request:async path=>{if(path.startsWith('/meeting_series?'))return [series()];if(path.startsWith('/hse_meetings?'))return [];started();return response;}}),loading=h.c.mtgLoadSeries();
 await ready;h.changeCompany('company-b');resolve([{id:'foreign-response',company_id:COMPANY,series_id:'series-a',scheduled_date:'2026-01-17',status:'cancelled'}]);await loading;assert.equal(h.c.mtgOccurrenceExceptions.length,0);assert.equal(listRows(h).length,0);assert.equal(h.elements['mtg-roadmap-container'].innerHTML,'');
});

test('permanent deletion immediately retains a trusted cancellation marker before the roadmap rerenders',async()=>{
 const record=minutes({status:'cancelled'}),h=harness({saved:[record],request:async()=>[{...record}]});
 vm.runInContext(section('function mtgMinutesRemovalMode(','function mtgNewSeries('),h.c);h.c.appConfirmDelete=async()=>true;
 assert.equal(await h.c.mtgRemoveMinutes(record.id),true);assert.equal(h.c.mtgMinutesData.length,0);assert.equal(h.c.mtgOccurrenceExceptions.length,1);
 const marker=h.c.mtgOccurrenceExceptions[0];assert.equal(marker.company_id,COMPANY);assert.equal(marker.series_id,'series-a');assert.equal(marker.scheduled_date,'2026-01-17');assert.equal(marker.status,'cancelled');
 assert.equal(listRows(h).length,3);assert.ok(!listRows(h).some(row=>row.children[0].textContent.startsWith('17/01/2026')));assert.equal(h.requests.filter(item=>item.request?.m==='DELETE').length,1);
 h.c.mtgShowRemovedOccurrences=true;h.c.mtgRenderRoadmap();assert.ok(listRows(h).some(row=>row.className.includes('is-removed')&&row.children[0].textContent.startsWith('17/01/2026')));
});

test('cancelled legacy linked minutes without a confirmed origin cannot be permanently deleted',async()=>{
 const record=minutes({status:'cancelled',scheduled_date:null}),h=harness({saved:[record],request:async()=>[{...record}]});let confirmations=0;
 vm.runInContext(section('function mtgMinutesRemovalMode(','function mtgNewSeries('),h.c);h.c.appConfirmDelete=async()=>{confirmations++;return true;};
 assert.equal(h.c.mtgCanRemoveMinutes(record),false);assert.equal(await h.c.mtgRemoveMinutes(record.id),false);assert.equal(confirmations,0);assert.equal(h.requests.length,1);assert.equal(h.requests[0].request,undefined);assert.equal(h.c.mtgMinutesData.length,1);assert.equal(h.c.mtgOccurrenceExceptions.length,0);
});

test('the Meetings module becomes ready only after its lazy occurrence API and print prerequisite load',async()=>{
 const scripts=[],pending=[],pages={},c={Intl,Date,Map,Set,Promise,Error,queueMicrotask,console,crypto:require('node:crypto').webcrypto};c.window=c;c.globalThis=c;
 c.AurisPlatformServices=Object.fromEntries(['auth','api','rbac','audit'].map(name=>[name,{isReady:()=>true}]));
 c.document={addEventListener(){},createElement:()=>({dataset:{}}),head:{appendChild(script){scripts.push(script);pending.push(script);}},getElementById:id=>pages[id]||(pages[id]={dataset:{}}),querySelector:()=>null};
 vm.createContext(c);vm.runInContext(fs.readFileSync('meeting-reliability.js','utf8'),c);vm.runInContext(fs.readFileSync('auris-module-registry.js','utf8'),c);vm.runInContext(fs.readFileSync('auris-module-extraction.js','utf8'),c);
 assert.equal(scripts.length,0);assert.equal(c.AurisMeetingAgenda,undefined);assert.deepEqual(Array.from(c.AurisModuleRegistry.get('meetings').extraction.assets),['meeting-occurrences.js','module-report-preview.js']);
 assert.doesNotMatch(fs.readFileSync('index.html','utf8'),/<script[^>]+src=["'][^"']*meeting-occurrences\.js(?:\?|["'])/);
 let ready=false;const preparing=c.AurisModuleExtraction.prepare('meetings',{services:c.AurisPlatformServices}).then(()=>{ready=true;});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(pending[0].dataset.aurisModuleAsset,'meeting-occurrences.js');assert.equal(ready,false);vm.runInContext(fs.readFileSync('meeting-occurrences.js','utf8'),c);pending.shift().onload();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof c.AurisMeetingAgenda.project,'function');assert.equal(typeof c.mtgOpenOccurrence,'function');assert.equal(typeof c.mtgChangeOccurrence,'function');assert.equal(pending[0].dataset.aurisModuleAsset,'module-report-preview.js');assert.equal(ready,false);
 pending.shift().onload();await preparing;assert.equal(ready,true);assert.equal(pages['page-meetings'].dataset.aurisExtracted,'true');assert.equal(scripts.length,2);
});
