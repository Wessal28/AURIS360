const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.resolve(__dirname,'..','auris-core.js'),'utf8');

test('agenda opens stored completed minutes and drafts instead of a blank form',()=>{
  assert.match(source,/function mtgClickWeek\(seriesId,week\)/);
  assert.match(source,/var saved=matches\.find\(function\(m\)\{return String\(m\.status\|\|''\)\.toLowerCase\(\)==='completed';\}\)\|\|matches\[0\]/);
  assert.match(source,/else mtgOpenMom\(saved\.id\);return;/);
});

test('week 16 opens the stored draft for editing and keeps completed minutes read only',()=>{
  const calls=[];const c={mtgSeriesData:[{id:'series-a',title:'HSE Management Review Meeting'}],mtgMinutesData:[{id:'week-16',series_id:'series-a',meeting_date:'2026-04-15',status:'draft'}],mtgRoadmapYear:2026,mtgGetWeekNumber:()=>16,isMgr:()=>true,mtgOpenMom:id=>calls.push(['edit',id]),mtgViewMomReadOnly:id=>calls.push(['view',id])};
  vm.createContext(c);const start=source.indexOf('function mtgClickWeek(seriesId,week){'),end=source.indexOf('\nfunction mtgWeekToDate',start);vm.runInContext(source.slice(start,end),c);
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
 const c={mtgMinutesData:[{id:'meeting-1',company_id:company,status:'completed'}],ccid:()=>company,prof:{id:'user-a'},document:{getElementById:()=>null,createElement:()=>modal,body:{appendChild(){rendered++;}}},mtgSplitAgendaPayload:()=>({items:[]}),mtgSplitRecommendationPayload:()=>({recs:[]}),escH:String,MTG_TYPES:{},isMgr:()=>false,toastActionError:(a,b,e)=>{error=e.message;}};
 vm.createContext(c);const start=source.indexOf('async function mtgViewMomReadOnly(id){'),end=source.indexOf('\nasync function mtgOpenMom',start);assert.ok(end>start);vm.runInContext(source.slice(start,end),c);
 return {c,modal,switchCompany(){company='company-b';},get rendered(){return rendered;},get error(){return error;}};
}
test('partial completed minutes fetch full company-scoped content before rendering',async()=>{const h=minutesHarness();h.c.api=async path=>{assert.ok(path.includes('company_id=eq.company-a'));assert.ok(path.includes('id=eq.meeting-1'));return [{id:'meeting-1',company_id:'company-a',title:'Saved title',minutes:'Stored discussion'}];};await h.c.mtgViewMomReadOnly('meeting-1');assert.equal(h.rendered,1);assert.match(h.modal.innerHTML,/Stored discussion/);});
test('company switch during minutes fetch prevents stale content from rendering',async()=>{const h=minutesHarness();h.c.api=async()=>{h.switchCompany();return [{id:'meeting-1',company_id:'company-a',title:'Saved'}];};await h.c.mtgViewMomReadOnly('meeting-1');assert.equal(h.rendered,0);assert.match(h.error,/company changed/);});
test('wrong-company minutes response is rejected',async()=>{const h=minutesHarness();h.c.api=async()=>[{id:'meeting-1',company_id:'company-b',title:'Other'}];await h.c.mtgViewMomReadOnly('meeting-1');assert.equal(h.rendered,0);assert.match(h.error,/unavailable for this company/);});
