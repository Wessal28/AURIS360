const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.resolve(__dirname,'..','auris-core.js'),'utf8');
const occurrences=fs.readFileSync(path.resolve(__dirname,'..','meeting-occurrences.js'),'utf8');
const reliability=fs.readFileSync(path.resolve(__dirname,'..','meeting-reliability.js'),'utf8');

test('agenda opens stored completed minutes and drafts instead of a blank form',()=>{
  assert.match(source,/function mtgClickWeek\(seriesId,week\)/);
  assert.match(source,/return mtgOpenWeek\(seriesId,week\)/);
  assert.match(occurrences,/if\(entry\.status==='completed'\|\|!isMgr\(\)\)mtgViewMomReadOnly\(entry\.minutesId\);else mtgOpenMom\(entry\.minutesId\)/);
  assert.match(occurrences,/row\.key===key/);
  assert.doesNotMatch(occurrences.slice(occurrences.indexOf('root.mtgOpenWeek='),occurrences.indexOf('root.mtgChangeOccurrence=')),/matches\[0\]/);
});

test('week 16 opens the stored draft for editing and keeps completed minutes read only',()=>{
  const calls=[];const c={Intl,Date,Map,Set,document:{addEventListener(){}},ccid:()=> 'company-a',prof:{id:'user-a'},mtgAgendaLoadError:'',mtgSeriesData:[{id:'series-a',company_id:'company-a',title:'HSE Management Review Meeting',agenda_anchor_date:'2026-01-15',next_date:'2026-10-15',recurrence:'quarterly'}],mtgMinutesData:[{id:'week-16',company_id:'company-a',series_id:'series-a',scheduled_date:'2026-04-15',meeting_date:'2026-04-15T05:00:00Z',meeting_timezone:'Asia/Dubai',status:'draft'}],mtgRoadmapYear:2026,isMgr:()=>true,mtgOpenMom:id=>calls.push(['edit',id]),mtgViewMomReadOnly:id=>calls.push(['view',id])};
  c.window=c;vm.createContext(c);vm.runInContext(reliability+'\n'+occurrences,c);const start=source.indexOf('function mtgClickWeek(seriesId,week){'),end=source.indexOf('\nfunction mtgWeekToDate',start);vm.runInContext(source.slice(start,end),c);
  c.mtgClickWeek('series-a',16);assert.deepEqual(calls,[['edit','week-16']]);
  c.mtgMinutesData[0].status='completed';c.mtgClickWeek('series-a',16);assert.deepEqual(calls[1],['view','week-16']);
});

test('roadmap partial rows are refreshed before rendering complete minutes',()=>{
  assert.match(source,/async function mtgViewMomReadOnly\(id\)/);
  assert.match(source,/Object\.prototype\.hasOwnProperty\.call\(m,'title'\)/);
  assert.match(source,/\/hse_meetings\?select=\*&company_id=eq\./);
  assert.match(source,/The completed meeting minutes are unavailable for this company/);
});

test('opening a draft retrieves its full company-scoped fields before editing',()=>{
  assert.match(source,/async function mtgOpenMom\(id\)/);
  assert.match(source,/!Object\.prototype\.hasOwnProperty\.call\(m,'agenda_items'\)/);
  assert.match(source,/!Object\.prototype\.hasOwnProperty\.call\(m,'recommendations'\)/);
  assert.match(source,/These meeting minutes are unavailable for this company/);
});

const vm=require('node:vm');
function minutesHarness(){
 let company='company-a',rendered=0,error='';const modal={querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};
 const c={mtgMinutesData:[{id:'meeting-1',company_id:company,status:'completed'}],ccid:()=>company,prof:{id:'user-a'},document:{getElementById:()=>null,createElement:()=>modal,body:{appendChild(){rendered++;}}},mtgSplitAgendaPayload:()=>({items:[]}),mtgSplitRecommendationPayload:()=>({recs:[]}),mtgAttachActions(){},mtgPreparePrint(){},AurisMeetingTime:{display:String},escH:String,MTG_TYPES:{},isMgr:()=>false,toastActionError:(a,b,e)=>{error=e.message;}};
 c.window=c;
 vm.createContext(c);const start=source.indexOf('async function mtgViewMomReadOnly(id){'),end=source.indexOf('\nasync function mtgOpenMom',start);assert.ok(end>start);vm.runInContext(source.slice(source.indexOf('function mtgMinutesRemovalMode('),source.indexOf('var mtgMinutesRemovalPending='))+source.slice(start,end),c);
 return {c,modal,switchCompany(){company='company-b';},get rendered(){return rendered;},get error(){return error;}};
}
test('partial completed minutes fetch full company-scoped content before rendering',async()=>{const h=minutesHarness();h.c.api=async path=>{assert.ok(path.includes('company_id=eq.company-a'));assert.ok(path.includes('id=eq.meeting-1'));return [{id:'meeting-1',company_id:'company-a',title:'Saved title',minutes:'Stored discussion'}];};await h.c.mtgViewMomReadOnly('meeting-1');assert.equal(h.rendered,1);assert.match(h.modal.innerHTML,/Stored discussion/);});
test('company switch during minutes fetch prevents stale content from rendering',async()=>{const h=minutesHarness();h.c.api=async()=>{h.switchCompany();return [{id:'meeting-1',company_id:'company-a',title:'Saved'}];};await h.c.mtgViewMomReadOnly('meeting-1');assert.equal(h.rendered,0);assert.match(h.error,/company changed/);});
test('wrong-company minutes response is rejected',async()=>{const h=minutesHarness();h.c.api=async()=>[{id:'meeting-1',company_id:'company-b',title:'Other'}];await h.c.mtgViewMomReadOnly('meeting-1');assert.equal(h.rendered,0);assert.match(h.error,/unavailable for this company/);});

test('the minutes viewer offers the status-appropriate removal action to authorized users',async()=>{
  const h=minutesHarness();
  let status='completed';
  h.c.isMgr=()=>true;
  h.c.api=async()=>[{id:'meeting-1',company_id:'company-a',title:'Saved',status}];
  await h.c.mtgViewMomReadOnly('meeting-1');
  assert.match(h.modal.innerHTML, /Cancel minutes/);
  status='cancelled';
  delete h.c.mtgMinutesData[0].title;
  await h.c.mtgViewMomReadOnly('meeting-1');
  assert.match(h.modal.innerHTML, /Delete minutes permanently/);
  h.c.AurisUserAccess={requestIssue:()=> 'Denied'};
  await h.c.mtgViewMomReadOnly('meeting-1');
  assert.doesNotMatch(h.modal.innerHTML,/r5-remove-minutes/);
});
