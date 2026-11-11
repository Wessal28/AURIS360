const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const helper=fs.readFileSync('meeting-reliability.js','utf8'),core=fs.readFileSync('auris-core.js','utf8');
function runtime(extra={}){const c={Intl,Date,Map,Set,crypto:require('node:crypto').webcrypto,document:{addEventListener(){},querySelectorAll(){return [];},getElementById(){return null;}},...extra};c.window=c;vm.createContext(c);vm.runInContext(helper,c);return c;}
test('09:00 in Dubai persists as 05:00 UTC and reopens and prints as 09:00 with a timezone label',()=>{const h=runtime().AurisMeetingTime;assert.equal(h.instant('2026-10-18T09:00','Asia/Dubai'),'2026-10-18T05:00:00.000Z');assert.equal(h.wall('2026-10-18T05:00:00Z','Asia/Dubai'),'2026-10-18T09:00');assert.match(h.display('2026-10-18T05:00:00Z','Asia/Dubai'),/18\/10\/2026 09:00 \(Asia\/Dubai\)/);});
test('ambiguous and nonexistent daylight-saving wall times require correction',()=>{const h=runtime().AurisMeetingTime;assert.throws(()=>h.instant('2026-03-08T02:30','America/New_York'),/does not exist/);assert.throws(()=>h.instant('2026-11-01T01:30','America/New_York'),/occurs twice/);});
test('recurrence preserves occurrence days and month-end anchors',()=>{const h=runtime().AurisMeetingTime;assert.equal(h.next('2026-10-18','quarterly'),'2027-01-18');assert.equal(h.next('2027-01-31','monthly'),'2027-02-28');const rows=h.occurrences({next_date:'2027-01-31',recurrence:'monthly'},2027);assert.ok(rows.includes('2027-02-28'));assert.ok(rows.includes('2027-03-31'));});
test('an agenda occurrence on Sunday 18 October opens that exact date, not the Monday of its week',()=>{const calls=[],c=runtime({mtgSeriesData:[{id:'s',company_id:'c',title:'Fictional',next_date:'2026-10-18',recurrence:'quarterly'}],mtgMinutesData:[],mtgRoadmapYear:2026,mtgScheduleMeeting:(...args)=>calls.push(args)});let a=core.indexOf('function mtgGetWeeksForSeries('),b=core.indexOf('function mtgCurrentWeek',a);vm.runInContext(core.slice(a,b),c);a=core.indexOf('function mtgClickWeek(seriesId,week){');b=core.indexOf('\nfunction mtgWeekToDate',a);vm.runInContext(core.slice(a,b),c);c.mtgClickWeek('s',c.mtgGetWeekNumber(new Date(2026,9,18,12)));assert.deepEqual(calls,[['s','2026-10-18']]);});
test('partial roadmap refresh preserves full older minutes and rejects foreign-company cache rows',()=>{const c=runtime({ccid:()=> 'a',mtgMinutesData:[{id:'1',company_id:'a',title:'Old minutes',agenda_items:[{item:'Stored'}]},{id:'foreign',company_id:'b',title:'Other'}]});c.mtgMergeMinutes([{id:'1',company_id:'a',status:'draft'}],true);assert.equal(c.mtgMinutesData.length,1);assert.equal(c.mtgMinutesData[0].title,'Old minutes');assert.equal(c.mtgMinutesData[0].agenda_items[0].item,'Stored');assert.equal(c.mtgParseArray('[{"desc":"Legacy action"}]')[0].desc,'Legacy action');});

test('the agenda shows removal controls on active schedules and excludes inactive duplicates',()=>{
  const host={innerHTML:'',querySelectorAll:()=>[]};
  const c=runtime({
    document:{addEventListener(){},getElementById:id=>id==='mtg-roadmap-container'?host:null},
    ccid:()=> 'company-a',prof:{id:'manager'},isMgr:()=>true,escH:String,
    mtgRoadmapYear:2026,mtgGetWeekNumber:()=>53,mtgCurrentWeek:()=>46,mtgGetWeeksForSeries:()=>[],MTG_RECURRENCE:{quarterly:'Quarterly'},
    mtgSeriesData:[
      {id:'keep',company_id:'company-a',title:'Main quarterly review',recurrence:'quarterly',active:true},
      {id:'retired',company_id:'company-a',title:'Inactive duplicate review',recurrence:'quarterly',active:false}
    ],mtgMinutesData:[]
  });
  const start=core.indexOf('function mtgCanChangeSeries('),end=core.indexOf('var mtgSeriesRemovalPending=',start);
  const roadmap=core.indexOf('function mtgRenderRoadmap(){'),next=core.indexOf('function mtgClickWeek(',roadmap);
  vm.runInContext(core.slice(start,end)+core.slice(roadmap,next),c);
  c.mtgRenderOccurrences=()=>{};
  c.mtgRenderRoadmap();
  assert.match(host.innerHTML,/Main quarterly review/);
  assert.match(host.innerHTML,/data-mtg-series-action="delete" data-id="keep"/);
  assert.doesNotMatch(host.innerHTML,/Inactive duplicate review|data-id="retired"/);
});

