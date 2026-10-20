const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('auris-core.js','utf8');
function harness(){
 const calls=[],messages=[],buttons=[{disabled:false},{disabled:false}],form={dataset:{editVersion:'editor-a',editCompany:'company-a',editUser:'user-a',timezone:'Asia/Dubai',savedUpdatedAt:'2026-10-18T05:00:00Z'},querySelectorAll:()=>buttons,prepend(el){elements[el.id]=el;}};
 const elements={'mtg-mom3form':form};
 for(const [id,value] of Object.entries({mom3title:'Fictional minutes',mom3date:'2026-10-20T09:00',mom3type:'hse_committee',mom3notes:'Keep this unsaved narrative',mom3location:'Fictional room',mom3status:'draft','mom3next-date':'2027-01-20'}))elements[id]={value};
 const c={Date,Intl,Map,Set,crypto:require('node:crypto').webcrypto,document:{addEventListener(){},getElementById:id=>elements[id],createElement:()=>({setAttribute(){}})},ccid:()=> 'company-a',prof:{id:'user-a'},isMgr:()=>true,mtgMinutesData:[],mtgEditingMomId:'minute-a',mapAllData:[],toast:(message,ok)=>messages.push([message,ok]),toastActionError:(_a,_m,e)=>messages.push([e.message,false]),mtgCollectRecs:()=>[{key:'action-key',desc:'Keep this action',status:'open'}],mtgCollectAgenda:()=>[{item:'Keep this discussion',notes:'Saved as entered'}],mtgCollectSignoff:()=>({chair:'Fictional chair'}),mtgCollectMeta:()=>({}),momGetAttendees:()=> 'Fictional attendees',momGetApologies:()=>'',personFromValue:()=>null,personIdsFromText:()=>[],mtgBuildAgendaPayload:(agenda,signoff)=>[...agenda,{_kind:'signoff',...signoff}],mtgBuildRecommendationPayload:recs=>recs,mtgMomBack:()=>calls.push('back')};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('meeting-reliability.js','utf8'),c);
 vm.runInContext("var mtgSavingMom=false;"+source.slice(source.indexOf('async function mtgSaveMom(){'),source.indexOf('\nasync function mtgDeleteMom')),c);
 return {c,calls,messages,form,elements,buttons};
}
test('missing minutes RPC retains all entries and concurrency token; retry confirms the same record and linked actions',async()=>{
 const h=harness(),requests=[];let missing=true;
 h.c.api=async(path,options)=>{requests.push([path,JSON.parse(JSON.stringify(options))]);if(missing)throw Error('Could not find the function public.save_hse_minutes(p_expected_updated_at, p_id, p_minutes) in the schema cache');return {minutes:{...options.b.p_minutes,id:options.b.p_id,updated_at:'2026-10-20T05:00:01Z'},actions:[{id:'linked-action',company_id:'company-a'}]};};
 await h.c.mtgSaveMom();
 assert.equal(h.elements.mom3notes.value,'Keep this unsaved narrative');assert.equal(h.elements.mom3status.value,'draft');assert.equal(h.form.dataset.savedUpdatedAt,'2026-10-18T05:00:00Z');assert.equal(h.form.dataset.pendingMinutesId,'minute-a');assert.deepEqual(h.calls,[]);
 assert.match(h.elements['mtg-save-error'].textContent,/database update[\s\S]*Your entries are retained/);assert.doesNotMatch(h.messages.at(-1)[0],/public\.|p_expected_updated_at|schema cache/);assert.ok(h.buttons.every(b=>!b.disabled));assert.equal(h.c.mtgSavingMom,false);
 missing=false;await h.c.mtgSaveMom();
 assert.equal(requests.length,2);assert.equal(requests[1][0],'/rpc/save_hse_minutes');assert.equal(requests[1][1].b.p_id,'minute-a');assert.equal(requests[1][1].b.p_expected_updated_at,'2026-10-18T05:00:00Z');assert.equal(requests[1][1].b.p_minutes.meeting_date,'2026-10-20T05:00:00.000Z');assert.equal(requests[1][1].b.p_minutes.recommendations[0].desc,'Keep this action');assert.deepEqual(h.calls,['back']);assert.equal(h.c.mapAllData[0].id,'linked-action');assert.equal(h.form.dataset.savedUpdatedAt,'2026-10-20T05:00:01Z');
});
test('in-flight minutes saves reject duplicate clicks and release controls after a failure',async()=>{
 const h=harness();let release,requests=0;h.c.api=()=>{requests++;return new Promise((_resolve,reject)=>release=()=>reject(Error('Connection timed out')));};
 const first=h.c.mtgSaveMom();assert.ok(h.buttons.every(b=>b.disabled));await h.c.mtgSaveMom();assert.equal(requests,1);release();await first;assert.ok(h.buttons.every(b=>!b.disabled));assert.match(h.elements['mtg-save-error'].textContent,/Connection timed out.*entries are retained/);assert.deepEqual(h.calls,[]);
});