test('schedule removal preserves linked minutes, confirms the exact duplicate and rejects stale writes',async()=>{
  const initial={id:'duplicate',company_id:'company-a',title:'Duplicate quarterly review',active:true,updated_at:'2026-11-11T07:00:00+00:00'};
  const keep={id:'keep',company_id:'company-a',title:'Main quarterly review',active:true};
  let schedule={...initial}, linked=true, mayViewMinutes=true, stale=false, confirm=true;
  const writes=[], prompts=[], errors=[];
  const c=runtime({
    ccid:()=> 'company-a',prof:{id:'manager'},activeRole:()=> 'manager',isMgr:()=>true,
    mtgSeriesSavePending:false,mtgSeriesLoadVersion:0,mtgSeriesData:[schedule,keep],mtgRenderRoadmap(){},toast(){},
    AurisUserAccess:{requestIssue:()=>'',allowed:()=>mayViewMinutes},
    appConfirmAction:async options=>{prompts.push(options);return confirm;},
    toastActionError:(_action,_module,error)=>errors.push(error.message),
    api:async(path,options)=>{
      if(path.startsWith('/hse_meetings?')){
        assert.equal(options,undefined,'schedule removal never writes to minutes');
        assert.match(path,/series_id=eq\.duplicate&company_id=eq\.company-a/);
        return linked?[{id:'retained-minutes'}]:[];
      }
      assert.match(path,/^\/meeting_series\?id=eq\.duplicate&company_id=eq\.company-a/);
      if(!options)return [{...schedule}];
      const params=new URLSearchParams(path.split('?')[1]);
      assert.equal(params.get('updated_at'),'eq.'+schedule.updated_at);
      assert.equal(params.get('active'),'eq.'+schedule.active);
      assert.equal(options.p,'return=representation');
      writes.push(options.m);
      if(stale)return [];
      if(options.m==='PATCH')schedule={...schedule,...options.b};
      return [schedule];
    }
  });
  const start=core.indexOf('function mtgCanChangeSeries('),end=core.indexOf('// -- SCHEDULE MEETING',start);
  vm.runInContext(core.slice(start,end),c);
  assert.equal(await c.mtgRemoveSeries(initial.id,'delete'),false);
  assert.match(errors.at(-1),/saved minutes/);
  mayViewMinutes=false;
  assert.equal(await c.mtgRemoveSeries(initial.id,'delete'),false);
  assert.match(errors.at(-1),/Access to view meeting minutes/);
  assert.deepEqual(writes,[]);
  assert.equal(await c.mtgRemoveSeries(initial.id,'deactivate'),true);
  assert.equal(c.mtgSeriesData[0].active,false);
  linked=false;mayViewMinutes=true;confirm=false;
  assert.equal(await c.mtgRemoveSeries(initial.id,'delete'),false);
  assert.match(prompts.at(-1).message,/Duplicate quarterly review/);
  confirm=true;stale=true;
  assert.equal(await c.mtgRemoveSeries(initial.id,'delete'),false);
  assert.equal(c.mtgSeriesData.length,2);
  stale=false;
  assert.equal(await c.mtgRemoveSeries(initial.id,'delete'),true);
  assert.deepEqual(writes,['PATCH','DELETE','DELETE']);
  assert.deepEqual(Array.from(c.mtgSeriesData,row=>row.id),['keep']);
});
function awareness(api){const host={innerHTML:'',addEventListener(){}};const c={document:{readyState:'loading',addEventListener(){},getElementById(){return host;}},window:{},prof:{id:'user'},ccid:()=> 'company',isMgr:()=>true,api};let source=fs.readFileSync('safety-awareness.js','utf8').replace('root.AurisSafetyAwareness={load:load','root.AurisSafetyAwareness={persist:persist,state:state,load:load');vm.runInNewContext(source,c);return {host,app:c.window.AurisSafetyAwareness,c};}
test('failed awareness saves retain the selected month, theme and all discussion text',async()=>{const x=awareness(async(_path,opts)=>{if(opts)throw Error('network disconnected');return [];});await x.app.load();x.app.state.formOpen=true;await x.app.persist({planned_month:10,theme:'Fictional October theme',discussion_points:['One','Two']});assert.equal(x.app.state.draft.month,10);assert.match(x.host.innerHTML,/value="10" selected/);assert.match(x.host.innerHTML,/Fictional October theme/);assert.match(x.host.innerHTML,/One\nTwo/);assert.match(x.host.innerHTML,/retained/);assert.equal(x.app.state.formOpen,true);});
test('a missing save confirmation does not clear the awareness draft or report success',async()=>{const x=awareness(async()=>[]);await x.app.load();x.app.state.formOpen=true;await x.app.persist({planned_month:3,theme:'Draft',discussion_points:['Keep me']});assert.equal(x.app.state.formOpen,true);assert.equal(x.app.state.message,'');assert.match(x.host.innerHTML,/Keep me/);});
test('awareness loading does not expose another company response',async()=>{const x=awareness(async()=>[{id:'bad',company_id:'other',theme:'FOREIGN',planned_month:1,discussion_points:['PRIVATE']}]);await x.app.load();assert.doesNotMatch(x.host.innerHTML,/FOREIGN|PRIVATE/);});
test('minutes and linked actions are saved through one transaction without deleting existing actions',()=>{const a=core.indexOf('async function mtgSaveMom(){'),b=core.indexOf('\nasync function mtgDeleteMom',a),source=core.slice(a,b);assert.match(source,/rpc\/save_hse_minutes/);assert.match(source,/p_expected_updated_at/);assert.doesNotMatch(source,/m:'DELETE'/);assert.match(source,/mtgSaveError/);assert.match(core,/adapter.key==='meetings'.*mtgViewMomReadOnly\(id\)/);});

test('minutes removal cancels first and verifies tenant, version and the confirmed deletion', async () => {
  const initial = {id:'minutes-a',company_id:'company-a',title:'Fixture',status:'completed',minutes:'Approved narrative',updated_at:'2026-11-11T07:00:00+00:00'};
  let row = {...initial}, company = row.company_id, permitted = true, accepted = false, stale = false;
  const writes = [], confirmations = [], errors = [];
  const c = runtime({
    ccid:()=>company, prof:{id:'manager-a'}, activeRole:()=> 'manager', isMgr:()=>true, mtgSavingMom:false, mtgMinutesData:[row],
    AurisUserAccess:{requestIssue:()=>permitted?'':'Denied'},
    appConfirmAction:async()=>{confirmations.push('cancel');return accepted;},
    appConfirmDelete:async()=>{confirmations.push('delete');return accepted;},
    toast:()=>{}, toastActionError:(_action,_module,error)=>errors.push(error.message),
    api:async(path,opts)=>{
      assert.match(path,/^\/hse_meetings\?id=eq\.minutes-a&company_id=eq\.company-a/);
      if(!opts)return [{...row}];
      assert.equal(opts.p,'return=representation');
      const query = new URLSearchParams(path.split('?')[1]);
      assert.equal(query.get('updated_at'),'eq.'+row.updated_at);
      assert.equal(query.get('status'),'eq.'+row.status);
      writes.push(opts.m);
      if(stale)return [];
      const result = [{...row,...opts.b}];
      row = opts.m==='DELETE'?null:result[0];
      return result;
    }
  });
  const start = core.indexOf('function mtgMinutesRemovalMode('), end = core.indexOf('function mtgNewSeries(',start);
  vm.runInContext(core.slice(start,end),c);
  assert.equal(await c.mtgRemoveMinutes(initial.id),false);
  assert.deepEqual(writes,[]);
  accepted=true;
  assert.equal(await c.mtgRemoveMinutes(initial.id),true);
  assert.equal(row.status,'cancelled');
  assert.equal(row.minutes,initial.minutes);
  assert.equal(c.mtgMinutesData[0].status,'cancelled');
  permitted=false;
  assert.equal(await c.mtgRemoveMinutes(initial.id),false);
  permitted=true;
  stale=true;
  assert.equal(await c.mtgRemoveMinutes(initial.id),false);
  assert.equal(c.mtgMinutesData.length,1);
  assert.match(errors.at(-1),/could not be confirmed/);
  stale=false;
  assert.equal(await c.mtgRemoveMinutes(initial.id),true);
  assert.deepEqual(writes,['PATCH','DELETE','DELETE']);
  assert.deepEqual(confirmations,['cancel','cancel','delete','delete']);
  assert.equal(c.mtgMinutesData.length,0);
});

test('the print template retains the entered meeting time and identifies the timezone',()=>{let printed='';const values={mom3title:{value:'Fictional minutes'},mom3type:{value:'management_review'},mom3date:{value:'2026-10-18T09:00'},'mtg-mom3form':{dataset:{timezone:'Asia/Dubai'}}};const c=runtime({document:{addEventListener(){},getElementById:id=>values[id]},mtgCollectSignoff:()=>({}),mtgCollectAgenda:()=>[],mtgCollectRecs:()=>[],momGetAttendees:()=>'',momGetApologies:()=>'',escH:String,aurisPrint:html=>{printed=html;}});const a=core.indexOf('function mtgPrintMom(){'),b=core.indexOf('function mtgSendMinutes(){',a);vm.runInContext(core.slice(a,b),c);c.mtgPrintMom();assert.match(printed,/18\/10\/2026 09:00 \(Asia\/Dubai\)/);assert.doesNotMatch(printed,/13:00/);});

test('older valid meeting types remain selectable instead of changing to Management Review on edit',()=>{const html=fs.readFileSync('index.html','utf8'),select=html.match(/<select id="mom3type">([\s\S]*?)<\/select>/)[1];for(const value of ['safety_committee','toolbox_talk','emergency_drill','hse_committee','management_review','other'])assert.ok(select.includes('value="'+value+'"'),value);});
